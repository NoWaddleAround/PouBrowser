import Foundation

/// The app speaks German on a German phone and English everywhere else. Both languages are declared
/// in Info.plist (`CFBundleLocalizations`), so iOS picks one of them, and its own parts of the screen
/// (the Cancel button of a dialog, the share sheet) come in the same language as the app's texts.
let isGerman = Bundle.main.preferredLocalizations.first == "de"

/// A text in the app's language. Both versions sit side by side where they are used.
func L(_ german: String, _ english: String) -> String { isGerman ? german : english }
