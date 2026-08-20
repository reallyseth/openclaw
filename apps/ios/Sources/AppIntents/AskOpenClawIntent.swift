import AppIntents
import Foundation
import OpenClawChatUI
import OpenClawKit
import os

/// Primary Siri intent: "Hey Siri, ask OpenClaw to [check the weather]."
///
/// Sends a message to the active agent via the existing Gateway session.
/// If the agent responds within 8 seconds, Siri speaks a truncated preview.
/// Otherwise the Live Activity shows "Thinking…" and the user can check
/// the Dynamic Island for updates.
@available(iOS 18.0, *)
struct AskOpenClawIntent: AppIntent {
    static let title: LocalizedStringResource = "Ask OpenClaw"
    static let description = IntentDescription("Send a message to your OpenClaw agent")
    static let openAppWhenRun: Bool = false

    @Parameter(title: "Message")
    var message: String

    private static let logger = Logger(subsystem: "ai.openclawfoundation.app", category: "AskOpenClawIntent")

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard let appModel = OpenClawAppModelRegistry.appModel else {
            return .result(dialog: "OpenClaw isn't running. Please open the app first.")
        }

        // A Siri invocation may cold-launch the app in the background; the
        // operator gateway reconnect loop needs a moment to re-establish the
        // session. Wait briefly before declaring the gateway unreachable.
        if !appModel.isOperatorGatewayConnected {
            Self.logger.info("Siri intent: gateway not connected, waiting for reconnect")
            let deadline = Date.now.addingTimeInterval(6)
            while Date.now < deadline, !appModel.isOperatorGatewayConnected {
                try? await Task.sleep(for: .milliseconds(300))
            }
        }
        guard appModel.isOperatorGatewayConnected else {
            return .result(dialog: "OpenClaw isn't connected to a gateway. Please open the app and connect.")
        }

        let sessionKey = appModel.chatSessionKey
        let agentID = appModel.chatDeliveryAgentId
        let agentName = appModel.chatAgentName
        let idempotencyKey = UUID().uuidString

        Self.logger.info("Siri intent: sending message to session=\(sessionKey, privacy: .public)")

        // Build transport through the app model's factory
        let transport = appModel.makeChatTransport()

        // 1. Store pending query
        let queryID = UUID()
        let pending = SiriQueryStore.PendingQuery(
            id: queryID,
            message: self.message,
            sessionKey: sessionKey,
            agentID: agentID,
            runId: nil,
            startedAt: .now)
        SiriQueryStore.setPending(pending)

        // 2. Start Live Activity
        SiriLiveActivityBridge.shared.showQuerying(
            message: self.message,
            agentName: agentName,
            sessionKey: sessionKey)

