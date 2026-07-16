"""
Backend server for the Telegram Mini App game hub.
100% free: no payments, no ads, no in-app purchases.

Games: Hokm (2p/4p) and Dice Duel (2p).

Run with:
    python server.py

Requires the static/ folder (frontend) next to this file.
"""
import os
import uuid
import time
from flask import Flask, request, jsonify, send_from_directory
from flask_socketio import SocketIO, join_room, leave_room, emit

from game_logic import HokmGame
from dice_logic import DiceGame

app = Flask(__name__, static_folder="static", static_url_path="")
socketio = SocketIO(app, cors_allowed_origins="*")

# ---- in-memory storage (swap for a real DB in production) ----
rooms = {}                          # room_id -> game object (HokmGame | DiceGame)
room_game_type = {}                 # room_id -> "hokm" | "dice"
waiting_queue = {                   # (game_type, mode) -> list of {sid, user_id, name}
    ("hokm", 2): [], ("hokm", 4): [], ("dice", 2): [],
}
sid_to_room = {}        # sid -> room_id
sid_to_seat = {}        # sid -> seat


def new_room_id():
    return uuid.uuid4().hex[:8]


def make_game(game_type, room_id, mode):
    if game_type == "hokm":
        return HokmGame(room_id, mode)
    if game_type == "dice":
        return DiceGame(room_id)
    raise ValueError("unknown game_type")


# ---------------- static frontend ----------------

@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


# ---------------- REST helpers ----------------

@app.route("/api/create_invite", methods=["POST"])
def create_invite():
    """Create a private room and return an invite code for a friend to join."""
    data = request.json or {}
    game_type = data.get("game_type", "hokm")
    mode = int(data.get("mode", 4 if game_type == "hokm" else 2))
    room_id = new_room_id()
    rooms[room_id] = make_game(game_type, room_id, mode)
    room_game_type[room_id] = game_type
    return jsonify({"room_id": room_id, "mode": mode, "game_type": game_type})


# ---------------- Socket.IO events ----------------

@socketio.on("connect")
def on_connect():
    emit("connected", {"sid": request.sid})


@socketio.on("disconnect")
def on_disconnect():
    sid = request.sid
    room_id = sid_to_room.pop(sid, None)
    sid_to_seat.pop(sid, None)
    for key in waiting_queue:
        waiting_queue[key] = [w for w in waiting_queue[key] if w["sid"] != sid]
    if room_id and room_id in rooms:
        emit("player_left", {"room_id": room_id}, room=room_id)


@socketio.on("join_by_code")
def join_by_code(data):
    """Join an existing room via invite code (used for friend invites)."""
    room_id = data.get("room_id")
    user_id = data.get("user_id")
    name = data.get("name", "Player")
    game = rooms.get(room_id)
    if not game:
        emit("error_msg", {"message": "room_not_found"})
        return
    ok = game.add_player(user_id, name)
    if not ok:
        emit("error_msg", {"message": "room_full"})
        return
    seat = game.players[-1]["seat"]
    sid_to_room[request.sid] = room_id
    sid_to_seat[request.sid] = seat
    join_room(room_id)
    emit("joined", {"room_id": room_id, "seat": seat, "mode": game.mode,
                     "game_type": room_game_type[room_id]})
    _broadcast_lobby(game)
    if game.is_full():
        _start_game(game)


