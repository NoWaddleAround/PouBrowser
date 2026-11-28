import PublicSuffixList
import UIKit
import WebKit

#if targetEnvironment(macCatalyst)
private final class CatalystWebView: WKWebView {
    private lazy var formNavigationCommands: [UIKeyCommand] = {
        let actions: [(UIKeyModifierFlags, String)] = [([], "_nextAccessoryTab:"), (.shift, "_previousAccessoryTab:")]
        return actions.compactMap { modifiers, name in
            let action = NSSelectorFromString(name)
            guard responds(to: action) else { return nil }
            let command = UIKeyCommand(input: "\t", modifierFlags: modifiers, action: action)
            // Route Tab to WebKit's form navigation before Catalyst's focus engine handles it.
            command.wantsPriorityOverSystemBehavior = true
            return command
        }
    }()

    override var keyCommands: [UIKeyCommand]? { (super.keyCommands ?? []) + formNavigationCommands }
}
#endif

struct Notice: Equatable {
    let id = UUID()
    var text: String
    var symbol = "hand.raised.fill"
    /// What was blocked, so the user can still open it on purpose.
    var url: URL?
    /// A button of its own instead of "Open".
    var action: (title: String, run: @MainActor () -> Void)?

    static func == (a: Notice, b: Notice) -> Bool { a.id == b.id }
}

/// One tab: its web view plus the rules that keep pages from opening popups, hijacking the tab or
/// jumping into other apps. A tab can sleep: then it has no web view and no page process, only its
/// address, history and reading position.
@MainActor @Observable
final class Browser: NSObject, WKNavigationDelegate, WKUIDelegate, UIGestureRecognizerDelegate {
    @ObservationIgnored unowned let session: Session
    /// Nil while the tab sleeps. The tab in front always has one.
    private(set) var webView: WKWebView!
    private(set) var url: URL?
    private(set) var title: String?
    private(set) var progress = 0.0
    private(set) var isLoading = false
    private(set) var canGoBack = false
    private(set) var canGoForward = false
    private(set) var notice: Notice?
    private(set) var preview: Data?
    /// Cached decoded thumbnail so `TabOverview` and tab-wake overlays never decode JPEG bytes on the UI thread.
    private(set) var previewImage: UIImage?
    /// True once the current web view has committed a document (used to fade out the wake snapshot cleanly).
    private(set) var hasCommittedPage = false
    /// A video has played on this page, so the picture-in-picture button has something to act on.
    private(set) var hasVideo = false
    /// Requests the filter lists stopped on the page in front.
    private(set) var blocked = 0

    @ObservationIgnored private var observations = [NSKeyValueObservation]()
    @ObservationIgnored private var previewRequest: UUID?
    @ObservationIgnored private var controller: WKUserContentController!
    /// Frame hosts that already got their filter script on the page in front.
    @ObservationIgnored private var frameHosts = Set<String>()
    @ObservationIgnored private var hasExtendedCSSLoaded = false
    /// Whether the page in front is filtered: its frames follow it.
    @ObservationIgnored private var pageFiltered = true
    /// Page the user is on. A script may not leave its site on its own.
    @ObservationIgnored private var committed: URL?
    /// A main-frame load has started and not yet shown its page.
    @ObservationIgnored private var loading = false
    /// That load was started by the user, so its server redirects may leave the site.
    @ObservationIgnored private var chainTrusted = false
    /// Where the user's own load is going until its page shows, to restart it after a script hijacked it.
    @ObservationIgnored private var userTarget: URL?
    @ObservationIgnored private var restarting = false
    /// The next main-frame navigation is ours (address bar, "Öffnen", restore).
    @ObservationIgnored private var ownLoad = false
    @ObservationIgnored private var last = (user: false, cross: false, url: URL?.none)

    /// Where the user's finger last left the page. Only finger scrolling counts: WebKit resets the
    /// offset by itself when the page's process goes away.
    @ObservationIgnored private(set) var scrollY = 0.0
    /// The bars slide away while the reader scrolls down and come back on the first bit of scrolling up.
    private(set) var barsHidden = false
    /// How far the finger has scrolled in one direction, and when the bars last moved.
    @ObservationIgnored private var travel = 0.0
    @ObservationIgnored private var lastY = 0.0
    @ObservationIgnored private var barsMoved = Date.distantPast
    /// Reading position to return to once the reloading page has finished.
    @ObservationIgnored private var pendingScroll: Double?
    /// A tab restored at launch loads only when the user comes to it.
    private var deferred: URL?
    /// iOS ended the page's process while the tab was hidden.
    @ObservationIgnored private var needsReload = false

    /// Whether this tab's web view was created with picture-in-picture allowed. WebKit reads that once.
    @ObservationIgnored private var builtFloating = true
    /// The address last asked for, for a tab whose process dies before its first page shows.
    @ObservationIgnored private var requested: URL?
    @ObservationIgnored private var staysUntilLoad = false
    @ObservationIgnored private var crashes = 0
    @ObservationIgnored private var lastCrash = Date.distantPast

    /// The tab's sound is off (Chrome's "Tab stummschalten"); kept when the tab sleeps and wakes.
    private(set) var isMuted = false

    /// Developer tools (`DevTools.swift`): console lines of the page in front and what the filter lists stopped there.
    var devLog = [DevEntry]()
    var blockedURLs = [String]()
    @ObservationIgnored var capturesConsole = false

    /// Downloads in flight: where each goes, and which keep only their sound (`Downloads.swift`).
    @ObservationIgnored var downloadTargets = [ObjectIdentifier: URL]()
    @ObservationIgnored var audioDownloads = Set<ObjectIdentifier>()
    @ObservationIgnored var downloadItems = [ObjectIdentifier: DownloadItem]()
    /// Pinned tabs stay at the front of the strip, small, without a close button (as in Chrome).
    var isPinned = false

    /// Frame whose video played last, to reach that video when the app leaves the screen.
    @ObservationIgnored private var mediaFrame: WKFrameInfo?

    /// Back/forward list and page state of a sleeping tab.
    @ObservationIgnored private var state: Any?
    /// A hidden tab that plays sound is not put to sleep.
    private(set) var isPlaying = false

    private static let iPadUserAgent =
        "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
    private static let desktopUserAgent =
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"

    /// Known click-tracking and campaign query parameters safe to strip on top-level GET navigations.
    nonisolated private static let trackingParams: Set<String> = [
        "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
        "fbclid", "gclid", "dclid", "gbraid", "wbraid", "msclkid",
        "twclid", "ttclid", "yclid", "mc_eid", "igshid", "_hsenc", "_hsmi", "mkt_tok",
    ]

    /// The address to remember for this tab, loaded or not yet.
    var address: URL? { url ?? deferred ?? requested }
    var label: String {
        if let title, !title.isEmpty { return title }
        return address?.host?.replacing(/^www\./, with: "") ?? L("Neuer Tab", "New tab")
    }

    private func scriptsAllowed(on url: URL?) -> Bool {
        !session.scriptlessSites.contains(Self.site(url) ?? "")
    }

    private func popupsAllowed(on url: URL?) -> Bool {
        session.popupSites.contains(Self.site(url) ?? "")
    }

    private func filteringAllowed(on url: URL?) -> Bool {
        !session.unfilteredSites.contains(Self.site(url) ?? "")
    }

    private func desktopAllowed(on url: URL?) -> Bool {
        session.desktopSites.contains(Self.site(url) ?? "")
    }

    /// The ad blocker for the site in front: filter lists, hidden ad areas and script rules.
    var filteringAllowed: Bool {
        get { filteringAllowed(on: address) }
        set {
            guard let site = Self.site(address) else { return }
            session.setFiltering(allowed: newValue, on: site)
            reload()
        }
    }

    /// Real popup windows for sign-ins (Google, PayPal, 3-D Secure). They open as a tab and keep `window.opener`.
    var popupsAllowed: Bool {
        get { popupsAllowed(on: address) }
        set {
            guard let site = Self.site(address) else { return }
            session.setPopups(allowed: newValue, on: site)
            reload()
        }
    }

    var scriptsAllowed: Bool {
        get { scriptsAllowed(on: address) }
        set {
            guard let site = Self.site(address) else { return }
            session.setScripts(allowed: newValue, on: site)
        }
    }

    /// Page zoom of the site in front (1 = 100 %).
    var zoom: Double { session.zoom(on: Self.site(address)) }

    /// `step` +0.1 or -0.1; nil resets to 100 %. Applies now and to every later page of the site.
    func changeZoom(by step: Double?) {
        guard let site = Self.site(address) else { return }
        session.setZoom(step.map { zoom + $0 }, on: site)
        webView?.pageZoom = zoom
    }

    var desktopMode: Bool {
        get { desktopAllowed(on: address) }
        set {
            guard let site = Self.site(address) else { return }
            session.setDesktop(enabled: newValue, on: site)
            applyUserAgent(for: address)
            reload()
        }
    }

    /// A private tab keeps cookies and storage in memory only, records no history and is not restored.
    let isPrivate: Bool
    /// Mac: the link under the pointer, shown at the bottom left.
    var hoverLink = ""
    /// alert/confirm/prompt shown on this page. Pages that loop them get no more after a few.
    @ObservationIgnored var dialogs = 0

    init(session: Session, url: URL? = nil, title: String? = nil, scroll: Double = 0, isPrivate: Bool = false) {
        self.session = session
        self.isPrivate = isPrivate
        super.init()
        deferred = url   // the web view comes when the tab is first looked at
        if let title, !title.isEmpty { self.title = title }
        scrollY = scroll
    }

