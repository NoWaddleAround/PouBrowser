import ContentBlockerConverter
import FilterEngine
import WebKit

/// Ad and tracker blocking. Downloads open filter lists, converts them with AdGuard's converter and
/// hands them to WebKit, which drops matching requests before they load. WebKit takes at most
/// 150,000 rules per list, so each entry stays its own list.
@MainActor @Observable
final class Blocker {
    static let shared = Blocker()

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
        // Cookie consent banners, hidden or answered with "reject".
        FilterList(name: "adguard-cookies", addresses: ["https://filters.adtidy.org/ios/filters/18.txt"], days: 3),
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
    @ObservationIgnored private var compiled = [String: WKContentRuleList]()
    /// The user's block list ("Seite sperren"): stays on also where the ad blocker is switched off.
    @ObservationIgnored private var userList: WKContentRuleList?
    @ObservationIgnored private let paused = NSHashTable<WKUserContentController>.weakObjects()
    private(set) var status = L("Werbeblocker startet …", "Ad blocker starting …")
    private(set) var isUpdating = false
    /// Opens once the already-compiled lists from the store are attached, so cold-restored tabs do not load unfiltered.
    @ObservationIgnored private(set) var isReady = false
    @ObservationIgnored private var readyWaiters = [CheckedContinuation<Void, Never>]()
    @ObservationIgnored private let sessions = NSHashTable<Session>.weakObjects()
    private(set) var blockedSites = Set(UserDefaults.standard.stringArray(forKey: "blockedSites") ?? [])

    func register(_ session: Session) { sessions.add(session) }

    private func report(_ entry: String) { sessions.anyObject?.log(entry) }

    func setBlocked(_ blocked: Bool, site: String) {
        if blocked { blockedSites.insert(site) } else { blockedSites.remove(site) }
        UserDefaults.standard.set(Array(blockedSites), forKey: "blockedSites")
        Task { await applyBlockedSites() }
    }

    func replaceBlocked(_ sites: Set<String>) {
        blockedSites = sites
        UserDefaults.standard.set(Array(blockedSites), forKey: "blockedSites")
        Task { await applyBlockedSites() }
    }

    private let store = WKContentRuleListStore.default()!
    @ObservationIgnored private var installed = InstalledFilters()
    @ObservationIgnored private var starting = false

    func waitUntilReady() async {
        guard !isReady else { return }
        await withCheckedContinuation { readyWaiters.append($0) }
    }

    /// Gives a new tab's controller the compiled lists and keeps it up to date.
    func attach(to controller: WKUserContentController) {
        if !Session.off("noLists") { Self.lists.compactMap { compiled[$0.name] }.forEach(controller.add) }
        userList.map(controller.add)
        controllers.add(controller)
    }

    /// Compiles the blocked sites into one rule list that stops every request to them and their subdomains.
    private func applyBlockedSites() async {
        let sites = blockedSites
        var list: WKContentRuleList?
        if !sites.isEmpty {
            let rules = sites.sorted().map { site -> [String: Any] in
                let escaped = NSRegularExpression.escapedPattern(for: site)
                return ["trigger": ["url-filter": "^[a-z]+://([^/:]*\\.)?" + escaped + "[/:]"], "action": ["type": "block"]]
            }
            if let data = try? JSONSerialization.data(withJSONObject: rules), let json = String(data: data, encoding: .utf8) {
                do { list = try await store.compileContentRuleList(forIdentifier: "user-blocked", encodedContentRuleList: json) }
                catch { report("FILTER user-blocked: \(error.localizedDescription)"); return }
            }
        }
        guard sites == blockedSites else { return }
        for controller in controllers.allObjects {
            userList.map(controller.remove)
            list.map(controller.add)
        }
        userList = list
    }

    /// Takes the lists off one tab, for a site whose ad blocker the user switched off, or puts them back.
    func setLists(on controller: WKUserContentController, enabled: Bool) {
        guard enabled == paused.contains(controller) else { return }
        controller.removeAllContentRuleLists()
        userList.map(controller.add)
        if enabled {
            paused.remove(controller)
            if !Session.off("noLists") { Self.lists.compactMap { compiled[$0.name] }.forEach(controller.add) }
        } else {
            paused.add(controller)
        }
    }

    func start() async {
        guard !starting, !isReady else { return }
        starting = true
        if let data = try? Data(contentsOf: InstalledFilters.manifest),
           let saved = try? JSONDecoder().decode(InstalledFilters.self, from: data) {
            installed = saved
        }

        let folder = installed.engineFolder
        async let engine = Task.detached(priority: .utility) { try? PageRules.open(folder) }.value
        await withTaskGroup(of: (String, WKContentRuleList?).self) { group in
            for list in Self.lists {
                let identifier = installed.lists[list.name].map { InstalledFilters.identifier(list.name, $0.slot) } ?? list.name
                group.addTask { @MainActor [store] in
                    (list.name, try? await store.contentRuleList(forIdentifier: identifier))
                }
            }
            for await (name, object) in group {
                if let object { replace(name, with: object) }
            }
        }
        await applyBlockedSites()
        pageRules.engine = await engine
        isReady = true
        readyWaiters.forEach { $0.resume() }
        readyWaiters.removeAll()
        refreshStatus()
        await update(all: false)
    }

