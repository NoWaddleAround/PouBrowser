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
    let blocker = Blocker()
    private(set) var tabs = [Browser]()
    private(set) var current: Browser!
    private(set) var closedTabs = [ClosedTab]()
    /// Tabs in the order they were last looked at. Only the first few keep a live page: on an
    /// iPhone 13 every open page costs memory, and iOS ends pages and the app when it runs short.
    @ObservationIgnored private var recent = [Browser]()
    private static let awake = 3

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
    var floatsVideo = UserDefaults.standard.object(forKey: "floatsVideo") as? Bool ?? true {
        didSet {
            UserDefaults.standard.set(floatsVideo, forKey: "floatsVideo")
            log("BILD-IN-BILD \(floatsVideo ? "an" : "aus")")
            current?.activate()
        }
    }

    /// What pages tried and what the guard decided, kept in the background so a popup that gets through
    /// can be traced afterwards. Shared from the menu; "Alles löschen" removes it.
    static let logFile = URL.documentsDirectory.appending(path: "Ruhe-Protokoll.txt")
    private static let timestampFormatter = ISO8601DateFormatter()
    @ObservationIgnored private var logLines =
        (try? String(contentsOf: Session.logFile, encoding: .utf8))?.components(separatedBy: "\n") ?? []
    @ObservationIgnored private var logFlushTask: Task<Void, Never>?
    @ObservationIgnored private lazy var weakHandler = WeakMessageHandler(self)

    override init() {
        super.init()
        blocker.report = { [weak self] in self?.log($0) }
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
                scroll: $0["scroll"] as? Double ?? 0
            )
        }
        var index = defaults.integer(forKey: "currentTab")
        // `-lastURL <address>` as a launch argument opens that page (see Scripts/popup-test). The key also
        // holds the open page of an install from before tabs.
        if let url = defaults.string(forKey: "lastURL").flatMap(URL.init) {
            saved.append((url, nil, defaults.double(forKey: "lastScroll")))
            index = saved.count - 1
            defaults.removeObject(forKey: "lastURL")
        }
        tabs = saved.map { Browser(session: self, url: $0.url, title: $0.title, scroll: $0.scroll) }
        if tabs.isEmpty { tabs = [Browser(session: self)] }
        select(tabs[min(max(index, 0), tabs.count - 1)])
    }

    /// What a tab's pages get at document start.
    var pageScripts: [WKUserScript] { Self.baseScripts + (darkPages ? [Self.darkScript] : []) }

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
        + (off("noPageScript") ? [] : [WKUserScript(
            source: Browser.pageScript, injectionTime: .atDocumentStart, forMainFrameOnly: false)])
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
                    'bereit ' + v.readyState + ' netz ' + v.networkState + ' fehler ' + (v.error ? v.error.code : '-') + ' quelle ' + String(v.currentSrc || v.src).slice(0, 80));
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
        blocker.attach(to: controller)
        return controller
    }

    // MARK: Tabs

    func select(_ tab: Browser) {
        tab.activate()   // first, so the tab in front always has its web view
        current = tab
        recent.removeAll { $0 === tab }
        recent.insert(tab, at: 0)
        for old in recent.dropFirst(Self.awake) where !old.isPlaying { old.sleep() }
        save()
    }

    private func memoryIsLow() {
        log("SPEICHER knapp, verdeckte Tabs schlafen")
        for tab in tabs where tab !== current && !tab.isPlaying { tab.sleep() }
        for tab in tabs { tab.discardPreview() }
    }

    func newTab() {
        tabs.append(Browser(session: self))
        select(tabs[tabs.count - 1])
    }

    func openInNewTab(_ url: URL, inBackground: Bool = false) {
        let cleaned = Browser.cleanURL(url)
        let tab = Browser(session: self, url: cleaned)
        if let currentIndex = tabs.firstIndex(where: { $0 === current }) {
            tabs.insert(tab, at: currentIndex + 1)
        } else {
            tabs.append(tab)
        }
        if inBackground {
            save()
            current?.show(L("Im Hintergrund geöffnet: ", "Opened in background: ") + (cleaned.host ?? ""), symbol: "plus.square.on.square")
        } else {
            select(tab)
        }
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
        if let url = tab.address {
            closedTabs.append(ClosedTab(url: url, title: tab.title, scroll: tab.scrollY))
            if closedTabs.count > 10 { closedTabs.removeFirst(closedTabs.count - 10) }
        }
        tabs.remove(at: index)
        recent.removeAll { $0 === tab }
        tab.retire()
        if tabs.isEmpty { tabs = [Browser(session: self)] }
        if tab === current { select(tabs[min(index, tabs.count - 1)]) } else { save() }
    }

    func reopenClosedTab() {
        guard let last = closedTabs.popLast() else { return }
        let tab = Browser(session: self, url: last.url, title: last.title, scroll: last.scroll)
        tabs.append(tab)
        select(tab)
    }

    /// Remembers the open tabs and reading positions for the next start, which may come sooner than
    /// the user thinks: iOS ends apps in the background when memory runs short.
    func save() {
        let defaults = UserDefaults.standard
        defaults.set(tabs.map {
            [
                "url": $0.address?.absoluteString ?? "",
                "title": String(($0.title ?? "").prefix(250)),
                "scroll": $0.scrollY,
            ]
        }, forKey: "tabs")
        defaults.set(tabs.firstIndex { $0 === current } ?? 0, forKey: "currentTab")
    }

    func appBecameActive() {
        let switches = ["noLists", "noPageRules", "noPageScript", "noMediaScript", "autoplay", "noAgent", "plain",
                        "plainConfig", "plainPolicy", "logBlocked", "logErrors"].filter(Self.off)
        log("APP aktiv" + (switches.isEmpty ? "" : " · Schalter: " + switches.joined(separator: ", ")))
        current.activate()
        current.returned()
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

    func setFiltering(allowed: Bool, on site: String) {
        if allowed { unfilteredSites.remove(site) } else { unfilteredSites.insert(site) }
        UserDefaults.standard.set(Array(unfilteredSites), forKey: "unfilteredSites")
        log("WERBEBLOCKER \(allowed ? "an" : "aus") für \(site)")
    }

    func setScripts(allowed: Bool, on site: String) {
        if allowed { scriptlessSites.remove(site) } else { scriptlessSites.insert(site) }
        UserDefaults.standard.set(Array(scriptlessSites), forKey: "scriptlessSites")
        log("JAVASCRIPT \(allowed ? "an" : "aus") für \(site)")
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
            try? snapshot.write(to: destination, atomically: true, encoding: .utf8)
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
        tabs.forEach { $0.retire() }
        recent = []
        tabs = [Browser(session: self)]   // new web views are the only way to drop the back/forward history
        select(tabs[0])
        await WKWebsiteDataStore.default().removeData(
            ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast)
        URLCache.shared.removeAllCachedResponses()
        current.show(L("Alles gelöscht: Cookies, Cache, Verlauf und alle Tabs", "Everything cleared: cookies, cache, history and all tabs"), symbol: "checkmark.circle.fill")
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        tabs.first { $0.webView === message.webView }?.received(message)
    }
}
