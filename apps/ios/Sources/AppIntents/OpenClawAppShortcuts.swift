import AppIntents
import Foundation

/// Registers Siri phrases for OpenClaw intents. Discovered by the system
/// from the app binary — powers "Hey Siri, ask OpenClaw to…"
@available(iOS 18.0, *)
struct OpenClawAppShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: AskOpenClawIntent(),
            phrases: [
                "Ask \(.applicationName) to \(\.$message)",
                "Tell \(.applicationName) to \(\.$message)",
                "Send a message to \(.applicationName): \(\.$message)",
            ],
            shortTitle: "Ask OpenClaw",
            systemImageName: "bubble.left"
        )

        AppShortcut(
            intent: ReadLastOpenClawResponseIntent(),
            phrases: [
                "What did \(.applicationName) say?",
                "Read the last \(.applicationName) response",
            ],
            shortTitle: "Read Last Response",
            systemImageName: "speaker.wave.2"
        )
    }
}
