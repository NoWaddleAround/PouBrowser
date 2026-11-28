import SwiftUI
import WebKit

/// A page's source text, for the "Seitenquelltext" sheet.
struct PageSource: Identifiable {
    let id = UUID()
    let text: String
    let page: URL
}

/// Developer tools and the desktop-browser page commands (print, save, find), as in Chrome's menus.
extension Browser {
    /// The page as the server sent it (fetched again with the page's cookies), else the current DOM.
    func pageSource() async -> PageSource? {
        guard let webView, let page = webView.url else { return nil }
        let script = """
            try {
                const response = await fetch(location.href, { cache: 'force-cache', credentials: 'include' });
                if (response.ok) return await response.text();
            } catch (error) {}
            return '<!-- DOM -->\\n' + document.documentElement.outerHTML;
            """
        guard let text = try? await webView.callAsyncJavaScript(script, contentWorld: .defaultClient) as? String else { return nil }
        return PageSource(text: text, page: page)
    }

    func printPage() {
        guard let webView else { return }
        let printer = UIPrintInteractionController.shared
        let info = UIPrintInfo.printInfo()
        info.jobName = label
        printer.printInfo = info
        printer.printFormatter = webView.viewPrintFormatter()
        printer.present(animated: true)
    }

    /// Saves the page with its pictures and styles as a .webarchive into Downloads (Mac), like Chrome's "Save Page As".
    func savePage() async {
        let data: Data? = await withCheckedContinuation { done in
            guard let webView else { return done.resume(returning: nil) }
            webView.createWebArchiveData { done.resume(returning: try? $0.get()) }
        }
        guard let data else {
            show(L("Seite ließ sich nicht sichern", "Could not save the page"), symbol: "exclamationmark.triangle.fill")
            return
        }
        let name = label.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: "-")
        let file = URL.downloadsDirectory.appending(path: name + ".webarchive")
        do {
            try data.write(to: file, options: .atomic)
            show(L("Gespeichert in Downloads: ", "Saved to Downloads: ") + file.lastPathComponent, symbol: "checkmark.circle.fill")
        } catch {
            show(error.localizedDescription, symbol: "exclamationmark.triangle.fill")
        }
    }

    func find(_ direction: UITextStorageDirection? = nil) {
        guard let finder = webView?.findInteraction else { return }
        switch direction {
        case .forward: finder.findNext()
        case .backward: finder.findPrevious()
        default: findInPage()
        }
    }
}

/// The source in a script-free web view: monospaced, numbered lines, searchable with ⌘F.
struct SourceView: View {
    let source: PageSource
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ReaderPage(html: html, base: source.page, open: { _ in }, findable: true)
                .ignoresSafeArea(edges: .bottom)
                .navigationTitle(source.page.absoluteString)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) { Button(L("Fertig", "Done")) { dismiss() } }
                    ToolbarItem(placement: .primaryAction) {
                        ShareLink(item: source.text, preview: SharePreview(source.page.absoluteString))
                    }
                }
        }
    }

    private var html: String { Self.html(for: source.text) }

    static func html(for text: String) -> String {
        let lines = text.components(separatedBy: "\n").map {
            "<span>" + $0.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;") + "</span>"
        }
        return """
            <!doctype html><html><head><meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
            :root { color-scheme: light dark; }
            body { margin: 0; font: 12px/1.5 ui-monospace, Menlo, monospace; }
            pre { margin: 0; padding: 8px 12px 48px 0; counter-reset: line; white-space: pre-wrap; word-break: break-all; }
            span { display: block; padding-left: 5.5em; text-indent: -4.5em; }
            span::before { counter-increment: line; content: counter(line); display: inline-block; width: 4em;
                           margin-right: .5em; text-align: right; color: gray; user-select: none; }
            </style></head><body><pre>\(lines.joined())</pre></body></html>
            """
    }
}

// MARK: Developer tools panel (console, network, element picker)

enum DevPane: String, CaseIterable, Identifiable {
    case console, network, source
    var id: Self { self }
    var title: String {
        switch self {
        case .console: L("Konsole", "Console")
        case .network: L("Netzwerk", "Network")
        case .source: L("Quelltext", "Source")
        }
    }
}

struct DevEntry: Identifiable {
    let id = UUID()
    /// log, info, debug, warn, error from the page; input and result for what the user typed.
    let level: String
    let text: String
}

struct DevResource: Identifiable {
    let id = UUID()
    let url: String
    let type: String
    let bytes: Int
    let milliseconds: Int
}

