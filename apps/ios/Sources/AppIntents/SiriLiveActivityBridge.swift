import Foundation
import os

/// Bridges between Siri intents and the existing LiveActivityManager.
/// Shows a Siri-specific Live Activity state while the agent is processing,
/// then updates with the response preview or dismisses on completion.
@MainActor
final class SiriLiveActivityBridge {
    static let shared = SiriLiveActivityBridge()

    private let logger = Logger(subsystem: "ai.openclawfoundation.app", category: "SiriLiveActivityBridge")
    private var dismissTask: Task<Void, Never>?

    private init() {}

    /// Shows a "Thinking…" Live Activity while the agent processes the query.
    func showQuerying(
        message preview: String,
        agentName: String,
        sessionKey: String)
    {
        dismissTask?.cancel()
        dismissTask = nil

        LiveActivityManager.shared.showSiriQuery(
            message: preview,
            agentName: agentName,
            sessionKey: sessionKey)
    }

    /// Shows the response preview in the Live Activity, then auto-dismisss after 10 seconds.
    func showResult(
        responsePreview: String,
        agentName: String,
        sessionKey: String)
    {
        LiveActivityManager.shared.showSiriResult(
            preview: responsePreview,
            agentName: agentName,
            sessionKey: sessionKey)

        // Auto-dismiss after 10 seconds so the Live Activity doesn't linger
        dismissTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(10))
            guard !Task.isCancelled else { return }
            self?.end()
        }
    }

    /// Dismisses the Siri Live Activity immediately.
    func end() {
        dismissTask?.cancel()
        dismissTask = nil
        LiveActivityManager.shared.endSiriActivity()
    }
}
