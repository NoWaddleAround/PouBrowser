import FilterEngine
import WebKit

/// The filter rules a content-rule list cannot express: scriptlets that defuse ad and anti-adblock
/// scripts, raw script rules, style rules and element hiding that needs more than a CSS selector.
/// AdGuard's FilterEngine finds the rules for a page; this turns them into scripts separated by
/// content world so styles and ExtendedCss remain invisible to page anti-adblock scripts.
///
/// `Resources/scriptlets.corelibs.json` (@adguard/scriptlets 2.3.1) and
/// `Resources/extended-css.min.js` (@adguard/extended-css 2.1.1) are the versions the converter
/// package 4.3.2 is built for; take new ones from the npm packages when the converter is updated.
@MainActor
final class PageRules {
    struct Match {
        /// Scriptlets and raw JS rules that must run in `.page` ahead of the site's own scripts.
        let pageSource: String?
        /// CSS and ExtendedCss rules that run isolated in `.defaultClient`.
        let styleSource: String?
        let needsExtendedCSS: Bool
        let summary: String
    }

    nonisolated static let folder = URL.applicationSupportDirectory.appending(path: "PageRules")

    /// Where one list's rules are kept between updates.
    nonisolated static func file(for list: String) -> URL { folder.appending(path: list + ".txt") }

    private var engine = try? WebExtension(containerURL: folder)

    var hasEngine: Bool { engine != nil }

    func reloadEngine() {
        engine = try? WebExtension(containerURL: Self.folder)
    }

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

    /// Loaded once per controller into `.defaultClient` rather than concatenated into every page's script.
    lazy var extendedCSSLibraryScript: WKUserScript? = {
        guard let url = Bundle.main.url(forResource: "extended-css.min", withExtension: "js"),
              let library = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        let source = """
            (() => {
                if (window.__ruheExtendedCss) return;
                try {
                    \(library)
                    window.__ruheExtendedCss = ExtendedCss;
                } catch (error) {}
            })();
            """
        return WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: false, in: .defaultClient)
    }()

    /// Builds the engine from the stored rules of all lists. Returns the number of rules. Runs off the main thread.
    nonisolated static func rebuild(lists: [String]) throws -> Int {
        let rules = lists.compactMap { try? String(contentsOf: file(for: $0), encoding: .utf8) }.joined(separator: "\n")
        _ = try WebExtension(containerURL: folder).buildFilterEngine(rules: rules)
        return rules.split(whereSeparator: \.isNewline).count
    }

    /// The scripts to run at document start in `page`, or nil when no rule applies. `top` is the page a frame sits in.
    func match(for page: URL, top: URL? = nil) -> Match? {
        guard let host = page.host, let rules = engine?.lookup(pageUrl: page, topUrl: top) else { return nil }
        var pageParts = [String]()
        // Scriptlets first: they have to be in place before the page's own scripts run.
        for scriptlet in rules.scriptlets {
            guard let function = scriptlets[scriptlet.name] ?? scriptlets[scriptlet.name + ".js"] else { continue }
            let source: [String: Any] = [
                "name": scriptlet.name, "args": scriptlet.args, "engine": "corelibs", "version": "ruhe", "verbose": false,
            ]
            pageParts.append("try { (\(function))(\(Self.json(source)), \(Self.json(scriptlet.args))); } catch (error) {}")
        }
        for script in rules.js {
            pageParts.append("try { (function () { \(script)\n })(); } catch (error) {}")
        }

        var styleParts = [String]()
        let plainCSS = Self.styleRules(rules.css)
        if !plainCSS.isEmpty {
            styleParts.append("""
                try {
                    const style = document.createElement('style');
                    style.textContent = \(Self.json(plainCSS.joined(separator: "\n")));
                    const attach = () => {
                        const root = document.head || document.documentElement;
                        if (root) root.appendChild(style);
                        return !!root;
                    };
                    if (!attach()) {
                        new MutationObserver((_, observer) => { if (attach()) observer.disconnect(); })
                            .observe(document, { childList: true, subtree: true });
                    }
                } catch (error) {}
                """)
        }

        let extended = Self.extendedRules(rules.extendedCss)
        let usesExtended = !extended.isEmpty && extendedCSSLibraryScript != nil
        if usesExtended {
            styleParts.append("""
                try {
                    const Ext = window.__ruheExtendedCss;
                    if (Ext) {
                        const valid = \(Self.json(extended)).filter(rule => {
                            try { new Ext({ cssRules: [rule] }); return true; } catch (error) { return false; }
                        });
                        const apply = () => { try { if (valid.length) new Ext({ cssRules: valid }).apply(); } catch (error) {} };
                        if (document.readyState === 'loading') addEventListener('DOMContentLoaded', apply, { once: true });
                        else apply();
                    }
                } catch (error) {}
                """)
        }

        guard !pageParts.isEmpty || !styleParts.isEmpty else { return nil }
        let hostGuard = "if (location.hostname !== \(Self.json(host))) return;"
        let pageSource = pageParts.isEmpty ? nil : "(function () {\n\(hostGuard)\n\(pageParts.joined(separator: "\n"))\n})();"
        let styleSource = styleParts.isEmpty ? nil : "(function () {\n\(hostGuard)\n\(styleParts.joined(separator: "\n"))\n})();"
        let summary = "\(rules.scriptlets.map(\.name).joined(separator: ", ")) · \(rules.js.count) Skripte"
            + " · \(plainCSS.count) Stile · \(extended.count) erweiterte Stile"
        return Match(pageSource: pageSource, styleSource: styleSource, needsExtendedCSS: usesExtended, summary: summary)
    }

    /// A bare selector means "hide"; anything ending in "}" is already a full style rule.
    private static func styleRules(_ rules: [String]) -> [String] {
        rules.map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .map { $0.hasSuffix("}") ? $0 : $0 + " {display:none!important;}" }
    }

    private static func extendedRules(_ rules: [String]) -> [String] {
        rules.map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .map { body in
                if body.hasSuffix("}") { return body }
                if body.hasSuffix(":remove()") { return String(body.dropLast(":remove()".count)) + " { remove: true; }" }
                return body + " { display: none !important; }"
            }
    }

    private static func json(_ value: Any) -> String {
        let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed, .withoutEscapingSlashes])
        return data.flatMap { String(data: $0, encoding: .utf8) } ?? "null"
    }
}
