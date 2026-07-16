# Game Hub — Telegram Mini App

A free, ad-free, no-purchase Telegram Mini App game hub. Currently features **Hokm**
(2-player and 4-player) and **Dice Duel** (2-player), with a menu ready for more games
later ("Coming soon" cards).

- Play with friends via a shareable invite link (Telegram `startapp` deep link)
- Random matchmaking with other online players
- Two small canvas mini-games (**Snake** and **Dino Run**) playable right in the waiting
  lobby so people have something to do while a match is found
- Light blue / white theme with dark mode, English + Persian UI with a language switcher
- Built with **pyTelegramBotAPI** (bot) + **Flask-SocketIO** (real-time game server)

## Project structure

```
hokm-app/
├── bot.py            # Telegram bot (pyTelegramBotAPI) — launches the Mini App
├── server.py         # Flask + Socket.IO backend — serves the app & runs both games
├── game_logic.py      # Hokm rules engine (deck, dealing, tricks, scoring)
├── dice_logic.py       # Dice Duel rules engine (3 rounds, back-to-back, highest wins)
├── requirements.txt
└── static/
    ├── index.html     # Mini App UI (all screens, both games)
    ├── style.css       # Light blue / white theme + dark mode
    ├── i18n.js         # English + Persian dictionary, RTL switching
    ├── minigames.js     # Snake & Dino Run — played while waiting in the lobby
    └── app.js          # Frontend logic (Telegram SDK + Socket.IO client)
```

## 1. Install dependencies

```bash
pip install -r requirements.txt
```

## 2. Create your Telegram bot

1. Message **@BotFather** on Telegram → `/newbot` → follow the prompts → copy the bot token.
2. Still with @BotFather: `/newapp` (or `/setmenubutton`) to attach a Mini App to your bot.
   You'll need an HTTPS URL for this — see step 3.

## 3. Deploy the web server (must be HTTPS)

Telegram Mini Apps require a public **HTTPS** URL. For local testing you can use a tunnel
like `ngrok`:

```bash
python server.py            # starts Flask-SocketIO on http://localhost:5000
ngrok http 5000              # gives you a public https://... URL
```

For production, deploy `server.py` behind any HTTPS-capable host (e.g. a VPS with Nginx +
Let's Encrypt, Render, Railway, Fly.io, etc.). Because it uses WebSockets, make sure your
host/proxy supports WebSocket connections.

## 4. Configure and run the bot

```bash
export BOT_TOKEN="123456:ABC-your-token"
export WEBAPP_URL="https://your-domain.example"
python bot.py
```

Also open `static/app.js` and set your bot's username so invite links work:

```js
window.BOT_USERNAME = "your_bot_username"; // add this line before app.js, e.g. in index.html
```

(Or set it as an inline `<script>` in `index.html` before `app.js` loads.)

## 5. How the features map to the original request

| Requirement | Implementation |
|---|---|
| Menu to choose a game | `screen-hub` in `index.html`, Hokm + Dice Duel active, others "Coming soon" |
| Hokm: 2-player & 4-player | `game_logic.py` `HokmGame(mode=2\|4)`, mode picker in `screen-mode` |
| Dice Duel: 2-player, 3 rounds back-to-back, highest wins | `dice_logic.py` `DiceGame` — both players roll each round, higher roll wins the round, ties auto-replay, most rounds won (best of 3) wins the match |
| Invite friends via Telegram | Shareable `startapp` deep link (`/api/create_invite` + `join_by_code`), works for both games |
| Random matchmaking with strangers | `join_random` socket event + server-side matchmaking queues, per game type |
| Mini-games while waiting for a match | `minigames.js` (Snake + Dino Run, canvas-based), shown in `screen-lobby`, auto-stopped once a match starts |
| Light blue / white, clean but engaging | `style.css` design tokens (`--primary`, `--bg-top`, rounded cards, soft shadows) |
| Dark mode | `style.css` `html[data-theme="dark"]` tokens + toggle button, auto-follows Telegram's theme unless overridden |
| Telegram Mini App | `telegram-web-app.js` SDK, `initDataUnsafe.user`, `expand()`, deep-link `start_param` |
| Language switcher | `i18n.js` (English/Persian) + toggle button + RTL/LTR switching |
| 100% free | No payment code, no ads, no purchases anywhere in the app |

## Notes & things to extend

- **In-memory state**: rooms/queues live in server memory (`rooms`, `waiting_queue` dicts in
  `server.py`). Fine for a demo/small scale; swap in Redis or a database for production
  and multiple server processes.
- **Simplified dealing**: the hakem currently sees all cards before choosing trump
  (traditional Hokm deals 5 cards first). Easy to adjust in `game_logic.py` `start_hand()`.
  if you want the exact traditional deal order.
- **`initData` validation**: for production, verify Telegram's `initData` signature
  server-side (HMAC with your bot token) before trusting `user_id` — this demo trusts the
  client-supplied id for simplicity.
- **Scaling**: `eventlet` is used as the async worker for Flask-SocketIO; for many
  concurrent tables consider a process manager (gunicorn + eventlet workers) and a shared
  message queue (Socket.IO's Redis adapter) across processes.
