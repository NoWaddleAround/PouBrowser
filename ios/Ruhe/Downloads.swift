import AVFoundation
import SwiftUI
import WebKit

/// A video or audio file the user long-pressed (or right-clicked), waiting for "Video laden" / "Nur Ton".
struct MediaOffer: Identifiable {
    let id = UUID()
    let url: URL
    let isVideo: Bool
    weak var tab: Browser?
}

/// A finished download on the iPhone, handed to the share sheet ("Bild sichern", "In Dateien sichern").
struct SharedFile: Identifiable {
    let id = UUID()
    let url: URL
}

/// Downloads the user started from a long press. Pages cannot start one (see `decide`).
extension Browser: WKDownloadDelegate {
    /// Finds `pouImageAtPress` from `Resources/media.js`, which runs in every frame of the app's script world.
    static let downloadScript = WKUserScript(
        source: Bundle.main.url(forResource: "media", withExtension: "js")
            .flatMap { try? String(contentsOf: $0, encoding: .utf8) } ?? "",
        injectionTime: .atDocumentStart, forMainFrameOnly: false, in: .defaultClient)

    /// The image under the last press in the page's main frame, if any.
    func pressedImage() async -> URL? {
        guard let webView,
              let found = try? await webView.callAsyncJavaScript(
                "return window.pouImageAtPress ? pouImageAtPress() : null", contentWorld: .defaultClient) as? String
        else { return nil }
        return URL(string: found)
    }

    /// media.js reports a long-pressed player as JSON: `{kind, url, stream}`.
    func mediaPressed(_ body: String) {
        guard let data = body.data(using: .utf8),
              let found = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        let isVideo = found["kind"] as? String == "video"
        guard found["stream"] as? Bool != true, let url = URL(string: found["url"] as? String ?? ""),
              ["http", "https"].contains(url.scheme?.lowercased() ?? "") else {
            log("DOWNLOAD nicht möglich, Stream")
            show(L("Dieses Video ist ein Stream und lässt sich nicht als Datei laden.",
                   "This video is a stream and cannot be saved as a file."), symbol: "exclamationmark.triangle.fill")
            return
        }
        guard session.current === self else { return }
        session.mediaOffer = MediaOffer(url: url, isVideo: isVideo, tab: self)
    }

    func download(_ url: URL, audioOnly: Bool = false) {
        guard let webView else { return }
        if let site = Self.site(url), session.blockedSites.contains(site) {
            show(L("Gesperrte Seite: ", "Blocked site: ") + site, symbol: "nosign")
            return
        }
        log("DOWNLOAD \(audioOnly ? "nur Ton " : "")\(url.absoluteString)")
        var request = URLRequest(url: url)
        if let page = webView.url { request.setValue(page.absoluteString, forHTTPHeaderField: "Referer") }
        show(L("Lädt …", "Downloading …"), symbol: "arrow.down.circle")
        webView.startDownload(using: request) { [weak self] download in
            download.delegate = self
            if audioOnly { self?.audioDownloads.insert(ObjectIdentifier(download)) }
        }
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
                  suggestedFilename: String) async -> URL? {
        let folder = Self.downloadFolder
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        // No folders and no hidden files from a name the server chose.
        let clean = (suggestedFilename as NSString).lastPathComponent.trimmingPrefix(while: { $0 == "." })
        let name = clean.isEmpty ? "Download" : String(clean)
        var target = folder.appending(path: name)
        var number = 2
        while FileManager.default.fileExists(atPath: target.path()) {
            let stem = (name as NSString).deletingPathExtension, ending = (name as NSString).pathExtension
            target = folder.appending(path: "\(stem) \(number)" + (ending.isEmpty ? "" : ".\(ending)"))
            number += 1
        }
        downloadTargets[ObjectIdentifier(download)] = target
        let item = DownloadItem(name: target.lastPathComponent)
        item.watch = download.progress.observe(\.fractionCompleted) { progress, _ in
            let done = progress.fractionCompleted
            Task { @MainActor in item.progress = done }
        }
        downloadItems[ObjectIdentifier(download)] = item
        session.downloads.append(item)
        return target
    }

    func downloadDidFinish(_ download: WKDownload) {
        let key = ObjectIdentifier(download)
        let item = downloadItems.removeValue(forKey: key)
        item?.watch = nil
        guard let file = downloadTargets.removeValue(forKey: key) else { return }
        guard audioDownloads.remove(key) != nil else {
            item?.file = file
            item?.state = .done
            return deliver(file)
        }
        Task {
            do {
                let audio = try await Self.audio(of: file)
                item?.name = audio.lastPathComponent
                item?.file = audio
                item?.state = .done
                deliver(audio)
            } catch {
                item?.state = .failed
                log("DOWNLOAD Ton fehlgeschlagen: \(error)")
                show(L("Der Ton dieses Videos lässt sich nicht als m4a speichern.",
                       "This video's sound cannot be saved as m4a."), symbol: "exclamationmark.triangle.fill")
            }
            try? FileManager.default.removeItem(at: file)
        }
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        let key = ObjectIdentifier(download)
        downloadTargets.removeValue(forKey: key)
        audioDownloads.remove(key)
        downloadItems.removeValue(forKey: key)?.state = .failed
        log("DOWNLOAD fehlgeschlagen: \(error.localizedDescription)")
        show(L("Download fehlgeschlagen: ", "Download failed: ") + error.localizedDescription,
             symbol: "exclamationmark.triangle.fill")
    }

    private func deliver(_ file: URL) {
        log("DOWNLOAD fertig \(file.lastPathComponent)")
        #if targetEnvironment(macCatalyst)
        // The app is not sandboxed, so nothing marks the file: without this Gatekeeper never checks an app
        // or script opened from the downloads list. Same flags Chrome writes; an existing mark stays.
        let mark = "0081;\(String(Int(Date.now.timeIntervalSince1970), radix: 16));PouBrowser;"
        _ = setxattr(file.path(percentEncoded: false), "com.apple.quarantine", mark, mark.utf8.count, 0, XATTR_CREATE)
        show(L("Gespeichert in Downloads: ", "Saved to Downloads: ") + file.lastPathComponent, symbol: "checkmark.circle.fill")
        #else
        show(L("Download fertig", "Download finished"), symbol: "checkmark.circle.fill")
        session.sharedFile = SharedFile(url: file)
        #endif
    }

    /// The Mac's Downloads folder (the app is not sandboxed); on the iPhone the app's own, which the Files app shows.
    static var downloadFolder: URL {
        #if targetEnvironment(macCatalyst)
        .downloadsDirectory
        #else
        URL.documentsDirectory.appending(path: "Downloads")
        #endif
    }

    /// The sound track as .m4a. Passthrough keeps AAC as it is; other codecs are re-encoded.
    private static func audio(of video: URL) async throws -> URL {
        let target = video.deletingPathExtension().appendingPathExtension("m4a")
        try? FileManager.default.removeItem(at: target)
        guard let export = AVAssetExportSession(asset: AVURLAsset(url: video), presetName: AVAssetExportPresetAppleM4A) else {
            throw CocoaError(.fileReadCorruptFile)
        }
        try await export.export(to: target, as: .m4a)
        return target
    }
}

/// The iPhone's share sheet for a finished download.
struct ShareSheet: UIViewControllerRepresentable {
    let file: URL
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [file], applicationActivities: nil)
    }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
