#!/bin/sh
# Does a page's video player get its video in the simulator? Opens the page in Ruhe with the
# diagnosis script on, waits, and prints what the app logged. Extra arguments switch one protection
# off, to find the one that breaks a page:
#   Scripts/video-check.sh <udid> <address> [-noLists YES] [-noPageRules YES] [-noPageScript YES]
#       [-noMediaScript YES] [-autoplay YES] [-noAgent YES] [-plainConfig YES] [-plainPolicy YES] [-logBlocked YES]
# Passes when a frame reports a video with data ("bereit 1" to "bereit 4").
udid=$1; address=$2; shift 2
app=com.nowaddlearound.ruhe
log="$(xcrun simctl get_app_container "$udid" $app data)/Documents/Ruhe-Protokoll.txt"
xcrun simctl terminate "$udid" $app 2>/dev/null

# Every switch is passed exactly once: launch arguments would otherwise stick from the last run,
# and a key given twice takes either value.
args=""
for key in noLists noPageRules noPageScript noMediaScript autoplay noAgent plain plainConfig plainPolicy logBlocked testSubtitles; do
    case " $* " in *" -$key "*) ;; *) args="$args -$key NO" ;; esac
done
case " $* " in *" -floatsVideo "*) ;; *) args="$args -floatsVideo YES" ;; esac

rm -f "$log"   # the app keeps only its last 1000 lines, so counting lines to find the new ones fails
# shellcheck disable=SC2086
xcrun simctl launch "$udid" $app -tabs '()' -lastURL "$address" -scriptlessSites '()' -logErrors YES $args "$@" >/dev/null
new() { cat "$log" 2>/dev/null; }
n=0
until new | grep -q "Videos \[bereit" || [ $n -ge 20 ]; do sleep 2; n=$((n + 1)); done
new | grep -E "REGELN|VIDEO|GEFILTERT|BLOCKIERT|LADEFEHLER|HINWEIS|Stand: [1-9]|m3u8|Fehler:|Abgelehnt" | cut -c22-330
if new | grep -q "Videos \[bereit [1-4]"; then echo "== BESTANDEN: Video hat Daten"; else echo "== ROT: Video ohne Daten"; exit 1; fi
