"""Drives a real Chrome (or Edge) with no window, so the app and its tests can be checked from the command line.

It starts the browser with its "remote debugging" door open and talks to it over a web socket (the Chrome DevTools
Protocol). Nothing here touches your own browser profile: each run uses a throwaway one.
"""
import json
import os
import shutil
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

import websocket

CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]
ROOT = Path(__file__).resolve().parent.parent


def find_browser() -> str:
    for path in CANDIDATES:
        if os.path.exists(path):
            return path
    raise SystemExit("No Chrome or Edge found.")


class Browser:
    def __init__(self, port: int = 9333, width: int = 390, height: int = 844):
        self.profile = tempfile.mkdtemp(prefix="spraywall-browser-")
        self.process = subprocess.Popen(
            [find_browser(), "--headless=new", f"--remote-debugging-port={port}", f"--user-data-dir={self.profile}",
             "--no-first-run", "--no-default-browser-check", "--disable-gpu", f"--window-size={width},{height}", "about:blank"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        self.port = port
        deadline = time.time() + 20
        while True:
            try:
                targets = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=2))
                page = next(t for t in targets if t["type"] == "page")
                break
            except Exception:
                if time.time() > deadline:
                    self.close()
                    raise SystemExit("Chrome did not start.")
                time.sleep(0.3)
        self.ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=90, suppress_origin=True)
        self.next_id = 0
        self.events = []
        self.call("Page.enable")
        self.call("Runtime.enable")
        self.call("Log.enable")

    def call(self, method: str, **params):
        self.next_id += 1
        mine = self.next_id
        self.ws.send(json.dumps({"id": mine, "method": method, "params": params}))
        while True:
            message = json.loads(self.ws.recv())
            if message.get("id") == mine:
                if "error" in message:
                    raise RuntimeError(f"{method}: {message['error']}")
                return message.get("result", {})
            self.events.append(message)

    def eval(self, expression: str):
        """Runs JavaScript in the page (waiting for a promise if it gives one) and returns the value."""
        result = self.call("Runtime.evaluate", expression=expression, awaitPromise=True, returnByValue=True)
        if "exceptionDetails" in result:
            details = result["exceptionDetails"]
            raise RuntimeError(details.get("exception", {}).get("description") or details.get("text"))
        return result["result"].get("value")

    def go(self, url: str, wait: float = 15.0):
        self.call("Page.navigate", url=url)
        deadline = time.time() + wait
        while time.time() < deadline:
            try:
                if self.eval("document.readyState") == "complete":
                    return
            except RuntimeError:
                pass
            time.sleep(0.2)
        raise RuntimeError(f"{url} did not finish loading")

    def wait_for(self, expression: str, seconds: float = 20.0, what: str = ""):
        deadline = time.time() + seconds
        last = None
        while time.time() < deadline:
            try:
                last = self.eval(expression)
                if last:
                    return last
            except RuntimeError as error:
                last = str(error)
            time.sleep(0.25)
        raise RuntimeError(f"timed out waiting for {what or expression} (last: {last})")

    def choose_username(self, name: str = "Tester"):
        """A fresh app asks for a username before it shows anything; this answers the question."""
        self.wait_for("!!document.querySelector('.dialog input')", what="the username question")
        self.eval(
            "(() => { const input = document.querySelector('.dialog input'); input.value = %r; "
            "[...document.querySelectorAll('.dialog button')].find((b) => b.textContent === 'Continue').click(); return true; })()" % name
        )
        self.wait_for("!document.querySelector('.dialog') && !!document.querySelector('.bar')", what="the app after choosing a username")

    _FILL = "const set = (label, value) => { const input = [...document.querySelectorAll('.dialog input')].find((i) => i.getAttribute('aria-label') === label); input.value = value; };"

    def create_account(self, name: str, password: str = "test-password-1"):
        """Answers the account dialog of a fresh app (the one shown when a Firebase project is set up) by making an account."""
        self.wait_for("!![...document.querySelectorAll('.dialog input')].find((i) => i.getAttribute('aria-label') === 'Username')", what="the account question")
        self.eval(
            "(() => { " + self._FILL + " set('Username', %r); set('Password', %r); set('Password again', %r); "
            "document.querySelector('.dialog button[type=submit]').click(); return true; })()" % (name, password, password)
        )
        self.wait_for("!document.querySelector('.dialog') && !!document.querySelector('.bar')", what="the app after creating the account")

    def skip_account(self):
        """Answers the account dialog of a fresh app by tapping Later."""
        self.wait_for("!![...document.querySelectorAll('.dialog button')].find((b) => b.textContent === 'Later')", what="the Later button")
        self.eval("(() => { [...document.querySelectorAll('.dialog button')].find((b) => b.textContent === 'Later').click(); return true; })()")
        self.wait_for("!document.querySelector('.dialog') && !!document.querySelector('.bar')", what="the app after Later")

    def sign_in(self, name: str, password: str = "test-password-1"):
        """Answers the account dialog of a fresh app by signing in to an account that already exists."""
        self.wait_for("!![...document.querySelectorAll('.dialog input')].find((i) => i.getAttribute('aria-label') === 'Username')", what="the account question")
        self.eval(
            "(() => { [...document.querySelectorAll('.dialog button')].find((b) => b.textContent === 'I already have an account').click(); "
            + self._FILL + " set('Username', %r); set('Password', %r); document.querySelector('.dialog button[type=submit]').click(); return true; })()" % (name, password)
        )
        self.wait_for("!document.querySelector('.dialog') && !!document.querySelector('.bar')", what="the app after signing in")

    def console_errors(self):
        out = []
        for event in self.events:
            if event.get("method") == "Runtime.exceptionThrown":
                out.append(event["params"]["exceptionDetails"].get("exception", {}).get("description", "error"))
        return out

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass
        self.process.terminate()
        try:
            self.process.wait(timeout=10)
        except Exception:
            self.process.kill()
        shutil.rmtree(self.profile, ignore_errors=True)


class Server:
    """The project's own little web server (tools/serve.py), on its own port so it can be stopped and started."""

    def __init__(self, port: int, root: Path = ROOT):
        self.port = port
        self.root = root
        self.process = None

    def start(self):
        self.process = subprocess.Popen(
            [os.sys.executable, str(ROOT / "tools" / "serve.py"), str(self.port), str(self.root)],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        deadline = time.time() + 10
        while time.time() < deadline:
            try:
                urllib.request.urlopen(f"http://localhost:{self.port}/", timeout=1)
                return self
            except urllib.error.HTTPError:
                return self
            except Exception:
                time.sleep(0.2)
        raise RuntimeError("the server did not start")

    def stop(self):
        if self.process:
            self.process.terminate()
            self.process.wait(timeout=10)
            self.process = None