    // MARK: Actions

    func go(_ input: String) {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.isEmpty { open(Self.destination(for: text)) }
    }

    func open(_ rawURL: URL) {
        let targetURL = Self.cleanURL(rawURL)
        ownLoad = true
        notice = nil
        pendingScroll = nil
        deferred = nil
        needsReload = false
        requested = targetURL
        applyUserAgent(for: targetURL)
        if session.blocker.isReady || Session.off("noLists") {
            webView.load(URLRequest(url: targetURL))
        } else {
            Task { [weak self] in
                guard let self else { return }
                await self.session.blocker.waitUntilReady()
                guard let view = self.webView, self.requested == targetURL, view.url == nil else { return }
                self.ownLoad = true
                view.load(URLRequest(url: targetURL))
            }
        }
    }

    /// The tab comes to the front: load what was put off while it was hidden.
    func activate() {
        if webView == nil {
            wake()
        } else if builtFloating != session.floatsVideo {
            // WebKit reads that setting only when a web view is created: swap in a new one.
            if !session.floatsVideo { webView?.closeAllMediaPresentations {} }
            sleep()
            wake()
        } else if let url = deferred {
            let position = scrollY
            open(url)
            pendingScroll = position
        } else if needsReload {
            needsReload = false
            webView.reload()
        }
    }

    /// A web view that is dropped goes on playing its sound unless it is told to stop.
    func retire() {
        previewRequest = nil
        webView?.pauseAllMediaPlayback()
        webView?.closeAllMediaPresentations {}
        webView?.stopLoading()
        webView?.navigationDelegate = nil   // its dying process must not report into the tab's new view
        webView?.uiDelegate = nil
        controller?.removeAllScriptMessageHandlers()
        controller?.removeAllUserScripts()
        controller?.removeAllContentRuleLists()
        controller = nil
    }

    /// Gives up the web view and with it the page's process and memory.
    func sleep() {
        guard webView != nil else { return }
        if url != nil { state = webView.interactionState }
        if deferred == nil { deferred = url }
        retire()
        observations = []
        webView = nil
        url = nil
        committed = nil
        hasCommittedPage = false
        isPlaying = false
        log("TAB schläft: \(label)")
    }

    private func wake() {
        makeWebView()
        let position = scrollY
        if let state {
            self.state = nil
            requested = deferred
            deferred = nil
            applyUserAgent(for: requested)
            pendingScroll = position
            if session.blocker.isReady || Session.off("noLists") {
                webView.interactionState = state   // brings back the back/forward list and loads the page
            } else {
                Task { [weak self] in
                    guard let self else { return }
                    await self.session.blocker.waitUntilReady()
                    guard let view = self.webView, view.url == nil else { return }
                    view.interactionState = state
                }
            }
        } else if let url = deferred {
            open(url)
            pendingScroll = position
        } else {
            // Prewarm the WebContent process on an idle start tab without changing its URL or history.
            webView.evaluateJavaScript("0")
        }
    }

    func reload() {
        guard let webView else { return }
        if webView.url == nil, let address {
            let position = scrollY
            open(address)
            pendingScroll = position
        } else {
            webView.reload()
        }
    }

    func findInPage() {
        guard let webView, hasCommittedPage else { return }
        webView.findInteraction?.presentFindNavigator(showingReplace: false)
    }

    /// Keep a small, in-memory preview even if the tab's web view goes to sleep.
    func capturePreview() {
        guard let webView, webView.window != nil, committed != nil, !webView.bounds.isEmpty else { return }
        let request = UUID()
        previewRequest = request
        let config = WKSnapshotConfiguration()
        let bounds = webView.bounds
        config.rect = CGRect(origin: .zero, size: .init(width: bounds.width, height: min(bounds.height, bounds.width * 0.75)))
        config.snapshotWidth = 180
        config.afterScreenUpdates = false
        webView.takeSnapshot(with: config) { [weak self] image, _ in
            guard let self, self.previewRequest == request else { return }
            self.previewRequest = nil
            if let image, let data = image.jpegData(compressionQuality: 0.7) {
                self.preview = data
                self.previewImage = image
            }
        }
    }

    func discardPreview() {
        previewRequest = nil
        preview = nil
        previewImage = nil
    }

    /// Tells the page's video that the app is leaving the screen, so the pause iOS is about to cause gets undone.
    func leaving(floating: Bool) {
        #if targetEnvironment(macCatalyst)
        // The Mac pauses nothing when another app comes to the front: no pause to undo, no full screen to close.
        if floating { runInMediaFrame("ruheFloat()") }
        #else
        if !floating { webView?.closeAllMediaPresentations {} }
        runInMediaFrame(floating ? "ruheLeaving(); ruheFloat()" : "ruheLeaving()")
        #endif
    }
    func returned() { runInMediaFrame("ruheBack(); ruheLand()") }
    /// Shows the track and jumps to a line of dialogue, so a screenshot can prove it is drawn.
    private static let subtitleTest = """
        ruheSubtitles(true); setTimeout(() => {
            const cue = shown && shown.cues && [...shown.cues].find(cue => cue.startTime > 150);
            if (!cue) return tell('Test: keine Zeile gefunden');
            playing.currentTime = cue.startTime + 0.2;
            tell('Test: springe zu ' + Math.round(cue.startTime) + ' s, Zeile: ' + cue.text.slice(0, 50) + ' · Spuren: '
                + [...playing.textTracks].map(track => track.kind + '/' + track.mode + '/' + (track.cues ? track.cues.length : '-')).join(', '));
        }, 2000)
        """

    /// The picture-in-picture button. Asked for while the app is in front, which iOS accepts more
    /// readily than a request made in the moment of leaving.
    func toggleFloat() {
        // `-testSubtitles YES`: the button shows the subtitle track in the page, for simulators without picture-in-picture.
        runInMediaFrame(Session.off("testSubtitles") ? Self.subtitleTest : "ruheToggleFloat()")
    }

    /// `pouVideo` from `Resources/media.js`, in the frame whose video played last (else the page itself).
    func videoTool(_ action: String, _ value: Double) {
        guard let webView else { return }
        Task {
            let answer = try? await webView.callAsyncJavaScript("return pouVideo(action, value)", arguments: ["action": action, "value": value],
                                                                in: mediaFrame, contentWorld: .defaultClient) as? String
            let parts = (answer ?? "none").split(separator: ":")
            let number = parts.count > 1 ? Double(parts[1]) ?? 0 : 0
            switch parts.first {
            case "speed": show(L("Tempo ", "Speed ") + number.formatted() + "×", symbol: "speedometer")
            case "seek": show((number > 0 ? "+" : "") + number.formatted() + " s", symbol: "goforward")
            case "boost": show(L("Lautstärke ", "Volume ") + "\(Int(number * 100)) %", symbol: "speaker.wave.3")
            case "boost-foreign": show(L("Lauter geht hier nicht: Ton kommt von fremdem Server", "Can't boost: sound comes from another server"),
                                       symbol: "speaker.slash")
            default: show(L("Kein Video gefunden", "No video found"), symbol: "play.slash")
            }
        }
    }

    /// Chrome's and Safari's "Copy link to highlight": the address with a text fragment (`#:~:text=`) of the selection.
    func copyHighlightLink() {
        guard let webView, let page = address else { return }
        Task {
            let selected = (try? await webView.evaluateJavaScript("String(getSelection())", in: nil, contentWorld: .defaultClient) as? String) ?? ""
            guard let link = Self.highlightLink(page, selected) else {
                return show(L("Erst Text auf der Seite markieren", "Select text on the page first"), symbol: "character.cursor.ibeam")
            }
            UIPasteboard.general.string = link.absoluteString
            show(L("Link zur Textstelle kopiert", "Link to highlight copied"), symbol: "link")
        }
    }

    /// The whole text when short, else its first and last five words (`start,end`). `-`, `,` and `&` are escaped too.
    nonisolated static func highlightLink(_ page: URL, _ selected: String) -> URL? {
        let words = selected.split(whereSeparator: \.isWhitespace)
        guard !words.isEmpty else { return nil }
        let encode = { (text: String) in
            text.addingPercentEncoding(withAllowedCharacters: CharacterSet.urlQueryAllowed.subtracting(CharacterSet(charactersIn: "-,&#=?+")))
                ?? text
        }
        let fragment = words.count <= 10 && selected.count <= 300
            ? encode(words.joined(separator: " "))
            : encode(words.prefix(5).joined(separator: " ")) + "," + encode(words.suffix(5).joined(separator: " "))
        var components = URLComponents(url: page, resolvingAgainstBaseURL: false)
        components?.fragment = nil
        return components?.url.flatMap { URL(string: $0.absoluteString + "#:~:text=" + fragment) }
    }

    private func runInMediaFrame(_ call: String) {
        guard let mediaFrame, let webView else { return }
        webView.evaluateJavaScript(call, in: mediaFrame, in: .defaultClient)
    }

    /// Private tabs leave no trace: the log is a file on disk.
    func log(_ entry: String) { if !isPrivate { session.log(entry) } }

    func setMuted(_ muted: Bool) {
        isMuted = muted
        if let webView { Self.mute(webView, muted) }
    }

    /// WebKit's own page mute (`_setPageMuted:`, private, checked first; 1 = audio muted), as Safari uses it.
    private static func mute(_ view: WKWebView, _ muted: Bool) {
        typealias SetMuted = @convention(c) (AnyObject, Selector, UInt) -> Void
        let selector = NSSelectorFromString("_setPageMuted:")
        guard view.responds(to: selector) else { return }
        unsafeBitCast(view.method(for: selector), to: SetMuted.self)(view, selector, muted ? 1 : 0)
    }

