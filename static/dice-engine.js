// Dice Duel rules engine — pure-function JS port of dice_logic.py.
// Same host-authoritative model as hokm-engine.js: no server, whichever client is the
// host runs this locally and writes the result to Firestore.

const DiceEngine = (() => {
  const ROUNDS_TO_PLAY = 3;

  function createRoom(roomId, mode, players) {
    return {
      game_type: "dice",
      room_id: roomId,
      mode,
      players,
      wins: { 0: 0, 1: 0 },
      round_no: 1,
      rounds_to_play: ROUNDS_TO_PLAY,
      current_rolls: {},
      history: [],
      phase: "waiting",
    };
  }

  function startMatch(raw) {
    return {
      ...raw,
      wins: { 0: 0, 1: 0 },
      round_no: 1,
      current_rolls: {},
      history: [],
      phase: "rolling",
    };
  }

  function roll(raw, seat) {
    if (raw.phase !== "rolling") return { ok: false, error: "not_rolling_phase" };
    if (Object.prototype.hasOwnProperty.call(raw.current_rolls, seat)) {
      return { ok: false, error: "already_rolled" };
    }

    const value = 1 + Math.floor(Math.random() * 6);
    const rolls = { ...raw.current_rolls, [seat]: value };

    if (Object.keys(rolls).length < raw.mode) {
      return { ok: true, raw: { ...raw, current_rolls: rolls } };
    }

    // both rolled -> resolve the round
    const seats = Object.keys(rolls).map(Number);
    const v0 = rolls[seats[0]];
    const v1 = rolls[seats[1]];
    let next = { ...raw };

    if (v0 === v1) {
      next.history = raw.history.concat([{ round: raw.round_no, rolls, winner_seat: null }]);
      next.current_rolls = {};
      return { ok: true, raw: next };
    }

    const winnerSeat = v0 > v1 ? seats[0] : seats[1];
    next.wins = { ...raw.wins, [winnerSeat]: (raw.wins[winnerSeat] || 0) + 1 };
    next.history = raw.history.concat([{ round: raw.round_no, rolls, winner_seat: winnerSeat }]);
    next.current_rolls = {};

    const decisiveRounds = next.history.filter((h) => h.winner_seat !== null).length;
    if (decisiveRounds >= ROUNDS_TO_PLAY) {
      next.phase = "match_over";
    } else {
      next.round_no = raw.round_no + 1;
    }

    return { ok: true, raw: next };
  }

  function stateFor(raw, seat) {
    const rolledSeats = Object.keys(raw.current_rolls).map(Number);
    return {
      game_type: "dice",
      room_id: raw.room_id,
      mode: raw.mode,
      phase: raw.phase,
      players: raw.players,
      your_seat: seat,
      round_no: raw.round_no,
      rounds_to_play: raw.rounds_to_play,
      wins: raw.wins,
      history: raw.history,
      you_rolled_this_round: rolledSeats.includes(seat),
      your_pending_roll: raw.current_rolls[seat],
      opponent_rolled_this_round: rolledSeats.some((s) => s !== seat),
    };
  }

  return { createRoom, startMatch, roll, stateFor };
})();

window.DiceEngine = DiceEngine;
