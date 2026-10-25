# SprayWall (web version, for iPhone, iPad and anything else)

The same idea as the Android SprayWall app: pick the holds of a climb on your own wall photo, give it a grade, stars and a
comment, browse and filter your climbs. This version is a web app that you put on your Home Screen. After the first
visit **everything is saved on the device and it works with no signal**: the app, the wall photo and the climbs.

Climbs are shared as a **link** or a **file**. Nothing is uploaded anywhere. (Automatic sync through a free online
service is stage 2 and is not built yet.)

Your Android app is separate and untouched. The two apps do not talk to each other, but the same climbs can be moved
between them by file (see "Moving your Android climbs").

## What goes online and what does not

The app itself (the **`site`** folder) holds no wall photo, no hold map and no climbs.

The wall pack and the climbs are in the **`wall`** folder of this repository, on purpose and public (the owner said that
is fine): `wall/home-wall.zip` (photo and 524 holds) and `wall/my-climbs.spraywall.json`. The publish step also puts them
on the live site, with a small download page at `https://leanderek.github.io/SprayWall/wall/get.html`. They are not
saved with the app for offline use; you load them into the app once per device from a file.

The working copies stay in `private/` (`private/work/home-wall.zip`, `private/my-climbs.spraywall.json`, not in the
repository). When you export a new wall pack or a newer climbs file, copy it over the one in `wall/` and push.
`private/` also holds the hand-editing and test files that are never published.

## 1. Put the app on the internet (once)

The app has to come from an `https://` address the first time, because that is what lets a phone save it for offline
use. After that first visit the phone no longer needs the address.

Any free static web host will do. The two easiest:

**GitHub Pages** (how this project is set up: github.com/LeanderEK/SprayWall)
1. The whole project is in the repository (a free account needs it to be public; the wall pack and climbs in `wall/` are public too, on purpose).
   `.github/workflows/pages.yml` publishes the `site` folder and the `wall` downloads.
2. Once: repository Settings → Pages → Build and deployment → Source: **GitHub Actions**.
3. Every push to `main` publishes again (Actions tab shows the progress). The app is at
   `https://leanderek.github.io/SprayWall/`.

**Netlify (drag and drop)**: go to app.netlify.com/drop and drag the `site` folder onto the page. It gives you an
address straight away. Cloudflare Pages has the same kind of upload.

Check the host's current free terms before relying on it; they change.

## 2. Install it on each device

**iPhone / iPad**: open the address in **Safari** → Share button → **Add to Home Screen** → Add. Open it from the
Home Screen icon from then on.
**Android**: open the address in Chrome → menu → **Install app** (or Add to Home screen).

Open it once with a connection and let it sit for a few seconds so it can save itself. After that, turn on aeroplane
mode and open it again to check: it should start, with no connection.

## 3. Load the wall and your climbs (once per device)

1. Open `https://leanderek.github.io/SprayWall/wall/get.html` on the device and download both files (or send them
   over by AirDrop, a message to yourself, a cable: whatever you like).
2. In the app: mountain icon (Walls) → **Import wall pack** → choose `home-wall.zip`. It takes a few seconds.
3. On the list: share icon → **From a file** → choose `my-climbs.spraywall.json`.

A friend does the same with the wall pack you give them. Then you can send them climbs.

## Sharing climbs

