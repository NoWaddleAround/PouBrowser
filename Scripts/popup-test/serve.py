"""Popup and redirect test page for Ruhe.

Run `python3 Scripts/popup-test/serve.py` from the project folder, then start the app in the simulator with
`xcrun simctl launch booted com.nowaddlearound.ruhe -lastURL http://localhost:8765/index.html`.
Expected: 1, 2, 3, 4, 8 show a "blockiert" notice and the page stays; 5 and 7 load; 6 opens Maps in the
browser, not the Maps app; 9 shows the notice and still reaches page 2; 10 shows "Kalender-Datei blockiert"; 11 shows "Popup blockiert" and the page stays; 12 shows "Popup blockiert" on the first tap and reads "12 erreicht" after the second; 13 and 14 load (a tapped link and a submitted form may leave the site);
the ad script line says "blockiert".
"""
import http.server, os, time
os.chdir(os.path.dirname(os.path.abspath(__file__)))
class H(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/hop':
            self.send_response(302); self.send_header('Location', 'http://127.0.0.1:8765/ad.html'); self.end_headers()
        elif self.path == '/check':   # like a bot check: with JavaScript off for localhost the app shows a hint
            self.send_response(403); self.send_header('Content-Type', 'text/html'); self.end_headers()
        elif self.path == '/spam':
            self.send_response(200); self.send_header('Content-Type', 'text/calendar'); self.end_headers()
            self.wfile.write(b'BEGIN:VCALENDAR\nEND:VCALENDAR\n')
        elif self.path == '/page2.html':
            time.sleep(1.5); super().do_GET()   # slow, so the hijack in test 9 lands mid-load
        else: super().do_GET()
http.server.ThreadingHTTPServer(('127.0.0.1', 8765), H).serve_forever()