    nonisolated static func destination(for text: String, engine: SearchEngine = .current) -> URL {
        // "localhost:8080" has no dot but is an address; it is served without TLS.
        let local = text.lowercased().hasPrefix("localhost")
        if !text.contains(" "), text.contains(".") || text.contains("://") || local,
           let url = URL(string: text.contains("://") ? text : (local ? "http://" : "https://") + text), url.host != nil {
            return cleanURL(url)
        }
        var search = URLComponents(string: engine.base)!
        search.queryItems = [URLQueryItem(name: engine.parameter, value: text)]
        return search.url!
    }

    /// Strips known ad and campaign click-ID parameters while leaving login/OAuth callbacks untouched.
    nonisolated static func cleanURL(_ url: URL) -> URL {
        if let target = unwrapped(url) { return cleanURL(target) }
        guard let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
              url.query != nil,
              var components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let items = components.queryItems, !items.isEmpty else { return url }
        let lowerPath = components.path.lowercased()
        if lowerPath.contains("oauth") || lowerPath.contains("callback") || lowerPath.contains("login")
            || lowerPath.contains("signin") || lowerPath.contains("authorize") || lowerPath.contains("sso") {
            return url
        }
        let filtered = items.filter { !trackingParams.contains($0.name.lowercased()) }
        guard filtered.count != items.count else { return url }
        components.queryItems = filtered.isEmpty ? nil : filtered
        return components.url ?? url
    }

    /// The home network and this device, which mostly have no HTTPS: localhost, LAN addresses, `.local`, single names.
    nonisolated static func isLocal(_ url: URL) -> Bool {
        guard let host = url.host?.lowercased() else { return true }
        if host == "localhost" || host.hasSuffix(".local") || host.hasSuffix(".localhost") || !host.contains(".") { return true }
        let parts = host.split(separator: ".").compactMap { Int($0) }
        guard parts.count == 4 else { return host.hasPrefix("fe80:") || host.hasPrefix("fc") || host.hasPrefix("fd") || host == "::1" }
        return parts[0] == 10 || parts[0] == 127 || (parts[0] == 192 && parts[1] == 168)
            || (parts[0] == 172 && (16...31).contains(parts[1])) || (parts[0] == 169 && parts[1] == 254)
    }

    /// Link wrappers that only bounce to the real address and log the click (Brave's "debouncing").
    nonisolated static func unwrapped(_ url: URL) -> URL? {
        guard let host = url.host?.lowercased(), let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        let bare = host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
        let path = components.path.lowercased()
        let names: [String]
        if bare.hasPrefix("google.") && path == "/url" { names = ["q", "url"] }
        else if (bare == "l.facebook.com" || bare == "lm.facebook.com") && path == "/l.php" { names = ["u"] }
        else if bare == "l.instagram.com" { names = ["u"] }
        else if bare == "out.reddit.com" { names = ["url"] }
        else if (bare == "youtube.com" || bare == "m.youtube.com") && path == "/redirect" { names = ["q"] }
        else if bare.hasSuffix(".safelinks.protection.outlook.com") { names = ["url"] }
        else if bare == "steamcommunity.com" && path.hasPrefix("/linkfilter") { names = ["url", "u"] }
        else if bare == "vk.com" && path == "/away.php" { names = ["to"] }
        else if bare == "slack-redir.net" && path == "/link" { names = ["url"] }
        else { return nil }
        let value = names.lazy.compactMap { name in components.queryItems?.first { $0.name == name }?.value }.first
        guard let value, let target = URL(string: value), target.host != nil,
              ["http", "https"].contains(target.scheme?.lowercased() ?? "") else { return nil }
        return target
    }

    /// Registrable domain ("bbc.co.uk" for "www.bbc.co.uk"): the unit a script may not leave by itself.
    nonisolated static func site(_ url: URL?) -> String? {
        guard let host = url?.host?.lowercased() else { return nil }
        return PublicSuffixList.effectiveTLDPlusOne(host) ?? host
    }

    // MARK: Setup

    private func applyUserAgent(for targetURL: URL?) {
        guard !Session.off("noAgent"), !Session.off("plain"), !Session.off("plainConfig") else { return }
        #if targetEnvironment(macCatalyst)
        // Catalyst's WebKit has no MediaSource (also not with WebKit's own switch), and desktop YouTube plays only
        // through it: "Es ist ein Fehler aufgetreten". As an iPad it gets HLS, which plays.
        if Self.site(targetURL) == "youtube.com" {
            webView?.customUserAgent = Self.iPadUserAgent
            return
        }
        #endif
        webView?.customUserAgent = desktopAllowed(on: targetURL) ? Self.desktopUserAgent : nil
    }

    /// A popup the page opened: its web view must be built from WebKit's configuration, which ties it to the opener.
    func adopt(_ configuration: WKWebViewConfiguration) -> WKWebView {
        makeWebView(using: configuration)
        return webView
    }

    private func makeWebView(using given: WKWebViewConfiguration? = nil) {
        var config = given ?? WKWebViewConfiguration()
        controller = session.makeController()
        session.pageScripts().forEach(controller.addUserScript)
        config.userContentController = controller
        config.preferences.javaScriptCanOpenWindowsAutomatically = false
        // Sound needs a tap, as in Safari. Asking a tap for every video (`.all`) also keeps players from
        // loading any video data, and one that waits for that data never shows its play button (kaa.to).
        config.mediaTypesRequiringUserActionForPlayback = Session.off("autoplay") ? [] : .audio
        config.allowsInlineMediaPlayback = true
        // Private tabs get their own throwaway storage and no extensions, which could read along.
        if given != nil {
            // A popup keeps its opener's storage (a private opener's too) and extensions.
        } else if isPrivate {
            config.websiteDataStore = session.privateDataStore()
        } else {
            config.webExtensionController = session.extensions.controller
        }
        // Off means off: no player button, no automatic floating out of full screen.
        config.allowsPictureInPictureMediaPlayback = session.floatsVideo
        builtFloating = session.floatsVideo
        // Without the Safari part many sites serve an "open in our app" page.
        #if targetEnvironment(macCatalyst)
        // Players then fill the screen with their own controls and subtitles, as in Safari on the Mac.
        config.preferences.isElementFullscreenEnabled = true
        // Mac Safari's tail, so sites serve their desktop pages.
        if !Session.off("noAgent") { config.applicationNameForUserAgent = "Version/\(UIDevice.current.systemVersion) Safari/605.1.15" }
        #else
        if !Session.off("noAgent") { config.applicationNameForUserAgent = "Version/\(UIDevice.current.systemVersion) Mobile/15E148 Safari/604.1" }
        #endif

        if Session.off("plain") || Session.off("plainConfig") {   // diagnosis: a web view with nothing of ours but the log
            config = WKWebViewConfiguration()
            controller = session.makeController()
            controller.removeAllContentRuleLists()
            session.pageScripts().forEach(controller.addUserScript)
            config.userContentController = controller
        }
        #if targetEnvironment(macCatalyst)
        let view = CatalystWebView(frame: .zero, configuration: config)
        #else
        let view = WKWebView(frame: .zero, configuration: config)
        #endif
        // Safari's Web Inspector may attach (Safari › Entwickler › this Mac or the iPhone › PouBrowser): the full
        // element tree, which the app's own developer tools do not have.
        view.isInspectable = true
        // Split view: a click into this half brings the tab forward, on any page (also without JavaScript).
        let click = UITapGestureRecognizer(target: self, action: #selector(clickedIntoView))
        click.cancelsTouchesInView = false
        click.delegate = self
        view.addGestureRecognizer(click)
        if isMuted { Self.mute(view, true) }
        view.navigationDelegate = self
        view.uiDelegate = self
        view.allowsBackForwardNavigationGestures = true
        view.isFindInteractionEnabled = true

        let refresh = UIRefreshControl()
        refresh.addAction(UIAction { [weak self] _ in
            guard let self else { return }
            if self.address != nil {
                self.reload()
            } else {
                refresh.endRefreshing()
            }
        }, for: .valueChanged)
        view.scrollView.refreshControl = refresh

        observations = [
            watch(view, \.url) { browser, newURL in
                browser.url = newURL
                if !browser.isPrivate { browser.session.extensions.controller.didChangeTabProperties(.URL, for: browser) }
            },
            watch(view, \.title) { browser, newTitle in
                if let newTitle, !newTitle.isEmpty {
                    browser.title = newTitle
                    if !browser.isPrivate, let page = browser.webView?.url {
                        browser.session.library.visited(page, title: newTitle, countsAsVisit: false)
                    }
                }
                if !browser.isPrivate { browser.session.extensions.controller.didChangeTabProperties(.title, for: browser) }
            },
            watch(view, \.estimatedProgress) { $0.progress = $1 },
            watch(view, \.isLoading) { browser, loading in
                browser.isLoading = loading
                if !browser.isPrivate { browser.session.extensions.controller.didChangeTabProperties(.loading, for: browser) }
                if !loading { browser.webView?.scrollView.refreshControl?.endRefreshing() }
            },
            watch(view, \.canGoBack) { $0.canGoBack = $1 },
            watch(view, \.canGoForward) { $0.canGoForward = $1 },
            view.scrollView.observe(\.contentOffset) { [weak self] scroll, _ in
                MainActor.assumeIsolated {
                    self?.moveBars(with: scroll)
                }
            },
        ]
        committed = nil
        hasCommittedPage = false
        loading = false
        mediaFrame = nil
        hasVideo = false
        isPlaying = false
        webView = view
    }

    private func watch<Value>(
        _ view: WKWebView, _ path: KeyPath<WKWebView, Value> & Sendable, _ set: @escaping (Browser, Value) -> Void
    ) -> NSKeyValueObservation {
        view.observe(path, options: [.initial, .new]) { [weak self] view, _ in
            MainActor.assumeIsolated {
                if let self { set(self, view[keyPath: path]) }
            }
        }
    }

    /// `lasting` notices tell the user what to do about the page in front and stay until it is loaded again.
    func show(_ text: String, _ url: URL? = nil, symbol: String = "hand.raised.fill", lasting: Bool = false,
              action: (title: String, run: @MainActor () -> Void)? = nil) {
        let shown = Notice(text: text, symbol: symbol, url: url, action: action)
        notice = shown
        staysUntilLoad = lasting
        AccessibilityNotification.Announcement(text).post()
        if lasting { return }
        Task {
            try? await Task.sleep(for: .seconds(6))
            if notice?.id == shown.id { notice = nil }
        }
    }

    // MARK: Reading position

    /// iOS ends the page's process, or the whole app, when memory runs short in the background. That
    /// cannot be switched off, so the page comes back where the user was reading.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        log("SEITENPROZESS von iOS beendet")
        pendingScroll = scrollY
        hasCommittedPage = false
        // A page that dies again right after each reload would otherwise reload forever.
        crashes = Date.now.timeIntervalSince(lastCrash) < 30 ? crashes + 1 : 1
        lastCrash = .now
        if committed == nil { deferred = requested }   // nothing to reload yet: load the address again
        guard crashes < 3 else {
            deferred = committed ?? requested   // keeps the address in the bar, so "Neu laden" has something to load
            log("SEITE stürzt wiederholt ab, kein weiteres Neuladen")
            show(L("Die Seite stürzt immer wieder ab. Neu laden versucht es noch einmal.", "This page keeps crashing. Reload tries once more."), symbol: "exclamationmark.triangle.fill")
            return
        }
        // Reloading a hidden page would only get the new process ended again: wait until it is looked at.
        needsReload = true
        if UIApplication.shared.applicationState == .active, session.current === self { activate() }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        session.save()
        if !isPrivate, let page = webView.url { session.library.visited(page, title: webView.title, countsAsVisit: true) }
        guard let target = pendingScroll, target > 0, let page = webView.url else { return }
        pendingScroll = nil
        scrollY = target
        log("LESESTELLE wiederhergestellt bei \(Int(target))")
        restoreScroll(to: target, on: page, tries: 60)
    }

