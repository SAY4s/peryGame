// A drop-in replacement for the old Socket.IO client — implements the same pub-sub
// surface (`net.on(event, cb)` / `net.emit(event, payload)`) but backed by Firebase
// Firestore instead of a custom Python/Socket.IO backend. This is what makes the whole
// site "serverless": there's nothing to host except the static files themselves.
//
// Trust model: there is no trusted server. Whichever player creates a room (or is first
// in line when random-matched) becomes that room's "host" and runs the actual game
// rules locally in their own browser tab; every other player's client just reads the
// synced result from Firestore. Two consequences worth knowing:
//   1. The host's tab needs to stay open for the game to keep progressing. If the host
//      closes the app mid-game, that table gets stuck (no server to take over).
//   2. Firestore data for a room (including every seat's hand) is technically readable
//      by anyone in that room, since there's no trusted server to keep secrets. The UI
//      only ever displays your own hand, but a technical, motivated opponent could look.
// Fine for casual games with friends; see README for details and alternatives.

const net = (() => {
  const listeners = {};
  function on(event, cb) {
    (listeners[event] = listeners[event] || []).push(cb);
  }
  function fire(event, payload) {
    (listeners[event] || []).forEach((cb) => cb(payload));
  }

  let db = null;
  let myUid = null;
  let ready = null;

  let currentRoomId = null;
  let currentSeat = null;
  let isHost = false;
  let dealingInProgress = false;
  let roomUnsub = null;
  let actionsUnsub = null;
  let chatUnsub = null;
  let notifUnsub = null;
  let seenChatIds = new Set();

  function init() {
    if (ready) return ready;
    ready = new Promise((resolve, reject) => {
      const cfg = window.FIREBASE_CONFIG;
      if (!cfg || !cfg.apiKey || cfg.apiKey === "YOUR_API_KEY") {
        reject(new Error("firebase_not_configured"));
        return;
      }
      try {
        firebase.initializeApp(cfg);
        db = firebase.firestore();
        firebase.auth().onAuthStateChanged((user) => {
          if (user) {
            myUid = user.uid;
            fire("connected", { uid: myUid });
            resolve();
          }
        });
        firebase.auth().signInAnonymously().catch(reject);
      } catch (e) {
        reject(e);
      }
    });
    return ready;
  }

  function engineFor(gameType) {
    return gameType === "dice" ? window.DiceEngine : window.HokmEngine;
  }

  function teardownRoomListeners() {
    if (roomUnsub) roomUnsub();
    if (actionsUnsub) actionsUnsub();
    if (chatUnsub) chatUnsub();
    roomUnsub = actionsUnsub = chatUnsub = null;
    seenChatIds = new Set();
    dealingInProgress = false;
  }

  function attachRoomListeners(roomId) {
    teardownRoomListeners();
    const roomRef = db.collection("rooms").doc(roomId);

    roomUnsub = roomRef.onSnapshot((doc) => {
      if (!doc.exists) return;
      const data = doc.data();
      isHost = data.hostUid === myUid;

      if (!data.raw) {
        fire("lobby_update", { room_id: roomId, mode: data.mode, players: data.players || [] });
        if (isHost && !dealingInProgress && data.players && data.players.length === data.mode) {
          dealingInProgress = true;
          const engine = engineFor(data.gameType);
          let raw = engine.createRoom(roomId, data.mode, data.players);
          raw = data.gameType === "dice" ? engine.startMatch(raw) : engine.startHand(raw);
          roomRef.update({ raw }).catch(() => { dealingInProgress = false; });
        }
        return;
      }

      const engine = engineFor(data.gameType);
      fire("game_state", engine.stateFor(data.raw, currentSeat));
    }, (err) => fire("error_msg", { message: "sync_error: " + err.message }));

    // Host listens for other players' submitted actions and applies them here.
    actionsUnsub = roomRef.collection("actions").orderBy("ts").onSnapshot((snap) => {
      if (!isHost) return;
      snap.docChanges().forEach((change) => {
        if (change.type === "added") applyHostAction(roomId, change.doc.id, change.doc.data());
      });
    });

    chatUnsub = roomRef.collection("chat").orderBy("ts").onSnapshot((snap) => {
      snap.docChanges().forEach((change) => {
        if (change.type !== "added" || seenChatIds.has(change.doc.id)) return;
        seenChatIds.add(change.doc.id);
        const d = change.doc.data();
        fire("chat_message", { seat: d.seat, text: d.text });
      });
    });
  }

  function applyHostAction(roomId, actionId, action) {
    const roomRef = db.collection("rooms").doc(roomId);
    roomRef.get().then((doc) => {
      if (!doc.exists) return;
      const data = doc.data();
      const engine = engineFor(data.gameType);
      let result = null;

      if (action.type === "choose_trump") {
        result = engine.chooseTrump(data.raw, action.seat, action.payload.suit);
      } else if (action.type === "play_card") {
        result = engine.playCard(data.raw, action.seat, action.payload.suit, action.payload.rank);
      } else if (action.type === "roll_dice") {
        result = engine.roll(data.raw, action.seat);
      } else if (action.type === "rematch_dice") {
        result = { ok: true, raw: engine.startMatch(data.raw) };
      }

      if (result && result.ok) {
        roomRef.update({ raw: result.raw }).then(() => {
          // Hokm: same auto-redeal-after-2s behavior the old server used.
          if (data.gameType === "hokm" && result.raw.phase === "hand_over") {
            setTimeout(() => {
              roomRef.get().then((freshDoc) => {
                if (!freshDoc.exists) return;
                const fresh = freshDoc.data().raw;
                if (fresh.phase !== "hand_over") return; // someone already advanced it
                const nextHakem = (fresh.hakem_seat + 1) % fresh.mode;
                roomRef.update({ raw: window.HokmEngine.startHand(fresh, nextHakem) });
              });
            }, 2000);
          }
        });
      }
      // Whether it applied or not, the action's been handled — clean it up.
      if (actionId) roomRef.collection("actions").doc(actionId).delete().catch(() => {});
    });
  }

  function submitOrApply(type, payload) {
    if (!currentRoomId) return;
    if (isHost) {
      applyHostAction(currentRoomId, null, { type, seat: currentSeat, payload });
    } else {
      db.collection("rooms").doc(currentRoomId).collection("actions").add({
        uid: myUid, seat: currentSeat, type, payload,
        ts: firebase.firestore.FieldValue.serverTimestamp(),
      });
    }
  }

  // ---- request/response helper used for invite creation ----

  async function createInvite(gameType, mode) {
    await init();
    const roomRef = db.collection("rooms").doc();
    await roomRef.set({
      gameType, mode,
      hostUid: myUid,
      players: [{ uid: myUid, name: "", seat: 0 }],
      raw: null,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    return { room_id: roomRef.id, mode, game_type: gameType };
  }

  // ---- "emit"-style actions ----

  async function joinByCode({ room_id, name }) {
    await init();
    const roomRef = db.collection("rooms").doc(room_id);

    await db.runTransaction(async (tx) => {
      const doc = await tx.get(roomRef);
      if (!doc.exists) throw new Error("room_not_found");
      const data = doc.data();
      if ((data.players || []).some((p) => p.uid === myUid)) return; // already in (e.g. reload)
      if (data.players.length >= data.mode) throw new Error("room_full");
      const seat = data.players.length;
      tx.update(roomRef, { players: data.players.concat([{ uid: myUid, name, seat }]) });
    });

    const doc = await roomRef.get();
    const data = doc.data();
    const me = (data.players || []).find((p) => p.uid === myUid);
    currentRoomId = room_id;
    currentSeat = me.seat;

    fire("joined", { room_id, seat: currentSeat, mode: data.mode, game_type: data.gameType });
    attachRoomListeners(room_id);
  }

  async function joinRandom({ game_type, mode, name }) {
    await init();
    const key = `${game_type}_${mode}`;
    const queueRef = db.collection("queueEntries").doc(key);
    const notifRef = db.collection("matchNotifications").doc(myUid);

    fire("queued", { mode, game_type });

    if (notifUnsub) notifUnsub();
    notifUnsub = notifRef.onSnapshot((doc) => {
      if (!doc.exists) return;
      const data = doc.data();
      if (!data || !data.roomId) return;
      notifUnsub();
      notifRef.delete().catch(() => {});
      joinByCode({ room_id: data.roomId, name });
    });

    await db.runTransaction(async (tx) => {
      const doc = await tx.get(queueRef);
      const waiting = (doc.exists && doc.data().waiting) || [];
      const group = waiting.concat([{ uid: myUid, name }]);

      if (group.length < mode) {
        tx.set(queueRef, { waiting: group }, { merge: true });
        return;
      }

      const roomRef = db.collection("rooms").doc();
      const players = group.slice(0, mode).map((p, i) => ({ uid: p.uid, name: p.name, seat: i }));
      tx.set(roomRef, {
        gameType: game_type, mode,
        hostUid: players[0].uid,
        players,
        raw: null,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      tx.set(queueRef, { waiting: group.slice(mode) }, { merge: true });
      players.forEach((p) => {
        tx.set(db.collection("matchNotifications").doc(p.uid), { roomId: roomRef.id });
      });
    });
  }

  function emit(event, payload) {
    payload = payload || {};
    switch (event) {
      case "join_by_code":
        joinByCode(payload).catch((e) => fire("error_msg", { message: e.message }));
        break;
      case "join_random":
        joinRandom(payload).catch((e) => fire("error_msg", { message: e.message }));
        break;
      case "choose_trump":
        submitOrApply("choose_trump", { suit: payload.suit });
        break;
      case "play_card":
        submitOrApply("play_card", { suit: payload.suit, rank: payload.rank });
        break;
      case "roll_dice":
        submitOrApply("roll_dice", {});
        break;
      case "rematch_dice":
        submitOrApply("rematch_dice", {});
        break;
      case "chat_message":
        if (currentRoomId) {
          db.collection("rooms").doc(currentRoomId).collection("chat").add({
            seat: currentSeat, text: payload.text,
            ts: firebase.firestore.FieldValue.serverTimestamp(),
          });
        }
        break;
      default:
        break;
    }
  }

  return { on, emit, createInvite, init };
})();

window.net = net;
