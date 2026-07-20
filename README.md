# Game Hub — Telegram Mini App (serverless)

A free, ad-free, no-purchase Telegram Mini App game hub. Currently features **Hokm**
(2-player and 4-player) and **Dice Duel** (2-player), with a menu ready for more games
later ("Coming soon" cards).

- Play with friends via a shareable invite link (Telegram `startapp` deep link)
- Random matchmaking with other online players
- Two small canvas mini-games (**Snake** and **Dino Run**) playable right in the waiting
  lobby so people have something to do while a match is found
- Light blue / white theme with dark mode, English + Persian UI with a language switcher
- **Fully serverless** — the entire app is static files. There is nothing to host except
  a GitHub Pages site; real-time gameplay is synced directly between players' browsers
  via Firebase (free tier)

## Project structure

```
hokm-app/
├── static/                # <-- this whole folder is what you deploy to GitHub Pages
│   ├── index.html          # Mini App UI (all screens, both games) + Firebase config
│   ├── style.css            # Light blue / white theme + dark mode
│   ├── i18n.js              # English + Persian dictionary, RTL switching
│   ├── minigames.js          # Snake & Dino Run — played while waiting in the lobby
│   ├── hokm-engine.js         # Hokm rules engine, runs in the browser (no server)
│   ├── dice-engine.js         # Dice Duel rules engine, runs in the browser
│   ├── serverless-net.js      # Firebase-backed networking (rooms, matchmaking, sync)
│   └── app.js                # Frontend logic (Telegram SDK + calls into serverless-net.js)
├── bot.py                  # Telegram bot (pyTelegramBotAPI) — launches the Mini App
├── test_serverless.js       # Automated test of the serverless flow (see below)
│
└── (legacy, optional) self-hosted backend — see "Alternative" section at the bottom:
    server.py, game_logic.py, dice_logic.py, requirements.txt, render.yaml, test_multiplayer.py
```

## How it works (no server to run!)

There's no Python backend to deploy for gameplay anymore. Instead:

- The `static/` folder is plain HTML/CSS/JS — host it anywhere that serves static files,
  e.g. **GitHub Pages** at `https://say4s.github.io/peryGame/static/`.
- Real-time state (rooms, turns, chat, matchmaking) is synced through **Firebase
  Firestore** (a free real-time database) — your browser talks to Firestore directly,
  and Firestore pushes updates to the other player's browser. No custom server involved.
- Whichever player creates a room (or is first in line for random matchmaking) becomes
  that room's **host**: their browser tab runs the actual game rules (`hokm-engine.js` /
  `dice-engine.js`) locally and writes the result to Firestore. Every other player's tab
  just reads and renders that synced state.

**Trade-offs to know about, since there's no trusted server:**
- The host's tab needs to stay open for the game to keep progressing. If the host closes
  the Mini App mid-game, that table gets stuck (nothing else can advance it). This mostly
  matters for longer Hokm hands — Dice Duel matches are short enough that it's rarely an issue.
- Firestore data for a room (including every seat's hand) is technically readable by
  anyone in that room, since there's no trusted server to keep secrets — the UI only ever
  displays your own hand, but a technical, motivated opponent could inspect it. Fine for
  casual games with friends; not cheat-proof against someone determined to peek.

If you'd rather avoid both trade-offs, see the **self-hosted backend alternative** at the
bottom of this file (a real Socket.IO server keeps hands private and doesn't depend on
any one player's browser staying open) — but it requires deploying and running a small
Python server somewhere.

## 1. Create a free Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) → **Add project**
   (the free "Spark" plan is enough for this).
2. **Build → Firestore Database → Create database** → start in **test mode** (or use the
   rules below) → pick any region.
3. **Build → Authentication → Get started → Sign-in method → Anonymous → Enable.**
   (This just gives each visitor a random, stable ID for the session — no login screen,
   no email/password needed.)
4. **Project settings (gear icon) → General → Your apps → Add app → Web (`</>`)** → register
   the app (no need for Firebase Hosting) → copy the `firebaseConfig` object it shows you.

### Recommended Firestore security rules

In **Firestore → Rules**, replace the default with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /rooms/{roomId} {
      allow read, write: if request.auth != null;
      match /{subcollection}/{docId} {
        allow read, write: if request.auth != null;
      }
    }
    match /queueEntries/{entryId} {
      allow read, write: if request.auth != null;
    }
    match /matchNotifications/{uid} {
      allow read, write: if request.auth != null;
    }
  }
}
```

This only requires that a visitor be signed in (anonymously — automatic, no login UI),
matching the casual trust model described above. Tighten further if you want.

## 2. Configure the frontend

Open `static/index.html` and fill in the `<script>` block near the bottom:

```html
<script>
  window.BOT_USERNAME = "your_bot_username";      // your bot's @username
  window.FIREBASE_CONFIG = {
    apiKey: "...",
    authDomain: "your-project.firebaseapp.com",
    projectId: "your-project",
    storageBucket: "your-project.appspot.com",
    messagingSenderId: "...",
    appId: "...",
  }; // paste the firebaseConfig object from step 1.4
</script>
```

## 3. Deploy the frontend to GitHub Pages

Push the contents of the `static/` folder to your repo (matching the path you already
have set up: `https://say4s.github.io/peryGame/static/`). That's the entire deployment —
there's no backend to stand up.

## 4. Create your Telegram bot and point it at the GitHub Pages URL

1. Message **@BotFather** on Telegram → `/newbot` → follow the prompts → copy the bot token.
2. Still with @BotFather: `/newapp` (or `/setmenubutton`) and set the Mini App URL to your
   GitHub Pages URL: `https://say4s.github.io/peryGame/static/`.

