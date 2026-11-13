#!/usr/bin/env python3
"""Export the derived data behind playground.html.

Usage:
    python3 scripts/pickleball/export_playground.py <stats_project_dir> [out.json]

Reads the hand-label tables of one match (shots.csv, rallies.csv, and
trajectories.csv as a cross-check) and writes one small JSON file holding only
derived values: which player (anonymized as Player A to D) hit the serve or
return, where it landed (feet), and the
depth band and lane that landing falls in.

What is kept out on purpose:
  * every model column (m_*), hashes, versions, clip names, notes, timestamps
  * any landing that was not seen by a person: a missing landing, or one the
    labeller marked as placed without seeing the bounce ("estimated")

Coordinates are in the hitter's view: x 0 to 20 ft left to right, y 22 (net)
to 44 (far baseline), so every serve and return travels "up" the court.
Standard library only.
"""
import csv
import json
import os
import sys

MATCH = "ppa26nat_watersjohns_v_johnsonjohnson"
NET_Y, BASELINE_Y, WIDTH = 22.0, 44.0, 20.0

# The published file carries no names. The source tables use real player codes;
# this private mapping turns them into Player A to D on export.
SOURCE_PLAYER = {
    "ALW": "A",  # Anna Leigh Waters
    "BJ": "B",  # Ben Johns
    "JO": "C",  # Jorja Johnson
    "JW": "D",  # JW Johnson
}
MATCH_LABEL = "2026 pro mixed doubles match"

TEAMS = [
    {"id": "team1", "name": "Players A and B", "players": ["A", "B"]},
    {"id": "team2", "name": "Players C and D", "players": ["C", "D"]},
]
PLAYERS = {"A": "Player A", "B": "Player B", "C": "Player C", "D": "Player D"}
PLAYER_TEAM = {p: t["id"] for t in TEAMS for p in t["players"]}


# ---- band and lane definitions (the stats project's own, framework section 3)
def serve_band(y):
    """Serve depth, measured from the receiver's baseline."""
    d = BASELINE_Y - y
    if d <= 3.0:
        return "deep"
    if d <= 7.5:
        return "mid"
    return "shallow"


def return_band(y):
    """Return depth, measured from the net."""
    d = y - NET_Y
    if d >= 19.0:
        return "deep"
    if d >= 12.0:
        return "mid"
    return "shallow"


def serve_lane(x, court):
    """A third of the 10 ft service court, named from the receiver."""
    if court == "right":  # target court is x 0 to 10
        if x < 10.0 / 3:
            return "sideline"
        if x < 20.0 / 3:
            return "body"
        return "middle"
    if court == "left":  # target court is x 10 to 20
        if x < 40.0 / 3:
            return "middle"
        if x < 50.0 / 3:
            return "body"
        return "sideline"
    return None


def return_lane(x):
    """A third of the full 20 ft court, in the returner's view."""
    if x < 6.67:
        return "left"
    if x <= 13.33:
        return "middle"
    return "right"


def read(path):
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def truthy(v):
    return str(v).strip().lower() in ("true", "1", "yes")


def build(src):
    base = os.path.join(src, "data", "matches", MATCH, "tables", "csv")
    shots = read(os.path.join(base, "shots.csv"))
    rallies = {(r["game"], r["rally_id"]): r for r in read(os.path.join(base, "rallies.csv"))}
    traj_path = os.path.join(base, "trajectories.csv")
    traj = {t["shot_id"]: t for t in read(traj_path)} if os.path.exists(traj_path) else {}

    # the third shot's hand-labelled type (drop / drive), keyed by rally
    third_type = {}
    for s in shots:
        if s["role"] == "third" and s["meta_source"] == "human" and s["type"] in ("drop", "drive"):
            third_type[(s["game"], s["rally_id"])] = s["type"]

    out = {"serve": [], "return": []}
    skipped = {"serve": {"no_landing": 0, "estimated": 0}, "return": {"no_landing": 0, "estimated": 0}}
    totals = {"serve": 0, "return": 0}
    for s in shots:
        role = s["role"]
        if role not in out:
            continue
        totals[role] += 1
        if s["to_x"] == "" or s["to_y"] == "" or s["to_kind"] not in ("bounce", "out"):
            skipped[role]["no_landing"] += 1
            continue
        if truthy(s["meta_estimated"]):
            skipped[role]["estimated"] += 1
            continue
        key = (s["game"], s["rally_id"])
        r = rallies[key]
        hitter = s["hitter"]
        who = SOURCE_PLAYER[hitter]  # anonymized code written to the file
        x, y = float(s["to_x"]), float(s["to_y"])
        # hitter's view: flip when the hitter is on the far side of the camera
        if hitter in r["far"].split(";"):
            x, y = WIDTH - x, BASELINE_Y - y
        elif hitter not in r["near"].split(";"):
            raise SystemExit("hitter %s not on either side in %s" % (hitter, key))
        x, y = round(x, 2), round(y, 2)
        is_out = s["to_kind"] == "out"
        if not is_out and y < NET_Y:
            raise SystemExit("landing on the hitter's own half in %s" % (key,))
        court = r["server_court"] or None
        if role == "serve":
            band = None if is_out else serve_band(y)
            lane = None if is_out else serve_lane(x, court)
        else:
            band = None if is_out else return_band(y)
            lane = None if is_out else return_lane(x)
        row = {
            "g": int(s["game"]),
            "id": s["rally_id"],
            "t": PLAYER_TEAM[who],
            "w": who,
            "ct": court,
            "p": r["returning_parity"] or None,
            "x": x,
            "y": y,
            "o": 1 if is_out else 0,
            "b": band,
            "l": lane,
        }
        if role == "return":
            row["t3"] = third_type.get(key)

        # cross-check against the project's own derived table, when present
        t = traj.get(s["shot_id"])
        if t:
            assert t["to_src"] == "human", (key, role, t["to_src"])
            assert abs(float(t["bx_h"]) - x) < 0.011 and abs(float(t["by_h"]) - y) < 0.011, (key, role)
            if not is_out:
                assert (t["serve_band"] or t["return_band"]) == band, (key, role)
                if role == "return":
                    assert t["b_third"] == lane, (key, role)
        out[role].append(row)

    return {
        "match": MATCH_LABEL,
        "teams": TEAMS,
        "players": PLAYERS,
        "games": sorted({int(r["game"]) for r in rallies.values()}),
        "n_rallies": len(rallies),
        "n_shots": len(shots),
        "totals": totals,
        "not_counted": skipped,
        "serves": out["serve"],
        "returns": out["return"],
    }


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    here = os.path.dirname(os.path.abspath(__file__))
    dest = argv[2] if len(argv) > 2 else os.path.join(here, "..", "..", "data", "pickleball", "serves_returns.json")
    data = build(argv[1])
    os.makedirs(os.path.dirname(os.path.abspath(dest)), exist_ok=True)
    with open(dest, "w", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"))
        f.write("\n")
    print("wrote %s (%d bytes)" % (os.path.normpath(dest), os.path.getsize(dest)))
    print("serves %d, returns %d, not counted %s" % (len(data["serves"]), len(data["returns"]), data["not_counted"]))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