    /// Images arrive after the page counts as loaded, so the page is too short at first: keep moving
    /// down as it grows, until the position is reached or the user takes over.
    private func restoreScroll(to target: Double, on page: URL, tries: Int) {
        guard let webView, webView.url == page, !webView.scrollView.isTracking else { return }
        let scroll = webView.scrollView
        let reachable = scroll.contentSize.height - scroll.bounds.height + scroll.adjustedContentInset.bottom
        scroll.setContentOffset(CGPoint(x: scroll.contentOffset.x, y: min(target, max(reachable, 0))), animated: false)
        guard reachable < target, tries > 0 else { return }
        Task {
            try? await Task.sleep(for: .milliseconds(250))
            restoreScroll(to: target, on: page, tries: tries - 1)
        }
    }

    // MARK: Popup and redirect guard

    // webkit-extension: pages of installed extensions, such as their settings page.
    private static let webSchemes: Set = ["http", "https", "about", "blob", "data", "webkit-extension"]
    private static let userActions: Set<WKNavigationType> = [
        .linkActivated, .formSubmitted, .formResubmitted, .backForward, .reload,
    ]
    /// WebKit's "allow, but never hand the link to an installed app" (allow + 2), the value Firefox and
    /// DuckDuckGo on iOS use too. Plain `.allow` lets a tapped link jump into the App Store or another app.
    private static let allowInBrowser =
        WKNavigationActionPolicy(rawValue: WKNavigationActionPolicy.allow.rawValue + 2) ?? .allow

    private static let typeNames: [WKNavigationType: String] = [
        .linkActivated: "Link", .formSubmitted: "Formular", .formResubmitted: "Formular erneut",
        .backForward: "Zurück/Vor", .reload: "Neu laden", .other: "Skript/Sonstiges",
    ]

    func webView(
        _ webView: WKWebView, decidePolicyFor action: WKNavigationAction, preferences: WKWebpagePreferences
    ) async -> (WKNavigationActionPolicy, WKWebpagePreferences) {
        if Session.off("plain") || Session.off("plainPolicy") { return (.allow, preferences) }
        let targetURL = action.request.url
        preferences.allowsContentJavaScript = scriptsAllowed(on: targetURL)
        preferences.preferredContentMode = desktopAllowed(on: targetURL) ? .desktop : .recommended
        if session.httpsOnly, let targetURL, targetURL.scheme?.lowercased() == "http", let site = Self.site(targetURL), !Self.isLocal(targetURL) {
            // Loading the same http address again while WebKit's warning page shows it is that page's "Continue".
            // It counts for the whole site, so its subdomains do not ask again.
            if !ownLoad, action.navigationType == .other, webView.url?.scheme == "http", webView.url?.host == targetURL.host,
               session.httpHosts.insert(site).inserted {
                log("NUR HTTPS: HTTP erlaubt für \(site)")
            }
            if !session.httpHosts.contains(site) {
                preferences.preferredHTTPSNavigationPolicy = .userMediatedFallbackToHTTP   // WebKit's own warning page
            }
        }
        let policy = decide(action)
        if policy != .cancel { installFilterScript(for: action) }
        return (policy, preferences)
    }

    /// Scripts are set before the document exists, so they run ahead of everything the page loads.
    private func installFilterScript(for action: WKNavigationAction) {
        guard let url = action.request.url, let target = action.targetFrame,
              ["http", "https"].contains(url.scheme?.lowercased() ?? "") else { return }
        if target.isMainFrame {
            applyUserAgent(for: url)
            webView?.pageZoom = session.zoom(on: Self.site(url))
            pageFiltered = filteringAllowed(on: url)
            session.blocker.setLists(on: controller, enabled: pageFiltered)
        }
        let rules = Session.off("noPageRules") || !pageFiltered ? nil : session.blocker.pageRules
        if target.isMainFrame {
            controller.removeAllUserScripts()
            session.pageScripts(allowingPopups: popupsAllowed(on: url)).forEach(controller.addUserScript)
            if pageFiltered {
                controller.addUserScript(Session.privacyUserScript)
                if session.rejectsCookies { controller.addUserScript(Session.cookieUserScript) }
            }
            if let selectors = Self.site(url).flatMap({ session.hiddenElements[$0] }), !selectors.isEmpty {
                controller.addUserScript(Self.hidingScript(selectors))
            }
            if capturesConsole { controller.addUserScript(Self.consoleScript) }
            frameHosts = []
            hasExtendedCSSLoaded = false
            if let match = rules?.match(for: url) {
                log("REGELN \(url.host ?? ""): \(match.summary)")
                appendMatchScripts(match, forMainFrameOnly: true, rules: rules)
            }
        } else if let host = url.host, frameHosts.insert(host).inserted {
            log("FRAME \(host)")
            guard let match = rules?.match(for: url, top: committed) else { return }
            log("REGELN \(host) (Frame): \(match.summary)")
            // An embedded player or ad frame. Its script also lands in the page itself, where the host check ends it.
            appendMatchScripts(match, forMainFrameOnly: false, rules: rules)
        }
    }

    private func appendMatchScripts(_ match: PageRules.Match, forMainFrameOnly: Bool, rules: PageRules?) {
        if match.needsExtendedCSS, !hasExtendedCSSLoaded, let library = rules?.extendedCSSLibraryScript {
            hasExtendedCSSLoaded = true
            controller.addUserScript(library)
        }
        if let pageSource = match.pageSource {
            controller.addUserScript(
                WKUserScript(source: pageSource, injectionTime: .atDocumentStart, forMainFrameOnly: forMainFrameOnly, in: .page))
        }
        if let styleSource = match.styleSource {
            controller.addUserScript(
                WKUserScript(source: styleSource, injectionTime: .atDocumentStart, forMainFrameOnly: forMainFrameOnly, in: .defaultClient))
        }
    }

    /// Diagnosis (`-logBlocked YES`): which filter list dropped which request. WebKit tells this only
    /// through a delegate method outside the public interface.
    @objc(_webView:contentRuleListWithIdentifier:performedAction:forURL:)
    func ruleList(_ webView: WKWebView, identifier: String, performed action: NSObject, for url: URL) {
        guard action.value(forKey: "blockedLoad") as? Bool == true else { return }
        blocked += 1
        session.countBlocked()
        if blockedURLs.count < 500 { blockedURLs.append(url.absoluteString) }
        guard Session.off("logBlocked") else { return }
        log("GEFILTERT \(identifier): \(url.absoluteString.prefix(160))")
    }

    @objc private func clickedIntoView() {
        if session.current !== self, session.split.contains(where: { $0 === self }) { session.select(self) }
    }

    nonisolated func gestureRecognizer(_ gesture: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }

    /// WebKit's own record of a real click or key press. Private API, so asked for carefully.
    private static func isUserInitiated(_ action: WKNavigationAction) -> Bool {
        action.responds(to: NSSelectorFromString("_isUserInitiated")) && action.value(forKey: "_isUserInitiated") as? Bool == true
    }

