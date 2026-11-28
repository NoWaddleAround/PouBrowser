import SwiftUI
import UIKit
import UniformTypeIdentifiers
import WebKit

struct ContentView: View {
    @State private var session = Session()
    @State private var address = ""
    @State private var confirmsWipe = false
    @State private var showsTabs = false
    @State private var showsLicenses = false
    @State private var showsQRCode = false
    @State private var article: Browser.Article?
    /// The site waiting for the user's yes to be forgotten.
    @State private var forgetting: String?
    @State private var blocking: String?
    @State private var showsSiteLists = false
    @State private var showsPasswords = false
    @State private var showsSync = false
    @State private var importsExtension = false
    /// The picker takes folders only when nothing else is allowed (Mac), so folder and .zip are two entries.
    @State private var extensionTypes: [UTType] = [.folder]
    @State private var focusesNewTab = false
    /// Compact mode: the bars are out while the pointer is on them (or the address field is in use).
    @State private var revealsBars = false
    @State private var barsHeight = 0.0
    @FocusState private var editing: Bool
    @Environment(\.scenePhase) private var scenePhase

    /// The tab in front.
    private var browser: Browser { session.current }

    var body: some View {
        pages
            // Compact mode: a strip along the top edge brings the bars out over the page.
            .overlay(alignment: .top) {
                if isMac, session.compact {
                    if revealsBars || editing {
                        macBars
                            .onGeometryChange(for: Double.self) { $0.size.height } action: { barsHeight = $0 }
                            .onHover { inside in if !inside && !editing { revealsBars = false } }
                            .transition(.move(edge: .top))
                    } else {
                        Color.clear.frame(height: 6).contentShape(.rect).onHover { if $0 { revealsBars = true } }
                    }
                }
            }
            .animation(.easeOut(duration: 0.2), value: revealsBars || editing)
            // Under the Mac's address field, above the iPhone's.
            .overlay(alignment: isMac ? .top : .bottom) {
                if !suggestions.isEmpty {
                    SuggestionList(entries: suggestions, library: session.library) { url in
                        editing = false
                        browser.open(url)
                    }
                    .padding(.top, isMac && session.compact ? barsHeight : 0)
                }
            }
            // Mac: where the link under the pointer goes, as in every desktop browser.
            .overlay(alignment: .bottomLeading) {
                if isMac, !browser.hoverLink.isEmpty {
                    Text(browser.hoverLink)
                        .font(.caption)
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(.regularMaterial, in: .rect(cornerRadius: 6))
                        .frame(maxWidth: 520, alignment: .leading)
                        .padding(6)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
            }
            .overlay { if let glance = session.glance { glanceCard(glance) } }
            // Floats over the page: a notice per blocked popup must not make the page jump.
            .overlay(alignment: .bottom) {
                if let notice = browser.notice { noticeRow(notice) }
            }
            .animation(.default, value: browser.notice)
            // The empty stacks stay as the coloured strips behind the status bar and the home indicator.
            .safeAreaInset(edge: .top, spacing: 0) {
                if isMac {
                    if !session.compact { macBars }
                } else {
                    VStack(spacing: 0) {
                        if !hidesBars { topBar.transition(.move(edge: .top).combined(with: .opacity)) }
                    }
                    .frame(maxWidth: .infinity)
                    .background(.bar)
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if isMac, session.devTools != nil {
                    VStack(spacing: 0) {
                        Divider()
                        DevToolsPanel(browser: browser, pane: devTools).frame(height: 320)
                    }
                }
                if !isMac { VStack(spacing: 0) {
                    if !hidesBars {
                        VStack(spacing: 0) {
                            ProgressView(value: browser.progress)
                                .opacity(browser.isLoading ? 1 : 0)
                                .accessibilityHidden(!browser.isLoading)
                            bar
                        }
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                    }
                }
                .frame(maxWidth: .infinity)
                .background(.bar) }
            }
            .safeAreaInset(edge: .leading, spacing: 0) {
                if isMac, session.verticalTabs, !session.compact { tabColumn }
            }
            .animation(.easeOut(duration: 0.25), value: hidesBars)
            .onChange(of: browser.address, initial: true) { showAddress() }
            .onChange(of: editing) {
                showAddress()
                if editing && !address.isEmpty {
                    Task { @MainActor in
                        UIApplication.shared.sendAction(#selector(UIResponder.selectAll(_:)), to: nil, from: nil, for: nil)
                    }
                }
            }
            .fullScreenCover(isPresented: $showsTabs, onDismiss: focusNewTab) {
                TabOverview(session: session) {
                    session.newTab()
                    focusesNewTab = true
                }
            }
            .sheet(isPresented: $showsLicenses) { LicensesView() }
            .sheet(item: $article) { found in ReaderView(article: found) { browser.open($0) } }
            .confirmationDialog(
                L("Alle Daten von \(forgetting ?? "") löschen und ihre Tabs schließen?", "Delete all data of \(forgetting ?? "") and close its tabs?"),
                isPresented: Binding(get: { forgetting != nil }, set: { if !$0 { forgetting = nil } }),
                titleVisibility: .visible
            ) {
                Button(L("Seite vergessen", "Forget this site"), role: .destructive) {
                    if let site = forgetting { Task { await session.forget(site: site) } }
                }
            }
            .sheet(isPresented: $showsSiteLists) { SiteListsView(session: session) }
            .confirmationDialog(
                L("\(blocking ?? "") sperren? Seiten, Popups, Weiterleitungen und eingebettete Inhalte von dort laden dann nicht mehr.",
                  "Block \(blocking ?? "")? Its pages, popups, redirects and embedded content will no longer load."),
                isPresented: Binding(get: { blocking != nil }, set: { if !$0 { blocking = nil } }),
                titleVisibility: .visible
            ) {
                Button(L("Seite sperren", "Block this site"), role: .destructive) {
                    if let site = blocking { session.block(site: site) }
                }
            }
            .confirmationDialog(
                session.mediaOffer?.url.lastPathComponent ?? "",
                isPresented: Binding(get: { session.mediaOffer != nil }, set: { if !$0 { session.mediaOffer = nil } }),
                titleVisibility: .visible, presenting: session.mediaOffer
            ) { offer in
                Button(offer.isVideo ? L("Video laden", "Download video") : L("Audio laden", "Download audio")) {
                    offer.tab?.download(offer.url)
                }
                if offer.isVideo {
                    Button(L("Nur Ton laden (m4a)", "Download sound only (m4a)")) { offer.tab?.download(offer.url, audioOnly: true) }
                }
            }
            .sheet(item: Binding(get: { session.sharedFile }, set: { session.sharedFile = $0 })) { shared in
                ShareSheet(file: shared.url).presentationDetents([.medium, .large])
            }
            .sheet(item: Binding(get: { session.viewedSource }, set: { session.viewedSource = $0 })) { SourceView(source: $0) }
            .sheet(isPresented: Binding(get: { !isMac && session.devTools != nil }, set: { if !$0 { session.devTools = nil } })) {
                DevToolsPanel(browser: browser, pane: devTools).presentationDetents([.medium, .large])
            }
            .sheet(isPresented: $showsSync) { SyncView(sync: session.sync) }
            .sheet(isPresented: $showsPasswords) { PasswordsView(passwords: session.passwords) }
            .confirmationDialog(
                L("Passwort für \(session.passwordOffer?.user ?? "") auf \(session.passwordOffer?.host ?? "") speichern?",
                  "Save the password for \(session.passwordOffer?.user ?? "") on \(session.passwordOffer?.host ?? "")?"),
                isPresented: Binding(get: { session.passwordOffer != nil }, set: { if !$0 { session.passwordOffer = nil } }),
                titleVisibility: .visible, presenting: session.passwordOffer
            ) { offer in
                Button(L("Speichern", "Save")) {
                    let status = session.passwords.save(offer)
                    browser.log("PASSWORT gespeichert für \(offer.host): \(status)")
                    browser.show(status == errSecSuccess ? L("Passwort gespeichert", "Password saved") : L("Passwort ließ sich nicht speichern (\(status))", "Could not save the password (\(status))"),
                                 symbol: status == errSecSuccess ? "key.fill" : "exclamationmark.triangle.fill")
                }
                Button(L("Nicht jetzt", "Not now"), role: .cancel) {}
            } message: { _ in
                Text(L("Es liegt im Schlüsselbund dieses Geräts. Einsetzen geht nur mit Face ID, Touch ID oder Code.",
                       "It is kept in this device's keychain. Filling it in needs Face ID, Touch ID or the passcode."))
            }
            .sheet(isPresented: Bindable(session).showsLibrary, onDismiss: { session.libraryPage = .bookmarks }) {
                LibraryView(library: session.library, page: session.libraryPage) { browser.open($0) }
            }
            .sheet(isPresented: Bindable(session).showsDownloads) { DownloadsView(session: session) }
            .sheet(isPresented: Bindable(session).showsTabSearch) { TabSearchView(session: session) }
            .sheet(isPresented: $showsQRCode) { if let url = browser.address { QRCodeView(url: url) } }
            .onChange(of: session.addressRequests) {
                revealsBars = true   // compact mode: the field must be on screen to take the cursor
                Task { @MainActor in editing = true }
            }
            .onOpenURL { url in
                session.openExternal(url)
            }
            // The log shows a jump into another app; the reading position is saved for the way back.
            .onChange(of: scenePhase) { old, new in
                switch new {
                case .active: session.appBecameActive()
                case .inactive: if old == .active { session.appIsLeaving() }
                default: session.appWentToBackground()
                }
            }
            .confirmationDialog(
                L("Cookies, Cache, Anmeldungen, Verlauf und alle Tabs werden gelöscht.", "Cookies, cache, sign-ins, history and all tabs will be deleted."),
                isPresented: $confirmsWipe, titleVisibility: .visible
            ) {
                Button(L("Alles löschen", "Clear everything"), role: .destructive) {
                    Task { await session.wipe() }
                }
            }
            #if targetEnvironment(macCatalyst)
            .focusedSceneValue(\.browserSession, session)
            // The tab strip takes the title bar's place, as in desktop browsers.
            .onAppear {
                for case let scene as UIWindowScene in UIApplication.shared.connectedScenes {
                    scene.titlebar?.titleVisibility = .hidden
                    scene.titlebar?.toolbar = nil
                }
            }
            #endif
            .fileImporter(isPresented: $importsExtension, allowedContentTypes: extensionTypes) { result in
                if case .success(let url) = result { Task { await session.extensions.install(from: url) } }
            }
            .task { await session.extensions.start() }
            .task { await session.blocker.start() }
    }

    /// Installed extensions: a tap runs the extension's button (often its popup). Adding takes an unpacked folder or a .zip.
    private var extensionsMenu: some View {
        Menu {
            ForEach(session.extensions.installed, id: \.uniqueIdentifier) { context in
                Button { context.performAction(for: browser) } label: {
                    Label {
                        Text(Extensions.name(of: context))
                    } icon: {
                        if let icon = context.action(for: browser)?.icon(for: CGSize(width: 20, height: 20))
                            ?? context.webExtension.icon(for: CGSize(width: 20, height: 20)) {
                            Image(uiImage: icon)
                        } else {
                            Image(systemName: "puzzlepiece.extension")
                        }
                    }
                }
            }
            Section {
                ForEach(session.extensions.installed.filter { $0.optionsPageURL != nil }, id: \.uniqueIdentifier) { context in
                    Button(L("Einstellungen: ", "Settings: ") + Extensions.name(of: context), systemImage: "slider.horizontal.3") {
                        if let url = context.optionsPageURL { session.openInNewTab(url) }
                    }
                }
                Button(L("Erweiterung aus Ordner …", "Extension from folder …"), systemImage: "folder.badge.plus") {
                    extensionTypes = [.folder]
                    importsExtension = true
                }
                Button(L("Erweiterung aus ZIP …", "Extension from ZIP …"), systemImage: "doc.zipper") {
                    extensionTypes = [.zip]
                    importsExtension = true
                }
                if !session.extensions.installed.isEmpty {
                    Menu(L("Erweiterung entfernen", "Remove extension"), systemImage: "trash") {
                        ForEach(session.extensions.installed, id: \.uniqueIdentifier) { context in
                            Button(Extensions.name(of: context), role: .destructive) { session.extensions.remove(context) }
                        }
                    }
                }
            }
        } label: {
            Label(L("Erweiterungen", "Extensions"), systemImage: "puzzlepiece.extension").iconFrame()
        }
        .help(L("Erweiterungen", "Extensions"))
    }

    private let isMac = ProcessInfo.processInfo.isMacCatalystApp

    /// While typing something other than the open page's address.
    private var suggestions: [Library.Entry] {
        guard editing, address != browser.address?.absoluteString else { return [] }
        return session.library.suggestions(for: address)
    }

    private func toggleBookmark() {
        guard let url = browser.address else { return }
        session.library.toggleBookmark(url, title: browser.label)
    }

    /// While reading down a page the bars are out of the way. Typing an address and the start page keep them.
    /// The tab in front with its start page or wake-up picture.
    private var page: some View {
        WebViewHost(webView: browser.webView)
            .id(ObjectIdentifier(browser.webView))   // each tab has its own web view and may replace it
            .overlay {
                if browser.address == nil {
                    StartPage(library: session.library, status: session.blocker.status + "\n"
                              + L("\(session.blockedTotal.formatted()) Werbung und Tracker blockiert", "\(session.blockedTotal.formatted()) ads and trackers blocked")) { url in
                        editing = false
                        browser.open(url)
                    }
                } else if !browser.hasCommittedPage, let preview = browser.previewImage {
                    // Prevents a white flash while a sleeping tab wakes and restores its page.
                    GeometryReader { geo in
                        Image(uiImage: preview)
                            .resizable()
                            .scaledToFill()
                            .frame(width: geo.size.width, height: geo.size.height, alignment: .top)
                            .clipped()
                    }
                    .background(Color(.systemBackground))
                    .allowsHitTesting(false)
                }
            }
    }

    /// The page, or on the Mac two tabs side by side with a divider to drag.
    @ViewBuilder private var pages: some View {
        // The pair is read once: the geometry reader's closure can run again after the split was ended.
        if isMac, case let pair = session.split, pair.count == 2, pair.contains(where: { $0 === browser }) {
            GeometryReader { geo in
                HStack(spacing: 0) {
                    pane(pair[0]).frame(width: max(0, geo.size.width * session.splitRatio - 3))
                    Rectangle()
                        .fill(Color(.separator))
                        .frame(width: 6)
                        .contentShape(.rect)
                        .gesture(DragGesture(coordinateSpace: .named("split")).onChanged {
                            session.splitRatio = min(0.8, max(0.2, $0.location.x / max(geo.size.width, 1)))
                        })
                        .accessibilityLabel(L("Trennlinie", "Divider"))
                    pane(pair[1])
                }
                .coordinateSpace(.named("split"))
            }
        } else {
            page
        }
    }

    /// One half of the split view; the half in front is outlined, a click into the other brings it forward.
    @ViewBuilder private func pane(_ tab: Browser) -> some View {
        if tab === browser {
            page.overlay { Rectangle().strokeBorder(Color.accentColor, lineWidth: 2).allowsHitTesting(false) }
        } else if tab.address == nil {
            // An empty tab's web view is blank; its start page shows once it is in front.
            ContentUnavailableView(L("Neuer Tab", "New Tab"), systemImage: "plus.square")
                .contentShape(.rect)
                .onTapGesture { session.select(tab) }
        } else if let view = tab.webView {
            WebViewHost(webView: view).id(ObjectIdentifier(view))
        } else {
            Color(.systemBackground).onAppear { tab.activate() }
        }
    }

    /// Zen's "Glance": the ⌥-clicked link in a card over the page, kept as a tab or closed again.
    private func glanceCard(_ glance: Browser) -> some View {
        ZStack {
            Color.black.opacity(0.35)
                .ignoresSafeArea()
                .onTapGesture { session.closeGlance() }
            VStack(spacing: 0) {
                HStack(spacing: 8) {
                    if glance.address?.scheme == "http" {
                        Image(systemName: "lock.slash").foregroundStyle(.orange).accessibilityLabel(L("Nicht sicher", "Not secure"))
                    }
                    Text(glance.label)
                        .font(.callout.weight(.semibold))
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Button(L("Als Tab öffnen", "Open as Tab"), systemImage: "plus.square.on.square") { session.keepGlance() }
                        .keyboardShortcut("o")
                    Button(L("Schließen", "Close"), systemImage: "xmark") { session.closeGlance() }
                        .labelStyle(.iconOnly)
                        .keyboardShortcut(.cancelAction)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(.bar)
                .overlay(alignment: .bottom) {
                    if glance.isLoading { ProgressView(value: glance.progress).progressViewStyle(.linear) }
                }
                if let view = glance.webView { WebViewHost(webView: view).id(ObjectIdentifier(view)) }
            }
            .clipShape(.rect(cornerRadius: 12))
            .shadow(radius: 20)
            .containerRelativeFrame([.horizontal, .vertical]) { length, _ in length * 0.82 }
        }
    }

    private var hidesBars: Bool { browser.barsHidden && !editing && browser.address != nil && !isMac }

    /// Site name while reading, full address while editing.
    private func showAddress() {
        let url = browser.address
        address = (editing ? url?.absoluteString : url?.host?.replacing(/^www\./, with: "")) ?? ""
    }

    /// Top: moving through pages and what the app does. Bottom, in thumb reach: the address and the tabs.
    private var topBar: some View {
        HStack(spacing: 4) {
            icon(L("Zurück", "Back"), "chevron.backward") { browser.webView.goBack() }
                .disabled(!browser.canGoBack)
            icon(L("Vorwärts", "Forward"), "chevron.forward") { browser.webView.goForward() }
                .disabled(!browser.canGoForward)
            Spacer()
            if browser.hasVideo && session.floatsVideo {
                icon(L("Bild-in-Bild", "Picture in Picture"), "pip.enter") { browser.toggleFloat() }
            }
            extensionsMenu
            Menu {
                phoneMenu
            } label: {
                Label(L("Einstellungen", "Settings"), systemImage: "gearshape").iconFrame()
                    .blockedBadge(browser.blocked)
            }
            .accessibilityValue(L("\(browser.blocked) blockiert", "\(browser.blocked) blocked"))
            icon(L("Alles löschen", "Clear everything"), "flame") { confirmsWipe = true }
                .tint(.red)
        }
        .padding(.horizontal, 8)
    }

    /// What applies to the site in front: the shield in the Mac's address field, part of the gear menu on the phone.
    /// Mac: the shield in the address field. The iPhone's gear menu shows the same parts, the rarer ones a level down.
    @ViewBuilder private var siteSettings: some View {
        if browser.address != nil {
            zoomRow
            Section { pageActions }
            siteProtection
        }
    }

    private var zoomRow: some View {
        Section(L("\(browser.blocked) blockiert auf dieser Seite", "\(browser.blocked) blocked on this page")) {
            ControlGroup {
                Button(L("Kleiner", "Smaller"), systemImage: "minus.magnifyingglass") { browser.changeZoom(by: -0.1) }
                Button("\(Int((browser.zoom * 100).rounded())) %") { browser.changeZoom(by: nil) }
                Button(L("Größer", "Larger"), systemImage: "plus.magnifyingglass") { browser.changeZoom(by: 0.1) }
            }
        }
    }

    /// What one does with the page: keep it, pass it on, search or read it.
    @ViewBuilder private var pageActions: some View {
        if let pageURL = browser.address {
            if session.library.isBookmarked(pageURL) {
                Button(L("Lesezeichen entfernen", "Remove bookmark"), systemImage: "star.slash") { toggleBookmark() }
            } else {
                Button(L("Lesezeichen hinzufügen", "Add bookmark"), systemImage: "star") { toggleBookmark() }
            }
            ShareLink(item: pageURL) {
                Label(L("Seite teilen", "Share page"), systemImage: "square.and.arrow.up")
            }
            Button(L("QR-Code", "QR code"), systemImage: "qrcode") { showsQRCode = true }
            if browser.hasCommittedPage {
                Button(L("Auf der Seite suchen", "Find on page"), systemImage: "magnifyingglass") {
                    browser.findInPage()
                }
                Button(L("Lesemodus", "Reader mode"), systemImage: "doc.plaintext", action: showReader)
                Button(L("Link zur Textstelle kopieren", "Copy link to highlight"), systemImage: "link") {
                    browser.copyHighlightLink()
                }
                if browser.hasVideo { videoMenu }
                Button(L("Seitenquelltext anzeigen", "View page source"), systemImage: "chevron.left.forwardslash.chevron.right") {
                    session.showSource()
                }
                Button(L("Entwicklertools", "Developer tools"), systemImage: "hammer") { session.devTools = .console }
                Button(browser.isMuted ? L("Ton einschalten", "Unmute tab") : L("Tab stummschalten", "Mute tab"),
                       systemImage: browser.isMuted ? "speaker.wave.2" : "speaker.slash") { browser.setMuted(!browser.isMuted) }
            }
        }
    }

    /// Speed, jumps and a louder sound for the video or audio that played last.
    private var videoMenu: some View {
        Menu {
            Menu(L("Tempo", "Speed")) {
                ForEach([0.5, 1, 1.25, 1.5, 2, 3], id: \.self) { speed in
                    Button(speed.formatted() + "×") { browser.videoTool("speed", speed) }
                }
            }
            Button(L("10 s zurück", "Back 10 s"), systemImage: "gobackward.10") { browser.videoTool("seek", -10) }
            Button(L("10 s vor", "Forward 10 s"), systemImage: "goforward.10") { browser.videoTool("seek", 10) }
            Button(L("Intro überspringen (+85 s)", "Skip intro (+85 s)"), systemImage: "forward.end") { browser.videoTool("seek", 85) }
            Menu(L("Lautstärke", "Volume")) {
                ForEach([1.0, 2, 3], id: \.self) { level in
                    Button("\(Int(level * 100)) %") { browser.videoTool("boost", level) }
                }
            }
        } label: {
            Label(L("Video", "Video"), systemImage: "play.rectangle")
        }
    }

    /// The switches and tools of the protection on this site.
    @ViewBuilder private var siteProtection: some View {
        if let pageURL = browser.address {
            Section {
                Toggle(isOn: Bindable(browser).scriptsAllowed) {
                    Label(L("JavaScript auf dieser Seite", "JavaScript on this site"), systemImage: "chevron.left.forwardslash.chevron.right")
                }
                Toggle(isOn: Bindable(browser).popupsAllowed) {
                    Label(L("Popups auf dieser Seite", "Popups on this site"), systemImage: "macwindow.on.rectangle")
                }
                Toggle(isOn: Bindable(browser).filteringAllowed) {
                    Label(L("Werbeblocker auf dieser Seite", "Ad blocker on this site"), systemImage: "shield.lefthalf.filled")
                }
                Toggle(isOn: Bindable(browser).desktopMode) {
                    Label(L("Desktop-Webseite", "Desktop site"), systemImage: "desktopcomputer")
                }
            }
            if browser.hasCommittedPage {
                Section {
                    Button(L("Element ausblenden", "Hide element"), systemImage: "eye.slash", action: hideElement)
                    if let site = Browser.site(pageURL), let hidden = session.hiddenElements[site]?.count {
                        Button(L("Ausgeblendete Elemente zurücksetzen (\(hidden))", "Restore hidden elements (\(hidden))"),
                               systemImage: "eye") {
                            session.restoreHidden(on: site)
                            browser.reload()
                        }
                    }
                }
            }
            if let site = Browser.site(pageURL) {
                Section {
                    Toggle(isOn: Binding(
                        get: { session.forgetSites.contains(site) },
                        set: { session.setForget($0, site: site) }
                    )) {
                        Label(L("Beim Schließen vergessen", "Forget when closed"), systemImage: "flame")
                    }
                    Button(L("Seite vergessen …", "Forget this site …"), systemImage: "flame", role: .destructive) {
                        forgetting = site
                    }
                    Button(L("Seite sperren …", "Block this site …"), systemImage: "nosign", role: .destructive) {
                        blocking = site
                    }
                }
            }
        }
    }

    /// iPhone gear: what is used often stays on top, protection switches and app settings are one level down.
    @ViewBuilder private var phoneMenu: some View {
        if browser.address != nil {
            zoomRow
            Section { pageActions }
            Menu {
                siteProtection
            } label: {
                Label(L("Schutz · \(browser.blocked) blockiert", "Protection · \(browser.blocked) blocked"),
                      systemImage: "shield.lefthalf.filled")
            }
        }
        Section { appActions }
        Menu {
            appPreferences
        } label: {
            Label(L("Einstellungen", "Settings"), systemImage: "gearshape")
        }
    }

    private func showReader() {
        let tab = browser
        Task {
            if let found = await tab.readerArticle() {
                article = found
            } else {
                tab.show(L("Kein Artikeltext gefunden", "No article text found"), symbol: "doc.text.magnifyingglass")
            }
        }
    }

    /// The next tap on the page picks what disappears, on this page and on every later page of the site.
    private func hideElement() {
        guard let site = Browser.site(browser.address) else { return }
        let tab = browser
        tab.show(L("Tippe auf das Element, das verschwinden soll", "Tap the element to hide"), symbol: "eye.slash", lasting: true)
        Task {
            guard let selector = await tab.pickElement(), !selector.isEmpty else { return }
            session.hide(selector, on: site)
            tab.show(L("Element ausgeblendet", "Element hidden"), symbol: "eye.slash")
        }
    }

    @ViewBuilder private var appActions: some View {
        if !isMac {
            Button(L("Lesezeichen und Verlauf", "Bookmarks and history"), systemImage: "book") { session.showsLibrary = true }
        }
        Button(L("Neuer privater Tab", "New private tab"), systemImage: "eye.slash") {
            session.newPrivateTab()
            editing = true
        }
        Button(L("Downloads", "Downloads"), systemImage: "arrow.down.circle") { session.showsDownloads = true }
    }

    @ViewBuilder private var appPreferences: some View {
        Picker(L("Suchmaschine", "Search engine"), systemImage: "magnifyingglass", selection: Bindable(session).searchEngine) {
            ForEach(SearchEngine.all, id: \.name) { Text($0.name).tag($0.name) }
        }
        .pickerStyle(.menu)
        Button(L("Ausnahmen und Sperrliste", "Exceptions and block list"), systemImage: "list.bullet.rectangle") { showsSiteLists = true }
        Button(L("Passwörter", "Passwords"), systemImage: "key") { showsPasswords = true }
        Button(L("Synchronisierung", "Sync"), systemImage: "arrow.triangle.2.circlepath") { showsSync = true }
        Section {
            Toggle(isOn: Bindable(session).darkPages) {
                Label(L("Seiten abdunkeln", "Darken pages"), systemImage: "moon")
            }
            Toggle(isOn: Bindable(session).floatsVideo) {
                Label(L("Bild-in-Bild", "Picture in Picture"), systemImage: "pip")
            }
        }
        Section {
            Toggle(isOn: Bindable(session).rejectsCookies) {
                Label(L("Cookie-Banner ablehnen", "Reject cookie banners"), systemImage: "checkmark.shield")
            }
            Toggle(isOn: Bindable(session).httpsOnly) {
                Label(L("Nur HTTPS", "HTTPS only"), systemImage: "lock")
            }
        }
        Section(session.blocker.status) {
            Button(L("Filterlisten aktualisieren", "Update filter lists"), systemImage: "arrow.down.circle") {
                Task { await session.blocker.update() }
            }
            .disabled(session.blocker.isUpdating)
            ShareLink(L("Protokoll teilen", "Share log"), item: Session.logFile)
            Button(L("Lizenzen", "Licenses"), systemImage: "doc.text") { showsLicenses = true }
        }
    }

    // MARK: Mac: desktop browser layout, tab strip on top, then the toolbar with the address field

    private var devTools: Binding<DevPane?> {
        Binding(get: { session.devTools }, set: { session.devTools = $0 })
    }

    private var macBars: some View {
        VStack(spacing: 0) {
            if !session.verticalTabs || session.compact { tabStrip }
            HStack(spacing: 2) {
                // The keyboard shortcuts of these buttons live in the menu bar (RuheApp), as in Chrome.
                icon(L("Zurück", "Back"), "chevron.backward") { browser.webView.goBack() }
                    .disabled(!browser.canGoBack)
                icon(L("Vorwärts", "Forward"), "chevron.forward") { browser.webView.goForward() }
                    .disabled(!browser.canGoForward)
                if browser.isLoading {
                    icon(L("Laden abbrechen", "Stop loading"), "xmark") { browser.webView.stopLoading() }
                } else {
                    icon(L("Neu laden", "Reload"), "arrow.clockwise") { browser.reload() }
                        .disabled(browser.address == nil)
                }
                addressField
                    .padding(.horizontal, 6)
                if browser.hasVideo && session.floatsVideo {
                    icon(L("Bild-in-Bild", "Picture in Picture"), "pip.enter") { browser.toggleFloat() }
                }
                icon(L("Lesezeichen und Verlauf", "Bookmarks and history"), "book") { session.showsLibrary = true }
                extensionsMenu
                Menu {
                    Section {
                        Button(L("Neuer Tab", "New tab"), systemImage: "plus") { openNewTab() }
                        if !session.closedTabs.isEmpty {
                            Button(L("Geschlossenen Tab öffnen", "Reopen closed tab"), systemImage: "arrow.uturn.backward") {
                                session.reopenClosedTab()
                            }
                        }
                    }
                    appActions
                    appPreferences
                } label: {
                    Label(L("Menü", "Menu"), systemImage: "line.3.horizontal").iconFrame()
                }
                .help(L("Menü", "Menu"))
                Divider()
                    .frame(height: 18)
                    .padding(.horizontal, 4)
                    .accessibilityHidden(true)
                icon(L("Alles löschen", "Clear everything"), "flame") { confirmsWipe = true }
                    .tint(.red)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Color(.systemBackground))
            if session.showsBookmarksBar, !session.library.bookmarks.isEmpty { bookmarksBar }
            ProgressView(value: browser.progress)
                .progressViewStyle(.linear)
                .frame(height: 2)
                .opacity(browser.isLoading ? 1 : 0)
                .accessibilityHidden(!browser.isLoading)
            Divider()
        }
        .background(Color(.secondarySystemBackground))
    }

    private var bookmarksBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 2) {
                ForEach(session.library.bookmarks, id: \.self) { entry in
                    Button { browser.open(entry.url) } label: {
                        Label(entry.title, systemImage: "globe")
                            .labelStyle(.titleAndIcon)
                            .font(.caption)
                            .lineLimit(1)
                            .frame(maxWidth: 160)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .help(entry.url.absoluteString)
                    .contextMenu {
                        Button(L("In neuem Tab öffnen", "Open in New Tab"), systemImage: "plus.square") { _ = session.openInNewTab(entry.url) }
                        Button(L("Entfernen", "Remove"), systemImage: "trash", role: .destructive) { session.library.removeBookmark(entry) }
                    }
                }
            }
            .padding(.horizontal, 8)
        }
        .frame(height: 28)
        .background(Color(.systemBackground))
    }

    /// The tabs one below the other, readable with many open (Floorp, Zen).
    private var tabColumn: some View {
        VStack(spacing: 0) {
            ScrollView {
                LazyVStack(spacing: 2) {
                    ForEach(session.tabs, id: \.self) { tabChip($0, vertical: true) }
                }
                .padding(6)
            }
            Divider()
            Button(action: openNewTab) {
                Label(L("Neuer Tab", "New tab"), systemImage: "plus")
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(10)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
        }
        .frame(width: 230)
        .background(Color(.secondarySystemBackground))
        .overlay(alignment: .trailing) { Divider() }
    }

    private var tabStrip: some View {
        HStack(spacing: 0) {
            ScrollViewReader { strip in
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 2) {
                        ForEach(session.tabs, id: \.self) { tabChip($0).id(ObjectIdentifier($0)) }
                    }
                    .padding(.horizontal, 4)
                }
                // The tab in front stays in view, also a new one at the end.
                .onChange(of: ObjectIdentifier(browser), initial: true) { _, front in
                    withAnimation { strip.scrollTo(front) }
                }
            }
            icon(L("Neuer Tab", "New tab"), "plus") { openNewTab() }
        }
        .padding(.leading, 4)
        .padding(.top, 4)
        .frame(height: 44, alignment: .bottom)
    }

    private func tabChip(_ tab: Browser, vertical: Bool = false) -> some View {
        let isCurrent = tab === session.current
        let small = tab.isPinned && !vertical
        return HStack(spacing: 6) {
            if small, tab.isPlaying || tab.isMuted {
                Button { tab.setMuted(!tab.isMuted) } label: {
                    Image(systemName: tab.isMuted ? "speaker.slash.fill" : "speaker.wave.2.fill").font(.caption)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .help(tab.label)
            } else if small {
                Text(tab.label.prefix(1).uppercased())
                    .font(.callout.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity)
                    .help(tab.label)
            } else {
            Image(systemName: tab.isPrivate ? "eye.slash" : tab.address == nil ? "shield.lefthalf.filled" : "globe")
                .font(.caption)
                .foregroundStyle(tab.isPrivate ? AnyShapeStyle(.purple) : AnyShapeStyle(.secondary))
            if tab.isPlaying || tab.isMuted {
                Button { tab.setMuted(!tab.isMuted) } label: {
                    Image(systemName: tab.isMuted ? "speaker.slash.fill" : "speaker.wave.2.fill").font(.caption)
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .help(tab.isMuted ? L("Ton einschalten", "Unmute tab") : L("Tab stummschalten", "Mute tab"))
            }
            Text(tab.label)
                .font(.callout)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
            if !tab.isPinned { Button { session.close(tab) } label: {
                Image(systemName: "xmark")
                    .font(.caption2.weight(.bold))
                    .frame(width: 22, height: 22)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .accessibilityLabel(L("„\(tab.label)“ schließen", "Close “\(tab.label)”"))
            .help(L("Tab schließen", "Close tab")) }
            }
        }
        .padding(.leading, small ? 0 : 12)
        .padding(.trailing, small ? 0 : 6)
        .frame(width: vertical ? nil : small ? 44 : 210, height: 36)
        .frame(maxWidth: vertical ? .infinity : nil)
        .background(isCurrent ? Color(.systemBackground) : .clear,
                    in: UnevenRoundedRectangle(topLeadingRadius: 9, bottomLeadingRadius: vertical ? 9 : 0,
                                               bottomTrailingRadius: vertical ? 9 : 0, topTrailingRadius: 9))
        .contentShape(.rect)
        .onTapGesture { session.select(tab) }
        .contextMenu {
            Button(L("Neu laden", "Reload"), systemImage: "arrow.clockwise") { tab.reload() }
                .disabled(tab.address == nil)
            Button(L("Duplizieren", "Duplicate"), systemImage: "plus.square.on.square") {
                if let url = tab.address { session.select(tab); _ = session.openInNewTab(url) }
            }
            .disabled(tab.address == nil)
            Button(tab.isMuted ? L("Ton einschalten", "Unmute Tab") : L("Tab stummschalten", "Mute Tab"),
                   systemImage: tab.isMuted ? "speaker.wave.2" : "speaker.slash") { tab.setMuted(!tab.isMuted) }
            Button(tab.isPinned ? L("Tab loslösen", "Unpin Tab") : L("Tab anpinnen", "Pin Tab"),
                   systemImage: tab.isPinned ? "pin.slash" : "pin") { session.setPinned(tab, !tab.isPinned) }
            if tab !== session.current {
                Button(L("In geteilter Ansicht öffnen", "Open in Split View"), systemImage: "rectangle.split.2x1") { session.showSplit(with: tab) }
            }
            Divider()
            Button(L("Schließen", "Close"), systemImage: "xmark") { session.close(tab) }
            Button(L("Andere Tabs schließen", "Close Other Tabs")) {
                session.tabs.filter { $0 !== tab && !$0.isPinned }.forEach(session.close)
            }
            .disabled(session.tabs.count < 2)
            Button(L("Tabs rechts schließen", "Close Tabs to the Right")) {
                if let index = session.tabs.firstIndex(where: { $0 === tab }) { session.tabs[(index + 1)...].filter { !$0.isPinned }.forEach(session.close) }
            }
            .disabled(session.tabs.last === tab)
        }
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(isCurrent ? [.isButton, .isSelected] : .isButton)
    }

    private func openNewTab() {
        session.newTab()
        editing = true
    }

    private var bar: some View {
        HStack(spacing: 4) {
            addressField
            if editing {
                Button(L("Abbrechen", "Cancel")) { editing = false }
                    .padding(.horizontal, 8)
            } else {
                tabsButton
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
    }

    private var tabsButton: some View {
        Button {
            browser.capturePreview()
            showsTabs = true
        } label: {
            HStack(spacing: 4) {
                Image(systemName: "square.on.square")
                Text(session.tabs.count, format: .number)
                    .font(.caption.weight(.semibold).monospacedDigit())
            }
            .padding(.horizontal, 6)
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(.rect)
        }
        .accessibilityLabel(L("Tabübersicht", "Tab overview"))
        .accessibilityValue(L("\(session.tabs.count) offen", "\(session.tabs.count) open"))
    }

    private func focusNewTab() {
        guard focusesNewTab else { return }
        focusesNewTab = false
        editing = true
    }

    private var addressField: some View {
        HStack(spacing: 6) {
            let insecure = !editing && browser.address?.scheme == "http"
            Image(systemName: browser.isPrivate ? "eye.slash" : editing || browser.address == nil ? "magnifyingglass" : insecure ? "lock.slash" : "globe")
                .font(.subheadline)
                .foregroundStyle(browser.isPrivate ? AnyShapeStyle(.purple) : insecure ? AnyShapeStyle(.orange) : AnyShapeStyle(.secondary))
                .frame(width: 20)
                .accessibilityLabel(L("Nicht sicher", "Not secure"))
                .accessibilityHidden(!insecure)
                .help(insecure ? L("Nicht sicher: Die Verbindung zu dieser Seite ist nicht verschlüsselt.", "Not secure: the connection to this site is not encrypted.") : "")
            TextField(L("Adresse oder Suche", "Address or search"), text: $address)
                .focused($editing)
                .accessibilityLabel(browser.isPrivate ? L("Privat: Adresse oder Suche", "Private: address or search") : L("Adresse oder Suche", "Address or search"))
                .keyboardType(.webSearch)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.go)
                .onSubmit { browser.go(address) }
            if !editing, session.passwords.has(browser.address) {
                PasswordButton(browser: browser, passwords: session.passwords)
            }
            if editing {
                if !address.isEmpty {
                    small(L("Eingabe leeren", "Clear text"), "xmark.circle.fill") { address = "" }
                }
            } else if isMac {
                if browser.address != nil {
                    let marked = session.library.isBookmarked(browser.address)
                    Button(action: toggleBookmark) {
                        Label(marked ? L("Lesezeichen entfernen", "Remove bookmark") : L("Lesezeichen hinzufügen", "Add bookmark"),
                              systemImage: marked ? "star.fill" : "star")
                            .labelStyle(.iconOnly)
                            .frame(width: 32, height: 34)
                            .contentShape(.rect)
                    }
                    .tint(marked ? .accentColor : .secondary)
                    .help(marked ? L("Lesezeichen entfernen", "Remove bookmark") : L("Lesezeichen hinzufügen", "Add bookmark"))
                }
                // Like the shield in desktop browsers: what the protection does on this site.
                if browser.address != nil {
                    Menu { siteSettings } label: {
                        Label(L("Schutz auf dieser Seite", "Protection on this site"), systemImage: "shield.lefthalf.filled")
                            .labelStyle(.iconOnly)
                            .frame(width: 40, height: 34)
                            .blockedBadge(browser.blocked)
                            .contentShape(.rect)
                    }
                    .accessibilityValue(L("\(browser.blocked) blockiert", "\(browser.blocked) blocked"))
                    .help(L("Schutz auf dieser Seite", "Protection on this site"))
                    .tint(browser.filteringAllowed ? .accentColor : .secondary)
                }
            } else if browser.isLoading {
                small(L("Laden abbrechen", "Stop loading"), "xmark") { browser.webView.stopLoading() }
            } else if browser.address != nil {
                small(L("Neu laden", "Reload"), "arrow.clockwise") { browser.reload() }
            }
        }
        .padding(.leading, 12)
        .frame(minHeight: isMac ? 34 : 44)
        // Purple marks a private tab, as in other browsers.
        .background(browser.isPrivate ? AnyShapeStyle(Color.purple.opacity(0.2)) : AnyShapeStyle(Color(.tertiarySystemFill)),
                    in: .rect(cornerRadius: isMac ? 17 : 12))
    }

    private func noticeRow(_ notice: Notice) -> some View {
        HStack {
            Label(notice.text, systemImage: notice.symbol)
                .lineLimit(2)
            Spacer()
            if let action = notice.action {
                Button(action.title) { action.run() }
                    .fontWeight(.semibold)
            } else if let url = notice.url {
                Button(L("Öffnen", "Open"), systemImage: "arrow.up.right") { browser.open(url) }
                    .fontWeight(.semibold)
            }
        }
        .font(.footnote)
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(.regularMaterial)
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }

    private func icon(_ title: String, _ symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { Label(title, systemImage: symbol).iconFrame() }
            .help(title)
    }

    private func small(_ title: String, _ symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: symbol)
                .labelStyle(.iconOnly)
                .frame(width: 40, height: 44)
                .contentShape(.rect)
        }
        .tint(.secondary)
        .help(title)
    }
}

private extension View {
    /// How many requests were stopped on the page in front, as a small red count.
    func blockedBadge(_ count: Int) -> some View {
        overlay(alignment: .topTrailing) {
            if count > 0 {
                Text(count > 99 ? "99+" : "\(count)")
                    .font(.system(size: 9, weight: .bold).monospacedDigit())
                    .foregroundStyle(.white)
                    .padding(.horizontal, 3)
                    .background(.red, in: .capsule)
                    .accessibilityHidden(true)
            }
        }
    }

    /// Icon-only with the 44 pt touch target; the title stays for VoiceOver.
    func iconFrame() -> some View {
        labelStyle(.iconOnly)
            .frame(width: 44, height: 44)
            .contentShape(.rect)
    }
}

/// The licences of the app and everything it bundles or downloads, from `Resources/licenses.txt` (shared with Android).
private struct LicensesView: View {
    @Environment(\.dismiss) private var dismiss
    private let text = Bundle.main.url(forResource: "licenses", withExtension: "txt")
        .flatMap { try? String(contentsOf: $0, encoding: .utf8) } ?? ""

    var body: some View {
        NavigationStack {
            ScrollView {
                Text(text)
                    .font(.footnote)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding()
            }
            .navigationTitle(L("Lizenzen", "Licenses"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button(L("Fertig", "Done")) { dismiss() } }
            }
        }
    }
}

private struct WebViewHost: UIViewRepresentable {
    let webView: WKWebView
    func makeUIView(context: Context) -> WKWebView { webView }
    func updateUIView(_ view: WKWebView, context: Context) {}
}
