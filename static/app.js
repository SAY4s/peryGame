// ===== Telegram Web App bootstrap =====
const tg = window.Telegram ? window.Telegram.WebApp : null;
if (tg) {
  tg.ready();
  tg.expand();
}

const tgUser = (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) || {
  id: "guest_" + Math.floor(Math.random() * 100000),
  first_name: "Guest",
};

document.getElementById("userNameLabel").textContent = tgUser.first_name || "Guest";
document.getElementById("userAvatar").textContent = (tgUser.first_name || "G")[0].toUpperCase();

// Declared early so applyTheme() (called immediately below) can safely reference it.
let currentMiniGame = null;

// ===== Theme (light / dark) =====
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("theme", theme);
  const btn = document.getElementById("themeToggle");
  if (btn) btn.textContent = theme === "dark" ? "☀️" : "🌙";
  if (currentMiniGame && currentMiniGame.render) {
    // slight delay so the new CSS variables are committed before we read them
    requestAnimationFrame(() => currentMiniGame.render());
  }
}

const savedTheme = localStorage.getItem("theme");
const tgColorScheme = tg && tg.colorScheme; // "light" | "dark", set by the Telegram client
applyTheme(savedTheme || tgColorScheme || "light");

document.getElementById("themeToggle").addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme");
  applyTheme(current === "dark" ? "light" : "dark");
});

if (tg && tg.onEvent) {
  // Follow Telegram's own theme changes unless the user picked one manually here
  tg.onEvent("themeChanged", () => {
    if (!localStorage.getItem("theme")) applyTheme(tg.colorScheme || "light");
  });
}

// ===== How to play modal =====
const howtoOverlay = document.getElementById("howtoOverlay");
const howtoTitleEl = document.getElementById("howtoTitle");
const howtoStepsEl = document.getElementById("howtoSteps");

function openHowTo(titleKey, stepsKey) {
  howtoTitleEl.textContent = t(titleKey);
  howtoStepsEl.innerHTML = "";
  (DICT[currentLang][stepsKey] || []).forEach((step) => {
    const li = document.createElement("li");
    li.textContent = step;
    howtoStepsEl.appendChild(li);
  });
  howtoOverlay.classList.add("show");
}

document.getElementById("btnHowtoHokm").addEventListener("click", () => {
  openHowTo("hokm_howto_title", "hokm_howto_steps");
});
document.getElementById("btnHowtoDice").addEventListener("click", () => {
  openHowTo("dice_howto_title", "dice_howto_steps");
});
document.getElementById("howtoClose").addEventListener("click", () => {
  howtoOverlay.classList.remove("show");
});
howtoOverlay.addEventListener("click", (e) => {
  if (e.target === howtoOverlay) howtoOverlay.classList.remove("show");
});

// ===== Screen navigation =====
function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

document.querySelectorAll("[data-back]").forEach((el) => {
  el.addEventListener("click", () => showScreen(el.getAttribute("data-back")));
});

document.getElementById("langToggle").addEventListener("click", () => {
  applyLang(currentLang === "en" ? "fa" : "en");
});
applyLang(currentLang);

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2200);
}

// ===== Mini-games while waiting in the lobby =====
const minigameCanvas = document.getElementById("minigameCanvas");
const minigameOverlay = document.getElementById("minigameOverlay");
const minigameOverlayText = document.getElementById("minigameOverlayText");
const minigameScoreEl = document.getElementById("minigameScore");
const minigameHintEl = document.getElementById("minigameHint");
const tabSnakeEl = document.getElementById("tabSnake");
const tabDinoEl = document.getElementById("tabDino");

let currentMiniGameType = null;
let miniGameRunning = false;

const MINIGAME_HINT_KEY = { snake: "minigame_hint_snake", dino: "minigame_hint_dino" };

