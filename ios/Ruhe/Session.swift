import WebKit

/// Breaks the strong reference `WKUserContentController.add(_:name:)` keeps on its message handler.
private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    weak var target: Session?
    init(_ target: Session) { self.target = target }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        MainActor.assumeIsolated {
            target?.userContentController(controller, didReceive: message)
        }
    }
}

struct ClosedTab {
    let url: URL
    let title: String?
    let scroll: Double
}

/// What all tabs share: the blocker, the log, the JavaScript switches and the list of tabs itself.
@MainActor @Observable
final class Session: NSObject, WKScriptMessageHandler {
    let blocker = Blocker.shared
    private(set) var tabs = [Browser]()
    private(set) var current: Browser!
    private(set) var closedTabs = [ClosedTab]()
    /// Tabs in the order they were last looked at. Only the first few keep a live page: on an
    /// iPhone 13 every open page costs memory, and iOS ends pages and the app when it runs short.
    @ObservationIgnored private var recent = [Browser]()
    #if targetEnvironment(macCatalyst)
    private static let awake = 12   // a Mac has the memory
    #else
    private static let awake = 3
    #endif

    /// Sites where the user switched JavaScript off. No script means no popup, but many pages then show less.
    private(set) var scriptlessSites = Set(UserDefaults.standard.stringArray(forKey: "scriptlessSites") ?? [])

    /// Sites where the user switched the ad blocker off, because the site refuses to work with one
    /// (proxer.me). Popups and forced redirects stay blocked there.
    private(set) var unfilteredSites = Set(UserDefaults.standard.stringArray(forKey: "unfilteredSites") ?? [])

    /// Sites where the user asked for the desktop edition (useful for YouTube background playback or desktop layouts).
    private(set) var desktopSites = Set(UserDefaults.standard.stringArray(forKey: "desktopSites") ?? [])

    /// Repaints web pages in dark colours with the Dark Reader library. Tabs take the change when they
    /// load next, so hidden ones are put to sleep and the one in front reloads.
    var darkPages = UserDefaults.standard.bool(forKey: "darkPages") {
        didSet {
            UserDefaults.standard.set(darkPages, forKey: "darkPages")
            log("DUNKLE SEITEN \(darkPages ? "an" : "aus")")
            for tab in tabs where tab !== current { tab.sleep() }
            current?.reload()
        }
    }

    /// On: videos may float (picture-in-picture) and do so when the app is left. Off: no video ever
    /// floats, only its sound goes on. Each tab picks the change up when it is next in front.
    /// DuckDuckGo's autoconsent answers cookie banners with "reject" (`Resources/autoconsent.js`).
    var rejectsCookies = UserDefaults.standard.object(forKey: "rejectsCookies") as? Bool ?? true {
        didSet {
            UserDefaults.standard.set(rejectsCookies, forKey: "rejectsCookies")
            log("COOKIE-BANNER ABLEHNEN \(rejectsCookies ? "an" : "aus")")
            current?.reload()
        }
    }
    /// Pages load over HTTPS; WebKit warns before falling back to HTTP. Local addresses are exempt.
    var httpsOnly = UserDefaults.standard.object(forKey: "httpsOnly") as? Bool ?? true {
        didSet {
            UserDefaults.standard.set(httpsOnly, forKey: "httpsOnly")
            log("NUR HTTPS \(httpsOnly ? "an" : "aus")")
        }
    }
    /// Sites whose cookie banner was answered this app session: the notice shows once per site.
    var cookieSites: Set<String> = []
    /// Hosts the user opened despite a certificate error, until the app quits.
    var trustedHosts: Set<String> = []
    /// Sites the user opened over plain HTTP from the HTTPS warning page, until the app quits.
    var httpHosts: Set<String> = []

    var floatsVideo = UserDefaults.standard.object(forKey: "floatsVideo") as? Bool ?? true {
        didSet {
            UserDefaults.standard.set(floatsVideo, forKey: "floatsVideo")
            log("BILD-IN-BILD \(floatsVideo ? "an" : "aus")")
            current?.activate()
        }
    }