        // 3. Send message
        do {
            let sendResponse = try await transport.sendMessage(
                sessionKey: sessionKey,
                message: self.message,
                thinking: "",
                idempotencyKey: idempotencyKey,
                attachments: [])

            // Update pending with runId
            SiriQueryStore.setPending(SiriQueryStore.PendingQuery(
                id: queryID,
                message: self.message,
                sessionKey: sessionKey,
                agentID: agentID,
                runId: sendResponse.runId,
                startedAt: .now))

            // 4. Wait for run completion (8s budget for hybrid speak)
            let observation = await transport.waitForRunCompletion(
                runId: sendResponse.runId,
                timeoutMs: 8000)

            switch observation {
            case .terminal(.completed):
                // 5a. Fast path — fetch the response and speak it
                let preview = await Self.fetchLastAssistantText(
                    transport: transport,
                    sessionKey: sessionKey)
                    ?? "Done!"

                let truncatedPreview = String(preview.prefix(200))
                let spokenText = String(preview.prefix(500))

                SiriLiveActivityBridge.shared.showResult(
                    responsePreview: truncatedPreview,
                    agentName: agentName,
                    sessionKey: sessionKey)

                SiriQueryStore.complete(SiriQueryStore.CompletedQuery(
                    id: queryID,
                    message: self.message,
                    responsePreview: truncatedPreview,
                    fullResponse: preview,
                    sessionKey: sessionKey,
                    completedAt: .now))

                return .result(dialog: IntentDialog(stringLiteral: spokenText))

            case let .terminal(.failed(failureMessage)):
                SiriLiveActivityBridge.shared.end()
                SiriQueryStore.clearPending()
                return .result(dialog: "OpenClaw encountered an error: \(failureMessage)")

            case .checkAgain, .unavailable:
                // 5b. Slow path — start detached long-poll, then return
                Self.startDetachedLongPoll(
                    transport: transport,
                    runId: sendResponse.runId,
                    queryID: queryID,
                    message: self.message,
                    sessionKey: sessionKey,
                    agentName: agentName)

                // ActivityKit only starts Live Activities from the foreground;
                // when Siri launched us in the background the island can't appear.
                let islandAvailable = LiveActivityManager.shared.currentActivity != nil
                return .result(dialog: islandAvailable
                    ? "I've sent that to OpenClaw. Check the Dynamic Island for updates."
                    : "I've sent that to OpenClaw. Open the app to see the response.")
            }
        } catch {
            Self.logger.error("Siri intent send failed: \(error.localizedDescription, privacy: .public)")
            SiriLiveActivityBridge.shared.end()
            SiriQueryStore.clearPending()
            return .result(dialog: "Couldn't reach OpenClaw: \(error.localizedDescription)")
        }
    }

    /// Fetches the last assistant message text from history.
    private static func fetchLastAssistantText(
        transport: any OpenClawChatTransport,
        sessionKey: String) async -> String?
    {
        guard let history = try? await transport.requestHistory(sessionKey: sessionKey),
              let messages = history.messages
        else { return nil }

        // Messages are [AnyCodable]; decode each to OpenClawChatMessage
        for msgData in messages.reversed() {
            guard let data = try? JSONEncoder().encode(msgData),
                  let msg = try? JSONDecoder().decode(OpenClawChatMessage.self, from: data)
            else { continue }

            if msg.role.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == "assistant" {
                let text = ChatMessageVisibleText.visibleText(in: msg)
                let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty {
                    return trimmed
                }
            }
        }
        return nil
    }

    /// Starts a detached task that continues long-polling for up to 120 seconds.
    /// When the run completes, it updates the Live Activity and SiriQueryStore.
    private nonisolated static func startDetachedLongPoll(
        transport: any OpenClawChatTransport,
        runId: String,
        queryID: UUID,
        message: String,
        sessionKey: String,
        agentName: String)
    {
        Task.detached {
            // Long-poll in bounded chunks (120s + 180s ≈ the Live Activity
            // stale window) so slow runs keep the island alive instead of
            // silently dismissing it at a single 120s timeout.
            var observation = await transport.waitForRunCompletion(
                runId: runId,
                timeoutMs: 120_000)
            if case .checkAgain = observation {
                observation = await transport.waitForRunCompletion(
                    runId: runId,
                    timeoutMs: 180_000)
            }

            await MainActor.run {
                switch observation {
                case .terminal(.completed):
                    Task {
                        let preview = await fetchLastAssistantText(
                            transport: transport,
                            sessionKey: sessionKey)
                            ?? "Done!"
                        let truncated = String(preview.prefix(200))

                        SiriLiveActivityBridge.shared.showResult(
                            responsePreview: truncated,
                            agentName: agentName,
                            sessionKey: sessionKey)

                        SiriQueryStore.complete(SiriQueryStore.CompletedQuery(
                            id: queryID,
                            message: message,
                            responsePreview: truncated,
                            fullResponse: preview,
                            sessionKey: sessionKey,
                            completedAt: .now))
                    }
                case .terminal(.failed):
                    SiriLiveActivityBridge.shared.end()
                    SiriQueryStore.clearPending()
                case .checkAgain, .unavailable:
                    // Still running (or unavailable) after the poll budget:
                    // keep the island honest rather than silently ending it.
                    SiriLiveActivityBridge.shared.showQuerying(
                        message: "Still working — open the app",
                        agentName: agentName,
                        sessionKey: sessionKey)
                    SiriQueryStore.clearPending()
                }
            }
        }
    }
}
