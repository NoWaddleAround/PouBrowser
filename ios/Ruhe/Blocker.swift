import ContentBlockerConverter
import CryptoKit
import WebKit

struct FilterList: Sendable {
    let name: String
    /// Several addresses become one list: an exception rule only undoes blocks inside its own list.
    let addresses: [String]
    /// How long a compiled copy counts as fresh.
    let days: Double
}

/// Ad and tracker blocking. Downloads open filter lists, converts them with AdGuard's converter and
/// hands them to WebKit, which drops matching requests before they load. WebKit takes at most
/// 150,000 rules per list, so each entry stays its own list.
@MainActor @Observable
final class Blocker {
    /// `-testFilterList <address>` as a launch argument adds a list of one's own (see Scripts/popup-test).
    static let lists = builtIn + (UserDefaults.standard.string(forKey: "testFilterList").map {
        [FilterList(name: "test", addresses: [$0], days: 0)]
    } ?? [])

    private static let builtIn = [
        // EasyList plus AdGuard's own rules, which catch more of the popup networks on manga sites.
        FilterList(name: "adguard-base", addresses: ["https://filters.adtidy.org/ios/filters/2.txt"], days: 3),
        FilterList(name: "adguard-mobile", addresses: ["https://filters.adtidy.org/ios/filters/11.txt"], days: 3),
        FilterList(name: "easyprivacy", addresses: ["https://easylist.to/easylist/easyprivacy.txt"], days: 3),
        // Popunders, fake notifications, "open in app" banners.
        FilterList(name: "adguard-popups", addresses: ["https://filters.adtidy.org/ios/filters/19.txt"], days: 3),
        // uBlock Origin's own lists, strong on streaming and manga sites. "Quick fixes" changes several
        // times a day, hence the daily refresh.
        FilterList(name: "ublock", addresses: [
            "https://ublockorigin.github.io/uAssets/filters/filters.min.txt",
            "https://ublockorigin.github.io/uAssets/filters/badware.min.txt",
            "https://ublockorigin.github.io/uAssets/filters/privacy.min.txt",
            "https://ublockorigin.github.io/uAssets/filters/quick-fixes.min.txt",
            "https://ublockorigin.github.io/uAssets/filters/unbreak.min.txt",
        ], days: 1),
    ]

    /// The rules WebKit cannot take as a list: scripts and styles put into each page.
    let pageRules = PageRules()
    /// Every tab's controller, so a list compiled later also reaches pages that are already open.
    @ObservationIgnored private let controllers = NSHashTable<WKUserContentController>.weakObjects()
    @ObservationIgnored private var compiled = [WKContentRuleList]()
    @ObservationIgnored private let paused = NSHashTable<WKUserContentController>.weakObjects()
    private(set) var status = L("Werbeblocker startet …", "Ad blocker starting …")
    private(set) var isUpdating = false
    /// Opens once the already-compiled lists from the store are attached, so cold-restored tabs do not load unfiltered.
    @ObservationIgnored private(set) var isReady = false
    @ObservationIgnored private var readyWaiters = [CheckedContinuation<Void, Never>]()
    /// Where per-list results go (the app's log).
    @ObservationIgnored var report: (String) -> Void = { _ in }
    private let store = WKContentRuleListStore.default()!
    @ObservationIgnored private var attached = Set<String>()

    func waitUntilReady() async {
        guard !isReady else { return }
        await withCheckedContinuation { readyWaiters.append($0) }
    }

    /// Gives a new tab's controller the compiled lists and keeps it up to date.
    func attach(to controller: WKUserContentController) {
        compiled.forEach(controller.add)
        controllers.add(controller)
    }

    /// Takes the lists off one tab, for a site whose ad blocker the user switched off, or puts them back.
    func setLists(on controller: WKUserContentController, enabled: Bool) {
        guard enabled == paused.contains(controller) else { return }
        controller.removeAllContentRuleLists()
        if enabled {
            paused.remove(controller)
            compiled.forEach(controller.add)
        } else {
            paused.add(controller)
        }
    }

