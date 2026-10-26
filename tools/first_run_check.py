"""Proves that opening the app for the first time is all anybody has to do, against the REAL Firebase project and the real AV board.

    tools\\.venv\\Scripts\\python.exe tools\\first_run_check.py

Two brand-new "phones" (separate invisible Chrome profiles) open the app:
  1. one makes an account: the AV wall is downloaded and imported, and the AV board (the code in site/src/defaults.js) is joined,
     so the shared climbs are there without another tap;
  2. one taps Later: the AV wall is there, with no board; then it makes an account from code and the board is joined by itself.
The board is only READ (joining reads its climbs); nothing is written to it. The test accounts are deleted at the end.
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


APP = "const { app } = await import('/site/src/app.js');"


def js(phone, body):
    return phone.eval("(async () => { %s try { %s } catch (error) { return 'ERROR ' + (error.kind || '') + ' ' + error.message; } })()" % (APP, body))


def settings():
    config = (ROOT / "site" / "src" / "sync-config.js").read_text(encoding="utf-8")
    defaults = (ROOT / "site" / "src" / "defaults.js").read_text(encoding="utf-8")
    return re.findall(r"apiKey: '([^']+)'", config)[-1], re.findall(r"projectId: '([^']+)'", config)[-1], re.search(r"code: '([^']+)'", defaults).group(1).replace("-", "")


def post(url, body, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, data=json.dumps(body).encode(), headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read() or b"{}")


def board_climbs(api_key, project, code, password):
    """The board as an independent reader sees it: how many climbs, and which wall it says it is for."""
    name = "probe-" + "".join(random.choice(string.ascii_lowercase + string.digits) for _ in range(6))
    status, auth = post(f"https://identitytoolkit.googleapis.com/v1/accounts:signUp?key={api_key}", {"email": f"{name}@spraywall.example.com", "password": password, "returnSecureToken": True})
    if status != 200:
        raise SystemExit(f"could not make a probe account: {auth}")
    try:
        root = f"https://firestore.googleapis.com/v1/projects/{project}/databases/(default)/documents/boards/{code}"
        request = urllib.request.Request(root, headers={"Authorization": f"Bearer {auth['idToken']}"})
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                board = json.loads(response.read())
        except urllib.error.HTTPError as error:
            return None, 0, f"HTTP {error.code}"
        status, rows = post(f"{root}:runQuery", {"structuredQuery": {"from": [{"collectionId": "climbs"}], "limit": 1000}}, auth["idToken"])
        count = sum(1 for row in rows if "document" in row) if isinstance(rows, list) else -1
        return board["fields"].get("wallKey", {}).get("stringValue"), count, ""
    finally:
        post(f"https://identitytoolkit.googleapis.com/v1/accounts:delete?key={api_key}", {"idToken": auth["idToken"]})


def delete_account(phone):
    return js(
        phone,
        "const { apiKey } = app.sync.remote.config; "
        "const response = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:delete?key=' + apiKey, "
        "{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: app.sync.remote.auth.idToken }) }); return response.status;",
    )


def main():
    api_key, project, code = settings()
    ending = "".join(random.choice(string.ascii_lowercase + string.digits) for _ in range(5))
    password = "first-run-pass-1"
    wall_bits = "const w = await app.repo.getWall('av-wall'); return w ? JSON.stringify([w.name, w.holds.length]) : 'none';"
    server = Server(8096).start()
    new_phone = Browser(port=9343)
    late_phone = Browser(port=9344)
    base = "http://localhost:8096/site/?nosw=1"
    try:
        wall_key, expected, problem = board_climbs(api_key, project, code, password)
        print(f"The AV board holds {expected} climbs (its wall key says {wall_key!r}){' ' + problem if problem else ''}")
        check(wall_key in ("av-wall", "home-wall"), "the board in defaults.js exists and is for the AV wall")

        print("A brand-new phone: make an account")
        new_phone.go(base)
        started = time.time()
        new_phone.create_account(f"new-user-{ending}", password)
        print(f"       the app was ready {time.time() - started:.1f} s after creating the account")
        check(js(new_phone, wall_bits) == '["AV wall",524]', "the AV wall was downloaded and imported by itself (524 holds)")
        joined = js(new_phone, "return (await app.repo.getSyncSetup('av-wall'))?.code;")
        check(joined == code, "and the AV board was joined by itself")
        got = js(new_phone, "return (await app.repo.listClimbs('av-wall')).length;")
        check(got == expected, f"the shared climbs are already there ({got} of {expected})")
        check(new_phone.eval("document.querySelectorAll('.row').length") == expected, "and they are in the list")
        check(js(new_phone, "return (await app.repo.activeWall()).key;") == "av-wall", "the AV wall is the wall being climbed on")

        print("A brand-new phone that taps Later")
        late_phone.go(base)
        late_phone.skip_account()
        check(js(late_phone, wall_bits) == '["AV wall",524]', "the AV wall is there without an account")
        check(js(late_phone, "return await app.repo.getSyncSetup('av-wall');") is None, "but no board yet")
        late = f"late-user-{ending}"
        made = js(late_phone, "return await app.sync.signUp(%r, %r);" % (late, password))
        check(made == late, "an account made afterwards works")
        deadline = time.time() + 40
        while time.time() < deadline and js(late_phone, "return (await app.repo.getSyncSetup('av-wall'))?.code;") != code:
            time.sleep(0.5)
        check(js(late_phone, "return (await app.repo.getSyncSetup('av-wall'))?.code;") == code, "the board is joined by itself as soon as there is an account")
        deadline = time.time() + 40  # the board is remembered first, then its climbs are fetched
        while time.time() < deadline and js(late_phone, "return (await app.repo.listClimbs('av-wall')).length;") != expected:
            time.sleep(0.5)
        check(js(late_phone, "return (await app.repo.listClimbs('av-wall')).length;") == expected, "with all the shared climbs")

        print("Cleaning up")
        errors = new_phone.console_errors() + late_phone.console_errors()
        check(not errors, f"no errors in either browser ({len(errors)}) {errors[:2]}")
        check(delete_account(new_phone) == 200 and delete_account(late_phone) == 200, "the two test accounts were removed again")
    finally:
        for phone in (new_phone, late_phone):
            phone.close()
        server.stop()
    print("ALL OK" if not problems else f"{len(problems)} PROBLEM(S)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
