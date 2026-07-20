// Test harness for the serverless (Firebase-backed) networking layer.
// Simulates two separate browser tabs (two independent JS "vm" contexts, each with its
// own `window`/`net` singleton) sharing ONE in-memory mock of Firestore + Anonymous Auth,
// so we can exercise the actual serverless-net.js / hokm-engine.js / dice-engine.js code
// without needing a real Firebase project or network access.
"use strict";
const vm = require("vm");
const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------
// Minimal in-memory Firestore + Auth mock, shared across both simulated tabs.
// ---------------------------------------------------------------------
function createMockFirebaseBackend() {
  const store = new Map(); // path (string) -> data object
  const subscribers = new Map(); // path -> Set<callback>
  let tsCounter = 0;
  let idCounter = 0;

  function notify(path) {
    const subs = subscribers.get(path);
    if (!subs) return;
    subs.forEach((cb) => cb());
  }

  function collectionPath(parts) {
    return parts.join("/");
  }

  function makeDocRef(pathParts) {
    const fullPath = collectionPath(pathParts);
    return {
      id: pathParts[pathParts.length - 1],
      _path: fullPath,
      async set(data, opts) {
        const existing = store.get(fullPath) || {};
        const merged = opts && opts.merge ? { ...existing, ...data } : { ...data };
        store.set(fullPath, merged);
        notify(fullPath);
        notify(pathParts.slice(0, -1).join("/")); // notify parent collection listeners
      },
      async update(data) {
        const existing = store.get(fullPath) || {};
        store.set(fullPath, { ...existing, ...data });
        notify(fullPath);
      },
      async get() {
        const data = store.get(fullPath);
        return { exists: !!data, data: () => (data ? { ...data } : undefined) };
      },
      async delete() {
        store.delete(fullPath);
        notify(pathParts.slice(0, -1).join("/"));
      },
      onSnapshot(cb, errCb) {
        const wrapped = () => {
          Promise.resolve(this.get()).then(cb).catch(errCb || (() => {}));
        };
        if (!subscribers.has(fullPath)) subscribers.set(fullPath, new Set());
        subscribers.get(fullPath).add(wrapped);
        wrapped(); // Firestore fires an initial snapshot immediately
        return () => subscribers.get(fullPath).delete(wrapped);
      },
      collection(name) {
        return makeCollectionRef([...pathParts, name]);
      },
    };
  }

  function makeCollectionRef(pathParts) {
    const fullPath = collectionPath(pathParts);
    return {
      doc(id) {
        const docId = id || `auto_${++idCounter}`;
        return makeDocRef([...pathParts, docId]);
      },
      async add(data) {
        const ref = this.doc();
        await ref.set(data);
        return ref;
      },
      orderBy() {
        return this; // ordering handled by ts field when reading; mock keeps insertion order
      },
      onSnapshot(cb) {
        const seenIds = new Set();
        const wrapped = () => {
          const prefix = fullPath + "/";
          const docs = [];
          for (const [p, data] of store.entries()) {
            if (p.startsWith(prefix) && !p.slice(prefix.length).includes("/")) {
              docs.push({ id: p.slice(prefix.length), data });
            }
          }
          docs.sort((a, b) => (a.data.ts || 0) - (b.data.ts || 0));
          const changes = [];
          docs.forEach((d) => {
            if (!seenIds.has(d.id)) {
              seenIds.add(d.id);
              changes.push({ type: "added", doc: { id: d.id, data: () => ({ ...d.data }) } });
            }
          });
          if (changes.length) cb({ docChanges: () => changes });
        };
        if (!subscribers.has(fullPath)) subscribers.set(fullPath, new Set());
        subscribers.get(fullPath).add(wrapped);
        wrapped();
        return () => subscribers.get(fullPath).delete(wrapped);
      },
    };
  }

  const db = {
    collection(name) {
      return makeCollectionRef([name]);
    },
    async runTransaction(fn) {
      // Single-threaded test env: no real concurrent writers, so a plain sequential
      // execution is a faithful enough simulation of transaction semantics here.
      const tx = {
        async get(ref) { return ref.get(); },
        set(ref, data, opts) { return ref.set(data, opts); },
        update(ref, data) { return ref.update(data); },
      };
      return fn(tx);
    },
  };

  function nextTs() { return ++tsCounter; }

  return { db, nextTs };
}