## 5. Run the bot

```bash
py -m pip install -r requirements.txt   # only pyTelegramBotAPI is needed for the bot
export BOT_TOKEN="123456:ABC-your-token"      # (Windows: set BOT_TOKEN=...)
export WEBAPP_URL="https://say4s.github.io/peryGame/static/"
py bot.py
```

The bot itself is a small always-on script (long-polling) — host it anywhere that can
keep a Python process running (a small VM, PythonAnywhere's free "Always-On Task", your
own machine, etc.). It's lightweight since it no longer needs to run any game logic.

## Verifying the serverless flow works

`test_serverless.js` simulates two independent "browser tabs" (each with their own copy
of `hokm-engine.js` / `dice-engine.js` / `serverless-net.js`) sharing an in-memory mock of
Firestore, and plays full games through the real code — no real Firebase project or
network access needed to run it:

```bash
node test_serverless.js
```

It covers, and has been run and verified to pass:
- Two players joining a Hokm room via invite code, choosing trump, and playing a full
  hand to completion with suit-following rules enforced
- Two players getting matched automatically via random matchmaking (Dice Duel), playing
  a full 3-round match to completion
- Chat messages syncing correctly between both players

## How the features map to the original request

| Requirement | Implementation |
|---|---|
| Menu to choose a game | `screen-hub` in `index.html`, Hokm + Dice Duel active, others "Coming soon" |
| Hokm: 2-player & 4-player | `hokm-engine.js` — runs client-side, no server needed |
| Dice Duel: 2-player, 3 rounds back-to-back, highest wins | `dice-engine.js` — higher roll wins each round, ties auto-replay, best of 3 wins the match |
| Invite friends via Telegram | Shareable `startapp` deep link, room created directly in Firestore |
| Random matchmaking with strangers | Firestore-transaction-based matchmaking queue in `serverless-net.js`, per game type |
| Mini-games while waiting for a match | `minigames.js` (Snake + Dino Run, canvas-based), shown in `screen-lobby`, auto-stopped once a match starts |
| Light blue / white, clean but engaging | `style.css` design tokens (`--primary`, `--bg-top`, rounded cards, soft shadows) |
| Dark mode | `style.css` `html[data-theme="dark"]` tokens + toggle button, auto-follows Telegram's theme unless overridden |
| Telegram Mini App | `telegram-web-app.js` SDK, `initDataUnsafe.user`, `expand()`, deep-link `start_param` |
| Fully serverless — nothing to host but static files | Firebase Firestore + Anonymous Auth via `serverless-net.js`; host-authoritative game logic in the browser |
| Language switcher | `i18n.js` (English/Persian) + toggle button + RTL/LTR switching |
| 100% free | No payment code, no ads, no purchases anywhere in the app; Firebase free tier is generous for casual use |

## Notes & things to extend

- **Host must stay connected**: see the trade-offs section above. A future improvement
  could add host migration (another player's tab takes over if the host disconnects
  mid-game) using Firestore's presence patterns.
- **Hand privacy**: see the trade-offs section above — this is the fundamental limitation
  of a serverless, no-trusted-backend design for a hidden-information game like Hokm.
- **Simplified dealing**: the hakem currently sees all cards before choosing trump
  (traditional Hokm deals 5 cards first). Easy to adjust in `hokm-engine.js` `startHand()`.
- **Firestore free tier limits**: generous for casual/small-scale use (50K reads + 20K
  writes/day as of writing) — fine for friends playing together, but check Firebase's
  current pricing page if you expect heavier traffic.

---

## Alternative: self-hosted backend (Socket.IO), if you'd rather not use Firebase

The original design (kept in the repo for anyone who wants it) uses a real Python
backend instead of Firebase — it keeps hands private (server-side, never sent to the
opponent) and doesn't depend on any one player's browser staying open. The trade-off is
you have to deploy and keep a small server running.

This uses: `server.py`, `game_logic.py`, `dice_logic.py`, `requirements.txt`, `render.yaml`.

1. **Install dependencies**: `pip install -r requirements.txt`
2. **Deploy the backend** — simplest path is Render, connected to your GitHub repo:
   push this folder to GitHub → [render.com](https://render.com) → **New → Blueprint** →
   **Connect GitHub** → pick the repo. Render reads the included `render.yaml`
   automatically and deploys `server.py` (free tier sleeps after inactivity, wakes on
   the next request). Any other Python host with WebSocket support works too (Railway,
   Fly.io, a VPS, etc.) — start command is `python server.py`.
3. In `static/index.html`, instead of `FIREBASE_CONFIG`, you'd point the frontend at
   `BACKEND_URL` and swap `serverless-net.js` back out for a Socket.IO client — this
   requires reverting `static/app.js`'s networking section and `index.html`'s script
   tags to the Socket.IO version (check your version history / earlier export if you
   need this path, since the current `static/` folder is wired for Firebase by default).
4. Verify with `test_multiplayer.py` (needs `requirements-dev.txt`): start `python
   server.py` in one terminal, then `python test_multiplayer.py` in another. It plays a
   full Hokm hand and a full Dice Duel match end-to-end over real Socket.IO connections.

**Scaling notes for this path**: rooms/queues live in server memory — fine for a demo,
swap in Redis/a database for production with multiple server processes. `initData`
validation (verifying Telegram's signature server-side) isn't implemented — add HMAC
verification with your bot token before trusting `user_id` in a real deployment.
