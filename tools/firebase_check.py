"""Proves accounts and shared boards work against the REAL Firebase project named in site/src/sync-config.js, with separate
(invisible) Chrome profiles standing in for phones.

    tools\\.venv\\Scripts\\python.exe tools\\firebase_check.py

It makes two new accounts (usernames with a random ending, so it can be run again), has one "phone" upload climbs and
another receive them, signs in to the first account on a second phone, and then tries to change, delete and pass off climbs
with hand-made requests, which the database's rules must refuse. Real browsers enforce the same cross-site rules a phone
does, so this also proves the database accepts requests from the app.

It removes its two test accounts again when it is done (an account can delete itself). It leaves the test board and its
climbs behind: the rules do not allow deleting climbs, and nobody has the board's code. Needs private/work/av-wall.zip and
private/my-climbs.spraywall.json.
"""
import random
import string
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
    await importWallPack(await (await fetch('/private/work/av-wall.zip')).blob(), app.repo);
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
    return JSON.stringify((await app.repo.listClimbs('av-wall')).map((c) => c.name).sort());
})()""" % APP


def js(phone, body):
    """Runs async JavaScript with `app` available; an error comes back as 'ERROR kind message'."""
    return phone.eval("(async () => { %s try { %s } catch (error) { return 'ERROR ' + (error.kind || '') + ' ' + error.message; } })()" % (APP, body))


def fetch_now(phone):
    return js(phone, "await app.sync.syncWall('av-wall'); return app.sync.stateOf('av-wall').status;")


def upload(phone, name):
    return js(phone, "const c = (await app.repo.listClimbs('av-wall')).find((c) => c.name === %r); await app.sync.upload(c.id); return 'uploaded';" % name)


def delete_account(phone):
    """Deletes the account signed in on that phone (the one thing an account may do to itself)."""
    return js(
        phone,
        "const { apiKey } = app.sync.remote.config; "
        "const response = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:delete?key=' + apiKey, "
        "{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: app.sync.remote.auth.idToken }) }); "
        "return response.status;",
    )


def main():
    config = (ROOT / "site" / "src" / "sync-config.js").read_text(encoding="utf-8")
    if "export const FIREBASE = null" in config:
        print("site/src/sync-config.js has no Firebase project in it yet.")
        return 1
    ending = "".join(random.choice(string.ascii_lowercase + string.digits) for _ in range(5))
    alex, bea, password = f"alex-{ending}", f"bea-{ending}", "check-password-1"
    server = Server(8095).start()
    you = Browser(port=9337)
    friend = Browser(port=9338)
    other_phone = Browser(port=9339)
    base = "http://localhost:8095/site/?nosw=1&nodefaults=1"
    try:
        print(f"Accounts {alex} and {bea}")
        you.go(base)
        you.create_account(alex, password)
        check(js(you, "return (await app.sync.account()).username;") == alex, f"an account was made on your phone ({alex})")
        check(js(you, "return await app.repo.authorName();") == alex, "your phone uses it as its username")
        friend.go(base)
        friend.create_account(bea, password)
        check(js(friend, "return (await app.sync.account()).username;") == bea, f"and one on the friend's phone ({bea})")
        taken = js(friend, "await app.sync.signUp(%r, 'another-password-1'); return 'made';" % alex)
        check(taken.startswith("ERROR taken"), f"a username can only be taken once ({taken.strip()[:60]})")
        wrong = js(friend, "await app.sync.signIn(%r, 'not-the-password'); return 'signed in';" % alex)
        check(wrong.startswith("ERROR credentials"), f"a wrong password is refused ({wrong.strip()[:60]})")

        for phone in (you, friend):
            phone.eval(LOAD_WALL)
        you.eval(LOAD_CLIMBS)
        check(you.eval(NAMES) == '["Circuit no circuit","Swoobap","Under the sea"]', "your phone has your 3 climbs, as drafts")
        check(js(you, "return (await app.repo.listClimbs('av-wall')).every((c) => c.author === %r);" % alex) is True, "with your username on them")

        print("Starting a board on your phone")
        code = js(you, "return await app.sync.createBoard('av-wall');")
        check(isinstance(code, str) and len(code) == 16, f"the board was made ({code if str(code).startswith('ERROR') else 'code of 16 characters'})")
        if len(str(code)) != 16:
            return 1

        print("Joining from the friend's phone: nothing is uploaded yet")
        joined = js(friend, "await app.sync.joinBoard('av-wall', %r); return app.sync.stateOf('av-wall').status;" % code)
        check(joined == "ok", f"the friend joined ({joined})")
        check(friend.eval(NAMES) == "[]", "the friend sees no climbs: drafts stay on their maker's phone")

        print("Uploading")
        check(upload(you, "Swoobap") == "uploaded", "Swoobap was uploaded")
        check(upload(you, "Circuit no circuit") == "uploaded", "Circuit no circuit was uploaded")
        check(fetch_now(friend) == "ok", "the friend checked for new climbs")
        check(friend.eval(NAMES) == '["Circuit no circuit","Swoobap"]', "the friend got exactly the two uploaded climbs")
        mine = js(you, "const c = (await app.repo.listClimbs('av-wall')).find((c) => c.name === 'Swoobap'); return JSON.stringify([c.holds, c.grade, c.comment, c.author, !!c.publishedAt]);")
        same = js(friend, "const c = (await app.repo.listClimbs('av-wall')).find((c) => c.name === 'Swoobap'); return JSON.stringify([c.holds, c.grade, c.comment, c.author, !!c.publishedAt]);")
        check(same == mine and f'"{alex}"' in same, f"the friend's copy matches, with {alex} on it")
        check("cannot be changed" in js(friend, "const c = (await app.repo.listClimbs('av-wall'))[0]; await app.repo.saveClimb({ id: c.id, wallKey: 'av-wall', name: 'x', comment: '', holds: c.holds });"), "the friend's app refuses to edit it")

        print("The same account on a second phone")
        other_phone.go(base)
        other_phone.sign_in(alex, password)
        check(js(other_phone, "return await app.repo.authorName();") == alex, "signing in with the username and password works on another phone")
        other_phone.eval(LOAD_WALL)
        joined = js(other_phone, "await app.sync.joinBoard('av-wall', %r); return app.sync.stateOf('av-wall').status;" % code)
        check(joined == "ok" and other_phone.eval(NAMES) == '["Circuit no circuit","Swoobap"]', "and it gets the climbs you uploaded, as yours")
        check(js(other_phone, "return (await app.repo.listClimbs('av-wall')).every((c) => c.author === %r);" % alex) is True, "with your username on them")

        print("What hand-made requests may do (the database's own rules)")
        raw = """
            const c = (await app.repo.listClimbs('av-wall')).find((c) => c.name === 'Swoobap');
            const { projectId } = app.sync.remote.config;
            const token = app.sync.remote.auth.idToken;
            const base = 'https://firestore.googleapis.com/v1/projects/' + projectId + '/databases/(default)/documents';
            const doc = base + '/boards/%s/climbs/' + c.id;
            const call = async (method, url, body) => (await fetch(url, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body })).status;
            const results = {
              patch: await call('PATCH', doc + '?updateMask.fieldPaths=name', JSON.stringify({ fields: { name: { stringValue: 'Hacked' } } })),
              remove: await call('DELETE', doc),
              replace: await call('POST', base + ':commit', JSON.stringify({ writes: [{ update: { name: 'projects/' + projectId + '/databases/(default)/documents/boards/%s/climbs/' + c.id, fields: { name: { stringValue: 'Hacked' } } } }] })),
            };
            const after = await (await fetch(doc, { headers: { Authorization: 'Bearer ' + token } })).json();
            return JSON.stringify({ ...results, name: after.fields.name.stringValue });
        """ % (code, code)
        result = js(friend, raw)
        check('"patch":403' in result and '"remove":403' in result and '"replace":403' in result, f"editing, deleting and replacing an uploaded climb are all refused ({result})")
        check('"name":"Swoobap"' in result, "and the climb on the board is unchanged")
        again = js(you, "const c = (await app.repo.listClimbs('av-wall')).find((c) => c.name === 'Swoobap'); return await app.sync.remote.createClimb('%s', c.id, { name: 'Again', author: %r, holds: c.holds, createdAt: Date.now() });" % (code, alex))
        check("exists" in again, f"adding the same climb again is refused ({again.strip()[:80]})")
        passing_off = js(friend, "return await app.sync.remote.createClimb('%s', 'passing-off-0001', { name: 'Not mine', author: %r, holds: '1:hand', createdAt: Date.now() });" % (code, alex))
        check("denied" in passing_off, f"{bea} cannot upload a climb under {alex}'s name")
        for label, record in (("a one-letter author", "author: 'a', holds: '1:hand'"), ("holds that are not holds", "author: %r, holds: 'nonsense'" % alex), ("a grade of 40", "author: %r, holds: '1:hand', grade: 40" % alex)):
            refused = js(you, "await app.sync.remote.createClimb('%s', 'rules-test-%s-0001', { name: 'x', %s, createdAt: Date.now() });" % (code, label.split()[1], record))
            check("denied" in refused, f"the rules refuse {label}")

        print("The friend's own climb comes the other way")
        js(friend, "await app.repo.saveClimb({ wallKey: 'av-wall', name: 'Friend climb', grade: 5, comment: 'made on the other phone', holds: '1:start,2:hand,3:finish' });")
        check(upload(friend, "Friend climb") == "uploaded", "the friend uploaded their climb")
        check(fetch_now(you) == "ok", "your phone checked for new climbs")
        names = you.eval(NAMES)
        check(names == '["Circuit no circuit","Friend climb","Swoobap","Under the sea"]', f"it arrived on your phone ({names})")
        check(f'"{bea}"' in js(you, "const c = (await app.repo.listClimbs('av-wall')).find((c) => c.name === 'Friend climb'); return JSON.stringify(c.author);"), f"with {bea}'s name on it")

        print("Ratings and sent marks stay on each phone")
        js(you, "const c = (await app.repo.listClimbs('av-wall')).find((c) => c.name === 'Swoobap'); await app.repo.setRating(c.id, 5); await app.repo.setSent(c.id);")
        fetch_now(friend)
        fetch_now(other_phone)
        for phone, who in ((friend, "the friend"), (other_phone, "your other phone")):
            seen = js(phone, "const c = (await app.repo.listClimbs('av-wall')).find((c) => c.name === 'Swoobap'); return JSON.stringify([await app.repo.getRating(c.id), await app.repo.getSentAt(c.id)]);")
            check(seen == "[0,0]", f"{who} does not get your 5 stars or your sent mark")

        print("Signing out and in")
        js(friend, "await app.sync.signOut();")
        check(js(friend, "return await app.sync.account();") is None, "signed out")
        check(js(friend, "await app.sync.syncWall('av-wall');").startswith("ERROR signin"), "and nothing can be fetched until signing in again")
        check(js(friend, "await app.sync.signIn(%r, %r); return (await app.sync.account()).username;" % (bea, password)) == bea, "signing in again works")

        print("Nothing new")
        check(fetch_now(friend) == "ok" and fetch_now(you) == "ok", "a check with nothing new works")

        errors = you.console_errors() + friend.console_errors() + other_phone.console_errors()
        check(not errors, f"no errors in any browser ({len(errors)}) {errors[:2]}")

        print("Cleaning up")
        check(delete_account(you) == 200 and delete_account(friend) == 200, "the two test accounts were removed again")
    finally:
        for phone in (you, friend, other_phone):
            phone.close()
        server.stop()
    print("ALL OK" if not problems else f"{len(problems)} PROBLEM(S)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
