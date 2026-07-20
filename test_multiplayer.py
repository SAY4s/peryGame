import socketio
import time
import requests
import sys

SERVER = "http://127.0.0.1:5000"

def test_hokm_2player():
    print("\n=== HOKM 2-PLAYER TEST ===")
    r = requests.post(f"{SERVER}/api/create_invite", json={"mode": 2}).json()
    room_id = r["room_id"]
    print("created room:", room_id)

    states = {}
    errors = []

    def make_client(name):
        sio = socketio.Client()
        states[name] = {"state": None, "seat": None}

        @sio.on("joined")
        def on_joined(data):
            states[name]["seat"] = data["seat"]
            print(f"[{name}] joined as seat {data['seat']}")

        @sio.on("game_state")
        def on_state(data):
            states[name]["state"] = data

        @sio.on("error_msg")
        def on_err(data):
            errors.append((name, data))
            print(f"[{name}] ERROR:", data)

        sio.connect(SERVER)
        return sio

    p1 = make_client("P1")
    p1.emit("join_by_code", {"room_id": room_id, "user_id": "u1", "name": "Alice"})
    time.sleep(0.5)
    p2 = make_client("P2")
    p2.emit("join_by_code", {"room_id": room_id, "user_id": "u2", "name": "Bob"})
    time.sleep(1)

    assert states["P1"]["state"] is not None, "P1 never got game_state"
    assert states["P2"]["state"] is not None, "P2 never got game_state"
    print("Both players received initial game_state. Phase:", states["P1"]["state"]["phase"])
    assert states["P1"]["state"]["phase"] == "choosing_trump"

    hakem_seat = states["P1"]["state"]["hakem_seat"]
    hakem_client = p1 if states["P1"]["seat"] == hakem_seat else p2
    hakem_name = "P1" if hakem_client is p1 else "P2"
    print(f"Hakem is seat {hakem_seat} ({hakem_name})")

    hakem_client.emit("choose_trump", {"suit": "spades"})
    time.sleep(0.5)
    assert states["P1"]["state"]["phase"] == "playing", "trump not applied"
    assert states["P1"]["state"]["trump"] == "spades"
    print("Trump chosen -> phase is now 'playing'. Trump:", states["P1"]["state"]["trump"])

    # Play enough tricks to finish an entire hand, always choosing a legal card
    # (follow suit when possible) driven by the server's turn_seat.
    clients_by_seat = {states["P1"]["seat"]: p1, states["P2"]["seat"]: p2}
    max_turns = 60
    for i in range(max_turns):
        state = states["P1"]["state"]
        if state["phase"] != "playing":
            break
        turn_seat = state["turn_seat"]
        turn_name = "P1" if states["P1"]["seat"] == turn_seat else "P2"
        my_hand = states[turn_name]["state"]["your_hand"]
        current_trick = states[turn_name]["state"]["current_trick"]

        if current_trick:
            lead_suit = current_trick[0]["suit"]
            same_suit_cards = [c for c in my_hand if c["suit"] == lead_suit]
            card = same_suit_cards[0] if same_suit_cards else my_hand[0]
        else:
            card = my_hand[0]

        clients_by_seat[turn_seat].emit("play_card", {"suit": card["suit"], "rank": card["rank"]})
        time.sleep(0.35)
        new_phase = states["P1"]["state"]["phase"]
        print(f"  turn {i}: seat {turn_seat} ({turn_name}) played {card['suit']} {card['rank']} -> phase={new_phase}")
        if new_phase == "hand_over":
            print("  Hand finished! Round scores:", states["P1"]["state"]["round_scores"])
            break

    assert not errors, f"Unexpected errors during play: {errors}"
    print("Full hand played with no rule-violation errors.")

    p1.disconnect()
    p2.disconnect()
    print("HOKM 2-PLAYER TEST PASSED")


def test_dice_duel():
    print("\n=== DICE DUEL TEST ===")
    r = requests.post(f"{SERVER}/api/create_invite", json={"mode": 2, "game_type": "dice"}).json()
    room_id = r["room_id"]
    print("created dice room:", room_id, r)

    states = {}
    errors = []

    def make_client(name):
        sio = socketio.Client()
        states[name] = {"state": None, "seat": None}

        @sio.on("joined")
        def on_joined(data):
            states[name]["seat"] = data["seat"]
            print(f"[{name}] joined as seat {data['seat']}")

        @sio.on("game_state")
        def on_state(data):
            states[name]["state"] = data

        @sio.on("error_msg")
        def on_err(data):
            errors.append((name, data))
            print(f"[{name}] ERROR:", data)

        sio.connect(SERVER)
        return sio

    p1 = make_client("P1")
    p1.emit("join_by_code", {"room_id": room_id, "user_id": "u1", "name": "Alice"})
    time.sleep(0.5)
    p2 = make_client("P2")
    p2.emit("join_by_code", {"room_id": room_id, "user_id": "u2", "name": "Bob"})
    time.sleep(1)

    assert states["P1"]["state"] is not None, "P1 never got dice game_state"
    assert states["P1"]["state"]["game_type"] == "dice"
    print("Both players got dice game_state. Phase:", states["P1"]["state"]["phase"])

    clients_by_seat = {states["P1"]["seat"]: p1, states["P2"]["seat"]: p2}

    rounds_played = 0
    while states["P1"]["state"]["phase"] not in ("match_over",) and rounds_played < 20:
        clients_by_seat[0].emit("roll_dice", {})
        clients_by_seat[1].emit("roll_dice", {})
        time.sleep(0.4)
        rounds_played += 1
        print(f"  round attempt {rounds_played}: phase={states['P1']['state']['phase']} wins={states['P1']['state'].get('wins')}")

    assert not errors, f"Unexpected errors during dice play: {errors}"
    assert states["P1"]["state"]["phase"] == "match_over", "match never finished"
    print("Final wins:", states["P1"]["state"]["wins"])
    print("DICE DUEL TEST PASSED")

    p1.disconnect()
    p2.disconnect()


if __name__ == "__main__":
    try:
        test_hokm_2player()
    except Exception as e:
        print("HOKM TEST FAILED:", e)
        sys.exit(1)
    try:
        test_dice_duel()
    except Exception as e:
        print("DICE TEST FAILED:", e)
        sys.exit(1)
    print("\nALL TESTS PASSED")