    func start() async {
        await attach()
        await update(all: false)
    }

    /// `all: false` refreshes only lists that are missing or older than their interval.
    func update(all: Bool = true) async {
        guard !isUpdating else { return }
        let defaults = UserDefaults.standard
        let now = Date.now.timeIntervalSince1970
        let due = Self.lists.filter {
            all || !attached.contains($0.name) || !FileManager.default.fileExists(atPath: PageRules.file(for: $0.name).path)
                || now - defaults.double(forKey: "updated." + $0.name) > $0.days * 86_400
        }
        guard !due.isEmpty else { return }
        isUpdating = true
        defer { isUpdating = false }
        status = L("Filterlisten werden geladen …", "Loading filter lists …")   // the lists compiled last time keep blocking meanwhile

        let previouslyAttached = attached
        struct FetchOutcome: Sendable {
            let list: FilterList
            let result: Result<(changed: Bool, converted: (json: String, count: Int, pageRules: String)?), Error>
        }
        let outcomes = await withTaskGroup(of: FetchOutcome.self) { group in
            for list in due {
                let canReuse = previouslyAttached.contains(list.name)
                    && FileManager.default.fileExists(atPath: PageRules.file(for: list.name).path)
                    && list.days > 0
                group.addTask {
                    do {
                        let fetched = try await Self.fetchAndConvert(list: list, allowNotModified: canReuse)
                        return FetchOutcome(list: list, result: .success(fetched))
                    } catch {
                        return FetchOutcome(list: list, result: .failure(error))
                    }
                }
            }
            var collected = [FetchOutcome]()
            for await item in group { collected.append(item) }
            return collected
        }

        var failed = [String]()
        var rebuiltAny = false
        for outcome in outcomes {
            let list = outcome.list
            switch outcome.result {
            case .success(let (changed, converted)):
                if !changed {
                    defaults.set(now, forKey: "updated." + list.name)
                    report("FILTER \(list.name): unverändert (304)")
                    continue
                }
                guard let converted else { continue }
                do {
                    _ = try await store.compileContentRuleList(forIdentifier: list.name, encodedContentRuleList: converted.json)
                    try FileManager.default.createDirectory(at: PageRules.folder, withIntermediateDirectories: true)
                    try converted.pageRules.write(to: PageRules.file(for: list.name), atomically: true, encoding: .utf8)
                    defaults.set(converted.count, forKey: "rules." + list.name)
                    defaults.set(now, forKey: "updated." + list.name)
                    rebuiltAny = true
                    report("FILTER \(list.name): \(converted.count) Regeln")
                } catch {
                    report("FILTER \(list.name) fehlgeschlagen: \(error.localizedDescription)")
                    failed.append(list.name)
                }
            case .failure(let error):
                report("FILTER \(list.name) fehlgeschlagen: \(error.localizedDescription)")
                failed.append(list.name)   // the list compiled last time stays in the store
            }
        }

        if rebuiltAny || !pageRules.hasEngine {
            do {
                let names = Self.lists.map(\.name)
                let count = try await Task.detached(priority: .utility) { try PageRules.rebuild(lists: names) }.value
                pageRules.reloadEngine()
                report("FILTER Skript-Regeln: \(count)")
            } catch {
                report("FILTER Skript-Regeln fehlgeschlagen: \(error.localizedDescription)")
            }
        }
        await attach()
        if !failed.isEmpty { status += L(" · Aktualisierung fehlgeschlagen: ", " · Update failed: ") + failed.joined(separator: ", ") }
    }

