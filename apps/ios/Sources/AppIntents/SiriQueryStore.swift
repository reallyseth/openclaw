import Foundation
import os

/// Lightweight persistence for Siri queries using UserDefaults. Stores a
/// single pending slot and the most recent completed response so the
/// follow-up intent ("What did OpenClaw say?") can read it aloud.
enum SiriQueryStore {
    private static let logger = Logger(subsystem: "ai.openclawfoundation.app", category: "SiriQueryStore")

    struct PendingQuery: Codable, Equatable {
        let id: UUID
        let message: String
        let sessionKey: String
        let agentID: String?
        let runId: String?
        let startedAt: Date
    }

    struct CompletedQuery: Codable, Equatable {
        let id: UUID
        let message: String
        let responsePreview: String
        let fullResponse: String?
        let sessionKey: String
        let completedAt: Date
    }

    private enum Key {
        static let pending = "siri.pendingQuery"
        static let lastResponse = "siri.lastResponse"
    }

    private static let defaults: UserDefaults = .standard

    static var pending: PendingQuery? {
        guard let data = defaults.data(forKey: Key.pending) else { return nil }
        return try? JSONDecoder().decode(PendingQuery.self, from: data)
    }

    static var lastResponse: CompletedQuery? {
        guard let data = defaults.data(forKey: Key.lastResponse) else { return nil }
        return try? JSONDecoder().decode(CompletedQuery.self, from: data)
    }

    static func setPending(_ query: PendingQuery) {
        do {
            let data = try JSONEncoder().encode(query)
            defaults.set(data, forKey: Key.pending)
        } catch {
            logger.error("Failed to encode pending query: \(error.localizedDescription, privacy: .public)")
        }
    }

    static func complete(_ query: CompletedQuery) {
        do {
            let data = try JSONEncoder().encode(query)
            defaults.set(data, forKey: Key.lastResponse)
        } catch {
            logger.error("Failed to encode completed query: \(error.localizedDescription, privacy: .public)")
        }
        clearPending()
    }

    static func clearPending() {
        defaults.removeObject(forKey: Key.pending)
    }
}
