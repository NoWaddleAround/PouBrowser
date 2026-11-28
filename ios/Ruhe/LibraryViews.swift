import SwiftUI
import UniformTypeIdentifiers

/// An empty tab: favourites (bookmarks, or the most visited pages) as tiles.
struct StartPage: View {
    let library: Library
    let status: String
    let open: (URL) -> Void

    var body: some View {
        let favourites = library.favourites
        ScrollView {
            if favourites.entries.isEmpty {
                ContentUnavailableView(
                    "PouBrowser", systemImage: "globe",
                    description: Text(L("Adresse oder Suchbegriff eingeben", "Enter an address or a search"))
                )
                .padding(.top, 60)
            } else {
                VStack(alignment: .leading, spacing: 20) {
                    Label(favourites.areBookmarks ? L("Favoriten", "Favourites") : L("Häufig besucht", "Frequently visited"),
                          systemImage: favourites.areBookmarks ? "star" : "clock")
                        .font(.headline)
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 80, maximum: 100), spacing: 12)], spacing: 20) {
                        ForEach(favourites.entries, id: \.self) { entry in
                            Button { open(entry.url) } label: { Tile(entry: entry) }
                                .buttonStyle(.plain)
                        }
                    }
                }
                .padding(24)
                .frame(maxWidth: 640)
                .frame(maxWidth: .infinity)
            }
            Label(status, systemImage: "shield.lefthalf.filled")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 24)
                .padding(.bottom, 24)
        }
        .background(Color(.systemBackground))
    }

    private struct Tile: View {
        let entry: Library.Entry

        var body: some View {
            VStack(spacing: 8) {
                Text(entry.site.prefix(1).uppercased())
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(.white)
                    .frame(width: 56, height: 56)
                    .background(Self.colour(for: entry.site), in: .rect(cornerRadius: 14))
                Text(entry.title)
                    .font(.caption)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .contentShape(.rect)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(entry.title)
            .accessibilityAddTraits(.isButton)
        }

        /// The same site always gets the same colour (`hashValue` changes with every launch).
        static func colour(for site: String) -> Color {
            let sum = site.unicodeScalars.reduce(0) { $0 + Int($1.value) }
            return Color(hue: Double(sum % 360) / 360, saturation: 0.55, brightness: 0.7)
        }
    }
}

/// Matches from bookmarks and history while the address is typed.
struct SuggestionList: View {
    let entries: [Library.Entry]
    let library: Library
    let open: (URL) -> Void