extension Browser {
    /// Reports the page's console and uncaught errors to the app. Runs in the page's own world, since that is
    /// where `console` is called; only in tabs whose developer tools were opened.
    static let consoleScript = WKUserScript(source: """
        (() => {
            if (window.__pouConsole) return;
            window.__pouConsole = true;
            const show = value => {
                try {
                    if (typeof value === 'string') return value;
                    if (value instanceof Error) return value.stack || value.message;
                    if (value instanceof Node) return value.outerHTML ? value.outerHTML.slice(0, 500) : String(value);
                    return JSON.stringify(value) ?? String(value);
                } catch (error) { return String(value); }
            };
            const send = (level, values) => {
                try {
                    webkit.messageHandlers.devConsole.postMessage(JSON.stringify({
                        level, text: (window === top ? '' : '[' + location.host + '] ') + values.map(show).join(' ').slice(0, 4000) }));
                } catch (error) {}
            };
            for (const level of ['log', 'info', 'debug', 'warn', 'error']) {
                const original = console[level];
                console[level] = function (...values) { send(level, values); return original.apply(this, values); };
            }
            addEventListener('error', event => {
                if (event.message) send('error', [event.message + ' (' + String(event.filename || '').split('/').pop() + ':' + event.lineno + ')']);
            });
            addEventListener('unhandledrejection', event => send('error', ['Uncaught (in promise) ', event.reason]));
        })();
        """, injectionTime: .atDocumentStart, forMainFrameOnly: false)

    func addDevEntry(_ entry: DevEntry) {
        devLog.append(entry)
        if devLog.count > 1000 { devLog.removeFirst(devLog.count - 1000) }
    }

    /// From now on (and after every reload) the page's console lines come to the panel.
    func startConsole() {
        guard !capturesConsole, let webView else { return }
        capturesConsole = true
        webView.configuration.userContentController.addUserScript(Self.consoleScript)
        webView.evaluateJavaScript(Self.consoleScript.source)
    }

    /// Runs typed JavaScript in the page itself, like Chrome's console (native, so a page's CSP does not stop it).
    func evaluate(_ code: String) {
        guard let webView else { return }
        addDevEntry(DevEntry(level: "input", text: code))
        webView.evaluateJavaScript(code, in: nil, in: .page) { [weak self] result in
            switch result {
            case .success(let value): self?.addDevEntry(DevEntry(level: "result", text: Self.describe(value)))
            case .failure(let error as NSError):
                // undefined, functions and DOM nodes cannot cross into the app.
                if error.domain == WKError.errorDomain, error.code == WKError.javaScriptResultTypeIsUnsupported.rawValue {
                    self?.addDevEntry(DevEntry(level: "result", text: "undefined"))
                } else {
                    self?.addDevEntry(DevEntry(level: "error",
                        text: error.userInfo["WKJavaScriptExceptionMessage"] as? String ?? error.localizedDescription))
                }
            }
        }
    }

    private static func describe(_ value: Any) -> String {
        switch value {
        case let text as String: return "\"" + text + "\""
        case is NSNull: return "null"
        case let number as NSNumber: return CFGetTypeID(number) == CFBooleanGetTypeID() ? (number.boolValue ? "true" : "false") : number.stringValue
        default:
            guard JSONSerialization.isValidJSONObject(value),
                  let data = try? JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys]) else {
                return String(describing: value)
            }
            return String(decoding: data, as: UTF8.self)
        }
    }

    /// What the page loaded (main frame's Resource Timing list), slowest stays where the page put it.
    func resources() async -> [DevResource] {
        guard let webView else { return [] }
        let script = """
            return performance.getEntriesByType('navigation').concat(performance.getEntriesByType('resource')).map(entry =>
                [entry.name, entry.initiatorType || 'document', entry.transferSize || entry.encodedBodySize || 0, Math.round(entry.duration)]);
            """
        let rows = (try? await webView.callAsyncJavaScript(script, contentWorld: .defaultClient)) as? [[Any]] ?? []
        return rows.compactMap { row in
            guard row.count == 4, let url = row[0] as? String else { return nil }
            return DevResource(url: url, type: row[1] as? String ?? "", bytes: (row[2] as? NSNumber)?.intValue ?? 0,
                               milliseconds: (row[3] as? NSNumber)?.intValue ?? 0)
        }
    }

    /// "Element untersuchen": outlines what is under the pointer, takes the next click (it does not reach the page)
    /// and writes that element's selector, size and HTML into the console.
    func inspectElement() async {
        guard let webView else { return }
        startConsole()
        addDevEntry(DevEntry(level: "info", text: L("Element anklicken …", "Click an element …")))
        let script = """
            return await new Promise(resolve => {
                let marked = null, before = '';
                const mark = element => {
                    if (marked) marked.style.outline = before;
                    marked = element;
                    if (element) { before = element.style.outline; element.style.outline = '2px solid #1a73e8'; }
                };
                const over = event => mark(event.target);
                const pick = event => {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    removeEventListener('pointerover', over, true);
                    removeEventListener('click', pick, true);
                    mark(null);
                    const element = event.target, box = element.getBoundingClientRect();
                    let path = [];
                    for (let node = element; node && node.nodeType === 1 && path.length < 6; node = node.parentElement) {
                        path.unshift(node.localName + (node.id ? '#' + node.id : '') + [...node.classList].slice(0, 3).map(name => '.' + name).join(''));
                    }
                    resolve(path.join(' > ') + '  ' + Math.round(box.width) + '×' + Math.round(box.height) + '\\n' + element.outerHTML.slice(0, 4000));
                };
                addEventListener('pointerover', over, true);
                addEventListener('click', pick, true);
            });
            """
        if let found = try? await webView.callAsyncJavaScript(script, contentWorld: .defaultClient) as? String {
            addDevEntry(DevEntry(level: "element", text: found))
        }
    }
}