function makeAuthMock(uid) {
  let authCb = null;
  return {
    onAuthStateChanged(cb) { authCb = cb; },
    signInAnonymously() {
      setTimeout(() => authCb && authCb({ uid }), 0);
      return Promise.resolve();
    },
  };
}

// ---------------------------------------------------------------------
// Build one simulated "browser tab": its own vm context + window + net singleton,
// sharing the given mock Firestore backend.
// ---------------------------------------------------------------------
function createTab(name, uid, backend) {
  const sandbox = {
    console: { log: (...a) => console.log(`[${name}]`, ...a), error: (...a) => console.error(`[${name}]`, ...a) },
    setTimeout, clearTimeout, Promise, Date, Math, Object, Array, JSON,
  };
  sandbox.window = sandbox;
  sandbox.window.FIREBASE_CONFIG = { apiKey: "test-key", projectId: "test-project" };
  vm.createContext(sandbox);

  const firebaseMock = {
    initializeApp() {},
    firestore: () => backend.db,
  };
  const authInstance = makeAuthMock(uid);
  firebaseMock.auth = () => authInstance;
  firebaseMock.firestore.FieldValue = { serverTimestamp: () => backend.nextTs() };
  sandbox.firebase = firebaseMock;

  ["hokm-engine.js", "dice-engine.js", "serverless-net.js"].forEach((file) => {
    const code = fs.readFileSync(path.join(__dirname, "static", file), "utf8");
    vm.runInContext(code, sandbox, { filename: file });
  });

  return sandbox; // sandbox.net is now the tab's networking shim
}

// ---------------------------------------------------------------------
// Actual tests
// ---------------------------------------------------------------------
async function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function testHokmInviteFlow() {
  console.log("\n=== SERVERLESS TEST: Hokm invite flow (2 players) ===");
  const backend = createMockFirebaseBackend();
  const alice = createTab("Alice", "alice-uid", backend);
  const bob = createTab("Bob", "bob-uid", backend);

  const events = { alice: [], bob: [] };
  alice.net.on("joined", (d) => events.alice.push(["joined", d]));
  alice.net.on("game_state", (d) => events.alice.push(["game_state", d]));
  bob.net.on("joined", (d) => events.bob.push(["joined", d]));
  bob.net.on("game_state", (d) => events.bob.push(["game_state", d]));

  const invite = await alice.net.createInvite("hokm", 2);
  console.log("invite created:", invite);

  alice.net.emit("join_by_code", { room_id: invite.room_id, name: "Alice" });
  await wait(20);
  bob.net.emit("join_by_code", { room_id: invite.room_id, name: "Bob" });
  await wait(50);

  const aliceJoined = events.alice.find((e) => e[0] === "joined");
  const bobJoined = events.bob.find((e) => e[0] === "joined");
  console.log("alice seat:", aliceJoined && aliceJoined[1].seat, "bob seat:", bobJoined && bobJoined[1].seat);

  const aliceState = [...events.alice].reverse().find((e) => e[0] === "game_state");
  const bobState = [...events.bob].reverse().find((e) => e[0] === "game_state");
  if (!aliceState || !bobState) throw new Error("dealing never happened");
  console.log("phase after deal:", aliceState[1].phase, "hakem seat:", aliceState[1].hakem_seat);
  if (aliceState[1].phase !== "choosing_trump") throw new Error("expected choosing_trump phase");

  const hakemTab = aliceState[1].hakem_seat === aliceJoined[1].seat ? alice : bob;
  const hakemName = hakemTab === alice ? "alice" : "bob";
  console.log("hakem is:", hakemName);
  hakemTab.net.emit("choose_trump", { suit: "spades" });
  await wait(50);

  const latestAlice = [...events.alice].reverse().find((e) => e[0] === "game_state")[1];
  const latestBob = [...events.bob].reverse().find((e) => e[0] === "game_state")[1];
  console.log("phase after trump:", latestAlice.phase, "trump:", latestAlice.trump);
  if (latestAlice.phase !== "playing" || latestBob.phase !== "playing") {
    throw new Error("trump selection did not propagate to both tabs");
  }

  // Play the entire hand out via alternating turns, each side always reading its OWN
  // latest game_state and picking a legal card.
  let turns = 0;
  while (turns < 60) {
    const aState = [...events.alice].reverse().find((e) => e[0] === "game_state")[1];
    if (aState.phase !== "playing") break;
    const actingTab = aState.turn_seat === aliceJoined[1].seat ? alice : bob;
    const actingEvents = actingTab === alice ? events.alice : events.bob;
    const myState = [...actingEvents].reverse().find((e) => e[0] === "game_state")[1];
    const trick = myState.current_trick;
    let card = myState.your_hand[0];
    if (trick.length) {
      const sameSuit = myState.your_hand.find((c) => c.suit === trick[0].suit);
      if (sameSuit) card = sameSuit;
    }
    actingTab.net.emit("play_card", { suit: card.suit, rank: card.rank });
    await wait(15);
    turns++;
  }

  await wait(60);
  const finalAlice = [...events.alice].reverse().find((e) => e[0] === "game_state")[1];
  console.log("final phase:", finalAlice.phase, "round scores:", finalAlice.round_scores, "turns:", turns);
  if (finalAlice.phase !== "hand_over" && finalAlice.phase !== "game_over") {
    throw new Error("hand never finished, final phase=" + finalAlice.phase);
  }
  console.log("HOKM INVITE FLOW TEST: PASSED");
}

