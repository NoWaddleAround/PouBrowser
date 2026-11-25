import SwiftUI
import WebKit

struct ContentView: View {
    @State private var session = Session()
    @State private var address = ""
    @State private var confirmsWipe = false
    @State private var showsTabs = false
    @State private var focusesNewTab = false
    @FocusState private var editing: Bool
    @Environment(\.scenePhase) private var scenePhase

    /// The tab in front.
    private var browser: Browser { session.current }

    var body: some View {
        WebViewHost(webView: browser.webView)
            .id(ObjectIdentifier(browser.webView))   // each tab has its own web view and may replace it
            .overlay {
                if browser.url == nil {
                    ContentUnavailableView(
                        "PouBrowser", systemImage: "shield.lefthalf.filled",
                        description: Text(L(
                            "Adresse oder Suchbegriff eingeben. Popups, Weiterleitungen, Werbung und Tracker bleiben draußen.",
                            "Enter an address or a search. Popups, redirects, ads and trackers stay out."
                        ) + "\n\n" + session.blocker.status)
                    )
                    .background(Color(.systemBackground))
                }
            }
            // Floats over the page: a notice per blocked popup must not make the page jump.
            .overlay(alignment: .bottom) {
                if let notice = browser.notice { noticeRow(notice) }
            }
            .animation(.default, value: browser.notice)
            // The empty stacks stay as the coloured strips behind the status bar and the home indicator.
            .safeAreaInset(edge: .top, spacing: 0) {
                VStack(spacing: 0) {
                    if !hidesBars { topBar.transition(.move(edge: .top).combined(with: .opacity)) }
                }
                .frame(maxWidth: .infinity)
                .background(.bar)
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                VStack(spacing: 0) {
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
                .background(.bar)
            }
            .animation(.easeOut(duration: 0.25), value: hidesBars)
            .onChange(of: browser.address, initial: true) { showAddress() }
            .onChange(of: editing) { showAddress() }
            .fullScreenCover(isPresented: $showsTabs, onDismiss: focusNewTab) {
                TabOverview(session: session) {
                    session.newTab()
                    focusesNewTab = true
                }
            }
            // The log shows a jump into another app; the reading position is saved for the way back.
            .onChange(of: scenePhase) { old, new in
                switch new {
                case .active: session.appBecameActive()
                case .inactive: if old == .active { session.appIsLeaving() }
                default: session.appWentToBackground()
                }
            }
            .task { await session.blocker.start() }
    }

    /// While reading down a page the bars are out of the way. Typing an address and the start page keep them.
    private var hidesBars: Bool { browser.barsHidden && !editing && browser.url != nil }

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
            Menu {
                if browser.url != nil {
                    Toggle(L("JavaScript auf dieser Seite", "JavaScript on this site"), isOn: Bindable(browser).scriptsAllowed)
                    Toggle(L("Werbeblocker auf dieser Seite", "Ad blocker on this site"), isOn: Bindable(browser).filteringAllowed)
                }
                Toggle(L("Seiten abdunkeln", "Darken pages"), isOn: Bindable(session).darkPages)
                Toggle(L("Bild-in-Bild", "Picture in Picture"), isOn: Bindable(session).floatsVideo)
                Section(session.blocker.status) {
                    Button(L("Filterlisten aktualisieren", "Update filter lists"), systemImage: "arrow.down.circle") {
                        Task { await session.blocker.update() }
                    }
                    .disabled(session.blocker.isUpdating)
                    ShareLink(L("Protokoll teilen", "Share log"), item: Session.logFile)
                }
            } label: {
                Label(L("Einstellungen", "Settings"), systemImage: "gearshape").iconFrame()
            }
            icon(L("Alles löschen", "Clear everything"), "flame") { confirmsWipe = true }
                .confirmationDialog(
                    L("Cookies, Cache, Anmeldungen, Verlauf und alle Tabs werden gelöscht.", "Cookies, cache, sign-ins, history and all tabs will be deleted."),
                    isPresented: $confirmsWipe, titleVisibility: .visible
                ) {
                    Button(L("Alles löschen", "Clear everything"), role: .destructive) {
                        Task { await session.wipe() }
                    }
                }
        }
        .padding(.horizontal, 8)
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
            Text(session.tabs.count, format: .number)
                .font(.caption.weight(.semibold).monospacedDigit())
                .padding(.horizontal, 4)
                .frame(minWidth: 24, minHeight: 24)
                .overlay { RoundedRectangle(cornerRadius: 6).strokeBorder(lineWidth: 1.5) }
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
            TextField(L("Adresse oder Suche", "Address or search"), text: $address)
                .focused($editing)
                .keyboardType(.webSearch)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.go)
                .onSubmit { browser.go(address) }
            if editing {
                if !address.isEmpty {
                    small(L("Eingabe leeren", "Clear text"), "xmark.circle.fill") { address = "" }
                }
            } else if browser.isLoading {
                small(L("Laden abbrechen", "Stop loading"), "xmark") { browser.webView.stopLoading() }
            } else if browser.address != nil {
                small(L("Neu laden", "Reload"), "arrow.clockwise") { browser.reload() }
            }
        }
        .padding(.leading, 12)
        .frame(minHeight: 44)
        .background(Color(.tertiarySystemFill), in: .rect(cornerRadius: 12))
    }

    private func noticeRow(_ notice: Notice) -> some View {
        HStack {
            Label(notice.text, systemImage: notice.symbol)
                .lineLimit(2)
            Spacer()
            if let url = notice.url {
                Button(L("Öffnen", "Open")) { browser.open(url) }
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
    }

    private func small(_ title: String, _ symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: symbol)
                .labelStyle(.iconOnly)
                .frame(width: 40, height: 44)
                .contentShape(.rect)
        }
        .tint(.secondary)
    }
}

private extension View {
    /// Icon-only with the 44 pt touch target; the title stays for VoiceOver.
    func iconFrame() -> some View {
        labelStyle(.iconOnly)
            .frame(width: 44, height: 44)
            .contentShape(.rect)
    }
}

private struct WebViewHost: UIViewRepresentable {
    let webView: WKWebView
    func makeUIView(context: Context) -> WKWebView { webView }
    func updateUIView(_ view: WKWebView, context: Context) {}
}
