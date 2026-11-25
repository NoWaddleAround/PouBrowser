# PouBrowser für Android

Öffne diesen Ordner in Android Studio und starte die Konfiguration `app` auf einem Gerät oder Emulator. Das Projekt enthält den Gradle-Wrapper und verwendet Android SDK 37, JDK 17 oder neuer und Android 8.0 als Mindestversion.

```sh
./gradlew testDebugUnitTest assembleDebug
node --test scripts/test-captions.cjs
```

Die Debug-APK liegt nach dem Build unter `app/build/outputs/apk/debug/app-debug.apk`.

- Der Tabzähler öffnet die Übersicht. Sie zeigt den zuletzt sichtbaren Ausschnitt besuchter Tabs. URLs und Lesepositionen bleiben nach einem Neustart erhalten. Die Vorschaubilder bleiben im Arbeitsspeicher.
- Das Menü bietet JavaScript und Werbeblocker pro Site, abgedunkelte Seiten (Dark Reader), Bild-in-Bild und Aktualisierung der Filterlisten. Der Werbeblocker lädt dieselben Filterlisten wie die iOS-App (AdGuard Base, Mobile und Popups, EasyPrivacy, uBlock) und wendet Netzwerkregeln, versteckte Werbeflächen und Scriptlets an (`FilterEngine.kt`). Die Skriptbibliotheken kommen aus `../Ruhe/Resources`. Was auf einer kaputten Seite geblockt wird, zeigt `adb shell setprop log.tag.PouBlock DEBUG` im Logcat.
- Für Bild-in-Bild ein Video auf der Webseite ins Vollbild schalten. Dann das PiP-Symbol tippen oder zum Startbildschirm wechseln, wenn Bild-in-Bild aktiviert ist. Der KAA-Player auf `krussdomi.com` kann geladene WebVTT-Untertitel im nativen Video-Vollbild übernehmen. Auf älteren WebView-Versionen steht die Einbindung des Skripts in eingebettete Player-Frames erst nach einem WebView-Update zur Verfügung.
- Vollständiges Löschen der Websitedaten nutzt die Löschfunktion einer aktuellen Android System WebView. Bei älteren Versionen nennt der Dialog den verfügbaren Umfang.
