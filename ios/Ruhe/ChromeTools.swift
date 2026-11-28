import CoreImage.CIFilterBuiltins
import SwiftUI
import UniformTypeIdentifiers

// What Chrome and Brave have beside the page: a downloads list, tab search, a QR code for the page and
// bookmark import/export.

/// One download in the list, with its progress while it runs.
@MainActor @Observable
final class DownloadItem: Identifiable {
    enum State { case running, done, failed }
    let id = UUID()
    var name: String
    var file: URL?
    var progress = 0.0
    var state = State.running
    let date = Date.now
    @ObservationIgnored var watch: NSKeyValueObservation?

    init(name: String) { self.name = name }
}

struct DownloadsView: View {
    let session: Session
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                ForEach(session.downloads.reversed()) { item in
                    Button { show(item) } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(item.name).lineLimit(1)
                            switch item.state {
                            case .running: ProgressView(value: item.progress)
                            case .done:
                                Text(item.date.formatted(date: .omitted, time: .shortened)).font(.caption).foregroundStyle(.secondary)
                            case .failed:
                                Text(L("Fehlgeschlagen", "Failed")).font(.caption).foregroundStyle(.red)
                            }
                        }
                    }
                    .tint(.primary)
                    .disabled(item.state != .done)
                }
                .onDelete { offsets in
                    let shown = Array(session.downloads.reversed())
                    let gone = Set(offsets.map { shown[$0].id })
                    session.downloads.removeAll { gone.contains($0.id) }
                }
            }
            .overlay {
                if session.downloads.isEmpty {
                    ContentUnavailableView(L("Keine Downloads", "No downloads"), systemImage: "arrow.down.circle")
                }
            }
            .navigationTitle(L("Downloads", "Downloads"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button(L("Fertig", "Done")) { dismiss() } }
                ToolbarItem(placement: .topBarLeading) {
                    Button(L("Ordner öffnen", "Open folder"), systemImage: "folder") {
                        // On the iPhone the Files app shows the app's Downloads folder (UIFileSharingEnabled).
                        UIApplication.shared.open(ProcessInfo.processInfo.isMacCatalystApp ? Browser.downloadFolder : URL(string: "shareddocuments://" + Browser.downloadFolder.path())!)
                    }
                }
            }
        }
    }

    private func show(_ item: DownloadItem) {
        guard let file = item.file else { return }
        if ProcessInfo.processInfo.isMacCatalystApp {
            UIApplication.shared.open(file)
        } else {
            dismiss()
            session.sharedFile = SharedFile(url: file)
        }
    }
}

/// Chrome's "Tabs suchen" (⇧⌘A): every open tab by title and address.
struct TabSearchView: View {
    let session: Session
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""