* **One climb**: open it → share icon → **Share a link** (the phone's share sheet: Messages, WhatsApp, etc.), **Copy
  the link**, or **Share as a file**.
* **All climbs** (also a backup): list → share icon → **Share all as a file**.
* **Opening one**: tap the link, or open the file from the share icon → **From a file**. The app shows a review screen
  first (New / Newer than yours / You already have this / You have a newer version / You deleted this one) and nothing is added until you press Import. Importing the same
  climb twice does not double it, and a changed climb replaces the older copy.
* A link carries the whole climb inside it (about 400 characters), so it works with no internet. The other person must
  have the same wall loaded.

**iPhone caveat**: a link tapped in Messages opens in **Safari**, and Safari keeps its own separate copy of the app's
data, apart from the Home Screen app. So with the Home Screen app: copy the link, open the app, share icon → paste it
under "Or paste a link". Files and pasted links always land in the app you are in.

## Moving your Android climbs

`private/my-climbs.spraywall.json` holds the 3 climbs from your Android app. To make a fresh one later, copy
`spraywall.db` (with its `-wal` and `-shm` files) off the phone into a folder, then run:

```
python tools/convert_android_climbs.py <that folder>
```

It only reads the copy. Each climb always gets the same id, so importing again never doubles anything up.

## Sync with friends (Firebase)

Optional. Phones that join the same **board** keep the climbs of a wall the same, automatically: new, edited and deleted
climbs. Everything still works with no connection; changes are sent, and friends' changes fetched, whenever the app is open
and online (a couple of seconds after you change something, when you open the app, and every two minutes while it is open).
iOS does not allow apps to sync in the background, so a phone catches up when the app is next opened.

Only the climbs sync (name, grade, stars, comment, who set it, holds). The wall photo does not: everyone loads the wall pack
once. A board belongs to one wall (its key, `home-wall`), and a phone can only join a board for a wall it has.

**The board code is the password.** It is 16 random letters and digits (`k7f2-9xqm-c4ta-p8dn`); nobody can list or guess
boards. Whoever has the code can see, add, change and delete the climbs on the board, so give it only to friends. The app
shows it under share icon → Sync with friends. Stopping sync on a phone keeps its climbs.

How a merge works: for each climb the newer change wins. A climb that was deleted stays on the board as a small marker, so a
phone that was offline cannot bring it back (unless someone edited it after the deletion, which wins). The shared database
stamps every change with its own clock, so a phone with a wrong clock cannot make others miss changes.

### Setting up the Firebase project (once, free, about 10 minutes)

1. Go to console.firebase.google.com and sign in with a Google account. Create a project (name it SprayWall; Google
   Analytics is not needed, switch it off).
2. **Firestore**: Databases & Storage (or Build) → Firestore → Create database → Standard edition → pick a location near
   you → **Production mode** → Create.
3. **Rules**: Firestore → Rules tab → replace everything with the contents of `firebase/firestore.rules` → Publish.
4. **Sign-in**: Authentication → Get started → Sign-in method → **Anonymous** → Enable → Save. (Nobody types a password;
   this only gives each phone a token the database asks for.)
5. **The app's two values**: Project settings (gear) → General → Your apps → the web icon `</>` → give it a nickname →
   Register app (leave Hosting off). The config shows `apiKey` and `projectId`.
6. Put them in `site/src/sync-config.js` (replace `null`), run the tests, push. The share icon then has "Sync with friends".
7. Prove it against the real project: `tools\.venv\Scripts\python.exe tools\firebase_check.py` (leaves one test board).

The two values are not secrets (every phone running the app has them); the rules decide who may do what. GitHub may email a
warning about a Google API key in the repository; for a Firebase web key that is expected. To tighten it further, in Google
Cloud console → APIs & Services → Credentials, restrict that key to the website `https://leanderek.github.io/*`.

Free plan limits (Spark): about 1 GiB stored, 50,000 reads and 20,000 writes per day; no card is needed. A friend group stays
far below that (a sync that finds nothing new costs one read). If the daily limit were ever reached the database would stop
until the next day; the app says so and keeps working offline.

## Updating the app

After changing anything in `site`, commit and push to `main`. The publish step runs `python tools/stamp.py` itself, so
the offline file list and version number are always right on the live site. Phones that have the app notice the new
version, show "A new version of SprayWall is ready" with an **Update** button, and switch when you tap it.

With another host (Netlify and the like) run `python tools/stamp.py` yourself first, then upload the `site` contents;
without it phones never see the change, and the test page will say so.

## Things to know on iPhone / iPad

* Needs iOS / iPadOS **16.4 or newer** (older ones cannot open the wall pack or compressed links).
* **Back up**: Apple can clear a website's saved data if the device is very short of space or the app is not opened for
  a long time. Use "Share all as a file" now and then and keep the file somewhere safe. Keep your wall pack too.
* The Home Screen app and Safari keep separate data (see above).
* Not yet tried on a real iPhone or iPad: it was tested in desktop Chrome with phone screen sizes and touch gestures.
  Report anything odd.

## Trying it before it is online

```
python tools/serve.py          the app at http://localhost:8080/site/ and the tests at http://localhost:8080/tests/
python tools/serve.py --lan    the same, but a phone or iPad on your Wi-Fi can open the address it prints
```

`--lan` serves only the app, not your private files, but use it only on a network you trust and stop it after. A device
opening it this way **cannot install the app or use it offline** (that needs https); it is for looking and trying.

Add `?nosw` to the address while developing to switch the offline copy off so that edited files show up at once.

## Checks

```
tools\.venv\Scripts\python.exe tools\run_tests.py       the unit and screen tests (needs Chrome or Edge)
tools\.venv\Scripts\python.exe tools\offline_check.py   installs the app, stops the server, proves it still works
tools\.venv\Scripts\python.exe tools\share_check.py     three separate "phones" share a link and a file
```

## How it is built

Plain JavaScript modules, no build step and no libraries, so there is nothing to install or keep up to date.
`site/src/domain` is the logic (holds, grades, sharing format, merge rules), `site/src/data` is saving (IndexedDB) and
importing, `site/src/ui` is the screens, `site/sw.js` is the offline copy. The wall pack and share formats are
described at the top of `domain/wallpack.js` and `domain/share.js`.