    private func decide(_ action: WKNavigationAction) -> WKNavigationActionPolicy {
        guard let url = action.request.url else { return .cancel }
        let toMainFrame = action.targetFrame?.isMainFrame ?? true
        guard Self.webSchemes.contains(url.scheme?.lowercased() ?? "") else {
            // itms-apps:, tg:, intent: and the like would leave the browser.
            log("BLOCKIERT App-Schema \(toMainFrame ? "" : "im Frame ")\(url.absoluteString)")
            if toMainFrame { show(L("App-Weiterleitung blockiert: ", "App redirect blocked: ") + (url.scheme ?? "")) }
            return .cancel
        }
        if let site = Self.site(url), session.blockedSites.contains(site) {
            log("BLOCKIERT gesperrte Seite \(toMainFrame ? "" : "im Frame ")\(url.absoluteString)")
            if toMainFrame { show(L("Gesperrte Seite: ", "Blocked site: ") + site, symbol: "nosign") }
            return .cancel
        }
        // ⌘-click or the middle button: the link in a tab behind (⇧ brings it to the front). ⌥-click: a preview
        // card over the page. Only real clicks: a page's synthetic click with modifier keys does nothing here.
        if action.navigationType == .linkActivated, Self.isUserInitiated(action) {
            let flags = action.modifierFlags
            if flags.contains(.command) || action.buttonNumber.contains(.button(3)) {
                log("NEUER TAB per ⌘-Klick: \(url.absoluteString)")
                session.openInNewTab(url, inBackground: !flags.contains(.shift))
                return .cancel
            }
            if flags.contains(.alternate) {
                log("VORSCHAU per ⌥-Klick: \(url.absoluteString)")
                session.openGlance(url)
                return .cancel
            }
        }

        // No target frame means a new window: createWebViewWith decides. Frames inside the page may load freely.
        guard let target = action.targetFrame, target.isMainFrame else { return .allow }

        // `sourceFrame` can be nil at run time although Swift imports it as non-optional.
        if staysUntilLoad {
            staysUntilLoad = false
            notice = nil
        }
        let fromMainFrame = (action.value(forKey: "sourceFrame") as? WKFrameInfo)?.isMainFrame ?? true
        let user = ownLoad || (fromMainFrame && Self.userActions.contains(action.navigationType))
        ownLoad = false

        if user { userTarget = restarting ? nil : url }
        restarting = false
        let cross = committed != nil && Self.site(url) != Self.site(committed)
        last = (user, cross, url)

        // A script or an embedded frame sends the tab to another site: the forced redirect ad pages use.
        let blocked = cross && !user && !(loading && chainTrusted)
        log("""
            \(blocked ? "BLOCKIERT" : "ERLAUBT") Navigation \(Self.typeNames[action.navigationType] ?? "?")\
            \(user ? ", vom Nutzer" : "")\(cross ? ", fremde Seite" : "")\(fromMainFrame ? "" : ", aus Frame")\
            \(loading ? ", während Laden" : ""): \(url.absoluteString)
            """)
        if blocked {
            blockRedirect(to: url)
            return .cancel
        }
        if action.shouldPerformDownload { return .download }   // <a download>
        // Strip tracking parameters from the user's own GET link taps. Only after the guard: `open` marks
        // the new load as the user's, so a frame's or script's link must never get here.
        if user, fromMainFrame, action.navigationType == .linkActivated,
           (action.request.httpMethod ?? "GET").uppercased() == "GET" {
            let cleaned = Self.cleanURL(url)
            if cleaned != url {
                open(cleaned)
                return .cancel
            }
        }
        return Self.allowInBrowser
    }

    /// Only the finger counts, and not the moment after the bars moved: the page changes size then,
    /// which shifts the position too and would bring the bars straight back at the end of a page.
    private func moveBars(with scroll: UIScrollView) {
        let y = scroll.contentOffset.y
        let step = y - lastY
        lastY = y
        if scroll.isDragging || scroll.isDecelerating { scrollY = y }   // the reading position, kept for the way back
        guard y > 0 else { return showBars() }
        guard scroll.isDragging, barsMoved.timeIntervalSinceNow < -0.4 else {
            travel = 0
            return
        }
        travel = (step > 0) == (travel > 0) ? travel + step : step
        if travel < -8 {
            showBars()
        } else if travel > 40, y > 150, !barsHidden, !UIAccessibility.isVoiceOverRunning {
            // Further down than the bars are tall: the page grows by their height when they go, and a
            // short page must not land back at the top, where they return. VoiceOver keeps the buttons in reach.
            barsHidden = true
            barsMoved = .now
        }
    }

    private func showBars() {
        travel = 0
        guard barsHidden else { return }
        barsHidden = false
        barsMoved = .now
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        showBars()
        // Server redirects never arrive here, new navigations do. One that got through above as a
        // "redirect" of the user's load is a script hijacking that load.
        if loading && last.cross && !last.user {
            webView.stopLoading()
            loading = false
            log("BLOCKIERT Skript kapert laufendes Laden: \(last.url?.absoluteString ?? "")")
            blockRedirect(to: last.url)
            return
        }
        loading = true
        chainTrusted = last.user
    }

    private func blockRedirect(to url: URL?) {
        show(L("Weiterleitung blockiert: ", "Redirect blocked: ") + (url?.host ?? ""), url)
        // A script that navigates over the user's own load makes WebKit drop that load, even when the
        // script's navigation is refused. Restart it, once: a page that keeps hijacking must not loop us.
        guard let target = userTarget else { return }
        userTarget = nil
        Task {
            guard let webView else { return }
            ownLoad = true
            restarting = true
            webView.load(URLRequest(url: target))
        }
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        loading = false
        userTarget = nil
        hoverLink = ""
        if pendingScroll == nil { scrollY = 0 }   // a new page starts at the top
        mediaFrame = nil
        hasVideo = false
        dialogs = 0
        blocked = 0
        blockedURLs = []
        devLog = []
        if committed != webView.url { discardPreview() }
        committed = webView.url
        hasCommittedPage = committed != nil
        log("SEITE \(webView.url?.absoluteString ?? "")")
        session.save()
    }