async function testDiceRandomMatch() {
  console.log("\n=== SERVERLESS TEST: Dice Duel random matchmaking (2 players) ===");
  const backend = createMockFirebaseBackend();
  const alice = createTab("Alice", "alice-uid2", backend);
  const bob = createTab("Bob", "bob-uid2", backend);

  const events = { alice: [], bob: [] };
  alice.net.on("joined", (d) => events.alice.push(["joined", d]));
  alice.net.on("game_state", (d) => events.alice.push(["game_state", d]));
  bob.net.on("joined", (d) => events.bob.push(["joined", d]));
  bob.net.on("game_state", (d) => events.bob.push(["game_state", d]));

  alice.net.emit("join_random", { game_type: "dice", mode: 2, name: "Alice" });
  await wait(20);
  bob.net.emit("join_random", { game_type: "dice", mode: 2, name: "Bob" });
  await wait(80);

  const aliceJoined = events.alice.find((e) => e[0] === "joined");
  const bobJoined = events.bob.find((e) => e[0] === "joined");
  if (!aliceJoined || !bobJoined) throw new Error("random matchmaking never paired the players");
  console.log("matched into room:", aliceJoined[1].room_id, "=", bobJoined[1].room_id);
  if (aliceJoined[1].room_id !== bobJoined[1].room_id) throw new Error("players ended up in different rooms");

  let rounds = 0;
  while (rounds < 30) {
    const aState = [...events.alice].reverse().find((e) => e[0] === "game_state");
    if (aState && aState[1].phase === "match_over") break;
    alice.net.emit("roll_dice", {});
    bob.net.emit("roll_dice", {});
    await wait(30);
    rounds++;
  }

  const finalAlice = [...events.alice].reverse().find((e) => e[0] === "game_state")[1];
  console.log("final phase:", finalAlice.phase, "wins:", finalAlice.wins, "attempts:", rounds);
  if (finalAlice.phase !== "match_over") throw new Error("dice match never finished");
  console.log("DICE RANDOM MATCH TEST: PASSED");
}

async function testChat() {
  console.log("\n=== SERVERLESS TEST: chat sync ===");
  const backend = createMockFirebaseBackend();
  const alice = createTab("Alice", "alice-uid3", backend);
  const bob = createTab("Bob", "bob-uid3", backend);
  const chatEvents = { alice: [], bob: [] };
  alice.net.on("chat_message", (d) => chatEvents.alice.push(d));
  bob.net.on("chat_message", (d) => chatEvents.bob.push(d));

  const invite = await alice.net.createInvite("hokm", 2);
  alice.net.emit("join_by_code", { room_id: invite.room_id, name: "Alice" });
  await wait(20);
  bob.net.emit("join_by_code", { room_id: invite.room_id, name: "Bob" });
  await wait(50);

  alice.net.emit("chat_message", { text: "hi bob" });
  await wait(30);
  bob.net.emit("chat_message", { text: "hi alice" });
  await wait(30);

  console.log("alice saw:", chatEvents.alice);
  console.log("bob saw:", chatEvents.bob);
  if (chatEvents.bob.length < 1 || chatEvents.alice.length < 2) throw new Error("chat messages did not propagate to both sides");
  console.log("CHAT TEST: PASSED");
}

(async () => {
  try {
    await testHokmInviteFlow();
    await testDiceRandomMatch();
    await testChat();
    console.log("\nALL SERVERLESS TESTS PASSED");
    process.exit(0);
  } catch (e) {
    console.error("\nSERVERLESS TEST FAILED:", e);
    process.exit(1);
  }
})();
