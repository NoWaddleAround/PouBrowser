import AVFAudio
import CryptoKit
import SwiftUI

@main
struct RuheApp: App {
    #if targetEnvironment(macCatalyst)
    @UIApplicationDelegateAdaptor private var appDelegate: AppDelegate
    #endif

    init() {
        // Background sound and picture-in-picture are only granted to apps whose audio counts as playback.
        try? AVAudioSession.sharedInstance().setCategory(.playback)
        #if DEBUG
        let site = { Browser.site(URL(string: $0)) }
        assert(site("https://www.bbc.co.uk/news") == "bbc.co.uk")
        assert(site("https://cdn.example.com") == site("https://example.com/a"))
        assert(site("https://a.co.uk") != site("https://b.co.uk"))
        assert(Browser.destination(for: "example.com/x").absoluteString == "https://example.com/x")
        assert(Browser.destination(for: "http://localhost:8795/").absoluteString == "http://localhost:8795/")
        assert(Browser.destination(for: "localhost:3000").absoluteString == "http://localhost:3000")
        assert(Browser.destination(for: "one piece 1100", engine: SearchEngine.all[0]).host == "duckduckgo.com")
        assert(Browser.destination(for: "a b", engine: SearchEngine.all[3]).query == "query=a%20b")
        assert(Browser.destination(for: "https://example.com/p?id=1&fbclid=abc&utm_source=x").absoluteString == "https://example.com/p?id=1")
        // Bookmark files: Netscape HTML round trip, entities and folders.
        let parsed = BookmarkFile.parse(html: BookmarkFile.html([Library.Entry(url: URL(string: "https://a.example/?x=1&y=2")!, title: "A & <B>", date: .now)])
                                         + "<DL><DT><H3>Ordner</H3><DL><DT><a href='x'>no</a><DT><A HREF=\"http://b.example/\" ICON=\"data:x\">B</A></DL></DL>")
        assert(parsed.map(\.url.absoluteString) == ["https://a.example/?x=1&y=2", "http://b.example/"] && parsed[0].title == "A & <B>")
        // Sync file format, shared with Android: PBKDF2-SHA256 200,000 rounds, AES-GCM combined box.
        let syncKey = Sync.key("pou-test", Data(count: 16))
        assert(syncKey.withUnsafeBytes { Data($0) }.map { String(format: "%02x", $0) }.joined()
               == "ee9464645021ff1073ef91cab564a6af237a043f7a0cecfed5a8584035fa5412")
        assert((try? AES.GCM.open(AES.GCM.SealedBox(combined: AES.GCM.seal(Data("x".utf8), using: syncKey).combined!), using: syncKey)) == Data("x".utf8))
        #endif
    }

    var body: some Scene {
        WindowGroup { ContentView() }
            #if targetEnvironment(macCatalyst)
            .commands { BrowserTabCommands() }
            #endif
    }
}

#if targetEnvironment(macCatalyst)
private struct BrowserSessionKey: FocusedValueKey {
    typealias Value = Session
}

extension FocusedValues {
    var browserSession: Session? {
        get { self[BrowserSessionKey.self] }
        set { self[BrowserSessionKey.self] = newValue }
    }
}

private struct BrowserTabCommands: Commands {
    /// Catalyst drops a whole menu when two items of the menu bar share a title (a page that is bookmarked and
    /// was just visited). Zero-width spaces, a different number per item, keep the titles apart invisibly.
    static func unique(_ title: String, _ number: Int) -> String {
        title + String(repeating: "\u{200B}", count: number + 1)
    }

    @FocusedValue(\.browserSession) private var session

    private var tab: Browser? { session?.current }
    private var hasPage: Bool { tab?.hasCommittedPage == true }