    private func attach() async {
        let items = Self.lists
        let lookedUp = await withTaskGroup(of: (Int, WKContentRuleList?).self) { group in
            for (index, list) in items.enumerated() {
                group.addTask { @MainActor [store] in
                    (index, try? await store.contentRuleList(forIdentifier: list.name))
                }
            }
            var pairs = Array<WKContentRuleList?>(repeating: nil, count: items.count)
            for await (index, ruleList) in group { pairs[index] = ruleList }
            return pairs
        }

        compiled = []
        var rules = 0
        attached = []
        for (index, list) in items.enumerated() {
            guard let ruleList = lookedUp[index] else { continue }
            compiled.append(ruleList)
            attached.insert(list.name)
            rules += UserDefaults.standard.integer(forKey: "rules." + list.name)
        }
        if Session.off("noLists") { compiled = [] }
        for controller in controllers.allObjects where !paused.contains(controller) {
            controller.removeAllContentRuleLists()
            compiled.forEach(controller.add)
        }
        status = compiled.isEmpty
            ? L("Werbeblocker aus: keine Filterliste geladen", "Ad blocker off: no filter list loaded")
            : L("Werbeblocker aktiv · \(rules.formatted()) Regeln", "Ad blocker active · \(rules.formatted()) rules")

        if !isReady {
            isReady = true
            let waiters = readyWaiters
            readyWaiters.removeAll()
            waiters.forEach { $0.resume() }
        }
    }

    nonisolated private static let rawFolder = PageRules.folder.appending(path: "raw")

    nonisolated private static func rawFile(for address: String) -> URL {
        let digest = SHA256.hash(data: Data(address.utf8)).map { String(format: "%02x", $0) }.joined()
        return rawFolder.appending(path: digest + ".txt")
    }

    /// Downloads every part of `list`, honoring HTTP 304 conditional caching when `allowNotModified` is true,
    /// and converts the combined rules off the main thread only when at least one part changed.
    nonisolated private static func fetchAndConvert(
        list: FilterList, allowNotModified: Bool
    ) async throws -> (changed: Bool, converted: (json: String, count: Int, pageRules: String)?) {
        let defaults = UserDefaults.standard
        try FileManager.default.createDirectory(at: rawFolder, withIntermediateDirectories: true)
        var combined = Data()
        var anyChanged = !allowNotModified

        for address in list.addresses {
            guard let url = URL(string: address) else { throw URLError(.badURL) }
            let cachedURL = rawFile(for: address)
            let hasCached = FileManager.default.fileExists(atPath: cachedURL.path)
            var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 40)
            if allowNotModified, hasCached {
                if let etag = defaults.string(forKey: "etag." + address) {
                    request.setValue(etag, forHTTPHeaderField: "If-None-Match")
                }
                if let modified = defaults.string(forKey: "lastmod." + address) {
                    request.setValue(modified, forHTTPHeaderField: "If-Modified-Since")
                }
            }
            let (part, response) = try await URLSession.shared.data(for: request)
            let http = response as? HTTPURLResponse
            if http?.statusCode == 304, hasCached, let cachedData = try? Data(contentsOf: cachedURL) {
                combined.append(cachedData)
                combined.append(0x0A)
                continue
            }
            guard http?.statusCode == 200 else { throw URLError(.badServerResponse) }
            anyChanged = true
            try? part.write(to: cachedURL, options: .atomic)
            if let etag = http?.value(forHTTPHeaderField: "ETag") {
                defaults.set(etag, forKey: "etag." + address)
            }
            if let modified = http?.value(forHTTPHeaderField: "Last-Modified") {
                defaults.set(modified, forKey: "lastmod." + address)
            }
            combined.append(part)
            combined.append(0x0A)
        }

        guard anyChanged else { return (false, nil) }
        let converted = await Task.detached(priority: .utility) { convert(combined) }.value
        return (true, converted)
    }

    nonisolated private static func convert(_ data: Data) -> (json: String, count: Int, pageRules: String) {
        var text = String(decoding: data, as: UTF8.self)
        text.makeContiguousUTF8()   // the converter parses UTF-8 in place
        let result = ContentBlockerConverter().convertArray(
            rules: text.split(whereSeparator: \.isNewline).map(String.init),
            safariVersion: .autodetect(),
            advancedBlocking: true   // also hands back the rules for `PageRules`
        )
        return (result.safariRulesJSON, result.safariRulesCount, result.advancedRulesText ?? "")
    }
}
