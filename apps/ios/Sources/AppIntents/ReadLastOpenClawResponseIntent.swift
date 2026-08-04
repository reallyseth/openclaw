import AppIntents
import Foundation

/// Follow-up intent: "Hey Siri, what did OpenClaw say?"
/// Reads the most recent agent response aloud from SiriQueryStore.
@available(iOS 18.0, *)
struct ReadLastOpenClawResponseIntent: AppIntent {
    static var title: LocalizedStringResource = "Read Last OpenClaw Response"
    static var description = IntentDescription("Reads the most recent OpenClaw agent response")
    static var openAppWhenRun: Bool = false

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard let completed = SiriQueryStore.lastResponse else {
            return .result(dialog: "OpenClaw hasn't responded to anything yet.")
        }

        let spokenText = completed.fullResponse ?? completed.responsePreview
        return .result(dialog: IntentDialog.string(spokenText))
    }
}
