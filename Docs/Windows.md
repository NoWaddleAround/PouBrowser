# PouBrowser für Windows – Anleitung

Stand: 28.11.2026. Diese Anleitung beschreibt, wie eine Windows-Version von PouBrowser entsteht, die so arbeitet wie die Android-App.

## 1. Wo der Code liegt

| Teil | Ordner | Sprache |
|---|---|---|
| iPhone, iPad, Mac | `ios/` (Xcode-Projekt `Ruhe.xcodeproj`, Code in `ios/Ruhe/`) | Swift, SwiftUI, WKWebView |
| Android | `android/` (Gradle, Code in `android/app/src/main/java/com/nowaddlearound/poubrowser/`) | Kotlin, Android WebView |
| Gemeinsame Seiten-Skripte | `ios/Ruhe/Resources/` (Android lädt diesen Ordner mit) | JavaScript |
| Hilfsskripte | `Scripts/` | Python, Swift, Shell |

Das Git-Repository ist `https://github.com/NoWaddleAround/PouBrowser` (Lizenz GPL-3.0, `LICENSE`).

## 2. Welcher Weg

**WinUI 3 + WebView2, in C# (.NET).**

- WebView2 ist die Chromium-Engine von Microsoft Edge. Android-WebView ist ebenfalls Chromium. Deshalb ist die **Android-App die Vorlage**: Regeln, Werbeblocker und Skripte lassen sich fast 1:1 übertragen.
- Auf Windows 10 und 11 ist die WebView2-Laufzeit schon installiert. Sie aktualisiert sich selbst, wie Edge.
- WinUI 3 ist Microsofts aktuelle Oberfläche (Fluent Design). Die App lässt sich als MSIX in den Microsoft Store bringen.

Andere Wege, kurz:
- **Tauri** (Rust, auch WebView2): wird nur dann leichter, wenn man Rust schon kann.
- **Electron**: liefert ein eigenes Chromium mit. Die App wird groß (über 100 MB) und muss jedes Chromium-Update selbst ausliefern.

## 3. Was man braucht

- **Einen Windows-11-PC.** Auf diesem Mac (Apple Silicon) geht auch eine VM: Parallels Desktop oder UTM mit Windows 11 ARM. WinUI 3 läuft auf ARM64 und auf x64.
- **Visual Studio 2022 Community oder neuer** (kostenlos) mit diesen Workloads:
  - „.NET-Desktopentwicklung“
  - „WinUI-Anwendungsentwicklung“ (enthält das Windows App SDK)
- **Git**, um das Repository zu klonen.

## 4. Projekt anlegen

1. Repository klonen.
2. In Visual Studio ein neues Projekt anlegen: **„Leere App, gepackt (WinUI 3 in Desktop)“**, Name `PouBrowser`, Ordner `windows/` neben `ios/` und `android/`.
3. NuGet-Paket **`Microsoft.Web.WebView2`** in der neuesten stabilen Version hinzufügen. `Microsoft.WindowsAppSDK` bringt die Vorlage schon mit.
4. Die gemeinsamen Skripte einbinden, ohne sie zu kopieren. In `windows/PouBrowser/PouBrowser.csproj`:

```xml
<ItemGroup>
  <Content Include="..\..\ios\Ruhe\Resources\*.js;..\..\ios\Ruhe\Resources\*.json;..\..\ios\Ruhe\Resources\licenses.txt"
           Link="Resources\%(Filename)%(Extension)" CopyToOutputDirectory="PreserveNewest" />
</ItemGroup>
```

Damit hat Windows dieselben Dateien wie iOS und Android:
- `privacy.js` (Ping, Fingerprint-Rauschen, Zwischenablage)
- `autoconsent.js` (Cookie-Banner)
- `media.js` (Video-Werkzeuge, Medien-Langdruck)
- `readability.js` (Lesemodus)
- `darkreader.js` (dunkle Seiten)
- `scriptlets.corelibs.json`, `extended-css.min.js` (Filterregeln mit Skripten)

## 5. Android → WebView2: was wohin gehört