@socketio.on("join_random")
def join_random(data):
    """Join the random-matchmaking queue for a given game type + mode."""
    game_type = data.get("game_type", "hokm")
    mode = int(data.get("mode", 4 if game_type == "hokm" else 2))
    if game_type == "dice":
        mode = 2  # Dice Duel is always 1v1
    key = (game_type, mode)
    if key not in waiting_queue:
        waiting_queue[key] = []
    user_id = data.get("user_id")
    name = data.get("name", "Player")
    entry = {"sid": request.sid, "user_id": user_id, "name": name}
    waiting_queue[key].append(entry)
    emit("queued", {"mode": mode, "game_type": game_type})

    if len(waiting_queue[key]) >= mode:
        group = waiting_queue[key][:mode]
        waiting_queue[key] = waiting_queue[key][mode:]
        room_id = new_room_id()
        game = make_game(game_type, room_id, mode)
        rooms[room_id] = game
        room_game_type[room_id] = game_type
        for member in group:
            game.add_player(member["user_id"], member["name"])
            seat = game.players[-1]["seat"]
            sid_to_room[member["sid"]] = room_id
            sid_to_seat[member["sid"]] = seat
            socketio.server.enter_room(member["sid"], room_id)
            socketio.emit("joined", {"room_id": room_id, "seat": seat, "mode": mode,
                                      "game_type": game_type}, to=member["sid"])
        _start_game(game)


def _start_game(game):
    if isinstance(game, HokmGame):
        game.start_hand()
    elif isinstance(game, DiceGame):
        game.start_match()
    _broadcast_state(game)


def _broadcast_lobby(game):
    emit("lobby_update", {
        "room_id": game.room_id,
        "players": game.players,
        "mode": game.mode,
        "needed": game.mode - len(game.players),
    }, room=game.room_id)


def _broadcast_state(game):
    for p in game.players:
        seat = p["seat"]
        for sid, s in list(sid_to_seat.items()):
            if s == seat and sid_to_room.get(sid) == game.room_id:
                socketio.emit("game_state", game.state_for(seat), to=sid)


# ---------------- Hokm-specific events ----------------

@socketio.on("choose_trump")
def on_choose_trump(data):
    room_id = sid_to_room.get(request.sid)
    seat = sid_to_seat.get(request.sid)
    game = rooms.get(room_id)
    if not game or not isinstance(game, HokmGame):
        return
    ok, err = game.choose_trump(seat, data.get("suit"))
    if not ok:
        emit("error_msg", {"message": err})
        return
    _broadcast_state(game)


@socketio.on("play_card")
def on_play_card(data):
    room_id = sid_to_room.get(request.sid)
    seat = sid_to_seat.get(request.sid)
    game = rooms.get(room_id)
    if not game or not isinstance(game, HokmGame):
        return
    ok, err = game.play_card(seat, data.get("suit"), int(data.get("rank")))
    if not ok:
        emit("error_msg", {"message": err})
        return
    _broadcast_state(game)
    if game.phase == "hand_over":
        socketio.sleep(2)
        game.start_hand(hakem_seat=(game.hakem_seat + 1) % game.mode)
        _broadcast_state(game)
    elif game.phase == "game_over":
        emit("game_over", {"round_scores": game.round_scores}, room=room_id)


# ---------------- Dice Duel-specific events ----------------

@socketio.on("roll_dice")
def on_roll_dice(data):
    room_id = sid_to_room.get(request.sid)
    seat = sid_to_seat.get(request.sid)
    game = rooms.get(room_id)
    if not game or not isinstance(game, DiceGame):
        return
    ok, err = game.roll(seat)
    if not ok:
        emit("error_msg", {"message": err})
        return
    _broadcast_state(game)
    if game.phase == "match_over":
        emit("game_over", {"wins": game.wins}, room=room_id)


@socketio.on("rematch_dice")
def on_rematch_dice(data):
    room_id = sid_to_room.get(request.sid)
    game = rooms.get(room_id)
    if not game or not isinstance(game, DiceGame):
        return
    game.start_match()
    _broadcast_state(game)


# ---------------- Shared events ----------------

@socketio.on("chat_message")
def on_chat_message(data):
    room_id = sid_to_room.get(request.sid)
    seat = sid_to_seat.get(request.sid)
    if not room_id:
        return
    emit("chat_message", {
        "seat": seat,
        "text": data.get("text", "")[:300],
        "ts": time.time(),
    }, room=room_id)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    socketio.run(app, host="0.0.0.0", port=port, debug=True)