    /// What pages tried and what the guard decided, kept in the background so a popup that gets through
    /// can be traced afterwards. Shared from the menu; "Alles löschen" removes it.
    static let logFile = URL.applicationSupportDirectory
        .appending(path: Bundle.main.bundleIdentifier ?? "PouBrowser").appending(path: "Ruhe-Protokoll.txt")
    private static let timestampFormatter = ISO8601DateFormatter()
    @ObservationIgnored private var logLines =
        (try? String(contentsOf: Session.logFile, encoding: .utf8))?.components(separatedBy: "\n") ?? []
    @ObservationIgnored private var logFlushTask: Task<Void, Never>?
    @ObservationIgnored private lazy var weakHandler = WeakMessageHandler(self)
    /// Bookmarks and history.
    let library = Library()
    /// All requests the filter lists ever stopped, for the start page.
    private(set) var blockedTotal = UserDefaults.standard.integer(forKey: "blockedTotal")
    /// Page zoom per site (1 = 100 %).
    private(set) var zooms = UserDefaults.standard.dictionary(forKey: "pageZoom") as? [String: Double] ?? [:]
    /// Sites that never load: pages, popups, redirects, frames and everything embedded from them.
    var blockedSites: Set<String> { blocker.blockedSites }
    /// A long-pressed video or audio file waiting for the user's choice, and a finished download for the share sheet.
    var mediaOffer: MediaOffer?
    var sharedFile: SharedFile?
    /// This run's downloads, newest last (Chrome's downloads list).
    var downloads = [DownloadItem]()
    var showsDownloads = false
    var showsTabSearch = false
    var showsLibrary = false
    /// Mac: no bars until the pointer touches the top edge (Zen's compact mode).
    var compact = UserDefaults.standard.bool(forKey: "compact") {
        didSet { UserDefaults.standard.set(compact, forKey: "compact") }
    }
    /// Mac: the tabs in a column on the left instead of a strip on top.
    var verticalTabs = UserDefaults.standard.bool(forKey: "verticalTabs") {
        didSet { UserDefaults.standard.set(verticalTabs, forKey: "verticalTabs") }
    }
    /// Mac split view: two tabs side by side, left and right. Empty when off.
    var split: [Browser] = []
    var splitRatio = 0.5
    /// The page an ⌥-click previews over the tab, until it is closed or kept as a tab.
    var glance: Browser?
    /// All private tabs share one store, as in Chrome's incognito window: gone with the last private tab.
    @ObservationIgnored private var privateStore: WKWebsiteDataStore?
    /// Where the library sheet opens: the menu's "Gesamtverlauf" (⌘Y) and "HTML-Datei …" want more than bookmarks.
    @ObservationIgnored var libraryPage = LibraryView.Page.bookmarks
    func openLibrary(_ page: LibraryView.Page) {
        libraryPage = page
        showsLibrary = true
    }

    /// Counts requests to put the cursor in the address field (⌘L, ⌘T from the menu).
    var addressRequests = 0
    /// The page source the user asked to see.
    var viewedSource: PageSource?
    /// Mac: the bookmarks under the address field (⌘⇧B), as in Chrome.
    var showsBookmarksBar = UserDefaults.standard.object(forKey: "showsBookmarksBar") as? Bool ?? true {
        didSet { UserDefaults.standard.set(showsBookmarksBar, forKey: "showsBookmarksBar") }
    }
    let passwords = Passwords()
    let sync = Sync()
    /// A sign-in a page just sent, waiting for "Passwort speichern?".
    var passwordOffer: Credential?
    /// The open part of the developer tools, nil while they are closed.
    var devTools: DevPane?
    /// Sites whose data is deleted when their last tab closes.
    private(set) var forgetSites = Set(UserDefaults.standard.stringArray(forKey: "forgetSites") ?? [])
    /// Elements the user hid ("Element ausblenden"), as CSS selectors per site.
    private(set) var hiddenElements = UserDefaults.standard.dictionary(forKey: "hiddenElements") as? [String: [String]] ?? [:]
    var searchEngine = SearchEngine.current.name {
        didSet { UserDefaults.standard.set(searchEngine, forKey: "searchEngine") }
    }
    /// Web extensions the user added; every tab's web view gets their controller.
    @ObservationIgnored private(set) lazy var extensions = Extensions(session: self)

