import Foundation
import Observation

/// Bookmarks and history, kept on the device only (typed text never leaves it for suggestions).
/// Stored as JSON in Application Support; the Android app keeps the same lists the same way.
@MainActor @Observable
final class Library {
    struct Entry: Codable, Hashable {
        var url: URL
        var title: String
        var date: Date          // added (bookmark) or last visit (history)
        var visits = 1

        /// Host without "www.", for rows and tiles.
        var site: String { url.host()?.replacing(/^www\./, with: "") ?? url.absoluteString }
    }

    private(set) var bookmarks: [Entry]
    private(set) var history: [Entry]

    private static let maxHistory = 1000
    private static let folder = URL.applicationSupportDirectory
        .appending(path: Bundle.main.bundleIdentifier ?? "PouBrowser")
    private static let bookmarksFile = folder.appending(path: "bookmarks.json")
    private static let historyFile = folder.appending(path: "history.json")

    init() {
        bookmarks = Self.read(Self.bookmarksFile)
        history = Self.read(Self.historyFile)
    }

    // MARK: Bookmarks

    func isBookmarked(_ url: URL?) -> Bool {
        guard let url else { return false }
        return bookmarks.contains { Self.key($0.url) == Self.key(url) }
    }

    func toggleBookmark(_ url: URL, title: String) {
        if isBookmarked(url) {
            bookmarks.removeAll { Self.key($0.url) == Self.key(url) }
        } else {
            bookmarks.insert(Entry(url: url, title: title, date: .now), at: 0)
        }
        Self.write(bookmarks, to: Self.bookmarksFile)
        changed()
    }

    func removeBookmark(_ entry: Entry) {
        bookmarks.removeAll { $0 == entry }
        Self.write(bookmarks, to: Self.bookmarksFile)
        changed()
    }

    /// Adds the ones not bookmarked yet, in their order, after the current ones. Returns how many were new.
    @discardableResult
    func importBookmarks(_ found: [(url: URL, title: String)]) -> Int {
        var known = Set(bookmarks.map { Self.key($0.url) })
        let new = found.filter { known.insert(Self.key($0.url)).inserted }
        guard !new.isEmpty else { return 0 }
        bookmarks += new.map { Entry(url: $0.url, title: $0.title, date: .now) }
        Self.write(bookmarks, to: Self.bookmarksFile)
        changed()
        return new.count
    }

    /// Called after every bookmark change (the sync listens).
    @ObservationIgnored var changed: () -> Void = {}

    /// The sync's newer copy from another device.
    func replaceBookmarks(_ entries: [Entry]) {
        bookmarks = entries
        Self.write(bookmarks, to: Self.bookmarksFile)
    }

    // MARK: History

    /// A main-frame web page finished loading, or its title changed afterwards.
    func visited(_ url: URL, title: String?, countsAsVisit: Bool) {
        guard ["http", "https"].contains(url.scheme?.lowercased() ?? "") else { return }
        let name = (title?.isEmpty == false ? title : nil) ?? url.host() ?? url.absoluteString
        if let index = history.firstIndex(where: { Self.key($0.url) == Self.key(url) }) {
            var entry = history.remove(at: index)
            entry.title = name
            if countsAsVisit {
                entry.visits += 1
                entry.date = .now
            }
            history.insert(entry, at: 0)
        } else {
            guard countsAsVisit else { return }
            history.insert(Entry(url: url, title: name, date: .now), at: 0)
            if history.count > Self.maxHistory { history.removeLast(history.count - Self.maxHistory) }
        }
        Self.write(history, to: Self.historyFile)
    }

    /// "Forget this site": its pages leave the history (bookmarks stay).
    func forgetHistory(of site: String) {
        history.removeAll { entry in
            let host = entry.url.host()?.lowercased() ?? ""
            return host == site || host.hasSuffix("." + site)
        }
        Self.write(history, to: Self.historyFile)
    }

    func removeHistory(_ entry: Entry) {
        history.removeAll { $0 == entry }
        Self.write(history, to: Self.historyFile)
    }

    func clearHistory() {
        history = []
        try? FileManager.default.removeItem(at: Self.historyFile)
    }

    // MARK: Suggestions and start page

    /// Up to `limit` matches for typed text: bookmarks first, then history by visits, then by recency.
    func suggestions(for text: String, limit: Int = 6) -> [Entry] {
        let needle = text.trimmingCharacters(in: .whitespaces).lowercased()
        guard !needle.isEmpty else { return [] }
        let matches = { (entry: Entry) in
            entry.title.lowercased().contains(needle) || Self.bare(entry.url).contains(needle)
        }
        let marked = bookmarks.filter(matches)
        let seen = Set(marked.map { Self.key($0.url) })
        let visited = history.filter { matches($0) && !seen.contains(Self.key($0.url)) }
            .sorted { ($0.visits, $0.date) > ($1.visits, $1.date) }
        return Array((marked + visited).prefix(limit))
    }

    /// Start page tiles: bookmarks, or the most visited pages when there are none.
    var favourites: (entries: [Entry], areBookmarks: Bool) {
        if !bookmarks.isEmpty { return (Array(bookmarks.prefix(8)), true) }
        return (Array(history.sorted { ($0.visits, $0.date) > ($1.visits, $1.date) }.prefix(8)), false)
    }

    // MARK: Files

    /// The same page with or without its #fragment counts once.
    private static func key(_ url: URL) -> String {
        var parts = URLComponents(url: url, resolvingAgainstBaseURL: false)
        parts?.fragment = nil
        return parts?.string ?? url.absoluteString
    }

    /// "example.com/path" from "https://www.example.com/path", for matching what people type.
    nonisolated static func bare(_ url: URL) -> String {
        url.absoluteString.lowercased()
            .replacing(/^https?:\/\//, with: "")
            .replacing(/^[^\/@]*@/, with: "")   // https://google.com@evil.com is evil.com
            .replacing(/^www\./, with: "")
    }

    private static func read(_ file: URL) -> [Entry] {
        (try? JSONDecoder().decode([Entry].self, from: Data(contentsOf: file))) ?? []
    }

    private static func write(_ entries: [Entry], to file: URL) {
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try? JSONEncoder().encode(entries).write(to: file, options: .atomic)
    }
}