    var body: some View {
        VStack(spacing: 0) {
            ForEach(entries, id: \.self) { entry in
                Button { open(entry.url) } label: {
                    HStack(spacing: 12) {
                        Image(systemName: library.isBookmarked(entry.url) ? "star.fill" : "clock")
                            .foregroundStyle(.secondary)
                            .frame(width: 20)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(entry.title).lineLimit(1)
                            Text(Library.bare(entry.url)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 9)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                if entry != entries.last { Divider().padding(.leading, 46) }
            }
        }
        .background(.regularMaterial, in: .rect(cornerRadius: 12))
        .shadow(color: .black.opacity(0.15), radius: 12, y: 4)
        .frame(maxWidth: 640)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }
}

/// Bookmarks and history, with a filter. Tap opens in the current tab; swipe or right-click removes.
struct LibraryView: View {
    enum Page { case bookmarks, history, importFile }
    let library: Library
    var page = Page.bookmarks
    let open: (URL) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var showsHistory = false
    @State private var filter = ""
    @State private var imports = false
    @State private var exports = false
    @State private var report: String?

    private var rows: [Library.Entry] {
        let all = showsHistory ? library.history : library.bookmarks
        let needle = filter.trimmingCharacters(in: .whitespaces).lowercased()
        guard !needle.isEmpty else { return all }
        return all.filter { $0.title.lowercased().contains(needle) || Library.bare($0.url).contains(needle) }
    }

    var body: some View {
        NavigationStack {
            List {
                ForEach(rows, id: \.self) { entry in
                    Button {
                        open(entry.url)
                        dismiss()
                    } label: {
                        Label {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(entry.title).lineLimit(1)
                                Text(showsHistory ? entry.site + " · " + entry.date.formatted(.relative(presentation: .named)) : Library.bare(entry.url))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                        } icon: {
                            Image(systemName: showsHistory ? "clock" : "star")
                                .foregroundStyle(.secondary)
                                .accessibilityHidden(true)
                        }
                    }
                    .tint(.primary)
                    .contextMenu {
                        Button(L("Entfernen", "Remove"), systemImage: "trash", role: .destructive) { remove(entry) }
                    }
                }
                .onDelete { offsets in
                    let shown = rows
                    offsets.map { shown[$0] }.forEach(remove)
                }
            }
            .overlay {
                if rows.isEmpty {
                    ContentUnavailableView(
                        showsHistory ? L("Kein Verlauf", "No history") : L("Keine Lesezeichen", "No bookmarks"),
                        systemImage: showsHistory ? "clock" : "star",
                        description: Text(showsHistory ? "" : L("Mit dem Stern speichert man die offene Seite.", "The star saves the open page."))
                    )
                }
            }
            .searchable(text: $filter, prompt: L("Suchen", "Search"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Picker(L("Ansicht", "View"), selection: $showsHistory) {
                        Text(L("Lesezeichen", "Bookmarks")).tag(false)
                        Text(L("Verlauf", "History")).tag(true)
                    }
                    .pickerStyle(.segmented)
                    .fixedSize()
                }
                ToolbarItem(placement: .confirmationAction) { Button(L("Fertig", "Done")) { dismiss() } }
                if showsHistory && !library.history.isEmpty {
                    ToolbarItem(placement: .topBarLeading) {
                        Button(role: .destructive) { library.clearHistory() } label: {
                            Label(L("Verlauf löschen", "Clear history"), systemImage: "trash")
                        }
                    }
                }
                if !showsHistory {
                    // Chrome's "Lesezeichen importieren" and "exportieren": the HTML file every browser reads and writes.
                    ToolbarItem(placement: .topBarLeading) {
                        Menu {
                            Button(L("Aus HTML-Datei importieren …", "Import from HTML file …"), systemImage: "square.and.arrow.down") { imports = true }
                            Button(L("Als HTML-Datei exportieren …", "Export as HTML file …"), systemImage: "square.and.arrow.up") { exports = true }
                                .disabled(library.bookmarks.isEmpty)
                        } label: {
                            Label(L("Importieren und exportieren", "Import and export"), systemImage: "arrow.up.arrow.down")
                        }
                    }
                }
            }
            .onAppear {
                showsHistory = page == .history
                imports = page == .importFile
            }
            .fileImporter(isPresented: $imports, allowedContentTypes: [.html]) { result in
                guard let file = try? result.get() else { return }
                let access = file.startAccessingSecurityScopedResource()
                defer { if access { file.stopAccessingSecurityScopedResource() } }
                let found = (try? String(contentsOf: file, encoding: .utf8)).map(BookmarkFile.parse) ?? []
                let added = library.importBookmarks(found)
                report = L("\(found.count) Lesezeichen gefunden, \(added) neu übernommen.", "\(found.count) bookmarks found, \(added) new ones added.")
            }
            .fileExporter(isPresented: $exports, document: BookmarksDocument(text: BookmarkFile.html(library.bookmarks)),
                          contentType: .html, defaultFilename: "PouBrowser-Lesezeichen.html") { _ in }
            .alert(report ?? "", isPresented: Binding(get: { report != nil }, set: { if !$0 { report = nil } })) {
                Button("OK") {}
            }
        }
    }

    private func remove(_ entry: Library.Entry) {
        if showsHistory { library.removeHistory(entry) } else { library.removeBookmark(entry) }
    }
}

/// Site exceptions and blocked sites. Swipe or right-click removes an entry.
struct SiteListsView: View {
    let session: Session
    @Environment(\.dismiss) private var dismiss
    @State private var newScriptlessSite = ""
    @State private var newBlockedSite = ""

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(session.scriptlessSites.sorted(), id: \.self) { site in
                        row(site) { session.setScripts(allowed: true, on: site) }
                    }
                    if session.scriptlessSites.isEmpty { none }
                    siteInput($newScriptlessSite, buttonTitle: L("Hinzufügen", "Add")) { site in
                        session.setScripts(allowed: false, on: site)
                    }
                } header: {
                    Text(L("Seiten ohne JavaScript", "Sites without JavaScript"))
                } footer: {
                    Text(L("Entfernen schaltet JavaScript dort wieder ein.", "Removing an entry turns JavaScript back on there."))
                }
                Section {
                    ForEach(session.popupSites.sorted(), id: \.self) { site in
                        row(site) { session.setPopups(allowed: false, on: site) }
                    }
                    if session.popupSites.isEmpty { none }
                } header: {
                    Text(L("Popups erlaubt auf", "Popups allowed on"))
                } footer: {
                    Text(L("Für Anmeldefenster (Google, PayPal). Entfernen blockiert Popups dort wieder.",
                           "For sign-in windows (Google, PayPal). Removing an entry blocks popups there again."))
                }
                Section {
                    ForEach(session.unfilteredSites.sorted(), id: \.self) { site in
                        row(site) { session.setFiltering(allowed: true, on: site) }
                    }
                    if session.unfilteredSites.isEmpty { none }
                } header: {
                    Text(L("Werbeblocker aus auf", "Ad blocker off on"))
                } footer: {
                    Text(L("Entfernen schaltet den Werbeblocker dort wieder ein.", "Removing an entry turns the ad blocker back on there."))
                }
                Section {
                    ForEach(session.blockedSites.sorted(), id: \.self) { site in
                        row(site) { session.setBlocked(false, site: site) }
                    }
                    if session.blockedSites.isEmpty { none }
                    siteInput($newBlockedSite, buttonTitle: L("Sperren", "Block")) { site in
                        session.setBlocked(true, site: site)
                    }
                } header: {
                    Text(L("Gesperrte Seiten", "Blocked sites"))
                } footer: {
                    Text(L("Seiten, Popups, Weiterleitungen und eingebettete Inhalte von dort laden nicht.",
                           "Pages, popups, redirects and embedded content from there do not load."))
                }
            }
            .navigationTitle(L("Ausnahmen und Sperrliste", "Exceptions and block list"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button(L("Fertig", "Done")) { dismiss() } }
            }
        }
    }

    private var none: some View {
        Text(L("Keine", "None")).foregroundStyle(.secondary)
    }

    private func row(_ site: String, remove: @escaping () -> Void) -> some View {
        Text(site)
            .swipeActions { Button(L("Entfernen", "Remove"), systemImage: "trash", role: .destructive, action: remove) }
            .contextMenu { Button(L("Entfernen", "Remove"), systemImage: "trash", role: .destructive, action: remove) }
    }

    /// "https://www.Example.com/x" and "example.com" both mean "example.com".
    private func site(from text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.rangeOfCharacter(from: .whitespacesAndNewlines.union(.controlCharacters)) == nil,
              !trimmed.contains("\\"),
              let url = URL(string: trimmed.contains("://") ? trimmed : "https://" + trimmed),
              ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
              url.user == nil, url.password == nil,
              let site = Browser.site(url), !site.isEmpty else { return nil }
        return site
    }

    private func siteInput(_ text: Binding<String>, buttonTitle: String, save: @escaping (String) -> Void) -> some View {
        let add = {
            guard let site = site(from: text.wrappedValue) else { return }
            save(site)
            text.wrappedValue = ""
        }
        return HStack {
            TextField(L("Domain oder URL", "Domain or URL"), text: text)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.URL)
                .onSubmit(add)
            Button(buttonTitle, action: add)
                .disabled(site(from: text.wrappedValue) == nil)
        }
    }
}