/// Chrome-style developer tools under the page (Mac) or in a sheet (iPhone).
struct DevToolsPanel: View {
    let browser: Browser
    @Binding var pane: DevPane?
    @State private var code = ""
    @State private var resources = [DevResource]()
    @State private var filter = ""
    @State private var source: PageSource?

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Picker(L("Bereich", "Pane"), selection: Binding(get: { pane ?? .console }, set: { pane = $0 })) {
                    ForEach(DevPane.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented)
                .fixedSize()
                Button(L("Element untersuchen", "Inspect element"), systemImage: "cursorarrow.rays") {
                    pane = .console
                    Task { await browser.inspectElement() }
                }
                .labelStyle(.iconOnly)
                .help(L("Element untersuchen", "Inspect element"))
                Spacer()
                if pane != .source {
                    TextField(L("Filter", "Filter"), text: $filter)
                        .textFieldStyle(.roundedBorder)
                        .frame(maxWidth: 180)
                }
                Button(L("Leeren / neu laden", "Clear / refresh"), systemImage: pane == .console ? "trash" : "arrow.clockwise") {
                    if pane == .console { browser.devLog = [] } else { Task { await refresh() } }
                }
                .labelStyle(.iconOnly)
                Button(L("Schließen", "Close"), systemImage: "xmark") { pane = nil }
                    .labelStyle(.iconOnly)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            Divider()
            switch pane ?? .console {
            case .console: console
            case .network: network
            case .source:
                if let source {
                    ReaderPage(html: SourceView.html(for: source.text), base: source.page, open: { _ in }, findable: true)
                } else {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
        }
        .background(Color(.systemBackground))
        .font(.system(.caption, design: .monospaced))
        .task(id: ObjectIdentifier(browser)) {
            browser.startConsole()
            await refresh()
        }
        .task(id: pane) { await refresh() }
    }

    private func matches(_ text: String) -> Bool {
        filter.isEmpty || text.localizedCaseInsensitiveContains(filter)
    }

    private var console: some View {
        VStack(spacing: 0) {
            ScrollViewReader { list in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(browser.devLog.filter { matches($0.text) }) { entry in
                            HStack(alignment: .top, spacing: 6) {
                                Text(Self.mark(entry.level)).foregroundStyle(.secondary).frame(width: 14)
                                Text(entry.text).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .foregroundStyle(Self.colour(entry.level))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(Self.background(entry.level))
                            .id(entry.id)
                            Divider()
                        }
                    }
                }
                .onChange(of: browser.devLog.last?.id) { _, last in
                    if let last { list.scrollTo(last, anchor: .bottom) }
                }
            }
            Divider()
            HStack(spacing: 6) {
                Text("›").foregroundStyle(.blue)
                TextField(L("JavaScript eingeben", "Type JavaScript"), text: $code)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .onSubmit {
                        guard !code.isEmpty else { return }
                        browser.evaluate(code)
                        code = ""
                    }
            }
            .padding(8)
        }
    }

    private var network: some View {
        List {
            Section(L("Geladen (\(resources.count))", "Loaded (\(resources.count))")) {
                ForEach(resources.filter { matches($0.url) }) { resource in
                    HStack {
                        Text(resource.url).lineLimit(1).truncationMode(.middle).textSelection(.enabled)
                        Spacer()
                        Text(resource.type).foregroundStyle(.secondary).frame(width: 90, alignment: .trailing)
                        Text(resource.bytes > 0 ? resource.bytes.formatted(.byteCount(style: .file)) : "–")
                            .foregroundStyle(.secondary).frame(width: 70, alignment: .trailing)
                        Text("\(resource.milliseconds) ms").foregroundStyle(.secondary).frame(width: 70, alignment: .trailing)
                    }
                }
            }
            Section(L("Blockiert (\(browser.blockedURLs.count))", "Blocked (\(browser.blockedURLs.count))")) {
                ForEach(Array(browser.blockedURLs.filter(matches).enumerated()), id: \.offset) { _, url in
                    Text(url).lineLimit(1).truncationMode(.middle).foregroundStyle(.red).textSelection(.enabled)
                }
            }
        }
        .listStyle(.plain)
        .environment(\.defaultMinListRowHeight, 22)
    }

    private func refresh() async {
        switch pane ?? .console {
        case .network: resources = await browser.resources()
        case .source: source = await browser.pageSource()
        case .console: break
        }
    }

    private static func mark(_ level: String) -> String {
        switch level {
        case "input": "›"
        case "result": "‹"
        case "error": "✕"
        case "warn": "⚠"
        case "element": "◎"
        default: " "
        }
    }

    private static func colour(_ level: String) -> Color {
        switch level {
        case "error": .red
        case "warn": .orange
        case "input": .blue
        case "debug": .secondary
        default: .primary
        }
    }

    private static func background(_ level: String) -> Color {
        switch level {
        case "error": .red.opacity(0.08)
        case "warn": .yellow.opacity(0.1)
        default: .clear
        }
    }
}