    private func replace(_ name: String, with object: WKContentRuleList) {
        let old = compiled.updateValue(object, forKey: name)
        guard !Session.off("noLists") else { return }
        for controller in controllers.allObjects where !paused.contains(controller) {
            old.map(controller.remove)
            controller.add(object)
        }
    }

    private func refreshStatus() {
        let count = compiled.keys.reduce(0) { total, name in
            total + (installed.lists[name]?.count ?? UserDefaults.standard.integer(forKey: "rules." + name))
        }
        status = compiled.isEmpty || Session.off("noLists")
            ? L("Werbeblocker aus: keine Filterliste geladen", "Ad blocker off: no filter list loaded")
            : L("Werbeblocker aktiv · \(count.formatted()) Regeln", "Ad blocker active · \(count.formatted()) rules")
    }

    private struct Prepared {
        let list: InstalledFilters.List
        let object: WKContentRuleList
    }

    /// A maximum of two lists can own converter output while WebKit compiles it.
    private func prepare(_ list: FilterList) async throws -> Prepared? {
        let active = installed.lists[list.name]
        let reusable = compiled[list.name] != nil && list.days > 0 &&
            FileManager.default.fileExists(atPath: installed.advanced(list.name).path)
        guard let staged = try await FilterSources.stage(list, installed: active, reuse: reusable) else { return nil }
        let slot = !(active?.slot ?? true)
        let converted = try await Task.detached(priority: .utility) {
            var combined = Data()
            for i in list.addresses.indices {
                try combined.append(Data(contentsOf: staged.directory.appending(path: "\(i).txt"), options: .mappedIfSafe))
                combined.append(0x0A)
            }
            let converted = Self.convert(combined)
            try converted.pageRules.write(to: staged.directory.appending(path: "advanced.txt"), atomically: true, encoding: .utf8)
            return (converted.json, converted.count)
        }.value
        let id = InstalledFilters.identifier(list.name, slot)
        guard let object = try await store.compileContentRuleList(forIdentifier: id, encodedContentRuleList: converted.0) else {
            throw CocoaError(.fileReadCorruptFile)
        }
        return Prepared(list: .init(slot: slot, count: converted.1, parts: staged.parts), object: object)
    }

    /// A manual refresh also validates fresh lists. Validators always describe the published slot.
    func update(all: Bool = true) async {
        if !isReady {
            if !starting { await start() } else { await waitUntilReady() }
        }
        guard !isUpdating else { return }
        let defaults = UserDefaults.standard
        let now = Date.now.timeIntervalSince1970
        let due = Self.lists.filter { list in
            all || !installed.hasParts(for: list) || compiled[list.name] == nil ||
                !FileManager.default.fileExists(atPath: installed.advanced(list.name).path) ||
                now - defaults.double(forKey: "updated." + list.name) >= list.days * 86_400
        }
        guard !due.isEmpty || pageRules.engine == nil else { return }
        isUpdating = true
        defer { isUpdating = false }
        status = L("Filterlisten werden geladen …", "Loading filter lists …")
        for list in due { defaults.removeObject(forKey: "updated." + list.name) }
        var changed = [String: Prepared]()
        var failed = [String]()
        await withTaskGroup(of: (String, Result<Prepared?, Error>).self) { group in
            var pending = due.makeIterator()
            func enqueue(_ list: FilterList) {
                group.addTask { @MainActor in
                    do { return (list.name, .success(try await self.prepare(list))) }
                    catch { return (list.name, .failure(error)) }
                }
            }
            for _ in 0..<2 { if let list = pending.next() { enqueue(list) } }
            while let (name, result) = await group.next() {
                switch result {
                case .success(.some(let part)): changed[name] = part
                case .success(nil): defaults.set(now, forKey: "updated." + name)
                case .failure(let error):
                    failed.append(name)
                    report("FILTER \(name): \(error.localizedDescription)")
                }
                if let list = pending.next() { enqueue(list) }
            }
        }
        if !changed.isEmpty || pageRules.engine == nil {
            do {
                var next = installed
                for (name, prepared) in changed { next.lists[name] = prepared.list }
                next.engineSlot = !(installed.engineSlot ?? true)
                let files = Self.lists.compactMap { list -> URL? in
                    guard next.lists[list.name] != nil || compiled[list.name] != nil else { return nil }
                    return next.advanced(list.name)
                }
                if !files.isEmpty {
                    let folder = next.engineFolder
                    let engine = try await Task.detached(priority: .utility) { try PageRules.build(files, in: folder) }.value
                    // The manifest selects the matching source bodies, validators, WebKit objects and page engine together.
                    try JSONEncoder().encode(next).write(to: InstalledFilters.manifest, options: .atomic)
                    installed = next
                    pageRules.engine = engine
                    for (name, prepared) in changed {
                        replace(name, with: prepared.object)
                        defaults.set(now, forKey: "updated." + name)
                        report("FILTER \(name): \(prepared.list.count) Regeln")
                    }
                }
            } catch {
                failed.append(contentsOf: changed.keys)
                failed.append(L("Skript-Regeln", "page rules"))
                report("FILTER: \(error.localizedDescription)")
            }
        }
        refreshStatus()
        if !failed.isEmpty { status += L(" · Aktualisierung fehlgeschlagen: ", " · Update failed: ") + failed.sorted().joined(separator: ", ") }
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