function loadMiniGame(type) {
  if (currentMiniGame) currentMiniGame.destroy();
  currentMiniGameType = type;
  miniGameRunning = false;

  tabSnakeEl.classList.toggle("active", type === "snake");
  tabDinoEl.classList.toggle("active", type === "dino");
  minigameHintEl.setAttribute("data-i18n", MINIGAME_HINT_KEY[type]);
  minigameHintEl.textContent = t(MINIGAME_HINT_KEY[type]);
  minigameScoreEl.textContent = "0";

  currentMiniGame = window.MiniGames[type](minigameCanvas, {
    onScore: (score) => { minigameScoreEl.textContent = score; },
    onGameOver: (score) => {
      miniGameRunning = false;
      minigameOverlayText.setAttribute("data-i18n", "minigame_game_over");
      minigameOverlayText.textContent = `${t("minigame_game_over")} (${score})`;
      minigameOverlay.classList.add("show");
    },
  });

  minigameOverlayText.setAttribute("data-i18n", "minigame_tap_start");
  minigameOverlayText.textContent = t("minigame_tap_start");
  minigameOverlay.classList.add("show");
}

function startMiniGameFromOverlay() {
  if (!currentMiniGame || miniGameRunning) return;
  miniGameRunning = true;
  minigameOverlay.classList.remove("show");
  currentMiniGame.start();
}

minigameOverlay.addEventListener("click", startMiniGameFromOverlay);
tabSnakeEl.addEventListener("click", () => loadMiniGame("snake"));
tabDinoEl.addEventListener("click", () => loadMiniGame("dino"));

function stopMiniGames() {
  if (currentMiniGame) currentMiniGame.destroy();
  currentMiniGame = null;
  miniGameRunning = false;
  minigameOverlay.classList.remove("show");
}

// ===== Game hub =====
let currentGameType = "hokm";

document.getElementById("cardHokm").addEventListener("click", () => {
  currentGameType = "hokm";
  showScreen("screen-mode");
});
document.getElementById("cardDice").addEventListener("click", () => {
  currentGameType = "dice";
  showScreen("screen-dice-options");
});
document.querySelectorAll(".game-card.locked").forEach((el) => {
  el.addEventListener("click", () => toast(t("select_a_game")));
});

// ===== Mode selection =====
let selectedMode = 4;
function selectMode(mode) {
  selectedMode = mode;
  document.getElementById("modeCard2").classList.toggle("selected", mode === 2);
  document.getElementById("modeCard4").classList.toggle("selected", mode === 4);
}
document.getElementById("modeCard2").addEventListener("click", () => selectMode(2));
document.getElementById("modeCard4").addEventListener("click", () => selectMode(4));
selectMode(4);

// ===== Socket.io connection =====
// BACKEND_URL lets this static frontend (e.g. on GitHub Pages) talk to a game server
// hosted elsewhere. Falls back to same-origin if not set (useful for local dev where
// server.py also serves the static files itself).
const BACKEND_URL = (window.BACKEND_URL && window.BACKEND_URL !== "https://your-backend.example.com")
  ? window.BACKEND_URL
  : "";
const socket = io(BACKEND_URL || undefined);
let roomId = null;
let mySeat = null;
let gameMode = 4;

socket.on("connected", () => console.log("connected to server"));

// --- create invite (play with friends) ---
async function createInvite(gameType, mode, inviteBoxId) {
  const res = await fetch(`${BACKEND_URL}/api/create_invite`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ game_type: gameType, mode }),
  });
  const data = await res.json();
  roomId = data.room_id;
  gameMode = data.mode;
  currentGameType = data.game_type;

  const botUsername = window.BOT_USERNAME || "@peryGamebot"; // set at deploy time
  const link = `https://t.me/${botUsername}/app?startapp=${roomId}`;
  const box = document.getElementById(inviteBoxId);
  box.style.display = "block";
  box.textContent = link;

  navigator.clipboard && navigator.clipboard.writeText(link).then(() => toast(t("copied")));

  joinRoom(roomId);
}

document.getElementById("btnCreateInvite").addEventListener("click", () => {
  createInvite("hokm", selectedMode, "inviteBox");
});
document.getElementById("btnCreateInviteDice").addEventListener("click", () => {
  createInvite("dice", 2, "inviteBoxDice");
});

// --- random matchmaking ---
document.getElementById("btnRandom").addEventListener("click", () => {
  currentGameType = "hokm";
  gameMode = selectedMode;
  socket.emit("join_random", {
    game_type: "hokm",
    mode: selectedMode,
    user_id: tgUser.id,
    name: tgUser.first_name || "Player",
  });
  showLobby(selectedMode, 1);
});

