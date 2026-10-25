"""Loads every JavaScript module of the site and the tests in a real browser and says which ones fail to load.

    tools\\.venv\\Scripts\\python.exe tools\\check_modules.py
"""
import sys
from pathlib import Path

from browser import ROOT, Browser, Server


def main():
    server = Server(8098).start()
    browser = Browser(port=9341)
    bad = 0
    try:
        browser.go("http://localhost:8098/tests/harness.js")
        files = sorted(p for folder in ("site", "tests") for p in (ROOT / folder).rglob("*.js") if p.name not in ("sw.js", "sw-minimal.js"))
        for path in files:
            url = "/" + path.relative_to(ROOT).as_posix()
            answer = browser.eval("import(%r).then(() => 'ok', (e) => 'ERROR ' + e.message)" % url)
            if answer != "ok":
                bad += 1
                print(f"{url}: {answer}")
        print("all modules load" if not bad else f"{bad} module(s) failed")
    finally:
        browser.close()
        server.stop()
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
