"""Proves sync works against the REAL Firebase project named in site/src/sync-config.js, with two separate (invisible)
Chrome profiles standing in for two phones.

    tools\\.venv\\Scripts\\python.exe tools\\firebase_check.py

It makes a new board (with a random code that only this run knows), puts your wall and 3 climbs on one "phone", joins
from the other, and checks that new, edited and deleted climbs cross in both directions. Real browsers enforce the same
cross-site rules a phone does, so this also proves the database accepts requests from the app's own address.

It leaves the test board behind in the database (the rules do not allow deleting): a handful of small documents that
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


LOAD_WALL = """(async () => {
    const { app } = await import('/site/src/app.js');
    const { importWallPack } = await import('/site/src/data/wallimport.js');
    await importWallPack(await (await fetch('/private/work/home-wall.zip')).blob(), app.repo);
    return true;
})()"""

LOAD_CLIMBS = """(async () => {
    const { app } = await import('/site/src/app.js');
    const { parseShare } = await import('/site/src/domain/share.js');
    const text = await (await fetch('/private/my-climbs.spraywall.json')).text();
    await app.repo.applyImport(await app.repo.planImport(parseShare(text)));
    return true;
})()"""

NAMES = """(async () => {
    const { app } = await import('/site/src/app.js');
    return JSON.stringify((await app.repo.listClimbs('home-wall')).map((c) => c.name).sort());
})()"""


def sync_now(phone):
    """Syncs and returns the state afterwards (an error shows up as the message)."""
    return phone.eval(
        """(async () => {
            const { app } = await import('/site/src/app.js');
            try { await app.sync.syncWall('home-wall'); } catch (error) { return 'ERROR ' + error.message; }
            return app.sync.stateOf('home-wall').status;
        })()"""
    )


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
        for phone in (you, friend):
            phone.go(base)
            phone.eval(LOAD_WALL)
        you.eval(LOAD_CLIMBS)
        check(you.eval("(async () => { const { app } = await import('/site/src/app.js'); return app.sync.available; })()") is True, "the app has the Firebase project (sync is available)")

        print("Starting a board on your phone")
        code = you.eval(
            """(async () => {
                const { app } = await import('/site/src/app.js');
                try { return await app.sync.createBoard('home-wall'); } catch (error) { return 'ERROR ' + error.message; }
            })()"""
        )
        check(isinstance(code, str) and not code.startswith("ERROR") and len(code) == 16, f"the board was made ({code if str(code).startswith('ERROR') else 'code of 16 characters'})")
        if problems:
            return 1
        state = you.eval("(async () => { const { app } = await import('/site/src/app.js'); const s = app.sync.stateOf('home-wall'); return s.status + ' ' + s.message; })()")
        check(state.startswith("ok"), f"your 3 climbs were sent ({state})")

        print("Joining from the friend's phone")
        joined = friend.eval(
            """(async () => {
                const { app } = await import('/site/src/app.js');
                try { await app.sync.joinBoard('home-wall', %r); } catch (error) { return 'ERROR ' + error.message; }
                return app.sync.stateOf('home-wall').status;
            })()""" % code
        )
        check(joined == "ok", f"the friend joined and synced ({joined})")
        check(friend.eval(NAMES) == you.eval(NAMES), "the friend has the same 3 climbs")
        same = friend.eval(
            """(async () => {
                const { app } = await import('/site/src/app.js');
                const c = (await app.repo.listClimbs('home-wall')).find((c) => c.name === 'Swoobap');
                return JSON.stringify([c.holds, c.grade, c.stars, c.comment]);
            })()"""
        ) == you.eval(
            """(async () => {
                const { app } = await import('/site/src/app.js');
                const c = (await app.repo.listClimbs('home-wall')).find((c) => c.name === 'Swoobap');
                return JSON.stringify([c.holds, c.grade, c.stars, c.comment]);
            })()"""
        )
        check(same, "Swoobap has exactly the same holds, grade, stars and comment")

        print("A new climb on the friend's phone, an edit and a deletion on yours")
        friend.eval(
            """(async () => {
                const { app } = await import('/site/src/app.js');
                await app.repo.saveClimb({ wallKey: 'home-wall', name: 'Friend climb', grade: 5, stars: 4, comment: 'made on the other phone', holds: '1:start,2:hand,3:finish' });
                return true;
            })()"""
        )
        check(sync_now(friend) == "ok", "the friend's new climb was sent")
        check(sync_now(you) == "ok", "your phone synced")
        check("Friend climb" in you.eval(NAMES), "the new climb arrived on your phone")
        you.eval(
            """(async () => {
                const { app } = await import('/site/src/app.js');
                const all = await app.repo.listClimbs('home-wall');
                const mine = all.find((c) => c.name === 'Circuit no circuit');
                await app.repo.saveClimb({ ...mine, name: 'Circuit renamed' });
                await app.repo.deleteClimb(all.find((c) => c.name === 'Under the sea').id);
                return true;
            })()"""
        )
        check(sync_now(you) == "ok", "your edit and deletion were sent")
        check(sync_now(friend) == "ok", "the friend's phone synced")
        names = friend.eval(NAMES)
        check(names == '["Circuit renamed","Friend climb","Swoobap"]', f"the edit and the deletion arrived ({names})")

        print("Nothing new")
        check(sync_now(friend) == "ok", "a sync with nothing new works")

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