| Android (`BrowserSession.kt` u. a.) | WebView2 (`CoreWebView2`) |
|---|---|
| `shouldOverrideUrlLoading` (Navigation erlauben/sperren) | `NavigationStarting` (`e.Cancel`, `e.IsUserInitiated`, `e.IsRedirected`); für Frames `FrameNavigationStarting` |
| `onCreateWindow` (Popups) | `NewWindowRequested`: `e.Handled = true` sperrt, `e.NewWindow` macht einen Tab daraus |
| `shouldInterceptRequest` (Werbeblocker) | `AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All, CoreWebView2WebResourceRequestSourceKinds.All)` + `WebResourceRequested` → `e.Response = env.CreateWebResourceResponse(null, 403, "Blocked", "")` |
| `WebViewCompat.addDocumentStartJavaScript` | `AddScriptToExecuteOnDocumentCreatedAsync(script)` (läuft auch in iframes) |
| `WebMessageListener` (`pouPrivacy`, `pouMedia` …) | Seite: `chrome.webview.postMessage(...)`; App: `WebMessageReceived`, für iframes `FrameCreated` → `frame.WebMessageReceived` |
| `onReceivedHttpAuthRequest` | `BasicAuthenticationRequested` (`e.Response.UserName/Password`, `e.Cancel`) |
| `onReceivedSslError` | `ServerCertificateErrorDetected` (`e.Action = AlwaysAllow` oder `Cancel`) |
| Private Tabs (eigenes Profil) | `env.CreateCoreWebView2ControllerOptions()` mit `IsInPrivateModeEnabled = true` |
| Downloads | `DownloadStarting` |
| Kamera, Mikrofon, Standort | `PermissionRequested` |
| Langdruck-/Rechtsklick-Menü | `ContextMenuRequested` |
| Tab stummschalten | `IsMuted`, `IsDocumentPlayingAudio` |
| „Seite reagiert nicht“, Absturz | `ProcessFailed` (`RenderProcessUnresponsive`, `RenderProcessExited`) |
| `evaluateJavascript` | `ExecuteScriptAsync` (nur Hauptframe), für einen iframe `CoreWebView2Frame.ExecuteScriptAsync` |

**Wichtiger Unterschied:** `AddScriptToExecuteOnDocumentCreatedAsync` kennt keine Ursprungs-Liste wie Android (`setOf(origin)`). Seitenbezogene Skripte (Filterregeln pro Seite) setzt man deshalb wie unter iOS:
- in `NavigationStarting` des Hauptframes das alte Skript mit `RemoveScriptToExecuteOnDocumentCreated(id)` entfernen und das neue hinzufügen;
- in iframes prüft das Skript `location.hostname` selbst.

## 6. Grundgerüst (C#)

```csharp
using Microsoft.Web.WebView2.Core;

// In MainWindow, nachdem das WebView2-Steuerelement "Web" geladen ist:
await Web.EnsureCoreWebView2Async();
var core = Web.CoreWebView2;
var env = core.Environment;

// Keine Passwörter oder Formulare von Edge speichern lassen: PouBrowser hat seine eigene Verwaltung.
core.Settings.IsPasswordAutosaveEnabled = false;
core.Settings.IsGeneralAutofillEnabled = false;

// Gemeinsame Skripte. pouKey ist pro App-Start zufällig und für Seiten unsichtbar (siehe privacy.js).
string key = Guid.NewGuid().ToString();
string Wrap(string file) =>
    "(() => { const pouKey = \"" + key + "\";\n" +
    "const pouTell = (kind, text) => { try { chrome.webview.postMessage(kind + '\\n' + text); } catch (e) {} };\n" +
    File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Resources", file)) + "\n})();";
await core.AddScriptToExecuteOnDocumentCreatedAsync(Wrap("privacy.js"));
await core.AddScriptToExecuteOnDocumentCreatedAsync(Wrap("autoconsent.js"));
await core.AddScriptToExecuteOnDocumentCreatedAsync(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Resources", "media.js")));

// Nachrichten der Seite (Zwischenablage, Cookie-Banner).
core.WebMessageReceived += (_, e) => {
    var parts = e.TryGetWebMessageAsString().Split('\n', 2);
    // parts[0] == "clipboard" → Hinweis mit "Original kopieren"; "cookies" → "Cookie-Banner abgelehnt"
};

// Popups: nur mit Klick, und dann als eigener Tab (wie Android onCreateWindow).
core.NewWindowRequested += (_, e) => {
    e.Handled = true;
    if (e.IsUserInitiated) { /* neuen Tab mit e.Uri öffnen */ }
};

// Werbeblocker: jede Anfrage, auch aus iframes.
core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All, CoreWebView2WebResourceRequestSourceKinds.All);
core.WebResourceRequested += (_, e) => {
    // if (filterEngine.Blocks(e.Request.Uri, pageHost, e.ResourceContext))
    //     e.Response = env.CreateWebResourceResponse(null, 403, "Blocked", "");
};

core.Navigate("https://example.com/");
```

