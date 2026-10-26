# SprayWall

Set climbs on your spray wall from your phone. Tap the holds on a photo of the wall, give the climb a grade, and keep it as a
draft or upload it for your friends. Works on iPhone, iPad, Android and computers, costs nothing, needs no app store, and
**works with no signal** once it has been opened once.

* **The app:** https://leanderek.github.io/SprayWall/
* **The AV wall (Adrenaline Vault) and its climbs, to download:** https://leanderek.github.io/SprayWall/wall/get.html

This page has four parts: [using the app](#1-using-the-app), [how it works](#2-how-it-works),
[making a wall of your own](#3-making-a-wall-of-your-own) and [running your own copy](#4-running-your-own-copy-and-developing).
Common questions are answered at the [end](#questions).

---

## 1. Using the app

### Install it (30 seconds)

| Device | What to do |
| --- | --- |
| **iPhone / iPad** (iOS 16.4 or newer) | Open the address above in **Safari**. Tap **Share**, then **Add to Home Screen**, then **Add**. Open SprayWall from the new icon. |
| **Android** | Open the address in **Chrome**. Tap the **⋮** menu, then **Install app** (or **Add to Home screen**). |
| **Computer** | Just open the address in Chrome, Edge or Safari. (Chrome and Edge can also install it from the address bar.) |

Open it once with a connection and give it a few seconds: it saves itself on the device. From then on it opens with no signal
at all (try aeroplane mode). When a new version is out it says **A new version of SprayWall is ready**; tap **Update**.

> iPhone / iPad: use the Home Screen icon every time. Safari tabs and the Home Screen app keep **separate** data, so climbs
> made in one do not appear in the other.

### Make your account

The first time it opens, SprayWall asks you to create an account: a **username** and a **password**.

* The username is **yours alone** (nobody else can have it), 3 to 20 letters, digits, dashes or underscores, always lowercase.
  It is shown on every climb you upload.
* The password needs at least 8 characters. **There is no way to reset a lost password**, so pick one you will remember
  (a password manager helps). If you do lose it, ask the person who runs the project to delete your account; you can then
  make it again with the same username, and the climbs you uploaded count as yours again.
* The same username and password sign you in on **any** phone: on the new phone choose **I already have an account**.
* You need a connection for this step only. Everything else works offline.

### Load the wall

A **wall** is a photo of the board plus a map of where every hold is. The AV wall is ready to download:

1. On your phone open https://leanderek.github.io/SprayWall/wall/get.html and download **av-wall.zip**
   (on an iPhone it goes to the Files app).
2. In SprayWall tap the **mountain icon** (Walls), then **Import wall pack**, and choose `av-wall.zip`.
   It takes a few seconds. Your friends' climbs and your own will draw on this wall.

(The same page has `my-climbs.spraywall.json`, a few starter climbs: share icon → **From a file**.)

### Find and view climbs

* **The list** shows every climb on the wall with a picture, your stars, the grade and who set it. Search by name or comment;
  sort by newest, oldest, hardest, easiest, top rated or name.
* **Filters** narrow it by grade, by your star rating, by whose climbs (**All / My climbs / My drafts**) and by whether you have
  **sent** them.
* **Open a climb** to see it: the lit holds are the climb, the rest of the wall is dimmed. Colours: **green start**,
  **blue hand**, **purple finish**, **orange foot**.
  * Swipe **left or right** to go to the next or previous climb in your list.
  * **Pinch** to zoom, drag to move around.
  * The **eye** button shows the whole wall undimmed.
  * The **ⓘ** button shows the grade, who set it, the comment, your rating and when you sent it.
* **Rate it:** in the ⓘ panel tap the stars (tap the same star again to take it away).
* **Mark it as sent** when you have climbed it: the **Mark sent** button above the climb turns green (**✓ Sent**).
  Tap again to undo. The list shows ✓ Sent and you can filter by it.

Your ratings and sent marks are **private**: they stay on your phone and nobody else ever sees them.

### Set a climb

1. On the list tap **Set a climb**.
2. Pick a hold type at the bottom (**Start**, **Hand**, **Finish**, **Foot**), then **tap every hold** you want to be that type.
   Pick another type and keep tapping. Tap a lit hold again to unlight it; **Erase** removes holds; the **undo** arrow takes
   back your last tap; the **eye** hides the hold outlines if they get in the way.
3. Tap **Save**, give it a name, set the grade with the slider (or leave it as None), add a comment if you like, and **Save**.

A new climb is a **draft**: it lives only on your phone (the list marks it **Draft**) and you can edit or delete it whenever you
like with the pencil and bin buttons.

### Share your climbs with friends

There are two ways, and you can use either or both.

**A. Shared board (automatic, needs everyone to have an account)**

1. One person taps the **share icon**, then **Sync with friends**, then **Start a board**. They get a **board code** like
   `k7f2-9xqm-c4ta-p8dn`. **Copy** or **Share** it to friends (the code is the password to the board: only give it to people you trust).
2. Everyone else taps the share icon, **Sync with friends**, types the code under **Join a friend's board**, and taps **Join**.
3. To publish a climb, open your draft and tap **Upload**, then confirm. It goes to the board and appears on everyone's phone
   within moments. **Once a climb is uploaded nobody can edit or delete it, you included**, so check it first.
   Uploaded climbs show a small **Uploaded** tag. Only climbs you made (with your username) can be uploaded.
4. New climbs from friends arrive by themselves whenever the app is open and you have a connection (you can also tap
   **Check for new climbs** in the Sync panel).

**B. A link or a file (no account or board needed)**

* Open a climb and tap the **share** button: **Share a link**, **Copy the link** or **Share as a file**. The other person needs the
  same wall in their app. They open the link, look it over on the review screen, and tap **Import**.
* Share icon → **Share all as a file** saves everything on the wall as one file: a handy **backup**.
* To open a file or paste a link: share icon → **From a file** / **Open pasted link**.

### Good to know

* **Drafts stay on the phone they were made on.** Signing in on a new phone brings your uploaded climbs back, but not drafts,
  ratings or sent marks. Use **Share all as a file** to back up or move those.
* **iPhone and iPad can clear a web app's saved data** if the device is very short of space or the app is never opened.
  Back up now and then with **Share all as a file**.
* **iOS does not let apps work in the background**, so a phone picks up friends' new climbs the next time the app is open.
* You can leave a board with **Sync with friends → Stop syncing on this phone**. Your climbs stay. **Sign out** (share icon)
  keeps everything on the phone too, but you cannot upload or receive climbs until you sign in again.

---

## 2. How it works

### The three places things live

```
 your phone / computer                GitHub                          Firebase (Google, free plan)
 ─────────────────────                ──────                          ───────────────────────────
 the app (cached copy)   ◄── loads ── the app's files (GitHub Pages)   Authentication: accounts
 your wall (photo + holds)            the AV wall pack + starter climbs Firestore: boards and the
 your drafts and downloaded climbs    this source code and the tests     climbs people uploaded
 your ratings and sent marks          the database rules
 your sign-in, board codes
```

* **The app** is a set of plain web files (JavaScript, no frameworks, no build step, no server code of ours). GitHub Pages
  serves them; a *service worker* saves a complete copy on your device so it opens offline.
* **Your device** keeps everything personal in the browser's database (IndexedDB): the wall photo and holds, all climbs
  (drafts and uploaded), your ratings, sent marks, username and sign-in, and the codes of boards you joined.
* **Firebase** is Google's free hosting for two things only: **accounts** (usernames and passwords; Google stores the passwords
  safely, the app never sees or keeps them) and the **shared boards** (uploaded climbs).

### What is public and what is private

| | Where | Who can see it |
| --- | --- | --- |
| This source code, tests, tools, README, the database rules | GitHub (public repository) | everyone |
| The AV wall pack (`wall/av-wall.zip`, a reduced photo with no location data) and starter climbs | GitHub and the website | everyone |
| The Firebase project id and web API key (`site/src/sync-config.js`) | GitHub | everyone. They are **not secrets**: every phone running the app needs them. The rules decide who may do what |
| Accounts (usernames; passwords are held by Google) | Firebase | the project owner sees usernames; nobody sees passwords |
| Boards and uploaded climbs | Firebase | people who have the board's code |
| Drafts, ratings, sent marks, your wall copy | your device only | you |
| Working files (the original wall photo, hold-finding output, logs) | the owner's computer, `private/` (git-ignored) | the owner |

### Walls, holds and climbs

* A **wall pack** is a `.zip` with a photo and a `holds.json` (see [part 3](#3-making-a-wall-of-your-own)). Importing it saves
  the photo (shrunk to at most 2600 pixels on its long side) and the hold map on your device. Each wall has a **key** such as
  `av-wall`; importing a pack with the same key again updates that wall in place and keeps its climbs.
* A **climb** is just a list of hold numbers and what each is used for, for example `62:finish,101:hand,468:start,545:foot`,
  plus a name, grade (V0 to V17 or none), comment, author and dates. It points at holds by number, which is why hold numbers
  must never change once climbs exist.
* A climb is a **draft** (only on your device; editable) or **uploaded** (on a board; final). Climbs from friends arrive as uploaded.
* **Ratings** (1 to 5 stars) and **sent marks** are stored separately from climbs, only on your device, so they can never
  be shared by accident: they are not in links, files or boards.

### Accounts

Firebase's sign-in is built around email addresses, so your username is turned into one that **nobody can receive mail at**:
`yourname@spraywall.example.com`. Firebase refuses a second account with the same address, which is what makes usernames
unique. Nothing is ever emailed, which is also why a lost password cannot be reset. Signing in gives your phone a token that is
renewed automatically; the password is not stored.

### Boards and uploading

* A **board** belongs to one wall and is found only by its 16-character random code (about 79 bits: it cannot be guessed, and
  boards cannot be listed). Anyone who has the code and is signed in can **read** the board's climbs and **add** their own.
* **Uploading** adds one document to the board with the climb's name, grade, comment, author, holds and the time the database
  received it. The database's rules then allow **no change and no deletion** of it, by anyone.
* **Receiving**: each phone asks "anything newer than my last visit?" using the database's own clock stamps (so a phone with a
  wrong clock cannot make others miss climbs). Because uploaded climbs never change, there is nothing to merge: a climb is
  either on your phone or not. A check with nothing new costs one database read.
* The app checks a couple of seconds after anything changes, when it opens or comes back to the front, when the connection
  returns, and every two minutes while it is open.

### Security: what the database enforces

The rules in [`firebase/firestore.rules`](firebase/firestore.rules) run on Google's servers, so a hacked or hand-made copy of
the app cannot get round them. They allow only this:

* you must be signed in with a username and password (anonymous visitors are refused);
* boards can be created and read by code, never listed, changed or deleted;
* a climb can be **added** to a board, once, and the **author must be the account that adds it**: you cannot upload under
  someone else's name. It must have the right fields, types and sizes, and valid holds;
* a climb can never be updated or deleted.

This was tested against the real project with hand-made requests (see `tools/firebase_check.py`). What it cannot prevent:
someone with the board's code who is signed in can upload their own (valid) climbs to it, which is why the code is shared
only with friends. If a bad climb gets in, only the project owner can remove it, in the Firebase console.

### Offline and updates

On the first visit a service worker (`site/sw.js`) saves every file of the app. After that the app starts from the saved copy.
When a new version is published, the phone notices the changed version number, downloads it quietly, and shows **Update**; the
old version keeps running until you tap it, so the app never changes under you mid-climb. `tools/stamp.py` writes the file list and
version number; the publishing workflow runs it for you.

### Costs and limits

Everything is on free plans: GitHub Pages, and Firebase's free **Spark** plan (about 1 GiB of data, 50,000 reads and 20,000
writes per day, no card needed). A climb takes about 2.4 KB (mostly Firebase's automatic search indexes), so a board could hold
roughly 400,000 climbs. A friend group stays far below the daily limits. If a limit were ever hit, Firebase stops until the next day
and the app says so; everything local keeps working.

### Sharing format

Links and files hold the same small JSON (`spraywall-climbs`, version 1: wall key and name, then each climb's id, name,
grade, comment, author, holds, dates). Everything arriving from outside is checked and cleaned (text only, sizes limited, dates
clamped), and a link is a compressed version of the same data inside the web address, so it works without a server.

---

## 3. Making a wall of your own

A wall is **one photo** plus **a list of holds** with their positions. The app does not find holds for you; you make the pack
once, then import it on every phone.

### 1. Take the photo

* Stand square-on and as far back as you can, with the **whole board** in view and the phone held level.
* Even light, no strong shadows. Dark areas can be brightened in any photo editor.
* Crop it to the board (a little margin is fine). If the board is photographed at an angle, straighten it
  ("perspective correction") so that straight edges look straight: climbs are drawn on this picture exactly as it is.
* Any size is fine. The app shrinks it to 2600 pixels on the long side when importing.
* If the board has a sloping and a vertical part, either straighten each part and join them into one picture, or use one flat
  view; the app draws one picture.

### 2. Find the holds

You need the **centre of every hold** in pixels on the photo (and optionally its size, and its outline). Ways to get them:

* **By hand**: open the photo in any editor that shows pixel coordinates (Paint, Photoshop, GIMP, Preview, an online tool) and note the
  centre of each hold. Slow, but fine for a small wall.
* **With software**: any tool that finds blobs of colour or a segmentation model can produce them. The AV wall's 524 holds
  were found with Meta's *Segment Anything* model on the straightened photo, then cleaned up by hand in a small editor (to add
  missed holds, delete shadows, redraw bad outlines). Those tools live in the author's separate Android project, not in this
  repository, but the result is just numbers in a file, so anything that can produce a list of positions works.
* **Outlines** (optional): a polygon around each hold makes the app draw a ring that follows its shape and makes small holds easier
  to tap. Without them each hold is a circle.

### 3. Write the hold list and build the pack

Put the holds in a CSV (positions in **pixels** from the photo's top-left):

```
# x,y,r        r is the hold's radius in pixels (optional)
812,1304,38
1020,1288,30
```

and build the pack with the included tool (needs only Python):

```
python tools/make_wall_pack.py build photo.jpg holds.csv --name "My garage wall" --key my-garage-wall --angle 25 -o my-garage-wall.zip
python tools/make_wall_pack.py check my-garage-wall.zip
```

`--angle` (degrees of overhang) is optional. `--outlines outlines.json` can add outlines. `check` applies the same rules as the
app, so a pack that passes will import. The tool numbers holds 1, 2, 3 in file order unless the CSV has an `id` column.

### 4. Or write `holds.json` yourself

A wall pack is a zip containing the photo and a file named exactly `holds.json`:

```json
{
  "version": 1,
  "key": "my-garage-wall",
  "name": "My garage wall",
  "image": "wall.jpg",
  "angle": 25,
  "holds": [
    { "id": 1, "x": 0.231, "y": 0.412, "r": 0.011,
      "outline": [[0.22, 0.40], [0.24, 0.40], [0.25, 0.43]] },
    { "id": 2, "x": 0.512, "y": 0.300 }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `version` | always `1` |
| `key` | the wall's identity: letters, digits, dots, dashes, underscores (max 80). **Unique per wall, and never changed.** Defaults to the name made lowercase with dashes |
| `name` | what people see (you can rename it on each phone later) |
| `image` | the photo's file name inside the zip (JPEG or PNG) |
| `angle` | optional, degrees of overhang |
| `holds[].id` | a whole number, unique in the file. **Climbs point at holds by this number, so never renumber** |
| `holds[].x`, `y` | the hold's centre as a fraction (0 to 1) of the photo's width and height, from the top-left |
| `holds[].r` | optional radius as a fraction of the photo's **width** (0 to 0.5; default 0.02) |
| `holds[].outline` | optional list of at least 3 `[x, y]` corners (fractions) around the hold |

### 5. Import it, share it

* Import: **Walls → Import wall pack → your zip**. Check the climb drawing looks right on a few holds.
* Give friends the zip (any way you like, or host it like `wall/` in this repository) and they import it the same way.
  They must all use the **same pack**, because climbs refer to holds by number.
* **Updating a wall later** (new photo, extra holds): keep the same `key` and **keep every existing hold's `id`**; add new holds with
  new numbers and drop only holds that are really gone. Importing the new pack updates the wall in place and keeps all climbs.
* **Your own board**: once your wall is imported, **Sync with friends → Start a board** makes a board for that wall with its own
  code. See the first question below to understand where its climbs go.

---

## 4. Running your own copy and developing

You can use the public app as it is. To run an independent copy (your own address, your own accounts and database, your own
free quota):

1. **Fork** this repository on GitHub. In your fork: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
   Every push to `main` then publishes the `site` folder and the `wall` folder (`.github/workflows/pages.yml`).
2. Make a free **Firebase** project (console.firebase.google.com):
   1. Create a project (Google Analytics is not needed).
   2. **Firestore Database → Create database →** Standard edition, a location near you, **Production mode**.
   3. Firestore **Rules** tab: replace everything with [`firebase/firestore.rules`](firebase/firestore.rules) and **Publish**.
   4. **Authentication → Get started → Sign-in method → Email/Password →** enable the first toggle, **Save**.
   5. Project settings (gear) → General → Your apps → web icon `</>` → register an app. You only need the `apiKey` and `projectId`
      it shows; you can skip the install instructions (npm or script tag) and click **Continue to console**, because the app
      does not use Firebase's code library.
3. Put those two values in [`site/src/sync-config.js`](site/src/sync-config.js) and push. (Leave it `null` for an app with no accounts or
   boards: it then only asks for a local username and everything else works.)
4. Replace the files in `wall/` with your own wall pack and climbs, and the links in this README.
5. `tools/firebase_check.py` proves your project works end to end (details below).

Passwords cannot be reset (no real email addresses are used). To free a username, delete the account under
**Authentication → Users**.

### Project layout

```
site/            the app itself (this is all that is served)
  index.html, styles.css, manifest.webmanifest, sw.js (offline copy), icons/
  src/domain/    pure logic: holds, climbs, usernames, sharing format, wall packs, board codes
  src/data/      saving (IndexedDB), the database client (firestore.js), syncing (sync.js), wall import
  src/ui/        the screens
  src/sync-config.js   the Firebase project values
wall/            the AV wall pack, starter climbs and the download page
firebase/        the database rules
tests/           the tests (they run in a browser) and a fake Firebase
tools/           helper scripts (below)
.github/workflows/pages.yml   publishes the site
```

### Tools and tests

There is no Node here; the scripts run headless Chrome or Edge through a small Python helper. Create a virtual environment
in `tools/.venv` with `pip install websocket-client` first.

| Command | What it does |
| --- | --- |
| `python tools/serve.py` | try the app at http://localhost:8080/site/ (tests at /tests/). `--lan` serves only the app to your Wi-Fi |
| `tools\.venv\Scripts\python.exe tools\run_tests.py` | all unit and screen tests (95 + 35) |
| `... tools\offline_check.py` | installs the app, switches the server off, proves it still works, and tests updates |
| `... tools\share_check.py` | three separate browser profiles share a link and a file |
| `... tools\firebase_check.py` | against the **real** Firebase project: accounts, uploads, "no editing or deleting", no uploading under another name. Makes two test accounts and removes them again; leaves a test board |
| `python tools/stamp.py` | rewrites the offline file list and version (the publishing workflow also does this) |
| `python tools/make_wall_pack.py` | builds and checks wall packs (part 3) |
| `... tools\check_modules.py`, `peek_tests.py` | find a script that fails to load, or a test that hangs |

Add `?nosw` to the address to turn the offline copy off while developing and `?nosync` to turn accounts and boards off.

---

## Questions

**If someone makes their own wall, do their climbs end up in this database?**
Only if they use *this* app copy and start a board. All boards made through https://leanderek.github.io/SprayWall/ live in the
same Firebase project (the one used by this app), but each board is separate: it has its own random code, and its climbs are only
visible to people who have that code. So a stranger's climbs never appear on the AV wall board, and nothing from the AV board
appears on theirs. They do share the project's free daily limits and the accounts list. Climbs stay on the phone (and are
never sent anywhere) unless the person creates an account, starts a board and taps **Upload**. For a fully separate setup,
fork the project and use your own Firebase ([part 4](#4-running-your-own-copy-and-developing)).

**What if two different walls use the same key?**
The key is what the app uses to recognise a wall. If two people both name their pack `home-wall`, a phone treats them as the
same wall (importing one updates the other, and a board for one can be joined from the other). Give your wall a distinctive key,
for example `town-climbing-hall-wall-1`. (This is why the AV wall's key is `av-wall`; it used to be `home-wall`, and phones
and boards that still say the old name are recognised and moved automatically.)

**Why can't I delete or edit an uploaded climb?**
That is the point: a board is a permanent shared list. Draft carefully, check the climb in the viewer, and upload when you are
happy. Drafts can be edited and deleted freely.

**I lost my phone / got a new one.**
Install the app, sign in with your username and password, import the wall, and join your board again with its code. Your uploaded
climbs return. Drafts, ratings and sent marks were only on the old phone (unless you saved a backup file).

**Can I use it without an account?**
Not in the public app: every user makes an account the first time (it needs a connection once), so that every climb has a real,
unique username on it. A phone that already had a name from an earlier version can tap **Later** and carry on locally, setting, viewing,
rating and sharing climbs by file or link, but it cannot upload or receive friends' climbs until it signs in. A copy with no
Firebase project (part 4) has no accounts and only asks for a name.

**Is my data safe?**
Your climbs and ratings live on your device. Accounts and uploaded climbs are in Google's Firebase. Passwords are handled only by
Google. The code and rules are public so you can read exactly what the app and database do.
