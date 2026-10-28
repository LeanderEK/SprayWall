"""Proves that opening the app for the first time is all anybody has to do, against the REAL Firebase project and the real AV board.

    tools\\.venv\\Scripts\\python.exe tools\\first_run_check.py                                   (the app on this computer)
    tools\\.venv\\Scripts\\python.exe tools\\first_run_check.py https://leanderek.github.io/SprayWall/   (the published app)

A brand-new "phone" (an invisible Chrome profile) opens the app and is asked nothing: the AV wall is downloaded and imported, the AV
board (the code in site/src/defaults.js) is joined and its climbs arrive, all with NO account. It then makes an account (as it would to
upload) and the wall, board and climbs are still there. The board is only READ (joining reads its climbs); nothing is written to it.
The test account is deleted at the end.
"""
import json
import random
import re
import string
import sys
import time
import urllib.error
import urllib.request

from browser import ROOT, Browser, Server

OK = "  ok   "
BAD = "  FAIL "
problems = []


def check(condition, message):
    print((OK if condition else BAD) + message)
    if not condition:
        problems.append(message)


APP = "const { app } = await import('./src/app.js');"  # relative to the page, so it works on this computer and on the published site


def js(phone, body):
    return phone.eval("(async () => { %s try { %s } catch (error) { return 'ERROR ' + (error.kind || '') + ' ' + error.message; } })()" % (APP, body))


def settings():
    config = (ROOT / "site" / "src" / "sync-config.js").read_text(encoding="utf-8")
    defaults = (ROOT / "site" / "src" / "defaults.js").read_text(encoding="utf-8")
    return re.findall(r"projectId: '([^']+)'", config)[-1], re.search(r"code: '([^']+)'", defaults).group(1).replace("-", "")


def post(url, body):
    request = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read() or b"{}")


def board_climbs(project, code):
    """The board as an independent reader with NO account sees it: how many climbs, and which wall it says it is for."""
    root = f"https://firestore.googleapis.com/v1/projects/{project}/databases/(default)/documents/boards/{code}"
    try:
        with urllib.request.urlopen(urllib.request.Request(root), timeout=30) as response:
            board = json.loads(response.read())
    except urllib.error.HTTPError as error:
        return None, 0, f"HTTP {error.code}"
    status, rows = post(f"{root}:runQuery", {"structuredQuery": {"from": [{"collectionId": "climbs"}], "limit": 1000}})
    count = sum(1 for row in rows if "document" in row) if isinstance(rows, list) else -1
    return board["fields"].get("wallKey", {}).get("stringValue"), count, ""


def delete_account(phone):
    return js(
        phone,
        "const { apiKey } = app.sync.remote.config; "
        "const response = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:delete?key=' + apiKey, "
        "{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: app.sync.remote.auth.idToken }) }); return response.status;",
    )


def main():
    project, code = settings()
    ending = "".join(random.choice(string.ascii_lowercase + string.digits) for _ in range(5))
    password = "first-run-pass-1"
    wall_bits = "const w = await app.repo.getWall('av-wall'); return w ? JSON.stringify([w.name, w.holds.length]) : 'none';"
    live = sys.argv[1] if len(sys.argv) > 1 else None
    server = None if live else Server(8096).start()
    phone = Browser(port=9343)
    base = live or "http://localhost:8096/site/?nosw=1"
    try:
        wall_key, expected, problem = board_climbs(project, code)
        print(f"The AV board holds {expected} climbs (its wall key says {wall_key!r}){' ' + problem if problem else ''}")
        check(wall_key in ("av-wall", "home-wall"), "the board in defaults.js exists and is for the AV wall, and can be read with no account")

        print("A brand-new phone: nothing is asked")
        phone.go(base)
        started = time.time()
        phone.wait_for("!!document.querySelector('.bar')", seconds=60, what="the app")
        check(phone.eval("!document.querySelector('.dialog')"), "no account dialog, no question of any kind")
        deadline = time.time() + 60  # the wall is downloaded, then the board is joined, then its climbs are fetched
        while time.time() < deadline and js(phone, "return (await app.repo.listClimbs('av-wall')).length;") != expected:
            time.sleep(0.5)
        print(f"       the shared climbs were there {time.time() - started:.1f} s after opening the app")
        check(js(phone, wall_bits) == '["AV wall",525]', "the AV wall was downloaded and imported by itself (525 holds)")
        check(js(phone, "return (await app.repo.getSyncSetup('av-wall'))?.code;") == code, "and the AV board was joined by itself")
        got = js(phone, "return (await app.repo.listClimbs('av-wall')).length;")
        check(got == expected, f"the shared climbs are already there ({got} of {expected})")
        check(phone.eval("document.querySelectorAll('.row').length") == expected, "and they are in the list")
        check(js(phone, "return (await app.repo.activeWall()).key;") == "av-wall", "the AV wall is the wall being climbed on")
        check(js(phone, "return await app.sync.account();") is None, "and there is no account")

        print("Uploading is what needs an account")
        refused = js(phone, "const c = await app.repo.saveClimb({ wallKey: 'av-wall', name: 'Mine', grade: 3, comment: '', holds: '1:start,2:finish' }); return await app.sync.upload(c.id);")
        check(refused.startswith("ERROR signin"), f"a draft cannot be uploaded without one ({refused.strip()[:70]})")
        name = f"first-run-{ending}"
        made = js(phone, "return await app.sync.signUp(%r, %r);" % (name, password))
        check(made == name, "an account made afterwards works")
        check(js(phone, "return (await app.repo.getClimb((await app.repo.listClimbs('av-wall')).find((c) => c.name === 'Mine').id)).author;") == name, "the draft made before it is now the new username's")
        check(js(phone, "return (await app.repo.listClimbs('av-wall')).length;") == expected + 1, "and the board and its climbs are still there")
        check(js(phone, "return (await app.repo.getSyncSetup('av-wall'))?.code;") == code, "joined to the same board")

        print("Cleaning up")
        errors = phone.console_errors()
        check(not errors, f"no errors in the browser ({len(errors)}) {errors[:2]}")
        check(delete_account(phone) == 200, "the test account was removed again")
    finally:
        phone.close()
        if server:
            server.stop()
    print("ALL OK" if not problems else f"{len(problems)} PROBLEM(S)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
