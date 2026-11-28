import Foundation

struct FilterList: Sendable {
    let name: String
    /// Several addresses become one list: an exception rule only undoes blocks inside its own list.
    let addresses: [String]
    /// How long a compiled copy counts as fresh.
    let days: Double
}


/// Both slots are local to this installation. Only the atomic manifest selects live files.
struct InstalledFilters: Codable, Sendable {
    struct Part: Codable, Sendable {
        let etag: String?
        let modified: String?
        let bytes: Int
    }

    struct List: Codable, Sendable {
        let slot: Bool
        let count: Int
        let parts: [String: Part]
    }

    var lists = [String: List]()
    var engineSlot: Bool?

    static let folder = URL.applicationSupportDirectory.appending(path: "PageRules")
    static let manifest = folder.appending(path: "installed.json")
    static func identifier(_ name: String, _ slot: Bool) -> String { name + (slot ? "-b" : "-a") }
    static func directory(_ name: String, _ slot: Bool, root: URL = folder) -> URL {
        root.appending(path: identifier(name, slot), directoryHint: .isDirectory)
    }

    func hasParts(for list: FilterList) -> Bool {
        guard let active = lists[list.name] else { return false }
        let directory = Self.directory(list.name, active.slot)
        return list.addresses.enumerated().allSatisfy { index, address in
            active.parts["\(index):" + address] != nil &&
                FileManager.default.fileExists(atPath: directory.appending(path: "\(index).txt").path)
        }
    }

    func advanced(_ name: String) -> URL {
        guard let list = lists[name] else { return Self.folder.appending(path: name + ".txt") }
        return Self.directory(name, list.slot).appending(path: "advanced.txt")
    }

    var engineFolder: URL { engineSlot.map { Self.directory("engine", $0) } ?? Self.folder }
}

enum FilterSources {
    struct Download {
        let directory: URL
        let parts: [String: InstalledFilters.Part]
    }

    /// Returns nil without opening a cached body when every source confirms its installed version.
    static func stage(_ list: FilterList, installed: InstalledFilters.List?, reuse: Bool,
                      session: URLSession = .shared, root: URL = InstalledFilters.folder) async throws -> Download? {
        let slot = !(installed?.slot ?? true)
        let next = InstalledFilters.directory(list.name, slot, root: root)
        let current = InstalledFilters.directory(list.name, !slot, root: root)
        var parts = [String: InstalledFilters.Part]()
        var reused = [String]()
        for (index, address) in list.addresses.enumerated() {
            guard let url = URL(string: address) else { throw URLError(.badURL) }
            let file = "\(index).txt"
            // Position alone cannot identify a part when a release changes the source order.
            let key = "\(index):" + address
            let previous = installed?.parts[key]
            let bytes = try? current.appending(path: file).resourceValues(forKeys: [.fileSizeKey]).fileSize
            var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 40)
            if reuse, let previous, bytes == previous.bytes {
                request.setValue(previous.etag, forHTTPHeaderField: "If-None-Match")
                request.setValue(previous.modified, forHTTPHeaderField: "If-Modified-Since")
            }
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
            if http.statusCode == 304, let previous,
               request.value(forHTTPHeaderField: "If-None-Match") != nil || request.value(forHTTPHeaderField: "If-Modified-Since") != nil {
                parts[key] = previous
                reused.append(file)
                continue
            }
            guard http.statusCode == 200 else { throw URLError(.badServerResponse) }
            try FileManager.default.createDirectory(at: next, withIntermediateDirectories: true)
            try data.write(to: next.appending(path: file), options: .atomic)
            parts[key] = InstalledFilters.Part(etag: http.value(forHTTPHeaderField: "ETag"),
                                               modified: http.value(forHTTPHeaderField: "Last-Modified"), bytes: data.count)
        }
        if reused.count == list.addresses.count { return nil }
        for file in reused {
            let source = current.appending(path: file)
            try Data(contentsOf: source, options: .mappedIfSafe).write(to: next.appending(path: file), options: .atomic)
        }
        return Download(directory: next, parts: parts)
    }
}
