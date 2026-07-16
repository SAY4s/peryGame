"""
Dice Duel — simple 2-player dice game.
Rules: 3 rounds played back-to-back. Each round both players roll a die (1-6);
whichever player rolls higher wins that round (a tie re-rolls the same round).
After 3 decisive rounds, whoever won more rounds wins the match.
Free game, no purchases involved.
"""
import random

ROUNDS_TO_PLAY = 3


class DiceGame:
    def __init__(self, room_id):
        self.room_id = room_id
        self.mode = 2
        self.players = []          # [{id, name, seat}]
        self.wins = {0: 0, 1: 0}
        self.round_no = 1
        self.current_rolls = {}    # seat -> value (cleared each round)
        self.history = []          # list of {round, rolls: {seat: val}, winner_seat}
        self.phase = "waiting"     # waiting -> rolling -> match_over

    def add_player(self, user_id, name):
        if len(self.players) >= self.mode:
            return False
        seat = len(self.players)
        self.players.append({"id": user_id, "name": name, "seat": seat})
        return True

    def is_full(self):
        return len(self.players) == self.mode

    def start_match(self):
        self.wins = {0: 0, 1: 0}
        self.round_no = 1
        self.current_rolls = {}
        self.history = []
        self.phase = "rolling"

    def roll(self, seat):
        if self.phase != "rolling":
            return False, "not_rolling_phase"
        if seat in self.current_rolls:
            return False, "already_rolled"
        self.current_rolls[seat] = random.randint(1, 6)

        if len(self.current_rolls) < self.mode:
            return True, None  # waiting for the other player

        # both rolled — resolve the round
        seats = list(self.current_rolls.keys())
        v0, v1 = self.current_rolls[seats[0]], self.current_rolls[seats[1]]
        if v0 == v1:
            # tie: replay this same round number
            self.history.append({
                "round": self.round_no,
                "rolls": dict(self.current_rolls),
                "winner_seat": None,
            })
            self.current_rolls = {}
            return True, None

        winner_seat = seats[0] if v0 > v1 else seats[1]
        self.wins[winner_seat] += 1
        self.history.append({
            "round": self.round_no,
            "rolls": dict(self.current_rolls),
            "winner_seat": winner_seat,
        })
        self.current_rolls = {}

        decisive_rounds = len([h for h in self.history if h["winner_seat"] is not None])
        if decisive_rounds >= ROUNDS_TO_PLAY:
            self.phase = "match_over"
        else:
            self.round_no += 1

        return True, None

    def state_for(self, seat):
        return {
            "game_type": "dice",
            "room_id": self.room_id,
            "mode": self.mode,
            "phase": self.phase,
            "players": self.players,
            "your_seat": seat,
            "round_no": self.round_no,
            "rounds_to_play": ROUNDS_TO_PLAY,
            "wins": self.wins,
            "history": self.history,
            "you_rolled_this_round": seat in self.current_rolls,
            "your_pending_roll": self.current_rolls.get(seat),
            "opponent_rolled_this_round": any(s != seat for s in self.current_rolls),
        }
