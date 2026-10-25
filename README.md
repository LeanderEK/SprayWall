# SprayWall (web version, for iPhone, iPad and anything else)

The same idea as the Android SprayWall app: pick the holds of a climb on your own wall photo, give it a grade, stars and a
comment, browse and filter your climbs. This version is a web app that you put on your Home Screen. After the first
visit **everything is saved on the device and it works with no signal**: the app, the wall photo and the climbs.

Climbs are shared as a **link** or a **file**. Nothing is uploaded anywhere. (Automatic sync through a free online
service is stage 2 and is not built yet.)

Your Android app is separate and untouched. The two apps do not talk to each other, but the same climbs can be moved
between them by file (see "Moving your Android climbs").

## What goes online and what does not

Only the **`site`** folder is ever put online. It is the app itself: no wall photo, no hold map, no climbs.

Your wall photo and holds live in `private/work/home-wall.zip` and your climbs in `private/my-climbs.spraywall.json`.
Those stay on your computer (the `private` folder is not part of the site). You load them into the app on each device
yourself, once, from a file. Do not put them in the same place you host the app.

## 1. Put the app on the internet (once)

The app has to come from an `https://` address the first time, because that is what lets a phone save it for offline
use. After that first visit the phone no longer needs the address.

Any free static web host will do. The two easiest:

**GitHub Pages** (how this project is set up: github.com/LeanderEK/SprayWall)
1. The whole project is in the repository (a free account needs it to be public; it holds no wall photo or climbs).
   `.github/workflows/pages.yml` publishes only the `site` folder.
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

1. Get `home-wall.zip` onto the device (AirDrop, Files, a message to yourself, a cable: whatever you like).
2. In the app: mountain icon (Walls) → **Import wall pack** → choose the zip. It takes a few seconds.
3. Get a climbs file onto the device, then on the list: share icon → **From a file**.

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
