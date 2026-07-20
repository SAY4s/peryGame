// Hokm (Hukm) rules engine — pure-function JS port of game_logic.py.
// Runs entirely in the browser (no server): whichever client is the "host" of a room
// calls these functions locally and writes the resulting state to Firestore; every
// other client just reads/renders the synced state. See serverless-net.js.
//
// NOTE on privacy: because there's no trusted server, this state (including every
// seat's hand) is technically readable by anyone in the room via Firestore — the UI
// just doesn't display it. This is a deliberate trade-off for a fully serverless demo;
// see README for details.

const HokmEngine = (() => {
  const SUITS = ["hearts", "diamonds", "clubs", "spades"];
  const RANK_ORDER = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
  const RANK_NAMES = { 11: "J", 12: "Q", 13: "K", 14: "A" };

  function rankLabel(rank) {
    return RANK_NAMES[rank] || String(rank);
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function makeDeck(twoPlayer) {
    const ranks = twoPlayer ? RANK_ORDER.filter((r) => r >= 7) : RANK_ORDER;
    const deck = [];
    SUITS.forEach((s) => ranks.forEach((r) => deck.push({ suit: s, rank: r })));
    return shuffle(deck);
  }

  function teamOf(mode, seat) {
    if (mode === 4) return seat === 0 || seat === 2 ? 0 : 1;
    return seat;
  }

  // Creates the room's very first raw state (mode + players known, nothing dealt yet).
  function createRoom(roomId, mode, players) {
    return {
      game_type: "hokm",
      room_id: roomId,
      mode,
      players,
      hands: {},
      hakem_seat: null,
      trump: null,
      current_trick: [],
      turn_seat: null,
      lead_suit: null,
      tricks_won: { 0: 0, 1: 0 },
      round_scores: { 0: 0, 1: 0 },
      phase: "waiting",
    };
  }

  // Deals a new hand. `hakemSeat` defaults to random the first time, otherwise pass the
  // seat that should be hakem this hand (e.g. next player after the previous hand).
  function startHand(raw, hakemSeat) {
    const twoPlayer = raw.mode === 2;
    const deck = makeDeck(twoPlayer);
    const perPlayer = Math.floor(deck.length / raw.mode);
    const hands = {};
    raw.players.forEach((p, i) => {
      hands[p.seat] = deck.slice(i * perPlayer, (i + 1) * perPlayer);
    });
    const seats = raw.players.map((p) => p.seat);
    const hakem = hakemSeat !== undefined && hakemSeat !== null
      ? hakemSeat
      : seats[Math.floor(Math.random() * seats.length)];

    return {
      ...raw,
      hands,
      hakem_seat: hakem,
      trump: null,
      current_trick: [],
      lead_suit: null,
      tricks_won: { 0: 0, 1: 0 },
      turn_seat: hakem,
      phase: "choosing_trump",
    };
  }

  function legalMoves(raw, seat) {
    const hand = raw.hands[seat] || [];
    if (!raw.current_trick.length) return hand;
    const sameSuit = hand.filter((c) => c.suit === raw.lead_suit);
    return sameSuit.length ? sameSuit : hand;
  }

  function chooseTrump(raw, seat, suit) {
    if (seat !== raw.hakem_seat || raw.phase !== "choosing_trump") {
      return { ok: false, error: "not_your_turn" };
    }
    if (!SUITS.includes(suit)) return { ok: false, error: "invalid_suit" };
    return {
      ok: true,
      raw: { ...raw, trump: suit, phase: "playing", turn_seat: raw.hakem_seat },
    };
  }

  function playCard(raw, seat, suit, rank) {
    if (raw.phase !== "playing") return { ok: false, error: "not_playing_phase" };
    if (seat !== raw.turn_seat) return { ok: false, error: "not_your_turn" };

    const hand = raw.hands[seat] || [];
    const card = hand.find((c) => c.suit === suit && c.rank === rank);
    if (!card) return { ok: false, error: "card_not_in_hand" };

    const legal = legalMoves(raw, seat);
    if (!legal.some((c) => c.suit === suit && c.rank === rank)) {
      return { ok: false, error: "must_follow_suit" };
    }

    const newHands = { ...raw.hands, [seat]: hand.filter((c) => c !== card) };
    const newTrick = raw.current_trick.slice();
    const leadSuit = newTrick.length ? raw.lead_suit : suit;
    newTrick.push({ seat, suit: card.suit, rank: card.rank });

    let next = {
      ...raw,
      hands: newHands,
      current_trick: newTrick,
      lead_suit: leadSuit,
    };

    if (newTrick.length === raw.mode) {
      const winnerSeat = resolveTrick(newTrick, raw.trump, leadSuit);
      const team = teamOf(raw.mode, winnerSeat);
      next.tricks_won = { ...next.tricks_won, [team]: (next.tricks_won[team] || 0) + 1 };
      next.current_trick = [];
      next.lead_suit = null;
      next.turn_seat = winnerSeat;

      const allEmpty = Object.values(newHands).every((h) => h.length === 0);
      if (allEmpty) {
        next = endHand(next);
      }
    } else {
      const order = raw.players.map((p) => p.seat);
      const idx = order.indexOf(seat);
      next.turn_seat = order[(idx + 1) % order.length];
    }

    return { ok: true, raw: next };
  }

  function resolveTrick(trick, trump, leadSuit) {
    const trumpPlays = trick.filter((t) => t.suit === trump);
    const pool = trumpPlays.length ? trumpPlays : trick.filter((t) => t.suit === leadSuit);
    return pool.reduce((best, t) => (t.rank > best.rank ? t : best)).seat;
  }

  function endHand(raw) {
    const winnerTeam = raw.tricks_won[0] > raw.tricks_won[1] ? 0 : 1;
    const roundScores = { ...raw.round_scores, [winnerTeam]: (raw.round_scores[winnerTeam] || 0) + 1 };
    const phase = roundScores[winnerTeam] >= 7 ? "game_over" : "hand_over";
    return { ...raw, round_scores: roundScores, phase };
  }

  // Viewer projection: same shape the frontend already expects (mirrors state_for()
  // from game_logic.py). Hides nothing from Firestore itself, but the client only ever
  // reads its own `your_hand` out of this — see the note at the top of this file.
  function stateFor(raw, seat) {
    const hand = raw.hands[seat] || [];
    const handCounts = {};
    Object.keys(raw.hands).forEach((s) => { handCounts[s] = raw.hands[s].length; });
    return {
      game_type: "hokm",
      room_id: raw.room_id,
      mode: raw.mode,
      phase: raw.phase,
      players: raw.players,
      your_seat: seat,
      your_hand: hand.map((c) => ({ suit: c.suit, rank: c.rank, label: rankLabel(c.rank) })),
      hand_counts: handCounts,
      hakem_seat: raw.hakem_seat,
      trump: raw.trump,
      current_trick: raw.current_trick,
      turn_seat: raw.turn_seat,
      tricks_won: raw.tricks_won,
      round_scores: raw.round_scores,
    };
  }

  return { createRoom, startHand, chooseTrump, playCard, stateFor, teamOf };
})();

window.HokmEngine = HokmEngine;
