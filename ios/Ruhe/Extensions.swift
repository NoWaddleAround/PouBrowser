import SwiftUI
import UniformTypeIdentifiers
import WebKit

/// Web extensions in the WebExtension format (as in Safari, Chrome and Firefox), added by the user from an unpacked
/// folder or a .zip. Each one is copied into the app and loaded at start into one controller that every tab shares.
@MainActor @Observable
final class Extensions: NSObject, WKWebExtensionControllerDelegate {
    /// Persistent storage: an extension keeps its settings between launches (keyed by its folder name).
    let controller = WKWebExtensionController(configuration: .default())
    private(set) var installed = [WKWebExtensionContext]()
    @ObservationIgnored private unowned let session: Session

    private static let folder = URL.applicationSupportDirectory
        .appending(path: Bundle.main.bundleIdentifier ?? "PouBrowser").appending(path: "Extensions")

    init(session: Session) {
        self.session = session
        super.init()
        controller.delegate = self
    }

    /// Loads what was installed before. Tabs made earlier get the extensions too: they share the controller.
    func start() async {
        let saved = (try? FileManager.default.contentsOfDirectory(
            at: Self.folder, includingPropertiesForKeys: nil, options: .skipsHiddenFiles)) ?? []
        for url in saved.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
            do { try await load(url) } catch { session.log("ERWEITERUNG nicht geladen \(url.lastPathComponent): \(error)") }
        }
        controller.didOpenWindow(session)
        controller.didFocusWindow(session)
    }

    /// Copies the picked folder or .zip into the app and loads it; nothing stays behind when it fails.
    func install(from picked: URL) async {
        let scoped = picked.startAccessingSecurityScopedResource()
        defer { if scoped { picked.stopAccessingSecurityScopedResource() } }
        let isZip = picked.pathExtension.lowercased() == "zip"
        let target = Self.folder.appending(path: UUID().uuidString + (isZip ? ".zip" : ""))
        do {
            try FileManager.default.createDirectory(at: Self.folder, withIntermediateDirectories: true)
            try FileManager.default.copyItem(at: picked, to: target)
            let context = try await load(target)
            let name = context.webExtension.displayName ?? picked.lastPathComponent
            session.current.show(L("Erweiterung hinzugefügt: ", "Extension added: ") + name, symbol: "puzzlepiece.extension.fill")
        } catch {
            try? FileManager.default.removeItem(at: target)
            session.log("ERWEITERUNG Installation gescheitert \(picked.lastPathComponent): \(error)")
            session.current.show(L("Keine gültige Erweiterung: ", "Not a valid extension: ") + error.localizedDescription,
                                 symbol: "exclamationmark.triangle.fill", lasting: true)
        }
    }

    func remove(_ context: WKWebExtensionContext) {
        try? controller.unload(context)
        installed.removeAll { $0 === context }
        let saved = (try? FileManager.default.contentsOfDirectory(at: Self.folder, includingPropertiesForKeys: nil)) ?? []
        for url in saved where url.deletingPathExtension().lastPathComponent == context.uniqueIdentifier {
            try? FileManager.default.removeItem(at: url)
        }
        session.log("ERWEITERUNG entfernt: \(Self.name(of: context))")
    }

    @discardableResult
    private func load(_ url: URL) async throws -> WKWebExtensionContext {
        let webExtension = try await WKWebExtension(resourceBaseURL: url)
        let context = WKWebExtensionContext(for: webExtension)
        context.uniqueIdentifier = url.deletingPathExtension().lastPathComponent
        // The user picked this extension, so it gets what its manifest asks for, as when installing in a browser.
        for permission in webExtension.requestedPermissions { context.setPermissionStatus(.grantedExplicitly, for: permission) }
        for pattern in webExtension.allRequestedMatchPatterns { context.setPermissionStatus(.grantedExplicitly, for: pattern) }
        try controller.load(context)
        installed.append(context)
        session.log("ERWEITERUNG geladen: \(Self.name(of: context)) \(webExtension.version ?? "")")
        return context
    }

    static func name(of context: WKWebExtensionContext) -> String {
        context.webExtension.displayName ?? context.uniqueIdentifier
    }

    // MARK: WKWebExtensionControllerDelegate

    func webExtensionController(_ controller: WKWebExtensionController, openWindowsFor extensionContext: WKWebExtensionContext) -> [any WKWebExtensionWindow] {
        [session]
    }

    func webExtensionController(_ controller: WKWebExtensionController, focusedWindowFor extensionContext: WKWebExtensionContext) -> (any WKWebExtensionWindow)? {
        session
    }

    func webExtensionController(_ controller: WKWebExtensionController, openNewTabUsing configuration: WKWebExtension.TabConfiguration,
                                for extensionContext: WKWebExtensionContext) async throws -> (any WKWebExtensionTab)? {
        guard let url = configuration.url else {
            session.newTab()
            return session.current
        }
        return session.openInNewTab(url, inBackground: !configuration.shouldBeActive)
    }

    func webExtensionController(_ controller: WKWebExtensionController, openOptionsPageFor extensionContext: WKWebExtensionContext) async throws {
        guard let url = extensionContext.optionsPageURL else { return }
        session.openInNewTab(url)
    }

    // An optional permission asked for at run time: granted, like those in the manifest.
    func webExtensionController(_ controller: WKWebExtensionController, promptForPermissions permissions: Set<WKWebExtension.Permission>,
                                in tab: (any WKWebExtensionTab)?, for extensionContext: WKWebExtensionContext) async -> (Set<WKWebExtension.Permission>, Date?) {
        (permissions, nil)
    }

    func webExtensionController(_ controller: WKWebExtensionController, promptForPermissionToAccess urls: Set<URL>,
                                in tab: (any WKWebExtensionTab)?, for extensionContext: WKWebExtensionContext) async -> (Set<URL>, Date?) {
        (urls, nil)
    }

    func webExtensionController(_ controller: WKWebExtensionController, promptForPermissionMatchPatterns matchPatterns: Set<WKWebExtension.MatchPattern>,
                                in tab: (any WKWebExtensionTab)?, for extensionContext: WKWebExtensionContext) async -> (Set<WKWebExtension.MatchPattern>, Date?) {
        (matchPatterns, nil)
    }

    /// The extension's popup (its toolbar page), as a popover on the Mac and iPad and a sheet on the iPhone.
    func webExtensionController(_ controller: WKWebExtensionController, presentActionPopup action: WKWebExtension.Action,
                                for context: WKWebExtensionContext) async throws {
        guard let popup = action.popupViewController,
              let scene = UIApplication.shared.connectedScenes.first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene,
              var top = scene.keyWindow?.rootViewController else { return }
        while let shown = top.presentedViewController { top = shown }
        popup.modalPresentationStyle = .popover
        if let anchor = popup.popoverPresentationController {
            anchor.sourceView = top.view
            anchor.sourceRect = CGRect(x: top.view.bounds.maxX - 60, y: top.view.safeAreaInsets.top, width: 1, height: 1)
            anchor.permittedArrowDirections = .up
        }
        top.present(popup, animated: true)
    }
}