    // The menu bar follows Chrome's on the Mac: Datei, Bearbeiten, Darstellung, Verlauf, Lesezeichen, Tab, Fenster.
    var body: some Commands {
        // Datei. One window only (UIApplicationSupportsMultipleScenes is off in Info.plist): a second one would get its
        // own Session and overwrite the first one's tabs and files. Groups placed next to UIKit's own do not show on
        // Catalyst, so the tab items share this one.
        CommandGroup(replacing: .saveItem) {
            Button(L("Neuer Tab", "New Tab")) { session?.newTab(); session?.addressRequests += 1 }
                .keyboardShortcut("t")
            Button(L("Neuer privater Tab", "New Private Tab")) { session?.newPrivateTab(); session?.addressRequests += 1 }
                .keyboardShortcut("n", modifiers: [.command, .shift])
            Button(L("Geschlossenen Tab wieder öffnen", "Reopen Closed Tab")) { session?.reopenClosedTab() }
                .keyboardShortcut("t", modifiers: [.command, .shift])
                .disabled(session?.closedTabs.isEmpty != false)
            Button(L("Adresse öffnen …", "Open Location …")) { session?.addressRequests += 1 }
                .keyboardShortcut("l")
            Divider()
            Button(L("Tab schließen", "Close Tab")) { if let tab { session?.close(tab) } }
                .keyboardShortcut("w")
            Divider()
            Button(L("Seite sichern unter …", "Save Page As …")) { Task { await tab?.savePage() } }
                .keyboardShortcut("s")
                .disabled(!hasPage)
        }
        CommandGroup(replacing: .printItem) {
            Button(L("Drucken …", "Print …")) { tab?.printPage() }
                .keyboardShortcut("p")
                .disabled(!hasPage)
        }
        CommandGroup(after: .pasteboard) {
            Divider()
            Button(L("Suchen …", "Find …")) { tab?.find() }
                .keyboardShortcut("f")
            Button(L("Weitersuchen", "Find Next")) { tab?.find(.forward) }
                .keyboardShortcut("g")
            Button(L("Rückwärts suchen", "Find Previous")) { tab?.find(.backward) }
                .keyboardShortcut("g", modifiers: [.command, .shift])
        }
        // Darstellung
        CommandGroup(after: .toolbar) {
            Button(session?.showsBookmarksBar == true ? L("Lesezeichenleiste ausblenden", "Hide Bookmarks Bar") : L("Lesezeichenleiste einblenden", "Show Bookmarks Bar")) {
                session?.showsBookmarksBar.toggle()
            }
            .keyboardShortcut("b", modifiers: [.command, .shift])
            Button(session?.verticalTabs == true ? L("Tabs oben anzeigen", "Show Tabs on Top") : L("Tabs seitlich anzeigen", "Show Tabs on the Side")) {
                session?.verticalTabs.toggle()
            }
            .keyboardShortcut("s", modifiers: [.command, .shift])
            Button(session?.compact == true ? L("Kompaktmodus beenden", "Exit Compact Mode") : L("Kompaktmodus", "Compact Mode")) {
                session?.compact.toggle()
            }
            .keyboardShortcut("\\")
            Divider()
            Button(L("Stoppen", "Stop")) { tab?.webView?.stopLoading() }
                .keyboardShortcut(".")
                .disabled(tab?.isLoading != true)
            Button(L("Diese Seite neu laden", "Reload This Page")) { tab?.reload() }
                .keyboardShortcut("r")
                .disabled(tab?.address == nil)
            Button(L("Neu laden erzwingen", "Force Reload This Page")) { tab?.webView?.reloadFromOrigin() }
                .keyboardShortcut("r", modifiers: [.command, .shift])
                .disabled(!hasPage)
            Divider()
            Button(L("Originalgröße", "Actual Size")) { tab?.changeZoom(by: nil) }
                .keyboardShortcut("0")
            Button(L("Vergrößern", "Zoom In")) { tab?.changeZoom(by: 0.1) }
                .keyboardShortcut("+")
            Button(L("Verkleinern", "Zoom Out")) { tab?.changeZoom(by: -0.1) }
                .keyboardShortcut("-")
        }
        CommandMenu(L("Verlauf", "History")) {
            Button(L("Zurück", "Back")) { tab?.webView?.goBack() }
                .keyboardShortcut("[")
                .disabled(tab?.canGoBack != true)
            Button(L("Vorwärts", "Forward")) { tab?.webView?.goForward() }
                .keyboardShortcut("]")
                .disabled(tab?.canGoForward != true)
            Divider()
            Section(L("Kürzlich geschlossen", "Recently Closed")) {
                ForEach(Array((session?.closedTabs ?? []).suffix(8).reversed().enumerated()), id: \.offset) { index, closed in
                    Button(Self.unique(closed.title?.isEmpty == false ? closed.title! : closed.url.absoluteString, index)) {
                        _ = session?.openInNewTab(closed.url)
                    }
                }
            }
            Section(L("Kürzlich besucht", "Recently Visited")) {
                ForEach(Array((session?.library.history ?? []).prefix(10).enumerated()), id: \.offset) { index, entry in
                    Button(Self.unique(entry.title, 10 + index)) { tab?.open(entry.url) }
                }
            }
            Divider()
            Button(L("Gesamtverlauf anzeigen", "Show Full History")) { session?.openLibrary(.history) }
                .keyboardShortcut("y")
            // Chrome has it under Fenster; Catalyst cannot add to that menu.
            Button(L("Downloads", "Downloads")) { session?.showsDownloads = true }
                .keyboardShortcut("l", modifiers: [.command, .option])
        }
        CommandMenu(L("Lesezeichen", "Bookmarks")) {
            Button(L("Lesezeichenmanager öffnen", "Bookmark Manager")) { session?.showsLibrary = true }
                .keyboardShortcut("b", modifiers: [.command, .option])
            Button(session?.library.isBookmarked(tab?.address) == true ? L("Lesezeichen entfernen", "Remove Bookmark") : L("Lesezeichen für diesen Tab erstellen", "Bookmark This Tab")) {
                if let tab, let url = tab.address { session?.library.toggleBookmark(url, title: tab.label) }
            }
            .keyboardShortcut("d")
            .disabled(tab?.address == nil)
            Button(L("Alle Tabs als Lesezeichen speichern", "Bookmark All Tabs")) {
                if let added = session?.bookmarkAllTabs() { tab?.show(L("\(added) Lesezeichen hinzugefügt", "\(added) bookmarks added"), symbol: "star.fill") }
            }
            .keyboardShortcut("d", modifiers: [.command, .shift])
            Menu(L("Lesezeichen importieren", "Import Bookmarks")) {
                ForEach(BookmarkFile.chromiumFiles, id: \.name) { source in
                    Button(L("Aus \(source.name)", "From \(source.name)")) {
                        let found = BookmarkFile.chromium(source.file)
                        let added = session?.library.importBookmarks(found) ?? 0
                        tab?.show(found.isEmpty ? L("Keine Lesezeichen von \(source.name) lesbar. Dort als HTML exportieren und hier über „HTML-Datei …“ laden.",
                                                    "No \(source.name) bookmarks readable. Export them there as HTML and load that via “HTML File …”.")
                                  : L("\(added) Lesezeichen aus \(source.name) übernommen", "\(added) bookmarks taken from \(source.name)"),
                                  symbol: "star.fill")
                    }
                }
                Button(L("HTML-Datei …", "HTML File …")) { session?.openLibrary(.importFile) }
            }
            Divider()
            ForEach(Array((session?.library.bookmarks ?? []).prefix(20).enumerated()), id: \.offset) { index, entry in
                Button(Self.unique(entry.title, 20 + index)) { tab?.open(entry.url) }
            }
        }
        CommandMenu(L("Tab", "Tab")) {
            Button(L("Nächster Tab", "Next Tab")) { session?.selectAdjacentTab(by: 1) }
                .keyboardShortcut(.rightArrow, modifiers: [.command, .option])
                .disabled((session?.tabs.count ?? 0) < 2)
            Button(L("Vorheriger Tab", "Previous Tab")) { session?.selectAdjacentTab(by: -1) }
                .keyboardShortcut(.leftArrow, modifiers: [.command, .option])
                .disabled((session?.tabs.count ?? 0) < 2)
            // Chrome's other way, ⌃Tab: same items, not shown twice in spirit but SwiftUI needs a button per shortcut.
            Button(L("Nächster Tab (⌃⇥)", "Next Tab (⌃⇥)")) { session?.selectAdjacentTab(by: 1) }
                .keyboardShortcut(.tab, modifiers: .control)
                .disabled((session?.tabs.count ?? 0) < 2)
            Button(L("Vorheriger Tab (⌃⇧⇥)", "Previous Tab (⌃⇧⇥)")) { session?.selectAdjacentTab(by: -1) }
                .keyboardShortcut(.tab, modifiers: [.control, .shift])
                .disabled((session?.tabs.count ?? 0) < 2)
            Divider()
            // One button for both, so ⌃⌘S is registered once. The tab to the right joins, or the one to the left
            // at the end of the row.
            Button(session?.split.isEmpty == false ? L("Geteilte Ansicht beenden", "Close Split View") : L("Geteilte Ansicht mit nächstem Tab", "Split View with Next Tab")) {
                guard let session else { return }
                if !session.split.isEmpty { return session.split = [] }
                if let index = session.tabs.firstIndex(where: { $0 === session.current }) {
                    session.showSplit(with: session.tabs[index + 1 < session.tabs.count ? index + 1 : index - 1])
                }
            }
            .keyboardShortcut("s", modifiers: [.command, .control])
            .disabled((session?.tabs.count ?? 0) < 2)
            Divider()
            Button(L("Tab duplizieren", "Duplicate Tab")) {
                if let url = tab?.address { _ = session?.openInNewTab(url, inBackground: false) }
            }
            .disabled(tab?.address == nil)
            Button(tab?.isMuted == true ? L("Ton einschalten", "Unmute Site") : L("Website stummschalten", "Mute Site")) {
                if let tab { tab.setMuted(!tab.isMuted) }
            }
            Button(tab?.isPinned == true ? L("Tab loslösen", "Unpin Tab") : L("Tab anpinnen", "Pin Tab")) {
                if let tab { session?.setPinned(tab, !tab.isPinned) }
            }
            Divider()
            Button(L("Andere Tabs schließen", "Close Other Tabs")) {
                session?.tabs.filter { $0 !== tab && !$0.isPinned }.forEach { session?.close($0) }
            }
            .disabled((session?.tabs.count ?? 0) < 2)
            Button(L("Tabs rechts schließen", "Close Tabs to the Right")) {
                if let tabs = session?.tabs, let index = tabs.firstIndex(where: { $0 === tab }) { tabs[(index + 1)...].filter { !$0.isPinned }.forEach { session?.close($0) } }
            }
            .disabled(session?.tabs.last === tab)
            Divider()
            Button(L("Tabs suchen …", "Search Tabs …")) { session?.showsTabSearch = true }
                .keyboardShortcut("a", modifiers: [.command, .shift])
            Divider()
            // ⌘1 to ⌘8 pick that tab, ⌘9 the last one, as in Chrome.
            ForEach(1..<10) { number in
                Button(number == 9 ? L("Letzter Tab", "Last Tab") : L("Tab \(number)", "Tab \(number)")) {
                    guard let tabs = session?.tabs, !tabs.isEmpty else { return }
                    if number == 9 { session?.select(tabs[tabs.count - 1]) } else if number <= tabs.count { session?.select(tabs[number - 1]) }
                }
                .keyboardShortcut(KeyEquivalent(Character(String(number))), modifiers: .command)
            }
        }
        CommandMenu(L("Entwickler", "Developer")) {
            Button(session?.devTools == nil ? L("Entwicklertools", "Developer Tools") : L("Entwicklertools schließen", "Close Developer Tools")) {
                session?.devTools = session?.devTools == nil ? .console : nil
            }
            .keyboardShortcut("i", modifiers: [.command, .option])
            Button(L("Element untersuchen", "Inspect Element")) {
                session?.devTools = .console
                if let tab { Task { await tab.inspectElement() } }
            }
            .keyboardShortcut("c", modifiers: [.command, .option])
            Button(L("JavaScript-Konsole", "JavaScript Console")) { session?.devTools = .console }
                .keyboardShortcut("j", modifiers: [.command, .option])
            Button(L("Netzwerk", "Network")) { session?.devTools = .network }
            Divider()
            Button(L("Seitenquelltext anzeigen", "View Page Source")) { session?.showSource() }
                .keyboardShortcut("u", modifiers: [.command, .option])
        }
    }
}

/// Takes out UIKit's document items (Duplizieren, Bewegen, Umbenennen), which every Mac app gets but a browser does not use.
final class AppDelegate: UIResponder, UIApplicationDelegate {
    override func buildMenu(with builder: UIMenuBuilder) {
        super.buildMenu(with: builder)
        builder.remove(menu: .document)
    }
}
#endif
