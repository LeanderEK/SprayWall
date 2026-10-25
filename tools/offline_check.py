"""Proves the app works with no connection, and that updates arrive, using a real (invisible) Chrome.

    tools\\.venv\\Scripts\\python.exe tools\\offline_check.py

Part 1: open the app, let it save itself, load your wall and climbs, then STOP THE SERVER and reload. The app, the wall
photo and the climbs must all still be there, and a climb must open and draw.
Part 2: change a file of a throwaway copy of the site, and check the app offers the update, takes it when told to, and
never reloads by itself when first installed.
"""
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from browser import ROOT, Browser, Server

OK = "  ok   "
BAD = "  FAIL "
problems = []


def check(condition, message):
    print((OK if condition else BAD) + message)
    if not condition:
        problems.append(message)


def part_one():
    print("Part 1: offline")
    server = Server(8092).start()
    browser = Browser()
    try:
        base = "http://localhost:8092"
        browser.go(f"{base}/site/")
        browser.eval("window.__loadedOnce = true")
        saved = browser.wait_for(
            """(async () => {
                const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 8000))]);
                if (!reg) return '';
                const keys = await caches.keys();
                if (!keys.length) return '';
                const count = (await (await caches.open(keys[0])).keys()).length;
                return count >= 20 ? JSON.stringify({ keys, count, state: reg.active.state }) : '';
            })()""",
            seconds=25, what="the service worker to save the app",
        )
        info = json.loads(saved)
        check(info["state"] == "activated", f"the service worker is active ({info['count']} files saved)")
        sw_text = (ROOT / "site" / "sw.js").read_text(encoding="utf-8")
        listed = len(json.loads(sw_text.split("const ASSETS = ")[1].split("];")[0] + "]"))
        check(info["count"] == listed, f"every file on the list was saved ({info['count']} of {listed})")
        browser.eval("new Promise((r) => setTimeout(r, 1500))")
        check(browser.eval("window.__loadedOnce === true"), "the page did not reload by itself when the worker took over")

        # Load the real wall pack and climbs, the way the app's own buttons do.
        browser.eval(
            """(async () => {
                const { app } = await import('/site/src/app.js');
                const { importWallPack } = await import('/site/src/data/wallimport.js');
                const { parseShare } = await import('/site/src/domain/share.js');
                await importWallPack(await (await fetch('/private/work/home-wall.zip')).blob(), app.repo);
                const text = await (await fetch('/private/my-climbs.spraywall.json')).text();
                const plan = await app.repo.planImport(parseShare(text));
                await app.repo.applyImport(plan);
                return true;
            })()"""
        )
        browser.wait_for("document.querySelectorAll('.row').length === 3", what="three climbs in the list")
        check(True, "online: wall and 3 climbs loaded, list shows them")

        # Now switch the server off for real.
        server.stop()
        down = browser.eval(
            """fetch('/__files', { cache: 'no-store' }).then(() => 'still reachable', () => 'unreachable')"""
        )
        check(down == "unreachable", f"the server is really off ({down})")

        browser.go(f"{base}/site/")
        rows = browser.wait_for("document.querySelectorAll('.row').length", seconds=20, what="the list to appear offline")
        check(rows == 3, f"offline: the app opened from the phone's copy and shows {rows} climbs")
        check(browser.eval("document.querySelector('.bar-name').textContent") == "Home wall", "offline: the wall's name is there")
        thumbs = browser.wait_for(
            """(() => { const c = document.querySelector('canvas.thumb'); if (!c) return 0;
                const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0;
                for (let i = 0; i < d.length; i += 4 * 17) if (d[i + 3] > 0 && d[i] + d[i + 1] + d[i + 2] > 60) n++; return n; })()""",
            seconds=15, what="a climb picture to be drawn",
        )
        check(thumbs > 50, f"offline: the wall photo drew in the list (not blank), {thumbs} bright samples")

        # Open a climb, offline, by its address; typing an address of your own must open the app too.
        browser.eval("document.querySelector('.row').click()")
        first = browser.wait_for("location.hash.startsWith('#/climb/') ? location.hash : ''", what="the climb to open")
        check(first.startswith("#/climb/"), f"offline: tapping a climb opens it ({first[:20]}...)")
        browser.wait_for("document.querySelectorAll('.slide canvas').length === 3", what="the viewer")
        browser.eval("document.querySelectorAll('.wallview')[1].wallView.renderNow()")
        painted = browser.eval(
            """(() => { const c = document.querySelectorAll('.slide canvas')[1]; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
                let n = 0, t = 0; for (let i = 0; i < d.length; i += 4 * 61) { t++; if (d[i + 3] > 0) n++; } return n / t; })()"""
        )
        check(painted > 0.5, f"offline: the climb is drawn on the wall ({painted:.2f} of the picture painted)")
        browser.go(f"{base}/site/index.html?typed=by-hand")
        check(browser.wait_for("document.querySelectorAll('.row').length", what="the app at a hand-typed address") == 3, "offline: an address typed by hand still opens the app")
        errors = browser.console_errors()
        check(not errors, f"no uncaught errors in the page ({len(errors)})")
    finally:
        browser.close()
        server.stop()


def part_two():
    print("Part 2: updates")
    work = Path(tempfile.mkdtemp(prefix="spraywall-update-"))
    shutil.copytree(ROOT / "site", work / "site")
    stamp = ROOT / "tools" / "stamp.py"
    subprocess.run([sys.executable, str(stamp), str(work / "site")], check=True, capture_output=True)
    server = Server(8093, work).start()
    browser = Browser()
    try:
        base = "http://localhost:8093"
        browser.go(f"{base}/site/")
        first = browser.wait_for(
            "(async () => { const k = await caches.keys(); return k.length ? k[0] : ''; })()", seconds=25, what="the first version to be saved"
        )
        check(first.startswith("spraywall-"), f"first version saved as {first}")
        browser.eval("new Promise((r) => setTimeout(r, 1500))")

        # A new version of the site appears on the server.
        (work / "site" / "styles.css").write_text((work / "site" / "styles.css").read_text(encoding="utf-8") + "\n/* a change */\n", encoding="utf-8")
        subprocess.run([sys.executable, str(stamp), str(work / "site")], check=True, capture_output=True)
        browser.go(f"{base}/site/")
        toast = browser.wait_for("document.querySelector('.toast') ? document.querySelector('.toast').textContent : ''", seconds=25, what="the update message")
        check("new version" in toast.lower(), f"the app offers the update: \"{toast}\"")
        still_old = browser.eval("(async () => (await caches.keys()).join(','))()")
        check(first in still_old and still_old.count("spraywall-") == 2, "the new version waits; the old one is still in use until you tap Update")
        browser.eval("document.querySelector('.toast-action').click()")
        browser.wait_for("(async () => { const k = await caches.keys(); return k.length === 1 && k[0] !== '%s'; })()" % first, seconds=25, what="the update to take over")
        css = browser.wait_for("fetch('/site/styles.css').then((r) => r.text()).then((t) => t.includes('a change'))", what="the new styles")
        check(css, "after tapping Update the app is running the new version, and the old copy is gone")
    finally:
        browser.close()
        server.stop()
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    part_one()
    part_two()
    print("ALL OK" if not problems else f"{len(problems)} PROBLEM(S)")
    sys.exit(1 if problems else 0)