document.getElementById("btnRandomDice").addEventListener("click", () => {
  currentGameType = "dice";
  gameMode = 2;
  socket.emit("join_random", {
    game_type: "dice",
    mode: 2,
    user_id: tgUser.id,
    name: tgUser.first_name || "Player",
  });
  showLobby(2, 1);
});

function joinRoom(id) {
  socket.emit("join_by_code", {
    room_id: id,
    user_id: tgUser.id,
    name: tgUser.first_name || "Player",
  });
  showLobby(gameMode, 1);
}

// auto-join if launched via invite link (?tgWebAppStartParam= or startapp=)
(function checkStartParam() {
  const params = new URLSearchParams(window.location.search);
  const startParam =
    (tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param) || params.get("startapp");
  if (startParam) {
    roomId = startParam;
    joinRoom(roomId);
  }
})();

let lobbyMiniGameLoaded = false;

function showLobby(mode, filled) {
  const wasActive = document.getElementById("screen-lobby").classList.contains("active");
  showScreen("screen-lobby");
  const row = document.getElementById("seatsRow");
  row.innerHTML = "";
  for (let i = 0; i < mode; i++) {
    const d = document.createElement("div");
    d.className = "seat-slot" + (i < filled ? " filled" : "");
    d.textContent = i < filled ? "🙂" : "?";
    row.appendChild(d);
  }
  if (!wasActive || !lobbyMiniGameLoaded) {
    loadMiniGame("snake");
    lobbyMiniGameLoaded = true;
  }
}

document.getElementById("btnCancelLobby").addEventListener("click", () => {
  stopMiniGames();
  lobbyMiniGameLoaded = false;
  showScreen(currentGameType === "dice" ? "screen-dice-options" : "screen-mode");
});

socket.on("joined", (data) => {
  roomId = data.room_id;
  mySeat = data.seat;
  gameMode = data.mode;
  currentGameType = data.game_type || currentGameType;
});

socket.on("lobby_update", (data) => {
  showLobby(data.mode, data.players.length);
});

socket.on("queued", () => {
  // waiting for match
});

socket.on("error_msg", (data) => {
  toast(data.message);
});

// ===== Game state rendering =====
const SUIT_ICON = { hearts: "♥", diamonds: "♦", clubs: "♣", spades: "♠" };
const RED_SUITS = new Set(["hearts", "diamonds"]);

function rankLabel(rank) {
  if (rank === 11) return "J";
  if (rank === 12) return "Q";
  if (rank === 13) return "K";
  if (rank === 14) return "A";
  return String(rank);
}

let latestState = null;

socket.on("game_state", (state) => {
  latestState = state;
  currentGameType = state.game_type || currentGameType;
  stopMiniGames();
  lobbyMiniGameLoaded = false;
  document.getElementById("chatToggle").style.display = "flex";
  if (state.game_type === "dice") {
    showScreen("screen-dice-game");
    renderDice(state);
  } else {
    showScreen("screen-game");
    renderGame(state);
  }
});

