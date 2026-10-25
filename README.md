# SprayWall (web version, for iPhone, iPad and anything else)

The same idea as the Android SprayWall app: pick the holds of a climb on your own wall photo, give it a grade and a
comment, browse and filter the climbs, rate them with stars. This version is a web app that you put on your Home Screen.
After the first visit **everything is saved on the device and it works with no signal**: the app, the wall photo and the climbs.

Climbs can be shared as a **link** or a **file**, and (once a Firebase project is set up, see "Shared boards" below) uploaded
to a **shared board** that friends' phones receive automatically.

Every user has an **account**: a unique username (3 to 20 lowercase letters, digits, dashes or underscores) and a password,
made the first time the app opens (with a Firebase project set up; without one the app just asks for a name). Signing in
with them works on any phone. The username goes on every climb the user makes.
A new climb is a **draft**: only on that phone, and it can be edited and deleted. Pressing **Upload** on it puts it on
the shared board, after which **nobody can edit or delete it** (the database's rules allow only adding), and the database
only accepts a climb whose author is the account that uploads it. **Star ratings** and **"sent" marks** (completed climbs)
are private: each person keeps their own on their own phone and they are never shared.

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

## Shared boards (Firebase)

Optional. A **board** is a shared set of climbs for one wall. Everyone who has the board's code can see its climbs and
upload their own.

* **Making climbs**: a new climb is a draft on your phone. Edit it, delete it, share it as a link or file, whatever you like.
* **Uploading**: open the draft, press **Upload** (top of the climb), confirm. From then on it is final: nobody can edit or
  delete it, you included, and it carries your username. Only climbs you made (with your username on them) can be uploaded.
* **Receiving**: climbs other people upload arrive on their own, a few seconds after the app opens, when the connection
  returns and every two minutes while it is open. They are final too, and show as Uploaded. (iOS does not allow background
  work, so a phone catches up when the app is next opened.)
* **Your climbs**: the Filters panel has **Show: All climbs / My climbs / My drafts**. A small "Draft" tag marks drafts.
* **Ratings**: tap the stars in a climb's info panel. They stay on your phone. The list's "Your stars" filter and the
  "Top rated" sort use your own ratings.
* **Sent (completed)**: the **Mark sent** button above a climb turns it into a green **✓ Sent**; tap again to undo. The list
  shows ✓ Sent, and Filters has **Sent: Any / Sent / Not sent yet**. Like ratings, it is only on your phone: not in files,
  not on the board, not seen by anyone else, and it does not follow your account to another phone.
* **Accounts**: the username is unique (Firebase refuses a second account with the same one) and the same on every phone you
  sign in on. Share icon → shows who is signed in and has **Sign out**. Signed out, everything local still works, but you
  cannot upload or receive climbs until you sign in again. **There is no password reset**: an account is a username and a
  password and no real email address (Firebase is given `<username>@spraywall.example.com`, which nobody can receive mail at).
  If a password is lost, the project owner deletes that account in the Firebase console (Authentication → Users) and the
  username can be made again; climbs already uploaded under that name stay and count as yours again.
* **Drafts do not follow your account**: they live on the phone they were made on. Uploading, or Share as a file, moves them.
* **The board code** is 16 random letters and digits (`k7f2-9xqm-c4ta-p8dn`); nobody can list or guess boards. It is shown
  under share icon → Sync with friends. Stopping on a phone keeps all its climbs.
* A board belongs to one wall (its key, `home-wall`); a phone can only join a board for a wall it has.
* Only climbs go on the board (name, grade, comment, author, holds). Not the wall photo, not ratings.
* Existing climbs from before usernames and ratings are kept: they take your username, and their old star counts became your
  own ratings. If something is wrong with a climb you uploaded, only the project owner can remove it, in the Firebase console
  (Firestore Database → Data).

The shared database stamps each climb with its own clock, so a phone with a wrong clock cannot make others miss climbs.

Size: a typical climb is about 350 bytes of data plus about 2 KB of automatic indexes, roughly 2.4 KB (Google's size rules),
so the free 1 GiB holds around 400,000 climbs. Switching the indexes off for the fields that are never searched would shrink
that to about 0.6 KB, which is not worth the clicking. The free daily limits (50,000 reads, 20,000 writes) matter more, and a
friend group stays far below them: joining a board reads each climb once, then a check with nothing new costs one read.

### Setting up the Firebase project (once, free, about 10 minutes)

1. Go to console.firebase.google.com and sign in with a Google account. Create a project (name it SprayWall; Google
   Analytics is not needed, switch it off).
2. **Firestore**: Databases & Storage (or Build) → Firestore → Create database → Standard edition → pick a location near
   you → **Production mode** → Create.
3. **Rules**: Firestore → Rules tab → replace everything with the contents of `firebase/firestore.rules` → Publish.
4. **Sign-in**: Authentication → Get started → Sign-in method → **Email/Password** → switch on the first toggle
   (**Enable**, not "Email link") → Save. This is what usernames and passwords use. (Anonymous is not needed any more.)
5. **The app's two values**: Project settings (gear) → General → Your apps → the web icon `</>` → give it a nickname →
   Register app (leave Hosting off). The config shows `apiKey` and `projectId`.
6. Put them in `site/src/sync-config.js` (replace `null`), run the tests, push. The share icon then has "Sync with friends".
7. Prove it against the real project: `tools\.venv\Scripts\python.exe tools\firebase_check.py` (it makes two test accounts
   with random names and leaves them, a test board and a few climbs behind; delete the accounts in Authentication → Users).

If the rules in `firebase/firestore.rules` ever change, paste the new ones into the console again (step 3).

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