    override init() {
        super.init()
        sync.session = self
        library.changed = { [weak self] in self?.sync.changed(.bookmarks) }
        passwords.changed = { [weak self] in self?.sync.changed(.passwords) }
        blocker.register(self)
        NotificationCenter.default.addObserver(
            forName: UIApplication.didReceiveMemoryWarningNotification, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.memoryIsLow() }
        }

        let defaults = UserDefaults.standard
        var saved = (defaults.array(forKey: "tabs") as? [[String: Any]] ?? []).map {
            (
                url: ($0["url"] as? String).flatMap(URL.init),
                title: $0["title"] as? String,
                scroll: $0["scroll"] as? Double ?? 0,
                pinned: $0["pinned"] as? Bool ?? false
            )
        }
        var index = defaults.integer(forKey: "currentTab")
        // `-lastURL <address>` as a launch argument opens that page (see Scripts/popup-test). The key also
        // holds the open page of an install from before tabs.
        if let url = defaults.string(forKey: "lastURL").flatMap(URL.init) {
            saved.append((url, nil, defaults.double(forKey: "lastScroll"), false))
            index = saved.count - 1
            defaults.removeObject(forKey: "lastURL")
        }
        tabs = saved.map {
            let tab = Browser(session: self, url: $0.url, title: $0.title, scroll: $0.scroll)
            tab.isPinned = $0.pinned
            return tab
        }
        if tabs.isEmpty { tabs = [Browser(session: self)] }
        select(tabs[min(max(index, 0), tabs.count - 1)])
    }

    /// What a tab's pages get at document start. Popup sites keep the real `window.open`.
    func pageScripts(allowingPopups: Bool = false) -> [WKUserScript] {
        (allowingPopups ? Self.baseScripts.map { $0 === Self.pageUserScript ? Self.popupPageUserScript : $0 } : Self.baseScripts)
            + (darkPages ? [Self.darkScript] : [])
    }

    /// Random per app start, so the fingerprint noise of `privacy.js` differs per site and per start. Pages never see it.
    private static let privacyKey = UUID().uuidString
    /// `privacy.js` and `autoconsent.js` run in the page's world (they change its functions) and report through "privacy".
    private static func privacyScript(_ name: String) -> WKUserScript {
        let body = Bundle.main.url(forResource: name, withExtension: "js").flatMap { try? String(contentsOf: $0, encoding: .utf8) } ?? ""
        return WKUserScript(source: """
            (() => {
            const pouKey = "\(privacyKey)";
            const pouTell = (kind, text) => { try { webkit.messageHandlers.privacy.postMessage(kind + "\\n" + text); } catch (error) {} };
            \(body)
            })();
            """, injectionTime: .atDocumentStart, forMainFrameOnly: false, in: .page)
    }
    static let privacyUserScript = privacyScript("privacy")
    static let cookieUserScript = privacyScript("autoconsent")

    private static let pageUserScript = WKUserScript(source: Browser.pageScript, injectionTime: .atDocumentStart, forMainFrameOnly: false)
    private static let popupPageUserScript = WKUserScript(
        source: Browser.pageScript.replacingOccurrences(of: "const allowPopups = false", with: "const allowPopups = true"),
        injectionTime: .atDocumentStart, forMainFrameOnly: false)

    /// Dark Reader (MIT licence, `Resources/darkreader.js` from the npm package `darkreader`), kept
    /// inside a function so pages do not get a `DarkReader` object of their own to find.
    private static let darkScript: WKUserScript = {
        let library = Bundle.main.url(forResource: "darkreader", withExtension: "js")
            .flatMap { try? String(contentsOf: $0, encoding: .utf8) } ?? ""
        let source = """
            (() => {
                const exports = {}, module = {};
                \(library)
                try {
                    exports.setFetchMethod(window.fetch);
                    exports.enable({ brightness: 100, contrast: 95, sepia: 0 });
                } catch (error) {}
            })();
            """
        return WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: false)
    }()

    /// The scripts every page gets. The media script goes first: its listener must hear "hidden"
    /// before the page script silences it.
    static let baseScripts =
        (off("noMediaScript") ? [] : [WKUserScript(
            source: Browser.mediaScript, injectionTime: .atDocumentStart, forMainFrameOnly: false, in: .defaultClient)])
        + [Browser.downloadScript, Browser.passwordScript,
           WKUserScript(source: Browser.hoverScript, injectionTime: .atDocumentStart, forMainFrameOnly: false, in: .defaultClient)]
        + (off("noPageScript") ? [] : [pageUserScript])
        + (off("logErrors") ? [WKUserScript(source: diagnosisScript, injectionTime: .atDocumentStart, forMainFrameOnly: false)] : [])

    /// Diagnosis (`-logErrors YES`): script errors of every frame and, after a while, the state of its videos.
    private static let diagnosisScript = """
        (() => {
            const tell = text => { try { webkit.messageHandlers.tap.postMessage('[DIAGNOSE ' + location.hostname + '] ' + text); } catch (error) {} };
            addEventListener('error', event => {
                if (event.message) tell('Fehler: ' + event.message + ' @ ' + (event.filename || '').slice(-60) + ':' + event.lineno);
                else if (event.target && event.target.tagName) tell('Laden gescheitert: ' + event.target.tagName + ' ' + String(event.target.src || event.target.href || '').slice(0, 120));
            }, true);
            addEventListener('unhandledrejection', event => tell('Abgelehnt: ' + String(event.reason && (event.reason.stack || event.reason.message) || event.reason).slice(0, 300)));
            addEventListener('click', event => {
                const describe = e => e.tagName + (e.id ? '#' + e.id : '') + (e.className && e.className.baseVal === undefined ? '.' + String(e.className).trim().replace(/\\s+/g, '.') : '')
                    + '[' + getComputedStyle(e).position + ' z' + getComputedStyle(e).zIndex + ' pe:' + getComputedStyle(e).pointerEvents + ' op:' + getComputedStyle(e).opacity + ' kinder:' + e.children.length + ']';
                tell('Klick ' + (event.isTrusted ? 'echt' : 'Skript') + ' Stapel: ' + document.elementsFromPoint(event.clientX, event.clientY).slice(0, 6).map(describe).join(' > '));
            }, true);
            const wrapped = fetch;
            window.fetch = function (input, options) {
                const address = String(input && input.url || input).slice(0, 110);
                return wrapped.apply(this, arguments).then(
                    response => { tell('fetch ' + response.status + ' ' + address); return response; },
                    error => { tell('fetch GESCHEITERT ' + address + ' ' + error); throw error; });
            };
            const open = XMLHttpRequest.prototype.open;
            XMLHttpRequest.prototype.open = function (method, address) {
                this.addEventListener('loadend', () => tell('xhr ' + this.status + ' ' + String(address).slice(0, 110)));
                return open.apply(this, arguments);
            };
            setTimeout(() => {
                if (location.hostname.includes('krussdomi')) tell('Geladen: ' + performance.getEntriesByType('resource').map(e => e.name.replace(/^https:\\/\\//, '').slice(0, 60)).join(' , ').slice(0, 1500));
                const videos = [...document.querySelectorAll('video')].map(v =>
                    'bereit ' + v.readyState + ' netz ' + v.networkState + ' fehler ' + (v.error ? v.error.code : '-') + ' quelle ' + String(v.currentSrc || v.src).slice(0, 80)
                    + ' spuren ' + [...v.textTracks].map(t => t.kind + '/' + t.mode + '/' + (t.cues ? t.cues.length : '-') + '/' + t.language).join(','));
                tell('Stand: ' + videos.length + ' Videos [' + videos.join(' | ') + '] sw ' + ('serviceWorker' in navigator) + ' mse ' + (typeof MediaSource) + '/' + (typeof ManagedMediaSource) + ' text: ' + (document.body ? document.body.innerText.replace(/\\s+/g, ' ').slice(0, 120) : ''));
            }, 12000);
        })();
        """

    /// Launch arguments that switch one protection off (or a diagnosis on) to find what breaks a page;
    /// `Scripts/video-check.sh` drives them. Off: `-noLists`, `-noPageRules`, `-noPageScript`,
    /// `-noMediaScript`, `-noAgent`, `-autoplay` (no tap needed for sound), `-plainConfig` (web view
    /// without our settings), `-plainPolicy` (no navigation rules), `-plain` (both). On: `-logBlocked`
    /// (requests a filter list dropped), `-logErrors` (script errors, network calls, video state per frame).
    nonisolated static func off(_ part: String) -> Bool { UserDefaults.standard.bool(forKey: part) }

    /// Each tab has its own controller, because the filter scripts differ from page to page.
    func makeController() -> WKUserContentController {
        let controller = WKUserContentController()
        controller.add(weakHandler, name: "popup")
        controller.add(weakHandler, name: "tap")
        controller.add(weakHandler, contentWorld: .defaultClient, name: "media")
        controller.add(weakHandler, contentWorld: .defaultClient, name: "download")
        controller.add(weakHandler, name: "devConsole")
        controller.add(weakHandler, name: "privacy")
        controller.add(weakHandler, contentWorld: .defaultClient, name: "password")
        controller.add(weakHandler, contentWorld: .defaultClient, name: "hover")
        blocker.attach(to: controller)
        return controller
    }

    func showSource() {
        let tab = current!
        Task { viewedSource = await tab.pageSource() }
    }

    // MARK: Tabs

    func privateDataStore() -> WKWebsiteDataStore {
        if let privateStore { return privateStore }
        let store = WKWebsiteDataStore.nonPersistent()
        privateStore = store
        return store
    }

    /// `tab` beside the tab in front. Picking a tab outside the pair ends the split.
    func showSplit(with tab: Browser) {
        guard tab !== current else { return }
        tab.activate()
        split = [current, tab]
    }

    /// Previews `url` over the page; `keepGlance` turns it into a tab.
    func openGlance(_ url: URL) {
        glance?.retire()
        let tab = Browser(session: self, url: Browser.cleanURL(url), isPrivate: current.isPrivate)
        tab.activate()
        glance = tab
    }

    func closeGlance() {
        glance?.retire()
        glance = nil
    }

    func keepGlance() {
        guard let tab = glance else { return }
        glance = nil
        tabs.insert(tab, at: max((tabs.firstIndex { $0 === current } ?? tabs.count - 1) + 1, tabs.count { $0.isPinned }))
        if !tab.isPrivate { extensions.controller.didOpenTab(tab) }
        select(tab)
    }

    func select(_ tab: Browser) {
        tab.activate()   // first, so the tab in front always has its web view
        let previous = current
        current = tab
        if !split.contains(where: { $0 === tab }) { split = [] }
        // Extensions do not see private tabs.
        if previous !== tab, !tab.isPrivate {
            extensions.controller.didActivateTab(tab, previousActiveTab: previous?.isPrivate == true ? nil : previous)
        }
        recent.removeAll { $0 === tab }
        recent.insert(tab, at: 0)
        for old in recent.dropFirst(Self.awake) where !old.isPlaying && !split.contains(where: { $0 === old }) { old.sleep() }
        save()
    }

    func selectAdjacentTab(by offset: Int) {
        guard tabs.count > 1, let index = tabs.firstIndex(where: { $0 === current }) else { return }
        select(tabs[(index + tabs.count + offset) % tabs.count])
    }

    private func memoryIsLow() {
        log("SPEICHER knapp, verdeckte Tabs schlafen")
        for tab in tabs where tab !== current && !tab.isPlaying && !split.contains(where: { $0 === tab }) { tab.sleep() }
        for tab in tabs { tab.discardPreview() }
    }

    func newPrivateTab() {
        let tab = Browser(session: self, isPrivate: true)
        tabs.append(tab)
        select(tab)
    }

    func newTab() {
        tabs.append(Browser(session: self))
        extensions.controller.didOpenTab(tabs[tabs.count - 1])
        select(tabs[tabs.count - 1])
    }

    @discardableResult
    func openInNewTab(_ url: URL, inBackground: Bool = false) -> Browser {
        let cleaned = Browser.cleanURL(url)
        // A link out of a private tab stays private.
        let tab = Browser(session: self, url: cleaned, isPrivate: current?.isPrivate ?? false)
        if let currentIndex = tabs.firstIndex(where: { $0 === current }) {
            tabs.insert(tab, at: max(currentIndex + 1, tabs.count { $0.isPinned }))
        } else {
            tabs.append(tab)
        }
        if !tab.isPrivate { extensions.controller.didOpenTab(tab) }
        if inBackground {
            save()
            current?.show(L("Im Hintergrund geöffnet: ", "Opened in background: ") + (cleaned.host ?? ""), symbol: "plus.square.on.square")
        } else {
            select(tab)
        }
        return tab
    }

    func openExternal(_ url: URL) {
        guard let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else { return }
        let cleaned = Browser.cleanURL(url)
        if current.address == nil {
            current.open(cleaned)
        } else {
            openInNewTab(cleaned, inBackground: false)
        }
    }

    func close(_ tab: Browser) {
        guard let index = tabs.firstIndex(where: { $0 === tab }) else { return }
        if let url = tab.address, !tab.isPrivate {
            closedTabs.append(ClosedTab(url: url, title: tab.title, scroll: tab.scrollY))
            if closedTabs.count > 10 { closedTabs.removeFirst(closedTabs.count - 10) }
        }
        tabs.remove(at: index)
        recent.removeAll { $0 === tab }
        if split.contains(where: { $0 === tab }) { split = [] }
        tab.retire()
        if tab.isPrivate, !tabs.contains(where: \.isPrivate), glance?.isPrivate != true { privateStore = nil }
        if !tab.isPrivate { extensions.controller.didCloseTab(tab, windowIsClosing: false) }
        if tabs.isEmpty { tabs = [Browser(session: self)] }
        if tab === current { select(tabs[min(index, tabs.count - 1)]) } else { save() }
        if let site = Browser.site(tab.address), forgetSites.contains(site),
           !tabs.contains(where: { Browser.site($0.address) == site }) {
            Task { await forget(site: site) }
        }
    }

    /// "Seite vergessen": closes the site's tabs and deletes what it stored (cookies, storage, caches) and its history.
    func forget(site: String) async {
        for tab in tabs where Browser.site(tab.address) == site { close(tab) }
        let store = WKWebsiteDataStore.default()
        let types = WKWebsiteDataStore.allWebsiteDataTypes()
        let records = await store.dataRecords(ofTypes: types).filter {
            $0.displayName == site || $0.displayName.hasSuffix("." + site)
        }
        await store.removeData(ofTypes: types, for: records)
        library.forgetHistory(of: site)
        log("VERGESSEN \(site): \(records.count) Datensätze")
        current.show(L("\(site) vergessen", "\(site) forgotten"), symbol: "checkmark.circle.fill")
    }

    func setBlocked(_ blocked: Bool, site: String) {
        blocker.setBlocked(blocked, site: site)
        sync.changed(.blockedSites)
    }

    /// "Seite sperren": on the block list, and its open tabs close.
    func block(site: String) {
        setBlocked(true, site: site)
        for tab in tabs where Browser.site(tab.address) == site { close(tab) }
        log("GESPERRT \(site)")
        current.show(L("\(site) gesperrt", "\(site) blocked"), symbol: "nosign")
    }

    func setForget(_ on: Bool, site: String) {
        if on { forgetSites.insert(site) } else { forgetSites.remove(site) }
        UserDefaults.standard.set(Array(forgetSites), forKey: "forgetSites")
    }

    func hide(_ selector: String, on site: String) {
        hiddenElements[site, default: []].append(selector)
        UserDefaults.standard.set(hiddenElements, forKey: "hiddenElements")
    }

    func restoreHidden(on site: String) {
        hiddenElements[site] = nil
        UserDefaults.standard.set(hiddenElements, forKey: "hiddenElements")
    }

    /// Pinned tabs move to the front, unpinned ones right after the last pinned tab.
    func setPinned(_ tab: Browser, _ pinned: Bool) {
        tab.isPinned = pinned
        tabs = tabs.filter(\.isPinned) + tabs.filter { !$0.isPinned }
        save()
    }

    func bookmarkAllTabs() -> Int {
        library.importBookmarks(tabs.filter { !$0.isPrivate }.compactMap { tab in tab.address.map { ($0, tab.label) } })
    }

    func reopenClosedTab() {
        guard let last = closedTabs.popLast() else { return }
        let tab = Browser(session: self, url: last.url, title: last.title, scroll: last.scroll)
        tabs.append(tab)
        extensions.controller.didOpenTab(tab)
        select(tab)
    }

    /// Remembers the open tabs and reading positions for the next start, which may come sooner than
    /// the user thinks: iOS ends apps in the background when memory runs short.
    func save() {
        let defaults = UserDefaults.standard
        let kept = tabs.filter { !$0.isPrivate }
        defaults.set(kept.map {
            [
                "url": $0.address?.absoluteString ?? "",
                "title": String(($0.title ?? "").prefix(250)),
                "scroll": $0.scrollY,
                "pinned": $0.isPinned,
            ]
        }, forKey: "tabs")
        defaults.set(kept.firstIndex { $0 === current } ?? max(kept.count - 1, 0), forKey: "currentTab")
    }

    func appBecameActive() {
        let switches = ["noLists", "noPageRules", "noPageScript", "noMediaScript", "autoplay", "noAgent", "plain",
                        "plainConfig", "plainPolicy", "logBlocked", "logErrors"].filter(Self.off)
        log("APP aktiv" + (switches.isEmpty ? "" : " · Schalter: " + switches.joined(separator: ", ")))
        current.activate()
        current.returned()
        Task { await sync.run() }
    }

    /// The moment the app starts to leave the screen: later than this iOS no longer lets a video start floating.
    func appIsLeaving() {
        log("APP wird verlassen")
        current.leaving(floating: floatsVideo)
    }

    func appWentToBackground() {
        log("APP im Hintergrund")
        flushLogNow()
        save()
    }

    // MARK: Shared state

    /// The sync's newer copy of a site list (joined with this device's on its first sync).
    func replaceSites(_ part: Sync.Part, with sites: Set<String>, joining: Bool) {
        switch part {
        case .unfilteredSites:
            unfilteredSites = joining ? unfilteredSites.union(sites) : sites
            UserDefaults.standard.set(Array(unfilteredSites), forKey: "unfilteredSites")
        case .scriptlessSites:
            scriptlessSites = joining ? scriptlessSites.union(sites) : sites
            UserDefaults.standard.set(Array(scriptlessSites), forKey: "scriptlessSites")
        case .blockedSites:
            blocker.replaceBlocked(joining ? blockedSites.union(sites) : sites)
        default: break
        }
    }

    func setFiltering(allowed: Bool, on site: String) {
        if allowed { unfilteredSites.remove(site) } else { unfilteredSites.insert(site) }
        UserDefaults.standard.set(Array(unfilteredSites), forKey: "unfilteredSites")
        sync.changed(.unfilteredSites)
        log("WERBEBLOCKER \(allowed ? "an" : "aus") für \(site)")
    }

    /// Sites where page popups open as tabs (sign-in windows).
    private(set) var popupSites = Set(UserDefaults.standard.stringArray(forKey: "popupSites") ?? [])

    func setPopups(allowed: Bool, on site: String) {
        if allowed { popupSites.insert(site) } else { popupSites.remove(site) }
        UserDefaults.standard.set(Array(popupSites), forKey: "popupSites")
        log("POPUPS \(allowed ? "erlaubt" : "blockiert") für \(site)")
    }

    /// A popup from `opener` as a tab right after it, in front. Its web view comes from WebKit's configuration.
    func openPopup(from opener: Browser, with configuration: WKWebViewConfiguration) -> WKWebView {
        let tab = Browser(session: self, isPrivate: opener.isPrivate)
        let view = tab.adopt(configuration)
        tabs.insert(tab, at: max((tabs.firstIndex { $0 === opener } ?? tabs.count - 1) + 1, tabs.count { $0.isPinned }))
        if !tab.isPrivate { extensions.controller.didOpenTab(tab) }
        select(tab)
        return view
    }

    func setScripts(allowed: Bool, on site: String) {
        let changed = allowed ? scriptlessSites.remove(site) != nil : scriptlessSites.insert(site).inserted
        guard changed else { return }
        UserDefaults.standard.set(Array(scriptlessSites), forKey: "scriptlessSites")
        sync.changed(.scriptlessSites)
        log("JAVASCRIPT \(allowed ? "an" : "aus") für \(site)")
        if Browser.site(current?.address) == site { current?.reload() }
    }

    func countBlocked() {
        blockedTotal += 1
        UserDefaults.standard.set(blockedTotal, forKey: "blockedTotal")
    }

    func zoom(on site: String?) -> Double { site.flatMap { zooms[$0] } ?? 1 }

    /// Steps of 10 % between 50 and 300 %; nil goes back to 100 %.
    func setZoom(_ level: Double?, on site: String) {
        zooms[site] = level.map { min(max(($0 * 10).rounded() / 10, 0.5), 3) }
        if zooms[site] == 1 { zooms[site] = nil }
        UserDefaults.standard.set(zooms, forKey: "pageZoom")
    }

    func setDesktop(enabled: Bool, on site: String) {
        if enabled { desktopSites.insert(site) } else { desktopSites.remove(site) }
        UserDefaults.standard.set(Array(desktopSites), forKey: "desktopSites")
        log("DESKTOP-SEITE \(enabled ? "an" : "aus") für \(site)")
    }

    func log(_ entry: String) {
        logLines.append("\(Self.timestampFormatter.string(from: .now)) \(entry.prefix(600))")
        if logLines.count > 1000 { logLines.removeFirst(logLines.count - 1000) }
        guard logFlushTask == nil else { return }
        logFlushTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(1200))
            self?.flushLogNow()
        }
    }

    func flushLogNow() {
        logFlushTask?.cancel()
        logFlushTask = nil
        guard !logLines.isEmpty else { return }
        let snapshot = logLines.joined(separator: "\n")
        let destination = Self.logFile
        Task.detached(priority: .utility) {
            try? FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? snapshot.write(to: destination, atomically: true, encoding: .utf8)
            // The log used to sit in Documents, which the Files app (and the Mac's ~/Documents) shows.
            try? FileManager.default.removeItem(at: URL.documentsDirectory.appending(path: "Ruhe-Protokoll.txt"))
        }
    }

    /// Cookies, cache, site storage, history, all tabs and the log. Filter lists and the JavaScript
    /// switches stay: they are settings.
    func wipe() async {
        logFlushTask?.cancel()
        logFlushTask = nil
        logLines = []
        closedTabs = []
        try? FileManager.default.removeItem(at: Self.logFile)
        library.clearHistory()   // bookmarks stay: the user keeps those on purpose
        tabs.forEach { $0.retire() }
        recent = []
        split = []
        closeGlance()
        privateStore = nil
        trustedHosts = []
        httpHosts = []
        cookieSites = []
        tabs = [Browser(session: self)]   // new web views are the only way to drop the back/forward history
        select(tabs[0])
        await WKWebsiteDataStore.default().removeData(
            ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast)
        URLCache.shared.removeAllCachedResponses()
        current.show(L("Alles gelöscht: Cookies, Cache, Verlauf und alle Tabs", "Everything cleared: cookies, cache, history and all tabs"), symbol: "checkmark.circle.fill")
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        // The ⌥-click preview is not in `tabs` until it is kept.
        (glance?.webView === message.webView ? glance : tabs.first { $0.webView === message.webView })?.received(message)
    }
}

/// The app has one window; extensions see its tabs through it.
extension Session: WKWebExtensionWindow {
    func tabs(for context: WKWebExtensionContext) -> [any WKWebExtensionTab] { tabs.filter { !$0.isPrivate } }
    func activeTab(for context: WKWebExtensionContext) -> (any WKWebExtensionTab)? { current.isPrivate ? nil : current }
    func windowType(for context: WKWebExtensionContext) -> WKWebExtension.WindowType { .normal }
    func windowState(for context: WKWebExtensionContext) -> WKWebExtension.WindowState { .normal }
    func isPrivate(for context: WKWebExtensionContext) -> Bool { false }
}