function renderGame(state) {
  gameMode = state.mode;

  // score
  document.getElementById("scoreInfo").textContent =
    `${state.round_scores[0]} – ${state.round_scores[1]}`;

  // trump chip
  const trumpChip = document.getElementById("trumpChip");
  if (state.trump) {
    trumpChip.style.display = "flex";
    const icon = document.getElementById("trumpIcon");
    icon.textContent = SUIT_ICON[state.trump];
    icon.style.color = RED_SUITS.has(state.trump) ? "var(--danger)" : "var(--ink)";
  } else {
    trumpChip.style.display = "none";
  }

  // opponent seats (all seats except mine)
  const oppSeats = document.getElementById("oppSeats");
  oppSeats.innerHTML = "";
  state.players.forEach((p) => {
    if (p.seat === state.your_seat) return;
    const chip = document.createElement("div");
    chip.className = "opp-chip" + (state.turn_seat === p.seat ? " active-turn" : "");
    chip.innerHTML = `<div class="opp-avatar">${(p.name || "?")[0]}</div><div>${p.name} (${state.hand_counts[p.seat] || 0})</div>`;
    oppSeats.appendChild(chip);
  });

  // trump chooser
  const chooser = document.getElementById("trumpChooser");
  const trickArea = document.getElementById("trickArea");
  if (state.phase === "choosing_trump") {
    if (state.hakem_seat === state.your_seat) {
      chooser.style.display = "block";
      trickArea.style.display = "none";
    } else {
      chooser.style.display = "none";
      trickArea.style.display = "grid";
      trickArea.innerHTML = `<div class="center-note">${t("turn_note_wait")}</div>`;
    }
  } else {
    chooser.style.display = "none";
    trickArea.style.display = "grid";
    trickArea.className = "trick-area mode" + state.mode;
    trickArea.innerHTML = "";
    state.current_trick.forEach((play) => {
      trickArea.appendChild(makeCardEl(play.suit, play.rank));
    });
  }

  // turn note
  const note = document.getElementById("turnNote");
  if (state.phase === "playing") {
    note.textContent = state.turn_seat === state.your_seat ? t("turn_note_you") : t("turn_note_wait");
  } else {
    note.textContent = "";
  }

  // hand
  const handStrip = document.getElementById("handStrip");
  handStrip.innerHTML = "";
  const isMyTurn = state.phase === "playing" && state.turn_seat === state.your_seat;
  const legalIds = new Set();
  if (isMyTurn) {
    const leadSuit = state.current_trick.length ? state.current_trick[0].suit : null;
    const sameSuit = state.your_hand.filter((c) => c.suit === leadSuit);
    const legal = leadSuit && sameSuit.length ? sameSuit : state.your_hand;
    legal.forEach((c) => legalIds.add(c.suit + "_" + c.rank));
  }

  state.your_hand.forEach((c) => {
    const el = makeCardEl(c.suit, c.rank, "hand-card");
    const id = c.suit + "_" + c.rank;
    if (isMyTurn) {
      el.classList.add(legalIds.has(id) ? "playable" : "disabled");
      el.addEventListener("click", () => {
        if (!legalIds.has(id)) return;
        socket.emit("play_card", { suit: c.suit, rank: c.rank });
      });
    }
    handStrip.appendChild(el);
  });

  if (state.phase === "hand_over" || state.phase === "game_over") {
    document.getElementById("resultTitle").textContent =
      state.phase === "game_over" ? t("game_over_title") : t("hand_over_title");
    document.getElementById("resultSub").textContent =
      `${state.round_scores[0]} – ${state.round_scores[1]}`;
    setTimeout(() => showScreen("screen-result"), 400);
  }
}

function makeCardEl(suit, rank, extraClass) {
  const el = document.createElement("div");
  el.className = (extraClass || "playing-card") + " " + (RED_SUITS.has(suit) ? "red" : "black");
  el.innerHTML = `<div>${rankLabel(rank)}</div><div class="suit-icon">${SUIT_ICON[suit]}</div>`;
  return el;
}

// trump choice clicks
document.querySelectorAll(".trump-choice").forEach((el) => {
  el.addEventListener("click", () => {
    socket.emit("choose_trump", { suit: el.getAttribute("data-suit") });
  });
});

document.getElementById("btnBackHub").addEventListener("click", () => {
  showScreen("screen-hub");
  document.getElementById("chatToggle").style.display = "none";
  document.getElementById("inviteBox").style.display = "none";
});

// ===== Dice Duel =====
const DIE_UNICODE = { 1: "⚀", 2: "⚁", 3: "⚂", 4: "⚃", 5: "⚄", 6: "⚅" };

