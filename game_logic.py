"""
Hokm (Hukm) card game engine.
Supports 2-player and 4-player modes. Free / no payments, no ads.
"""
import random
import itertools

SUITS = ["hearts", "diamonds", "clubs", "spades"]
RANK_ORDER = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]  # 11=J 12=Q 13=K 14=A
RANK_NAMES = {11: "J", 12: "Q", 13: "K", 14: "A"}


def rank_label(rank):
    return RANK_NAMES.get(rank, str(rank))


def make_deck(two_player=False):
    """Full 52 card deck for 4-player, reduced 32 card deck (2-6 removed) for 2-player variant."""
    ranks = RANK_ORDER
    if two_player:
        ranks = [r for r in RANK_ORDER if r >= 7]  # 32-card deck: 7..A
    deck = [{"suit": s, "rank": r} for s in SUITS for r in ranks]
    random.shuffle(deck)
    return deck


def card_id(card):
    return f"{card['suit']}_{card['rank']}"


class HokmGame:
    """
    Manages a single Hokm room/table.
    players: list of dicts {id, name, seat} ordered by seat (0..N-1)
    4-player teams: seats 0 & 2 vs seats 1 & 3
    2-player: seat 0 vs seat 1
    """

    def __init__(self, room_id, mode):
        assert mode in (2, 4)
        self.room_id = room_id
        self.mode = mode
        self.players = []          # list of {id, name, seat}
        self.hands = {}            # seat -> list[card]
        self.hakem_seat = None
        self.trump = None
        self.current_trick = []    # list of {seat, card}
        self.turn_seat = None
        self.lead_suit = None
        self.tricks_won = {}       # team -> count (team 0 / team 1), reset each hand
        self.round_scores = {0: 0, 1: 0}  # hands (games) won
        self.phase = "waiting"     # waiting -> choosing_trump -> playing -> hand_over -> game_over
        self.log = []

    # ---------- setup ----------

    def add_player(self, user_id, name):
        if len(self.players) >= self.mode:
            return False
        seat = len(self.players)
        self.players.append({"id": user_id, "name": name, "seat": seat})
        return True

    def is_full(self):
        return len(self.players) == self.mode

    def team_of(self, seat):
        if self.mode == 4:
            return 0 if seat in (0, 2) else 1
        return seat  # 2-player: each seat is its own "team"

    def start_hand(self, hakem_seat=None):
        two_player = self.mode == 2
        deck = make_deck(two_player=two_player)
        per_player = len(deck) // self.mode
        self.hands = {p["seat"]: deck[i * per_player:(i + 1) * per_player] for i, p in enumerate(self.players)}
        self.hakem_seat = hakem_seat if hakem_seat is not None else random.choice([p["seat"] for p in self.players])
        self.trump = None
        self.current_trick = []
        self.lead_suit = None
        self.tricks_won = {0: 0, 1: 0}
        self.turn_seat = self.hakem_seat
        self.phase = "choosing_trump"
        self.log.append(f"New hand. Hakem is seat {self.hakem_seat}.")

    def choose_trump(self, seat, suit):
        if seat != self.hakem_seat or self.phase != "choosing_trump":
            return False, "not_your_turn"
        if suit not in SUITS:
            return False, "invalid_suit"
        self.trump = suit
        self.phase = "playing"
        self.turn_seat = self.hakem_seat
        self.log.append(f"Hakem chose {suit} as trump.")
        return True, None

    # ---------- playing ----------

    def legal_moves(self, seat):
        hand = self.hands[seat]
        if not self.current_trick:
            return hand
        lead_suit = self.lead_suit
        same_suit = [c for c in hand if c["suit"] == lead_suit]
        return same_suit if same_suit else hand

    def play_card(self, seat, suit, rank):
        if self.phase != "playing":
            return False, "not_playing_phase"
        if seat != self.turn_seat:
            return False, "not_your_turn"
        hand = self.hands[seat]
        card = next((c for c in hand if c["suit"] == suit and c["rank"] == rank), None)
        if card is None:
            return False, "card_not_in_hand"
        legal = self.legal_moves(seat)
        if card not in legal:
            return False, "must_follow_suit"

        hand.remove(card)
        if not self.current_trick:
            self.lead_suit = suit
        self.current_trick.append({"seat": seat, "card": card})

        if len(self.current_trick) == self.mode:
            winner_seat = self._resolve_trick()
            self.tricks_won[self.team_of(winner_seat)] += 1
            self.current_trick = []
            self.lead_suit = None
            self.turn_seat = winner_seat
            if all(len(h) == 0 for h in self.hands.values()):
                self._end_hand()
        else:
            order = [p["seat"] for p in self.players]
            idx = order.index(seat)
            self.turn_seat = order[(idx + 1) % len(order)]

        return True, None

    def _resolve_trick(self):
        trump_plays = [t for t in self.current_trick if t["card"]["suit"] == self.trump]
        pool = trump_plays if trump_plays else [t for t in self.current_trick if t["card"]["suit"] == self.lead_suit]
        best = max(pool, key=lambda t: t["card"]["rank"])
        return best["seat"]

    def _end_hand(self):
        needed = {2: 7, 4: 7}[self.mode] if self.mode == 4 else 5  # majority of tricks
        winner_team = 0 if self.tricks_won[0] > self.tricks_won[1] else 1
        self.round_scores[winner_team] += 1
        self.log.append(f"Hand over. Team {winner_team} wins the hand ({self.tricks_won}).")
        if self.round_scores[winner_team] >= 7:
            self.phase = "game_over"
        else:
            self.phase = "hand_over"

    def state_for(self, seat):
        """Serialize state visible to a given seat (hides other hands)."""
        return {
            "game_type": "hokm",
            "room_id": self.room_id,
            "mode": self.mode,
            "phase": self.phase,
            "players": self.players,
            "your_seat": seat,
            "your_hand": [{"suit": c["suit"], "rank": c["rank"], "label": rank_label(c["rank"])}
                          for c in self.hands.get(seat, [])],
            "hand_counts": {s: len(h) for s, h in self.hands.items()},
            "hakem_seat": self.hakem_seat,
            "trump": self.trump,
            "current_trick": [{"seat": t["seat"], "suit": t["card"]["suit"], "rank": t["card"]["rank"]}
                              for t in self.current_trick],
            "turn_seat": self.turn_seat,
            "tricks_won": self.tricks_won,
            "round_scores": self.round_scores,
        }
