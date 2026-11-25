import AVFAudio
import SwiftUI

@main
struct RuheApp: App {
    init() {
        // Background sound and picture-in-picture are only granted to apps whose audio counts as playback.
        try? AVAudioSession.sharedInstance().setCategory(.playback)
        #if DEBUG
        let site = { Browser.site(URL(string: $0)) }
        assert(site("https://www.bbc.co.uk/news") == "bbc.co.uk")
        assert(site("https://cdn.example.com") == site("https://example.com/a"))
        assert(site("https://a.co.uk") != site("https://b.co.uk"))
        assert(Browser.destination(for: "example.com/x").absoluteString == "https://example.com/x")
        assert(Browser.destination(for: "one piece 1100").host == "duckduckgo.com")
        assert(Browser.destination(for: "https://example.com/p?id=1&fbclid=abc&utm_source=x").absoluteString == "https://example.com/p?id=1")
        #endif
    }

    var body: some Scene {
        WindowGroup { ContentView() }
    }
}
