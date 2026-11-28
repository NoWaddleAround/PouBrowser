#!/usr/bin/env python3
"""Builds ios/Ruhe/Resources/autoconsent.js (used by iOS, Mac and Android) from DuckDuckGo's autoconsent.

Usage: download the npm package (https://registry.npmjs.org/@duckduckgo/autoconsent/-/autoconsent-VERSION.tgz),
unpack it, then: Scripts/autoconsent.py path/to/package

Takes dist/autoconsent.standalone.js (MPL-2.0, rules included) and replaces only its start-up part: no console
output, opt-out, and `pouTell('cookies', name)` once a banner was answered. The apps define `pouTell`.
"""
import json, pathlib, sys

package = pathlib.Path(sys.argv[1])
version = json.loads((package / "package.json").read_text())["version"]
source = (package / "dist/autoconsent.standalone.js").read_text()
marker = "  // standalone/content.ts\n"
assert source.count(marker) == 1, "the standalone build changed; check its start-up part"
start = """  // PouBrowser start-up (replaces standalone/content.ts): rejects cookie banners and tells the app.
  if (!window.autoconsentReceiveMessage) {
    const consent = new AutoConsent(async (message) => {
      if (message.type === "autoconsentDone" && typeof pouTell === "function") pouTell("cookies", message.cmp || "");
    });
    window.autoconsentReceiveMessage = (message) => Promise.resolve(consent.receiveMessageCallback(message));
    consent.initialize({
      isMainWorld: true,
      autoAction: "optOut",
      enableHeuristicDetection: true,
      heuristicMode: "tier2",
      logs: { lifecycle: false, rulesteps: false, detectionsteps: false, evals: false, errors: false, messages: false, waits: false }
    }, {
      autoconsent: [],
      compact: filterCompactRules(compact_rules_default, { url: window.location.href, mainFrame: window.top === window })
    });
  }
})();
"""
header = f"// DuckDuckGo autoconsent {version}, MPL-2.0 (https://github.com/duckduckgo/autoconsent). Built by Scripts/autoconsent.py.\n"
out = pathlib.Path(__file__).resolve().parent.parent / "ios/Ruhe/Resources/autoconsent.js"
out.write_text(header + source[: source.index(marker)] + start)
print(out, out.stat().st_size, "bytes")
