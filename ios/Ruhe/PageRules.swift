import FilterEngine
import WebKit

/// The filter rules a content-rule list cannot express: scriptlets that defuse ad and anti-adblock
/// scripts, raw script rules, style rules and element hiding that needs more than a CSS selector.
/// AdGuard's FilterEngine finds the rules for a page; this turns them into one script for that page.
///
/// `Resources/scriptlets.corelibs.json` (@adguard/scriptlets 2.3.1) and
/// `Resources/extended-css.min.js` (@adguard/extended-css 2.1.1) are the versions the converter
/// package 4.3.2 is built for; take new ones from the npm packages when the converter is updated.
@MainActor
final class PageRules {
    nonisolated static let folder = URL.applicationSupportDirectory.appending(path: "PageRules")

    /// Where one list's rules are kept between updates.
    nonisolated static func file(for list: String) -> URL { folder.appending(path: list + ".txt") }

    private let engine = try? WebExtension(containerURL: folder)

    /// AdGuard's scriptlets as function source, under every name the lists use (uBlock's "ubo-…" included).
    private lazy var scriptlets: [String: String] = {
        struct File: Decodable {
            struct Entry: Decodable { let names: [String]; let scriptlet: String }
            let scriptlets: [Entry]
        }
        guard let url = Bundle.main.url(forResource: "scriptlets.corelibs", withExtension: "json"),
              let file = try? JSONDecoder().decode(File.self, from: Data(contentsOf: url)) else { return [:] }
        var byName = [String: String]()
        for entry in file.scriptlets {
            for name in entry.names { byName[name] = entry.scriptlet }
        }
        return byName
    }()

    private lazy var extendedCSS =
        Bundle.main.url(forResource: "extended-css.min", withExtension: "js").flatMap { try? String(contentsOf: $0, encoding: .utf8) }

    /// Builds the engine from the stored rules of all lists. Returns the number of rules. Runs off the main thread.
    nonisolated static func rebuild(lists: [String]) throws -> Int {
        let rules = lists.compactMap { try? String(contentsOf: file(for: $0), encoding: .utf8) }.joined(separator: "\n")
        // An instance of its own: the one that answers lookups picks the new engine up from disk.
        _ = try WebExtension(containerURL: folder).buildFilterEngine(rules: rules)
        return rules.split(whereSeparator: \.isNewline).count
    }

    /// The script to run at document start in `page`, or nil when no rule applies. `top` is the page a frame sits in.
    func script(for page: URL, top: URL? = nil) -> (source: String, summary: String)? {
        guard let host = page.host, let rules = engine?.lookup(pageUrl: page, topUrl: top) else { return nil }
        var parts = [String]()
        // Scriptlets first: they have to be in place before the page's own scripts run.
        for scriptlet in rules.scriptlets {
            guard let function = scriptlets[scriptlet.name] else { continue }   // not in AdGuard's library
            let source: [String: Any] = [
                "name": scriptlet.name, "args": scriptlet.args, "engine": "corelibs", "version": "ruhe", "verbose": false,
            ]
            parts.append("try { (\(function))(\(Self.json(source)), \(Self.json(scriptlet.args))); } catch (error) {}")
        }
        for script in rules.js {
            parts.append("try { (function () { \(script)\n })(); } catch (error) {}")
        }
        if !rules.css.isEmpty {
            parts.append("""
                try {
                    const style = document.createElement('style');
                    style.textContent = \(Self.json(Self.styleRules(rules.css).joined(separator: "\n")));
                    (document.head || document.documentElement).appendChild(style);
                } catch (error) {}
                """)
        }
        if !rules.extendedCss.isEmpty, let extendedCSS {
            parts.append("""
                try {
                    \(extendedCSS)
                    new ExtendedCss({ cssRules: \(Self.json(Self.styleRules(rules.extendedCss))) }).apply();
                } catch (error) {}
                """)
        }
        guard !parts.isEmpty else { return nil }
        let summary = "\(rules.scriptlets.map(\.name).joined(separator: ", ")) · \(rules.js.count) Skripte"
            + " · \(rules.css.count) Stile · \(rules.extendedCss.count) erweiterte Stile"
        // The host check keeps a script that was prepared for one page away from another.
        return ("(function () {\nif (location.hostname !== \(Self.json(host))) return;\n\(parts.joined(separator: "\n"))\n})();", summary)
    }

    /// A bare selector means "hide"; anything ending in "}" is already a full style rule.
    private static func styleRules(_ rules: [String]) -> [String] {
        rules.map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .map { $0.hasSuffix("}") ? $0 : $0 + " {display:none!important;}" }
    }

    private static func json(_ value: Any) -> String {
        let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed, .withoutEscapingSlashes])
        return data.flatMap { String(data: $0, encoding: .utf8) } ?? "null"
    }
}
