"""Proves the shared boards work against the REAL Firebase project named in site/src/sync-config.js, with two separate
(invisible) Chrome profiles standing in for two phones.

    tools\\.venv\\Scripts\\python.exe tools\\firebase_check.py

It makes a new board (a random code that only this run knows), has one "phone" upload climbs and the other receive them,
and then tries to change and delete an uploaded climb with hand-made requests, which the database's rules must refuse.
Real browsers enforce the same cross-site rules a phone does, so this also proves the database accepts requests from the app.

It leaves the test board and its climbs in the database (the rules do not allow deleting): a handful of small documents that
nobody has the code for. Needs private/work/home-wall.zip and private/my-climbs.spraywall.json.
"""
import sys

from browser import ROOT, Browser, Server

OK = "  ok   "
BAD = "  FAIL "
problems = []


def check(condition, message):
    print((OK if condition else BAD) + message)
    if not condition:
        problems.append(message)


APP = "const { app } = await import('/site/src/app.js');"

LOAD_WALL = """(async () => {
    %s
    const { importWallPack } = await import('/site/src/data/wallimport.js');
    await importWallPack(await (await fetch('/private/work/home-wall.zip')).blob(), app.repo);
    return true;
})()""" % APP

LOAD_CLIMBS = """(async () => {
    %s
    const { parseShare } = await import('/site/src/domain/share.js');
    const text = await (await fetch('/private/my-climbs.spraywall.json')).text();
    await app.repo.applyImport(await app.repo.planImport(parseShare(text)));
    return true;
})()""" % APP

NAMES = """(async () => {
    %s
    return JSON.stringify((await app.repo.listClimbs('home-wall')).map((c) => c.name).sort());
})()""" % APP


def js(phone, body):
    """Runs async JavaScript with `app` available; an error comes back as 'ERROR message'."""
    return phone.eval("(async () => { %s try { %s } catch (error) { return 'ERROR ' + (error.kind || '') + ' ' + error.message; } })()" % (APP, body))


def fetch_now(phone):
    return js(phone, "await app.sync.syncWall('home-wall'); return app.sync.stateOf('home-wall').status;")


def upload(phone, name):
    return js(phone, "const c = (await app.repo.listClimbs('home-wall')).find((c) => c.name === %r); await app.sync.upload(c.id); return 'uploaded';" % name)