    /// Calendar spam: a page hands over an .ics file and iOS offers to subscribe to a calendar full of ads.
    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse) async -> WKNavigationResponsePolicy {
        let url = response.response.url
        // A bot check (Cloudflare) answers 403 or 503 and needs JavaScript to pass: without it the page stays white.
        if response.isForMainFrame, !scriptsAllowed(on: url),
           [403, 503].contains((response.response as? HTTPURLResponse)?.statusCode ?? 0) {
            log("HINWEIS Sicherheitsprüfung braucht JavaScript: \(url?.host ?? "")")
            show(L("Die Seite prüft den Browser und braucht dafür JavaScript. Im Zahnrad einschalten.", "This page is checking the browser and needs JavaScript for that. Switch it on in the gear menu."),
                 symbol: "exclamationmark.triangle.fill", lasting: true)
        }
        if response.isForMainFrame, let url, [404, 410].contains((response.response as? HTTPURLResponse)?.statusCode ?? 0) {
            offerArchive(of: url)
        }
        if response.response.mimeType == "text/calendar" || url?.pathExtension.lowercased() == "ics" {
            log("BLOCKIERT Kalender-Datei: \(url?.absoluteString ?? "")")
            show(L("Kalender-Datei blockiert: ", "Calendar file blocked: ") + (url?.host ?? ""))
            return .cancel
        }
        // A file the page cannot show (zip, dmg, apk) or one sent as an attachment. The navigation to it
        // already passed the redirect guard, so it is the user's.
        let disposition = (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition") ?? ""
        if response.isForMainFrame, !response.canShowMIMEType || disposition.lowercased().hasPrefix("attachment") {
            return .download
        }
        return .allow
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        started(download)
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        started(download)
    }

    private func started(_ download: WKDownload) {
        download.delegate = self
        log("DOWNLOAD Datei \(download.originalRequest?.url?.absoluteString ?? "")")
        show(L("Lädt …", "Downloading …"), symbol: "arrow.down.circle")
    }

    /// The page called `window.close()`. WebKit allows that only in windows a script opened.
    func webViewDidClose(_ webView: WKWebView) {
        log("POPUP schließt sich")
        session.close(self)
    }

    // MARK: alert, confirm, prompt

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo) async {
        _ = await dialog(message, frame: frame, cancel: false)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo) async -> Bool {
        await dialog(message, frame: frame, cancel: true) != nil
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
                 initiatedByFrame frame: WKFrameInfo) async -> String? {
        await dialog(prompt, frame: frame, cancel: true, field: defaultText ?? "")
    }

    /// The text field's content (or "") for OK, nil for Cancel or when no dialog may show.
    private func dialog(_ message: String, frame: WKFrameInfo, cancel: Bool, field: String? = nil) async -> String? {
        dialogs += 1
        guard session.current === self, dialogs <= 5, var top = webView?.window?.rootViewController else {
            log("BLOCKIERT Dialog: \(message.prefix(120))")
            return nil
        }
        while let next = top.presentedViewController { top = next }
        // A controller in the middle of a transition drops the alert: its handler never runs and the page hangs.
        guard !top.isBeingPresented, !top.isBeingDismissed else {
            log("BLOCKIERT Dialog (Ansicht wechselt): \(message.prefix(120))")
            return nil
        }
        let host = frame.securityOrigin.host
        let alert = UIAlertController(title: host.isEmpty ? nil : host, message: message, preferredStyle: .alert)
        if let field { alert.addTextField { $0.text = field } }
        return await withCheckedContinuation { done in
            if cancel { alert.addAction(UIAlertAction(title: L("Abbrechen", "Cancel"), style: .cancel) { _ in done.resume(returning: nil) }) }
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in done.resume(returning: alert.textFields?.first?.text ?? "") })
            top.present(alert, animated: true)
        }
    }

    /// Router and NAS logins (HTTP 401) ask for name and password; a certificate the user accepted after the
    /// warning stays accepted for the host until the app quits. Everything else is WebKit's normal check.
    func webView(_ webView: WKWebView, respondTo challenge: URLAuthenticationChallenge) async -> (URLSession.AuthChallengeDisposition, URLCredential?) {
        let space = challenge.protectionSpace
        switch space.authenticationMethod {
        case NSURLAuthenticationMethodServerTrust:
            if session.trustedHosts.contains(space.host), let trust = space.serverTrust {
                log("ZERTIFIKAT trotz Fehler angenommen: \(space.host)")
                return (.useCredential, URLCredential(trust: trust))
            }
        case NSURLAuthenticationMethodHTTPBasic, NSURLAuthenticationMethodHTTPDigest, NSURLAuthenticationMethodNTLM:
            if challenge.previousFailureCount < 3, let (user, password) = await askLogin(space) {
                return (.useCredential, URLCredential(user: user, password: password, persistence: isPrivate ? .none : .forSession))
            }
            return (.rejectProtectionSpace, nil)   // shows the server's own 401 page
        default:
            break
        }
        return (.performDefaultHandling, nil)
    }

    private func askLogin(_ space: URLProtectionSpace) async -> (String, String)? {
        guard session.current === self, var top = webView?.window?.rootViewController else { return nil }
        while let next = top.presentedViewController { top = next }
        guard !top.isBeingPresented, !top.isBeingDismissed else { return nil }
        let secure = space.receivesCredentialSecurely ? "" : L("\nDie Verbindung ist nicht verschlüsselt.", "\nThe connection is not encrypted.")
        let alert = UIAlertController(title: L("Anmelden", "Sign in"),
                                      message: space.host + (space.realm.map { " · " + $0 } ?? "") + secure, preferredStyle: .alert)
        alert.addTextField { $0.placeholder = L("Benutzername", "Username"); $0.textContentType = .username }
        alert.addTextField { $0.placeholder = L("Passwort", "Password"); $0.isSecureTextEntry = true; $0.textContentType = .password }
        return await withCheckedContinuation { done in
            alert.addAction(UIAlertAction(title: L("Abbrechen", "Cancel"), style: .cancel) { _ in done.resume(returning: nil) })
            alert.addAction(UIAlertAction(title: L("Anmelden", "Sign in"), style: .default) { _ in
                done.resume(returning: (alert.textFields?[0].text ?? "", alert.textFields?[1].text ?? ""))
            })
            top.present(alert, animated: true)
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        failed(error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        failed(error)
    }

    private func failed(_ error: Error) {
        loading = false
        pendingScroll = nil
        webView?.scrollView.refreshControl?.endRefreshing()
        let error = error as NSError
        log("LADEFEHLER \(error.domain) \(error.code)")
        // -999 and 102 are our own cancellations, already reported by the guard.
        let certificateErrors = [NSURLErrorServerCertificateUntrusted, NSURLErrorServerCertificateHasBadDate,
                                 NSURLErrorServerCertificateHasUnknownRoot, NSURLErrorServerCertificateNotYetValid]
        if certificateErrors.contains(error.code), let url = error.userInfo[NSURLErrorFailingURLErrorKey] as? URL, let host = url.host {
            // Chrome's "Your connection is not private": the way on is a deliberate step, for this host and this app run.
            show(L("Verbindung nicht privat: ", "Connection not private: ") + host + " · " + error.localizedDescription,
                 symbol: "exclamationmark.lock.fill", lasting: true,
                 action: (L("Trotzdem öffnen", "Open anyway"), { [weak self] in
                    self?.session.trustedHosts.insert(host)
                    self?.open(url)
                 }))
        } else if [NSURLErrorCannotFindHost, NSURLErrorCannotConnectToHost].contains(error.code),
           let url = error.userInfo[NSURLErrorFailingURLErrorKey] as? URL {
            offerArchive(of: url, because: error.localizedDescription)
        } else if error.code != NSURLErrorCancelled && !(error.domain == "WebKitErrorDomain" && error.code == 102) {
            show(error.localizedDescription, symbol: "exclamationmark.triangle.fill")
        }
    }

    /// A dead page may live on in the Internet Archive; the notice's button opens its latest copy there.
    private func offerArchive(of url: URL, because reason: String? = nil) {
        guard ["http", "https"].contains(url.scheme?.lowercased() ?? ""), url.host() != "web.archive.org",
              let archived = URL(string: "https://web.archive.org/web/2/" + url.absoluteString) else { return }
        show((reason.map { $0 + " " } ?? "") + L("Archiv-Version öffnen?", "Open an archived copy?"),
             archived, symbol: "clock.arrow.circlepath", lasting: true)
    }

    // MARK: Context menu & new windows

    func webView(
        _ webView: WKWebView, contextMenuConfigurationFor elementInfo: WKContextMenuElementInfo
    ) async -> UIContextMenuConfiguration? {
        let image = await pressedImage()
        let saveImage = image.map { image in
            UIAction(title: L("Bild laden", "Download image"), image: UIImage(systemName: "arrow.down.circle")) { [weak self] _ in
                self?.download(image)
            }
        }
        guard let linkURL = elementInfo.linkURL,
              let scheme = linkURL.scheme?.lowercased(),
              scheme == "http" || scheme == "https" else {
            guard let saveImage else { return nil }
            return UIContextMenuConfiguration(identifier: nil, previewProvider: nil) { suggested in
                UIMenu(children: [UIMenu(options: .displayInline, children: [saveImage])] + suggested)
            }
        }
        return UIContextMenuConfiguration(identifier: nil, previewProvider: nil) { [weak self] suggested in
            let openNew = UIAction(
                title: L("In neuem Tab öffnen", "Open in New Tab"),
                image: UIImage(systemName: "plus.square")
            ) { _ in self?.session.openInNewTab(linkURL, inBackground: false) }
            let openBackground = UIAction(
                title: L("Im Hintergrund öffnen", "Open in Background"),
                image: UIImage(systemName: "plus.square.on.square")
            ) { _ in self?.session.openInNewTab(linkURL, inBackground: true) }
            let tabGroup = UIMenu(options: .displayInline, children: [openNew, openBackground] + [saveImage].compactMap { $0 })
            return UIMenu(title: linkURL.host ?? "", children: [tabGroup] + suggested)
        }
    }

    /// Ad scripts that see `window.open` fail swallow every following tap and try again. So the page gets
    /// a window that does nothing and believes its popup opened; the real URL is reported to `popup`.
    /// Runs apart from the page's own scripts, so a page cannot see or undo it.
    /// The address of the link under the pointer, for the Mac's status pill. Only where there is a pointer.
    static let hoverScript = """
        (() => {
            if (!matchMedia('(hover: hover)').matches) return;
            let shown = '';
            const tell = href => {
                if (href === shown) return;
                shown = href;
                try { webkit.messageHandlers.hover.postMessage(href); } catch (error) {}
            };
            addEventListener('mouseover', event => {
                const link = event.target.closest && event.target.closest('a[href]');
                tell(link ? link.href : '');
            }, true);
            document.addEventListener('mouseleave', () => tell(''));
        })();
        """

    static let mediaScript = """
        let playing = null, leftAt = 0, pausedAt = 0;
        const tell = text => { try { webkit.messageHandlers.media.postMessage(text); } catch (error) {} };
        // iOS pauses a video the moment the app leaves the screen. A pause that comes together with
        // leaving is that and not the user, so play on. A later pause from the lock screen stays.
        // The app announces the leaving itself (ruheLeaving). Not "visibilitychange": that also fires when
        // the user switches tabs, and then a pause they made just before would be undone.
        const resume = () => {
            if (!playing || !playing.paused || Math.abs(leftAt - pausedAt) > 2000) return;
            tell('beim Verlassen pausiert, spielt im Hintergrund weiter');
            playing.play().catch(error => tell('Weiterspielen abgelehnt: ' + error));
        };
        addEventListener('pause', event => {
            if (event.composedPath()[0] !== playing) return;
            pausedAt = Date.now();
            tell('pausiert');
            resume();
        }, true);
        function ruheLeaving() {
            leftAt = Date.now();
            resume();
        }
        function ruheBack() {
            if (playing && leftAt) tell(playing.paused ? 'zurück, Video pausiert' : 'zurück, Video spielt');
            leftAt = 0;
        }
        // For the log: did a video get as far as being playable, or did it fail?
        addEventListener('loadedmetadata', event => {
            const media = event.composedPath()[0];
            if (!(media instanceof HTMLVideoElement)) return;
            if (media === playing) preloadSubtitles(media);
            tell('geladen, ' + Math.round(media.duration) + ' s lang, auf ' + location.hostname);
        }, true);
        addEventListener('error', event => {
            const media = event.composedPath()[0];
            if (media instanceof HTMLMediaElement) tell('Fehler ' + (media.error ? media.error.code + ' ' + media.error.message : '') + ' auf ' + location.hostname);
        }, true);
        addEventListener('play', event => {
            const media = event.composedPath()[0];
            if (!(media instanceof HTMLMediaElement)) return;
            if (media !== playing && playing instanceof HTMLVideoElement) resetSubtitles(!!prepared && !prepared.element);
            playing = media;
            if (media instanceof HTMLVideoElement) preloadSubtitles(media);
            tell('spielt auf ' + location.href);
        }, true);
        addEventListener('emptied', event => {
            if (event.composedPath()[0] === playing) resetSubtitles();
        }, true);
        function ruheFloat(evenPaused) {
            const video = playing;
            if (!(video instanceof HTMLVideoElement) || (video.paused && !evenPaused)
                || video.webkitPresentationMode === 'picture-in-picture') return;
            if (!video.webkitSupportsPresentationMode?.('picture-in-picture')) return tell('Bild-in-Bild hier nicht möglich');
            video.removeAttribute('disablepictureinpicture');
            // Enable the track before making the request, while the page can still render it.
            ruheSubtitles(true);
            clearTimeout(floatTimer);
            floatTimer = setTimeout(() => {
                if (playing === video && video.webkitPresentationMode !== 'picture-in-picture') ruheSubtitles(false);
            }, 2500);
            tell('Bild-in-Bild angefordert');
            video.webkitSetPresentationMode('picture-in-picture');
            setTimeout(watchMode, 1000);
        }
        /// The app's own button.
        function ruheToggleFloat() {
            if (playing && playing.webkitPresentationMode === 'picture-in-picture') ruheLand(); else ruheFloat(true);
        }
        // What iOS really did with the request: the log line above only says it was asked.
        const shownModes = new WeakMap();
        function presentationChanged(media) {
            const mode = media.webkitPresentationMode;
            if ((shownModes.get(media) ?? 'inline') === mode) return;
            shownModes.set(media, mode);
            tell('Darstellung jetzt: ' + mode);
            // Native full screen also takes only the video along, so it needs the native track too.
            if (media === playing) ruheSubtitles(mode !== 'inline');
        }
        addEventListener('webkitpresentationmodechanged', event => {
            const media = event.composedPath()[0];
            if (media instanceof HTMLVideoElement) presentationChanged(media);
        }, true);
        // The page script stops that event for the page; when its listener came first, ours never hears it.
        // Polled only while a video plays or floats, so idle tabs keep no timer.
        let modeTimer = 0;
        const watchMode = () => {
            const on = playing instanceof HTMLVideoElement && (!playing.paused || playing.webkitPresentationMode !== 'inline');
            if (on && !modeTimer) modeTimer = setInterval(() => { if (playing) presentationChanged(playing); watchMode(); }, 500);
            if (!on && modeTimer) { clearInterval(modeTimer); modeTimer = 0; }
        };
        for (const type of ['play', 'pause', 'emptied', 'webkitpresentationmodechanged']) addEventListener(type, () => setTimeout(watchMode), true);

        // Subtitles in picture-in-picture. Players draw subtitles as page elements or ASS canvases over the video,
        // and the floating window takes only the video along. Convert WebVTT, SRT or ASS/SSA subtitle files into a
        // hidden native text track and show it only while the video floats.
        const observedSubtitleFiles = new Set();
        let subtitleFile = null, prepared = null, subtitlesWanted = false;
        let shown = null, restoreSubtitle = null, floatTimer;

        function toWebVTT(raw, url) {
            const path = (() => { try { return new URL(url).pathname.toLowerCase(); } catch (_) { return ''; } })();
            const text = raw.replace(/^\\uFEFF/, '').replace(/\\r\\n?/g, '\\n');
            if (/^WEBVTT(\\s|$)/.test(text)) return text;
            if (path.endsWith('.ass') || path.endsWith('.ssa') || /^\\[Script Info\\]/im.test(text)) {
                const lines = text.split('\\n');
                let format = null;
                const cues = [];
                const stamp = value => {
                    const m = value.trim().match(/^(\\d+):(\\d{2}):(\\d{2})\\.(\\d{2,3})$/);
                    if (!m) return null;
                    const ms = m[4].length === 2 ? m[4] + '0' : m[4];
                    return m[1].padStart(2, '0') + ':' + m[2] + ':' + m[3] + '.' + ms;
                };
                for (const line of lines) {
                    if (/^Format:/i.test(line)) {
                        format = line.slice(7).split(',').map(part => part.trim().toLowerCase());
                        continue;
                    }
                    if (!/^Dialogue:/i.test(line) || !format) continue;
                    const body = line.slice(9).trimStart();
                    const parts = [];
                    let rest = body;
                    for (let i = 0; i < format.length - 1; i++) {
                        const comma = rest.indexOf(',');
                        if (comma < 0) break;
                        parts.push(rest.slice(0, comma));
                        rest = rest.slice(comma + 1);
                    }
                    parts.push(rest);
                    const start = stamp(parts[format.indexOf('start')] || '');
                    const end = stamp(parts[format.indexOf('end')] || '');
                    const rawText = parts[format.indexOf('text')] || '';
                    const cleaned = rawText.replace(/\\{[^}]*\\}/g, '').replace(/\\\\[Nn]/g, '\\n').replace(/\\\\h/g, ' ').trim();
                    if (start && end && cleaned) cues.push(start + ' --> ' + end + '\\n' + cleaned);
                }
                return cues.length ? 'WEBVTT\\n\\n' + cues.join('\\n\\n') + '\\n' : null;
            }
            if (path.endsWith('.srt') || /\\d{2}:\\d{2}:\\d{2},\\d{3}\\s*-->/.test(text)) {
                const converted = text.replace(/(\\d{2}:\\d{2}:\\d{2}),(\\d{3})/g, '$1.$2');
                return 'WEBVTT\\n\\n' + converted;
            }
            return null;
        }

        try {
            new PerformanceObserver(list => {
                const previous = subtitleFile;
                for (const entry of list.getEntries()) {
                    if (!/^https?:\\/\\//i.test(entry.name)) continue;
                    const path = new URL(entry.name).pathname;
                    if (!/\\.(vtt|srt|ass|ssa)$/i.test(path) || /preview|thumb|sprite|storyboard/i.test(path)
                        || observedSubtitleFiles.has(entry.name)) continue;
                    // Fetching the same URL ourselves produces another resource timing entry.
                    observedSubtitleFiles.add(entry.name);
                    subtitleFile = entry.name;
                }
                if (subtitleFile === previous) return;
                if (subtitlesWanted) ruheSubtitles(true);
                else if (playing instanceof HTMLVideoElement) preloadSubtitles(playing);
            }).observe({ type: 'resource', buffered: true });
        } catch (error) {}

        function pageSubtitle(video) {
            const tracks = [...video.textTracks].filter(track => track !== prepared?.element?.track
                && /^(subtitles|captions)$/.test(track.kind));
            // Only a track with lines counts: kaa.lt's player leaves an empty "captions" track showing.
            return tracks.find(track => track.mode === 'showing' && track.cues?.length)
                ?? tracks.find(track => track.mode === 'hidden' && track.cues?.length);
        }
        function preloadSubtitles(video) {
            if (subtitleFile && video.webkitSupportsPresentationMode?.('picture-in-picture') && !pageSubtitle(video))
                prepareSubtitles(video);
        }
        function discardPrepared() {
            if (!prepared) return;
            const { request, element } = prepared;
            prepared = null;
            request.abort();
            if (element) {
                if (shown === element.track) hideSubtitle();
                element.remove();
                URL.revokeObjectURL(element.src);
            }
        }
        function resetSubtitles(keepPendingFile) {
            ruheSubtitles(false);
            discardPrepared();
            if (!keepPendingFile) subtitleFile = null;
        }
        async function prepareSubtitles(video) {
            if (!subtitleFile || prepared?.file === subtitleFile) return;
            discardPrepared();
            const pending = { file: subtitleFile, request: new AbortController(), element: null };
            prepared = pending;
            try {
                const response = await fetch(pending.file, { signal: pending.request.signal });
                if (!response.ok) throw new Error();
                const vtt = toWebVTT(await response.text(), pending.file);
                if (!vtt || prepared !== pending) return;
                const element = document.createElement('track');
                pending.element = element;
                element.kind = 'subtitles';
                element.label = 'Untertitel';
                element.addEventListener('load', () => {
                    if (prepared !== pending) return;
                    tell('Untertitel für Bild-in-Bild: ' + (element.track.cues?.length ?? 0) + ' Zeilen');
                    if (subtitlesWanted) ruheSubtitles(true);
                }, { once: true });
                element.addEventListener('error', () => {
                    if (prepared === pending) tell('Untertitel-Datei nicht lesbar');
                }, { once: true });
                // As a blob, so the track loads whatever the video's cross-origin setting is.
                element.src = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
                video.appendChild(element);
                element.track.mode = 'hidden';
            } catch (error) {
                if (prepared === pending) tell('Untertitel-Datei nicht lesbar');
            }
        }
        function hideSubtitle() {
            restoreSubtitle?.();
            restoreSubtitle = null;
            shown = null;
        }
        function ruheSubtitles(on) {
            subtitlesWanted = on;
            if (!on) {
                clearTimeout(floatTimer);
                hideSubtitle();
                return;
            }
            const video = playing;
            if (!(video instanceof HTMLVideoElement)) return;
            const native = pageSubtitle(video);
            if (!native) prepareSubtitles(video);
            const track = native ?? prepared?.element?.track;
            if (!track || shown === track) return;
            hideSubtitle();
            shown = track;
            const mode = track.mode;
            const reportCue = () => {
                if (!track.activeCues?.length) return;
                track.removeEventListener('cuechange', reportCue);
                tell('Untertitel-Zeile aktiv');
            };
            track.addEventListener('cuechange', reportCue);
            let attempts = 0;
            const keepShowing = () => {
                if (track.mode !== 'showing' && attempts++ < 20) track.mode = 'showing';
            };
            // A player that manages the tracks may switch it off again: put it back, a limited number of times.
            if (mode !== 'showing') video.textTracks.addEventListener('change', keepShowing);
            restoreSubtitle = () => {
                track.removeEventListener('cuechange', reportCue);
                video.textTracks.removeEventListener('change', keepShowing);
                if (mode !== 'showing') track.mode = mode;
            };
            track.mode = 'showing';
        }
        function ruheLand() {
            if (playing && playing.webkitPresentationMode === 'picture-in-picture') playing.webkitSetPresentationMode('inline');
            else ruheSubtitles(false);
        }
        """

    static let pageScript = """
        (() => {
            // Global Privacy Control signal.
            try { Object.defineProperty(navigator, 'globalPrivacyControl', { get: () => true, configurable: true }); } catch (_) {}

            // A page that hears it got hidden pauses its video; YouTube does. To the page it stays visible.
            for (const name of ['hidden', 'webkitHidden']) Object.defineProperty(document, name, { get: () => false });
            for (const name of ['visibilityState', 'webkitVisibilityState']) {
                Object.defineProperty(document, name, { get: () => 'visible' });
            }
            for (const type of ['visibilitychange', 'webkitvisibilitychange']) {
                document.addEventListener(type, event => event.stopImmediatePropagation(), true);
            }
            // YouTube throws a video back out of picture-in-picture when it hears about the change.
            addEventListener('webkitpresentationmodechanged', event => event.stopImmediatePropagation(), true);

            const allowPopups = false;   // true on sites where the user allowed popups (Session.pageScripts)
            const decoy = new Proxy(function () {}, {
                get: (_, key) => key === 'closed' ? false : key === Symbol.toPrimitive ? () => '' : decoy,
                set: () => true,
                apply: () => decoy,
                construct: () => decoy,
            });
            let tapped = null, tappedAt = 0;
            if (!allowPopups) window.open = function (url) {
                try {
                    webkit.messageHandlers.popup.postMessage(new URL(url || 'about:blank', location.href).href);
                    // An empty layer over the page that answers a tap with a popup is an ad trap (kaa.to puts
                    // one over its video player). Taps fall through it from now on, so the next one reaches
                    // what lies underneath.
                    if (tapped && Date.now() - tappedAt < 1000 && tapped.isConnected
                        && !tapped.closest('a, button, input, select, textarea, label, video') && !tapped.innerText.trim()) {
                        tapped.style.setProperty('pointer-events', 'none', 'important');
                        webkit.messageHandlers.tap.postMessage('Werbe-Ebene abgeschaltet: ' + tapped.tagName);
                    }
                } catch (error) {}
                return decoy;
            };
            for (const type of ['pointerdown', 'touchstart', 'mousedown', 'click']) {
                addEventListener(type, event => {
                    if (event.isTrusted && event.target instanceof Element) { tapped = event.target; tappedAt = Date.now(); }
                }, true);
            }
            // For the log: what each tap really hit. A page-sized link or a click no finger made is an ad trick.
            addEventListener('click', event => {
                try {
                    const hit = event.target, link = hit.closest && hit.closest('a'), box = hit.getBoundingClientRect();
                    // A click no finger made, on a link that wants a new window: how ad scripts open their
                    // redirect page (kaa.to does it on every tap). Real taps go on to the lines below.
                    if (!event.isTrusted && link && link.target && link.target !== '_self') {
                        event.preventDefault();
                        event.stopImmediatePropagation();
                        webkit.messageHandlers.popup.postMessage(link.href);
                        return;
                    }
                    webkit.messageHandlers.tap.postMessage(
                        (event.isTrusted ? 'Finger' : 'vom Skript ausgelöst') + ' auf ' + hit.tagName
                        + ' ' + Math.round(box.width) + 'x' + Math.round(box.height)
                        + (link ? ' Link ' + link.href + (link.target ? ' Ziel ' + link.target : '') : '')
                        + (top === self ? '' : ' im Frame ' + location.href));
                } catch (error) {}
            }, true);
        })();
        """

    func received(_ message: WKScriptMessage) {
        let body = message.body as? String ?? ""
        if message.name == "media" {
            if body.hasPrefix("spielt") {
                mediaFrame = message.frameInfo   // the frame whose video played last is the one to float
                hasVideo = true
                isPlaying = true
            } else if body.hasPrefix("pausiert") {
                isPlaying = false
            }
            log("VIDEO \(body)")
        } else if message.name == "tap" {
            log("TIPP \(body)")
        } else if message.name == "hover" {
            hoverLink = body
        } else if message.name == "password" {
            passwordSubmitted(body, frame: message.frameInfo)
        } else if message.name == "devConsole" {
            guard capturesConsole else { return }
            let data = (try? JSONSerialization.jsonObject(with: Data(body.utf8))) as? [String: String] ?? [:]
            addDevEntry(DevEntry(level: data["level"] ?? "log", text: data["text"] ?? body))
        } else if message.name == "download" {
            mediaPressed(body)
        } else if message.name == "privacy" {
            let (kind, text) = body.firstIndex(of: "\n").map { (body[..<$0], String(body[body.index(after: $0)...])) } ?? (body[...], "")
            log("PRIVATSPHÄRE \(kind) \(kind == "clipboard" ? "" : text)")
            guard session.current === self else { return }
            if kind == "clipboard" {
                show(L("Seite hat den kopierten Text verändert", "Page changed the copied text"), symbol: "doc.on.clipboard",
                     action: (L("Original kopieren", "Copy original"), { UIPasteboard.general.string = text }))
            } else if kind == "cookies", let site = Self.site(committed), session.cookieSites.insert(site).inserted {
                show(L("Cookie-Banner abgelehnt", "Cookie banner rejected"), symbol: "checkmark.shield")
            }
        } else {
            log("BLOCKIERT window.open aus \(message.frameInfo.request.url?.absoluteString ?? "?"): \(body)")
            popupBlocked(URL(string: body))
        }
    }

    private func popupBlocked(_ url: URL?) {
        if let host = url?.host {
            show(L("Popup blockiert: ", "Popup blocked: ") + host, url)
        } else {
            show(L("Popup blockiert", "Popup blocked"))
        }
    }

    func webView(
        _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
        for action: WKNavigationAction, windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        // Never a second window, unless the user allowed popups on this site: then it becomes a tab of its own.
        // WebKit lets only a tap open one (javaScriptCanOpenWindowsAutomatically is off).
        let url = action.request.url
        let type = Self.typeNames[action.navigationType] ?? "?"
        if popupsAllowed(on: committed) {
            log("ERLAUBT Popup (\(type)): \(url?.absoluteString ?? "")")
            return session.openPopup(from: self, with: configuration)
        }
        if let url, url.host != nil, action.navigationType == .linkActivated, Self.site(url) == Self.site(committed) {
            log("ERLAUBT neues Fenster hier geöffnet (\(type)): \(url.absoluteString)")
            open(url)
        } else {
            log("BLOCKIERT neues Fenster (\(type)): \(url?.absoluteString ?? "")")
            popupBlocked(url)
        }
        return nil
    }
}

/// What a web extension sees of a tab. A sleeping tab has no web view until it is woken.
extension Browser: WKWebExtensionTab {
    func window(for context: WKWebExtensionContext) -> (any WKWebExtensionWindow)? { session }
    func indexInWindow(for context: WKWebExtensionContext) -> Int { session.tabs.firstIndex { $0 === self } ?? NSNotFound }
    func webView(for context: WKWebExtensionContext) -> WKWebView? { webView }
    func title(for context: WKWebExtensionContext) -> String? { title }
    func url(for context: WKWebExtensionContext) -> URL? { address }
    func isLoadingComplete(for context: WKWebExtensionContext) -> Bool { !isLoading }
    func isPlayingAudio(for context: WKWebExtensionContext) -> Bool { isPlaying }
    func isSelected(for context: WKWebExtensionContext) -> Bool { session.current === self }

    func loadURL(_ url: URL, for context: WKWebExtensionContext) async throws {
        if webView == nil { deferred = url } else { open(url) }
    }
    func reload(fromOrigin: Bool, for context: WKWebExtensionContext) async throws { reload() }
    func goBack(for context: WKWebExtensionContext) async throws { webView?.goBack() }
    func goForward(for context: WKWebExtensionContext) async throws { webView?.goForward() }
    func activate(for context: WKWebExtensionContext) async throws { session.select(self) }
    func close(for context: WKWebExtensionContext) async throws { session.close(self) }
}

/// Where typed text that is not an address goes. Chosen in the settings menu, DuckDuckGo until then.
struct SearchEngine: Hashable, Sendable {
    let name: String
    let base: String
    let parameter: String

    static let all = [
        SearchEngine(name: "DuckDuckGo", base: "https://duckduckgo.com/", parameter: "q"),
        SearchEngine(name: "Google", base: "https://www.google.com/search", parameter: "q"),
        SearchEngine(name: "Brave Search", base: "https://search.brave.com/search", parameter: "q"),
        SearchEngine(name: "Startpage", base: "https://www.startpage.com/sp/search", parameter: "query"),
        SearchEngine(name: "Ecosia", base: "https://www.ecosia.org/search", parameter: "q"),
        SearchEngine(name: "Bing", base: "https://www.bing.com/search", parameter: "q"),
    ]
    static var current: SearchEngine {
        all.first { $0.name == UserDefaults.standard.string(forKey: "searchEngine") } ?? all[0]
    }
}
