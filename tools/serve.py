"""Serves this project for trying the app and running the tests, with no caching.

    python tools/serve.py            then open  http://localhost:8080/site/   (the app)
                                          and   http://localhost:8080/tests/  (the tests)

    python tools/serve.py --lan      lets a phone or iPad on the same Wi-Fi open the app (see below)

Only the `site` folder is ever put online. The whole project folder is served on localhost so the tests and your private
test data (in `private`) can be reached while developing; that is why this is for your own computer only.

With --lan the server listens to the home network, so it serves ONLY the app (the `site` folder). Your wall pack, photo and
climbs in `private`, and the tests, are not reachable. Even so, only do this on a network you trust, and stop it after.
A phone opening it this way can use the app but not install it or use it offline: those need the https address of a real
web host (an unencrypted address on a home network does not count as secure for that).
"""
import http.server
import json
import socket
import socketserver
import sys
from pathlib import Path

ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
LAN = "--lan" in sys.argv
PORT = int(ARGS[0]) if len(ARGS) > 0 else 8080
ROOT = Path(ARGS[1]).resolve() if len(ARGS) > 1 else Path(__file__).resolve().parent.parent  # a folder with site/ (and tests/)


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".mjs": "text/javascript", ".webmanifest": "application/manifest+json"}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        path = self.path.split("?")[0]
        if LAN:  # to the home network, only the app itself
            if path in ("", "/"):
                self.send_response(302)
                self.send_header("Location", "/site/")
                self.end_headers()
                return
            if not path.startswith("/site/"):
                self.send_error(404)
                return
        if path == "/__files":  # the tests ask which files the site holds
            site = ROOT / "site"
            names = sorted(p.relative_to(site).as_posix() for p in site.rglob("*") if p.is_file())
            body = json.dumps(names).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def log_message(self, *args):
        pass


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def lan_address() -> str:
    """This computer's address on the home network (found by asking which network card would reach the internet)."""
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.connect(("10.255.255.255", 1))
        return probe.getsockname()[0]
    except OSError:
        return "your-computer's-address"
    finally:
        probe.close()


if __name__ == "__main__":
    with Server(("0.0.0.0" if LAN else "127.0.0.1", PORT), Handler) as server:
        if LAN:
            print(f"Serving ONLY the app. On a phone or iPad on this Wi-Fi open  http://{lan_address()}:{PORT}/  (Ctrl+C to stop)", flush=True)
        else:
            print(f"Serving {ROOT} on http://localhost:{PORT}  (Ctrl+C to stop)", flush=True)
        server.serve_forever()