def main():
    config = (ROOT / "site" / "src" / "sync-config.js").read_text(encoding="utf-8")
    if "export const FIREBASE = null" in config:
        print("site/src/sync-config.js has no Firebase project in it yet.")
        return 1
    server = Server(8095).start()
    you = Browser(port=9337)
    friend = Browser(port=9338)
    base = "http://localhost:8095/site/?nosw=1"
    try:
        for phone, name in ((you, "Alex"), (friend, "Bea")):
            phone.go(base)
            phone.choose_username(name)
            phone.eval(LOAD_WALL)
        you.eval(LOAD_CLIMBS)
        check(js(you, "return app.sync.available;") is True, "the app has the Firebase project (sync is available)")
        check(you.eval(NAMES) == '["Circuit no circuit","Swoobap","Under the sea"]', "your phone has your 3 climbs, as drafts")

        print("Starting a board on your phone")
        code = js(you, "return await app.sync.createBoard('home-wall');")
        check(isinstance(code, str) and len(code) == 16, f"the board was made ({code if str(code).startswith('ERROR') else 'code of 16 characters'})")
        if len(str(code)) != 16:
            return 1
        check(js(you, "return app.sync.stateOf('home-wall').status;") == "ok", "the board is ready")

        print("Joining from the friend's phone: nothing is uploaded yet")
        joined = js(friend, "await app.sync.joinBoard('home-wall', %r); return app.sync.stateOf('home-wall').status;" % code)
        check(joined == "ok", f"the friend joined ({joined})")
        check(friend.eval(NAMES) == "[]", "the friend sees no climbs: drafts stay on their maker's phone")

        print("Uploading")
        check(upload(you, "Swoobap") == "uploaded", "Swoobap was uploaded")
        check(upload(you, "Circuit no circuit") == "uploaded", "Circuit no circuit was uploaded")
        check(js(you, "const c = (await app.repo.listClimbs('home-wall')).find((c) => c.name === 'Swoobap'); return !!c.publishedAt;") is True, "it is marked uploaded on your phone")
        check(fetch_now(friend) == "ok", "the friend checked for new climbs")
        check(friend.eval(NAMES) == '["Circuit no circuit","Swoobap"]', "the friend got exactly the two uploaded climbs")
        same = js(friend, "const c = (await app.repo.listClimbs('home-wall')).find((c) => c.name === 'Swoobap'); return JSON.stringify([c.holds, c.grade, c.comment, c.author, !!c.publishedAt]);")
        mine = js(you, "const c = (await app.repo.listClimbs('home-wall')).find((c) => c.name === 'Swoobap'); return JSON.stringify([c.holds, c.grade, c.comment, c.author, !!c.publishedAt]);")
        check(same == mine and '"Alex"' in same, f"the friend's copy matches, with Alex's name on it ({same})")
        check("cannot be changed" in js(friend, "const c = (await app.repo.listClimbs('home-wall'))[0]; await app.repo.saveClimb({ id: c.id, wallKey: 'home-wall', name: 'x', comment: '', holds: c.holds });"), "the friend's app refuses to edit it")
        check("cannot be deleted" in js(friend, "const c = (await app.repo.listClimbs('home-wall'))[0]; await app.repo.deleteClimb(c.id);"), "and to delete it")

        print("What hand-made requests may do (the database's own rules)")
        raw = """
            const c = (await app.repo.listClimbs('home-wall')).find((c) => c.name === 'Swoobap');
            const { apiKey, projectId } = app.sync.remote.config;
            const token = app.sync.remote.auth.idToken;
            const doc = 'https://firestore.googleapis.com/v1/projects/' + projectId + '/databases/(default)/documents/boards/%s/climbs/' + c.id;
            const call = async (method, url, body) => (await fetch(url, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body })).status;
            const results = {
              patch: await call('PATCH', doc + '?updateMask.fieldPaths=name', JSON.stringify({ fields: { name: { stringValue: 'Hacked' } } })),
              remove: await call('DELETE', doc),
              replace: await call('POST', 'https://firestore.googleapis.com/v1/projects/' + projectId + '/databases/(default)/documents:commit', JSON.stringify({ writes: [{ update: { name: 'projects/' + projectId + '/databases/(default)/documents/boards/%s/climbs/' + c.id, fields: { name: { stringValue: 'Hacked' } } } }] })),
            };
            const after = await (await fetch(doc, { headers: { Authorization: 'Bearer ' + token } })).json();
            return JSON.stringify({ ...results, name: after.fields.name.stringValue });
        """ % (code, code)
        result = js(friend, raw)
        check('"patch":403' in result and '"remove":403' in result and '"replace":403' in result, f"editing, deleting and replacing an uploaded climb are all refused ({result})")
        check('"name":"Swoobap"' in result, "and the climb on the board is unchanged")
        again = js(you, "const c = (await app.repo.listClimbs('home-wall')).find((c) => c.name === 'Swoobap'); return await app.sync.remote.createClimb(app.sync.remote.config && '%s', c.id, { name: 'Again', author: 'Alex', holds: c.holds, createdAt: Date.now() });" % code)
        check("exists" in again, f"adding the same climb again is refused ({again.strip()[:80]})")
        for label, record in (("a one-letter author", "author: 'A', holds: '1:hand'"), ("holds that are not holds", "author: 'Alex', holds: 'nonsense'"), ("a grade of 40", "author: 'Alex', holds: '1:hand', grade: 40")):
            refused = js(you, "await app.sync.remote.createClimb('%s', 'rules-test-%s-0001', { name: 'x', %s, createdAt: Date.now() });" % (code, label.split()[1], record))
            check("denied" in refused, f"the rules refuse {label}")

        print("The friend's own climb comes the other way")
        js(friend, "await app.repo.saveClimb({ wallKey: 'home-wall', name: 'Friend climb', grade: 5, comment: 'made on the other phone', holds: '1:start,2:hand,3:finish' });")
        check(upload(friend, "Friend climb") == "uploaded", "the friend uploaded their climb")
        check(fetch_now(you) == "ok", "your phone checked for new climbs")
        names = you.eval(NAMES)
        check(names == '["Circuit no circuit","Friend climb","Swoobap","Under the sea"]', f"it arrived on your phone ({names})")
        check('"Bea"' in js(you, "const c = (await app.repo.listClimbs('home-wall')).find((c) => c.name === 'Friend climb'); return JSON.stringify(c.author);"), "with Bea's name on it")

        print("Ratings stay on each phone")
        js(you, "const c = (await app.repo.listClimbs('home-wall')).find((c) => c.name === 'Swoobap'); await app.repo.setRating(c.id, 5);")
        fetch_now(friend)
        check(js(friend, "const c = (await app.repo.listClimbs('home-wall')).find((c) => c.name === 'Swoobap'); return await app.repo.getRating(c.id);") == 0, "the friend does not get your 5 stars")

        print("Nothing new")
        check(fetch_now(friend) == "ok" and fetch_now(you) == "ok", "a check with nothing new works")

        errors = you.console_errors() + friend.console_errors()
        check(not errors, f"no errors in either browser ({len(errors)}) {errors[:2]}")
    finally:
        for phone in (you, friend):
            phone.close()
        server.stop()
    print("ALL OK" if not problems else f"{len(problems)} PROBLEM(S)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