## 7. Reihenfolge der Arbeit

Jeder Schritt ergibt eine benutzbare App. Die Vorlage steht jeweils in Klammern.

1. **Fenster, Tabs, Adressleiste**: Suche oder Adresse, Zurück/Vor, Neu laden, Tabs öffnen/schließen. (`BrowserPolicy.destination`, `searchUrl`; Oberfläche wie Mac: `ios/Ruhe/ContentView.swift`)
2. **Navigationsregeln und Popups**: keine Sprünge in fremde Apps, Popups nur nach Klick, ⌘-/Mittelklick → Tab im Hintergrund (unter Windows Strg-Klick). (`BrowserPolicy.allowsNavigation`, `sameTarget`, `onCreateWindow`)
3. **Werbeblocker**: `FilterEngine.kt` (785 Zeilen) nach C# übertragen. Der Code ist reines Kotlin ohne Android-Teile, die Übertragung ist also fast Zeile für Zeile. Die Filterlisten und ihr Laden stehen in `TrackerBlocker.kt` (`FilterList(...)`) und `FilterSources.kt`. Die Unit-Tests in `android/app/src/test/` gleich mit übertragen.
4. **Seitenskripte**: Filterstile pro Seite (`TrackerBlocker.planScripts`), Scriptlets, `privacy.js`, `autoconsent.js`, `media.js`, dunkle Seiten.
5. **Datenschutz-Regeln**:
   - Tracking-Parameter entfernen und Weiterleitungen auflösen (`BrowserPolicy.cleanUrl`, `unbounced`).
   - Nur HTTPS (`BrowserPolicy.httpsFirst`, `isLocal`).
   - Login-Fenster und Zertifikat-Warnung.
6. **Bibliothek**:
   - Lesezeichen, Verlauf und Passwörter (`Library.kt`).
   - Sync im selben JSON-Format wie iOS/Android (`Sync.kt`), damit alle Geräte dieselben Dateien lesen.
7. **Rest**:
   - Lesemodus mit Vorlesen: `readability.js`; die Stimme kommt unter Windows von `Windows.Media.SpeechSynthesis`.
   - Downloads, Entwicklertools (WebView2 hat mit `OpenDevToolsWindow()` echte DevTools), Bild-in-Bild (Chromium kann das selbst).

## 8. Prüfen

- **WebRTC**: Die Testseite mit ICE-Kandidaten öffnen. Erscheint die echte LAN-IP statt `….local`, das `RTC_SCRIPT` aus `BrowserSession.kt` mit einbinden (Android brauchte es).
- **Fingerprint**: Die Seite zweimal laden (gleicher Wert), dann unter anderer Adresse öffnen (anderer Wert).
- **Werbeblocker**: dieselben Seiten wie auf Android vergleichen, Zähler „blockiert“ gegenprüfen.
- **Testseiten**: Die Seiten in `Scripts/popup-test` lassen sich wiederverwenden.

## 9. Verteilen

- **MSIX-Paket** aus Visual Studio: Projekt › Packen und veröffentlichen.
- **Microsoft Store**: Konto im Microsoft Partner Center anlegen, App einreichen. Für einen Browser verlangt der Store eine eigene Datenschutzerklärung (die der iOS/Android-App passt).
- **Ohne Store**: Eine unsignierte `.exe` oder MSIX löst die SmartScreen-Warnung aus. Ein Code-Signing-Zertifikat verhindert das.
- **Standardbrowser**: In MSIX die Protokolle `http`/`https` und die Dateitypen `.htm`/`.html` anmelden. Dann bietet Windows PouBrowser unter Einstellungen › Apps › Standard-Apps an.
