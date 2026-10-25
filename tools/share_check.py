"""Proves sharing works between two separate phones, using two real (invisible) Chrome profiles: one is "you", one is "a friend".

    tools\\.venv\\Scripts\\python.exe tools\\share_check.py

A link is made from one of your climbs, opened on the friend's phone, reviewed and imported; then your whole set goes
across as a file; then a link is opened on a phone that does not have the wall yet.
"""
import sys

from browser import Browser, Server

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


def main():
    server = Server(8094).start()
    you = Browser(port=9334)
    friend = Browser(port=9335)
    stranger = Browser(port=9336)
    base = "http://localhost:8094/site/?nosw=1"
    try:
        for phone in (you, friend, stranger):
            phone.go(base)
        you.eval(LOAD_WALL)
        you.eval(LOAD_CLIMBS)
        friend.eval(LOAD_WALL)
        check(you.eval("document.querySelectorAll('.row').length") == 3, "your phone has 3 climbs")
        check(friend.eval("document.querySelectorAll('.row').length") == 0, "the friend's phone has the wall but no climbs")

        print("A link to one climb")
        link = you.eval(
            """(async () => {
                const { app } = await import('/site/src/app.js');
                const { makeShare, packShare, linkFor } = await import('/site/src/domain/share.js');
                const wall = await app.repo.getWall('home-wall');
                const climb = (await app.repo.listClimbs('home-wall')).find((c) => c.name === 'Swoobap');
                return linkFor('https://example.github.io/spraywall/', await packShare(makeShare(wall, [climb])));
            })()"""
        )
        print(f"       the link is {len(link)} characters long")
        check(len(link) < 800, "the link is short enough for any messaging app")
        local_link = link.replace("https://example.github.io/spraywall/", "http://localhost:8094/site/?nosw=1")
        friend.go(local_link)
        friend.wait_for("document.querySelector('.bar-name') && document.querySelector('.bar-name').textContent === 'Import climbs'", what="the review screen")
        check(friend.eval("document.querySelector('.row-name').textContent") == "Swoobap", "the friend sees the climb, named Swoobap")
        check(friend.eval("document.querySelector('.badge').textContent") == "New", "it is marked New")
        check(friend.eval("document.querySelector('.import-preview canvas') !== null"), "a preview of the climb on the wall is shown")
        friend.eval("[...document.querySelectorAll('button')].find((b) => b.textContent.startsWith('Import')).click()")
        friend.wait_for("location.hash.startsWith('#/climb/')", what="the imported climb to open")
        check(friend.eval("document.querySelector('.bar-name').textContent") == "Swoobap", "after Import the climb opens")
        same = friend.eval(
            """(async () => {
                const { app } = await import('/site/src/app.js');
                const mine = (await app.repo.listClimbs('home-wall'))[0];
                return JSON.stringify({ holds: mine.holds, grade: mine.grade, stars: mine.stars, comment: mine.comment });
            })()"""
        )
        original = you.eval(
            """(async () => {
                const { app } = await import('/site/src/app.js');
                const mine = (await app.repo.listClimbs('home-wall')).find((c) => c.name === 'Swoobap');
                return JSON.stringify({ holds: mine.holds, grade: mine.grade, stars: mine.stars, comment: mine.comment });
            })()"""
        )
        check(same == original, "the friend's copy has exactly the same holds, grade, stars and comment")

        print("Opening the same link again")
        friend.go(local_link)
        friend.wait_for("!!document.querySelector('.badge')", what="the review screen again")
        check(friend.eval("document.querySelector('.badge').textContent") == "You already have this", "it says the friend already has it, so nothing doubles up")
        check(friend.eval("[...document.querySelectorAll('button')].find((b) => b.textContent.startsWith('Nothing new')).disabled"), "and the Import button is switched off")

        print("Everything, as a file")
        text = you.eval(
            """(async () => {
                const { app } = await import('/site/src/app.js');
                const { makeShare, shareToText } = await import('/site/src/domain/share.js');
                return shareToText(makeShare(await app.repo.getWall('home-wall'), await app.repo.listClimbs('home-wall')));
            })()"""
        )
        friend.go(base)
        friend.eval("(async () => { window.__file = null; })()")
        friend.eval(
            "(async () => { const { importFiles } = await import('/site/src/ui/sharing.js'); await importFiles([new File([%s], 'all.spraywall.json')]); })()" % __import__("json").dumps(text)
        )
        friend.wait_for("document.querySelectorAll('.badge').length === 3", what="three climbs to review")
        badges = friend.eval("JSON.stringify([...document.querySelectorAll('.badge')].map((b) => b.textContent).sort())")
        check(badges == '["New","New","You already have this"]', f"the file shows 2 new and the one already imported ({badges})")
        friend.eval("[...document.querySelectorAll('button')].find((b) => b.textContent.startsWith('Import')).click()")
        friend.wait_for("document.querySelectorAll('.row').length === 3", what="the list with 3 climbs")
        check(True, "after importing, the friend's list has all 3 climbs")

        print("A link on a phone that has no wall yet")
        stranger.go(local_link)
        stranger.wait_for("!!document.querySelector('.banner.warn')", what="the warning")
        check("not on this phone yet" in stranger.eval("document.querySelector('.banner.warn').textContent"), "it explains the wall is missing")
        check(stranger.eval("[...document.querySelectorAll('button')].filter((b) => b.textContent.startsWith('Import')).every((b) => b.disabled)"), "and nothing can be imported")

        print("A pasted link")
        friend.go(base)
        friend.eval(
            "(async () => { const { importPasted } = await import('/site/src/ui/sharing.js'); await importPasted('Try this one! ' + %s + ' it is hard'); })()" % __import__("json").dumps(local_link)
        )
        friend.wait_for("!!document.querySelector('.badge')", what="the review screen from a paste")
        check(friend.eval("document.querySelector('.row-name').textContent") == "Swoobap", "pasting a link inside a chat message still opens the climb")

        errors = you.console_errors() + friend.console_errors() + stranger.console_errors()
        check(not errors, f"no uncaught errors on any phone ({len(errors)})")
    finally:
        for phone in (you, friend, stranger):
            phone.close()
        server.stop()
    print("ALL OK" if not problems else f"{len(problems)} PROBLEM(S)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
