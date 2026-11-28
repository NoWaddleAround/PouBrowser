import AVFoundation
import SwiftUI
import WebKit

/// Reader mode and "hide element". Both run in the app's own script world, out of the page's reach.
extension Browser {
    struct Article: Identifiable {
        let id = UUID()
        let title: String
        let byline: String?
        let html: String
        let page: URL
        /// Plain text and page language, for reading aloud.
        var text = ""
        var language = ""
    }

    /// Mozilla Readability (Apache-2.0, `Resources/readability.js` from the npm package `@mozilla/readability` 0.6.0).
    private static let readability = Bundle.main.url(forResource: "readability", withExtension: "js")
        .flatMap { try? String(contentsOf: $0, encoding: .utf8) } ?? ""

    /// The page's main text, or nil when Readability finds no article.
    func readerArticle() async -> Article? {
        guard let webView, let page = webView.url else { return nil }
        let script = Self.readability + """

            const article = new Readability(document.cloneNode(true)).parse();
            return article && article.content ? { title: article.title || '', byline: article.byline || '', content: article.content,
                text: article.textContent || '', lang: document.documentElement.lang || '' } : null;
            """
        guard let found = try? await webView.callAsyncJavaScript(script, contentWorld: .defaultClient) as? [String: Any],
              let html = found["content"] as? String else { return nil }
        let byline = (found["byline"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        return Article(title: found["title"] as? String ?? label, byline: byline, html: html, page: page,
                       text: found["text"] as? String ?? "", language: found["lang"] as? String ?? "")
    }

    /// Outlines what is under the pointer, takes the next tap, hides that element and returns a selector for it.
    func pickElement() async -> String? {
        guard let webView else { return nil }
        return try? await webView.callAsyncJavaScript(Self.picker, contentWorld: .defaultClient) as? String
    }

    private static let picker = """
        const simple = name => /^[A-Za-z][\\w-]*$/.test(name);
        // An id when there is a plain one, else up to five steps of tag.class:nth-of-type from the nearest id.
        const selector = element => {
            const parts = [];
            for (let node = element; node && node.nodeType === 1 && node !== document.body && parts.length < 5; node = node.parentElement) {
                if (node.id && simple(node.id)) { parts.unshift('#' + node.id); break; }
                let part = node.localName;
                const classes = [...node.classList].filter(simple).slice(0, 2);
                if (classes.length) part += '.' + classes.join('.');
                const same = node.parentElement ? [...node.parentElement.children].filter(child => child.localName === node.localName) : [];
                if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
                parts.unshift(part);
            }
            return parts.join(' > ');
        };
        return await new Promise(resolve => {
            let marked = null, before = '';
            const mark = element => {
                if (marked) marked.style.outline = before;
                marked = element;
                if (element) { before = element.style.outline; element.style.outline = '3px solid #e5484d'; }
            };
            const over = event => mark(event.target);
            const pick = event => {
                event.preventDefault();
                event.stopImmediatePropagation();
                removeEventListener('pointerover', over, true);
                removeEventListener('click', pick, true);
                mark(null);
                // A tap lands on the innermost text: grow to the box around it (a banner, an ad slot) while the
                // next box is at most three times as big and covers less than half of the view.
                const area = node => { const box = node.getBoundingClientRect(); return box.width * box.height; };
                const view = innerWidth * innerHeight;
                let element = event.target;
                while (element.parentElement && element.parentElement !== document.body
                       && area(element.parentElement) <= 3 * Math.max(area(element), 1)
                       && area(element.parentElement) < view / 2) element = element.parentElement;
                element.style.setProperty('display', 'none', 'important');
                resolve(selector(element));
            };
            addEventListener('pointerover', over, true);
            addEventListener('click', pick, true);
        });
        """

    /// Hides a site's picked elements from the start of every page.
    static func hidingScript(_ selectors: [String]) -> WKUserScript {
        let css = selectors.joined(separator: ",\n") + " { display: none !important; }"
        let literal = (try? String(data: JSONEncoder().encode(css), encoding: .utf8)) ?? "\"\""
        let source = """
            (() => {
                const style = document.createElement('style');
                style.textContent = \(literal);
                (document.head || document.documentElement).appendChild(style);
            })();
            """
        return WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .defaultClient)
    }
}

/// The article alone, in calm type. No scripts run here; a link opens in the tab and closes the reader.
/// Size, colours and serif type are kept for next time; the article can be read aloud.
struct ReaderView: View {
    let article: Browser.Article
    let open: (URL) -> Void
    @Environment(\.dismiss) private var dismiss
    @AppStorage("readerSize") private var size = 19.0
    @AppStorage("readerTheme") private var theme = "auto"
    @AppStorage("readerSerif") private var serif = false
    @State private var voice = ReaderVoice()