function renderDice(state) {
  const me = state.players.find((p) => p.seat === state.your_seat);
  const opp = state.players.find((p) => p.seat !== state.your_seat);

  document.getElementById("diceMeName").textContent = (me && me.name) || "You";
  document.getElementById("diceOppName").textContent = (opp && opp.name) || "Opponent";
  document.getElementById("diceMeAvatar").textContent = ((me && me.name) || "?")[0].toUpperCase();
  document.getElementById("diceOppAvatar").textContent = ((opp && opp.name) || "?")[0].toUpperCase();
  document.getElementById("diceMeWins").textContent = state.wins[state.your_seat] || 0;
  document.getElementById("diceOppWins").textContent = (opp ? state.wins[opp.seat] : 0) || 0;

  const label = currentLang === "fa"
    ? `دور ${state.round_no} از ${state.rounds_to_play}`
    : `Round ${state.round_no} / ${state.rounds_to_play}`;
  document.getElementById("diceRoundLabel").textContent = label;

  // arena dice: your own pending roll shows immediately, opponent's stays hidden
  // ("…") until the round resolves; the resolved round is always the last history entry.
  const lastRound = state.history.length ? state.history[state.history.length - 1] : null;
  const roundJustResolved = state.phase === "match_over"
    ? (lastRound && lastRound.round === state.round_no)
    : (lastRound && lastRound.round === state.round_no - 1 && !state.you_rolled_this_round);

  if (roundJustResolved) {
    document.getElementById("dieMe").textContent = DIE_UNICODE[lastRound.rolls[state.your_seat]];
    document.getElementById("dieOpp").textContent = DIE_UNICODE[opp ? lastRound.rolls[opp.seat] : null];
  } else {
    document.getElementById("dieMe").textContent = state.you_rolled_this_round
      ? DIE_UNICODE[state.your_pending_roll] : "?";
    document.getElementById("dieOpp").textContent = state.opponent_rolled_this_round ? "…" : "?";
  }

  const rollBtn = document.getElementById("btnRollDice");
  const note = document.getElementById("diceNote");
  if (state.phase === "match_over") {
    rollBtn.style.display = "none";
    note.textContent = "";
  } else if (state.you_rolled_this_round) {
    rollBtn.style.display = "none";
    note.textContent = state.opponent_rolled_this_round ? "" : t("dice_note_waiting");
  } else {
    rollBtn.style.display = "block";
    note.textContent = t("dice_note_roll");
  }

  // history list
  const histBox = document.getElementById("diceHistory");
  histBox.innerHTML = "";
  state.history.forEach((h) => {
    const row = document.createElement("div");
    row.className = "dice-history-row";
    const myR = h.rolls[state.your_seat];
    const oppR = opp ? h.rolls[opp.seat] : null;
    const resultText = h.winner_seat === null
      ? t("dice_tie")
      : (h.winner_seat === state.your_seat ? t("dice_you_won_round") : t("dice_opp_won_round"));
    row.innerHTML = `<span>${t("dice_round_word")} ${h.round}</span><span>${DIE_UNICODE[myR] || "?"} ${myR} — ${DIE_UNICODE[oppR] || "?"} ${oppR}</span><span>${resultText}</span>`;
    histBox.appendChild(row);
  });

  if (state.phase === "match_over") {
    const iWon = state.wins[state.your_seat] > (opp ? state.wins[opp.seat] : 0);
    document.getElementById("diceResultTitle").textContent = iWon ? t("dice_win_title") : t("dice_lose_title");
    document.getElementById("diceResultSub").textContent =
      `${state.wins[state.your_seat]} – ${opp ? state.wins[opp.seat] : 0}`;
    setTimeout(() => showScreen("screen-dice-result"), 500);
  }
}

document.getElementById("btnRollDice").addEventListener("click", () => {
  socket.emit("roll_dice", {});
});

document.getElementById("btnDiceRematch").addEventListener("click", () => {
  socket.emit("rematch_dice", {});
});

document.getElementById("btnDiceBackHub").addEventListener("click", () => {
  showScreen("screen-hub");
  document.getElementById("chatToggle").style.display = "none";
  document.getElementById("inviteBoxDice").style.display = "none";
});

// ===== Chat =====
const chatPanel = document.getElementById("chatPanel");
document.getElementById("chatToggle").addEventListener("click", () => {
  chatPanel.classList.toggle("open");
});
document.getElementById("chatSend").addEventListener("click", sendChat);
document.getElementById("chatInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendChat();
});
function sendChat() {
  const input = document.getElementById("chatInput");
  const text = input.value.trim();
  if (!text) return;
  socket.emit("chat_message", { text });
  input.value = "";
}
socket.on("chat_message", (data) => {
  const box = document.getElementById("chatMessages");
  const bubble = document.createElement("div");
  bubble.className = "chat-bubble" + (data.seat === mySeat ? " me" : "");
  bubble.textContent = data.text;
  box.appendChild(bubble);
  box.scrollTop = box.scrollHeight;
});