    var body: some View {
        NavigationStack {
            List(Self.matches(session.tabs, text), id: \.self) { tab in
                Button {
                    session.select(tab)
                    dismiss()
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(tab.label).lineLimit(1)
                        Text(tab.address.map(Library.bare) ?? "").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                .tint(.primary)
            }
            .searchable(text: $text, placement: .navigationBarDrawer(displayMode: .always), prompt: L("Tabs suchen", "Search tabs"))
            .navigationTitle(L("Tabs suchen", "Search tabs"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Fertig", "Done")) { dismiss() } } }
        }
    }

    static func matches(_ tabs: [Browser], _ text: String) -> [Browser] {
        let needle = text.trimmingCharacters(in: .whitespaces).lowercased()
        guard !needle.isEmpty else { return tabs }
        return tabs.filter { $0.label.lowercased().contains(needle) || ($0.address.map(Library.bare) ?? "").contains(needle) }
    }
}

/// Chrome's "QR-Code erstellen" for the page in front.
struct QRCodeView: View {
    let url: URL
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                if let image = Self.image(for: url.absoluteString) {
                    Image(uiImage: image)
                        .interpolation(.none)
                        .resizable()
                        .scaledToFit()
                        .frame(maxWidth: 280)
                        .accessibilityLabel(L("QR-Code für ", "QR code for ") + url.absoluteString)
                    ShareLink(item: Image(uiImage: image), preview: SharePreview(url.host() ?? "QR", image: Image(uiImage: image))) {
                        Label(L("Bild teilen", "Share image"), systemImage: "square.and.arrow.up")
                    }
                }
                Text(url.absoluteString).font(.caption).foregroundStyle(.secondary).lineLimit(3).textSelection(.enabled)
            }
            .padding()
            .navigationTitle(L("QR-Code", "QR code"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Fertig", "Done")) { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }

    private static let context = CIContext()

    static func image(for text: String) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        filter.correctionLevel = "M"
        guard let code = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 10, y: 10)),
              let cg = context.createCGImage(code, from: code.extent) else { return nil }
        return UIImage(cgImage: cg)
    }
}

/// Bookmarks in the Netscape HTML format every browser exports and imports, and Chrome's and Brave's own files.
enum BookmarkFile {
    static func parse(html: String) -> [(url: URL, title: String)] {
        html.matches(of: /(?is)<a\s[^>]*?href\s*=\s*"([^"]+)"[^>]*>(.*?)<\/a>/).compactMap { match in
            guard let url = URL(string: unescape(String(match.1))), ["http", "https"].contains(url.scheme?.lowercased() ?? "") else { return nil }
            let title = unescape(String(match.2).replacing(/<[^>]+>/, with: "")).trimmingCharacters(in: .whitespacesAndNewlines)
            return (url, title.isEmpty ? url.absoluteString : title)
        }
    }

    static func html(_ entries: [Library.Entry]) -> String {
        let rows = entries.map { entry in
            "    <DT><A HREF=\"\(escape(entry.url.absoluteString))\" ADD_DATE=\"\(Int(entry.date.timeIntervalSince1970))\">\(escape(entry.title))</A>"
        }
        return """
            <!DOCTYPE NETSCAPE-Bookmark-file-1>
            <META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
            <TITLE>Bookmarks</TITLE>
            <H1>Bookmarks</H1>
            <DL><p>
            \(rows.joined(separator: "\n"))
            </DL><p>

            """
    }

    /// Chrome's and Brave's `Bookmarks` JSON of every profile ("Default", "Profile 1" …), folders flattened.
    /// Mac only: the app is not sandboxed there. macOS may ask the user first, or refuse: then nothing is found.
    static func chromium(_ folder: URL) -> [(url: URL, title: String)] {
        let profiles = (try? FileManager.default.contentsOfDirectory(atPath: folder.path())) ?? []
        return profiles.filter { $0 == "Default" || $0.hasPrefix("Profile ") }
            .flatMap { chromiumFile(folder.appending(path: $0).appending(path: "Bookmarks")) }
    }

    private static func chromiumFile(_ file: URL) -> [(url: URL, title: String)] {
        guard let data = try? Data(contentsOf: file),
              let root = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["roots"] as? [String: Any] else { return [] }
        var found: [(URL, String)] = []
        func walk(_ node: Any?) {
            guard let node = node as? [String: Any] else { return }
            if node["type"] as? String == "url", let url = URL(string: node["url"] as? String ?? ""),
               ["http", "https"].contains(url.scheme?.lowercased() ?? "") {
                found.append((url, node["name"] as? String ?? url.absoluteString))
            }
            (node["children"] as? [Any])?.forEach(walk)
        }
        root.values.forEach(walk)
        return found
    }

    static let chromiumFiles: [(name: String, file: URL)] = [
        ("Chrome", URL.homeDirectory.appending(path: "Library/Application Support/Google/Chrome")),
        ("Brave", URL.homeDirectory.appending(path: "Library/Application Support/BraveSoftware/Brave-Browser")),
    ]

    private static func escape(_ text: String) -> String {
        text.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;")
    }

    private static func unescape(_ text: String) -> String {
        text.replacingOccurrences(of: "&lt;", with: "<").replacingOccurrences(of: "&gt;", with: ">")
            .replacingOccurrences(of: "&quot;", with: "\"").replacingOccurrences(of: "&#39;", with: "'")
            .replacingOccurrences(of: "&amp;", with: "&")
    }
}

/// The export file for `.fileExporter`.
struct BookmarksDocument: FileDocument {
    static let readableContentTypes = [UTType.html]
    let text: String
    init(text: String) { self.text = text }
    init(configuration: ReadConfiguration) throws { text = "" }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: Data(text.utf8)) }
}