    var body: some View {
        NavigationStack {
            ReaderPage(html: page, base: article.page) { url in
                dismiss()
                open(url)
            }
            .ignoresSafeArea(edges: .bottom)
            .navigationTitle(L("Lesemodus", "Reader mode"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button(L("Fertig", "Done")) { dismiss() } }
                ToolbarItemGroup(placement: .topBarLeading) {
                    Button(voice.speaking ? L("Vorlesen stoppen", "Stop reading") : L("Vorlesen", "Read aloud"),
                           systemImage: voice.speaking ? "stop.fill" : "speaker.wave.2") {
                        voice.toggle(article.title + ".\n" + article.text, language: article.language)
                    }
                    Menu(L("Darstellung", "Appearance"), systemImage: "textformat.size") {
                        ControlGroup {
                            Button(L("Kleiner", "Smaller"), systemImage: "textformat.size.smaller") { size = max(13, size - 2) }
                            Button(L("Größer", "Larger"), systemImage: "textformat.size.larger") { size = min(33, size + 2) }
                        }
                        Picker(L("Farben", "Colours"), selection: $theme) {
                            Text(L("Automatisch", "Automatic")).tag("auto")
                            Text(L("Hell", "Light")).tag("light")
                            Text("Sepia").tag("sepia")
                            Text(L("Dunkel", "Dark")).tag("dark")
                            Text(L("Schwarz", "Black")).tag("black")
                        }
                        Toggle(L("Serifenschrift", "Serif font"), isOn: $serif)
                    }
                }
            }
        }
        .onDisappear { voice.stop() }
    }

    private var colours: String {
        switch theme {
        case "light": "body { background: #fff; color: #1d1d1f; }"
        case "sepia": "body { background: #f4ecd8; color: #5b4636; }"
        case "dark": "body { background: #1c1c1e; color: #e5e5ea; }"
        case "black": "body { background: #000; color: #d1d1d6; }"
        default: ":root { color-scheme: light dark; }"
        }
    }

    private var page: String {
        let escape = { (text: String) in
            text.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
        }
        let font = serif ? "ui-serif, Georgia, serif" : "-apple-system, system-ui, sans-serif"
        return """
            <!doctype html><html><head><meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
            body { font: \(Int(size))px/1.6 \(font); max-width: 40em; margin: 0 auto; padding: 24px 20px 64px; }
            \(colours)
            h1 { font-size: 1.6em; line-height: 1.25; margin-bottom: .2em; }
            .byline { color: gray; margin-bottom: 2em; }
            img, video, figure { max-width: 100%; height: auto; }
            a { color: #2f7d6d; }
            pre { white-space: pre-wrap; }
            </style></head><body>
            <h1>\(escape(article.title))</h1>
            \(article.byline.map { "<p class=\"byline\">\(escape($0))</p>" } ?? "")
            \(article.html)
            </body></html>
            """
    }
}

/// The system voice reading the article, in the page's language when the device has a voice for it.
@MainActor @Observable
final class ReaderVoice: NSObject, AVSpeechSynthesizerDelegate {
    private(set) var speaking = false
    @ObservationIgnored private let synthesizer = AVSpeechSynthesizer()

    override init() {
        super.init()
        synthesizer.delegate = self
    }

    func toggle(_ text: String, language: String) {
        if speaking { return stop() }
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: language.isEmpty ? nil : language) ?? AVSpeechSynthesisVoice(language: nil)
        speaking = true
        synthesizer.speak(utterance)
    }

    func stop() {
        synthesizer.stopSpeaking(at: .immediate)
        speaking = false
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in self.speaking = false }
    }
}

struct ReaderPage: UIViewRepresentable {
    let html: String
    let base: URL
    let open: (URL) -> Void
    var findable = false

    func makeUIView(context: Context) -> WKWebView {
        context.coordinator.html = html
        let config = WKWebViewConfiguration()
        config.defaultWebpagePreferences.allowsContentJavaScript = false
        config.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = context.coordinator
        view.isFindInteractionEnabled = findable
        view.loadHTMLString(html, baseURL: base)
        return view
    }

    /// The reader's size and colours changed: same article, new style.
    func updateUIView(_ view: WKWebView, context: Context) {
        guard context.coordinator.html != html else { return }
        context.coordinator.html = html
        view.loadHTMLString(html, baseURL: base)
    }

    func makeCoordinator() -> Coordinator { Coordinator(open: open) }

    final class Coordinator: NSObject, WKNavigationDelegate {
        let open: (URL) -> Void
        var html = ""
        init(open: @escaping (URL) -> Void) { self.open = open }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
            guard action.navigationType == .linkActivated, let url = action.request.url else { return .allow }
            await MainActor.run { open(url) }
            return .cancel
        }
    }
}
