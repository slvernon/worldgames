#!/usr/bin/env python3
"""
fetch_players.py — per-player scorer stats for selected World Games teams.

WHAT THIS DOES
  For each configured team, fetch that team's fixtures from the Foireann open-data
  API using the ?involvedTeams=<teamId> query (the ONLY fixtures query that embeds
  the per-fixture `events` array), then aggregate SCORE events by scorer into a
  goals / points / total tally and write data/players/<slug>.json.

WHY ?involvedTeams (and not competition.id)
  The competition.id fixtures query strips events. The involvedTeams query returns,
  per fixture:
    events: [ { eventType:"SCORE", info:"GOAL"|"POINT", minute,
                team:<teamId>, relatedPersonId:<scorerPersonId> }, ... ]
    homeTeam/awayTeam.teamSheet: [ { personId, givenName, familyName, jerseyNumber } ]
  We match SCORE events whose `team` == our team, bucket by relatedPersonId, and
  resolve names from the teamSheets. Same public read key as fetch_results.py.

COVERAGE CAVEAT (real, upstream)
  Officials only record per-scorer events for SOME games (in practice the knockout
  rounds). Group games usually carry only the team total, no scorer events. So the
  tallies are "across games that HAVE scorer data", surfaced via gamesWithScorers /
  gamesTotal / unattributedScores so the UI can be honest about it.

  Fail-soft like fetch_results.py: any error logs and leaves existing files intact;
  always exits 0 (unless --strict) so CI stays green.

USAGE
  python3 fetch_players.py [--dry-run] [--verbose] [--strict]
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

# ---------------------------------------------------------------------------
# CONFIG
# ---------------------------------------------------------------------------

API_BASE = "https://open-data-prod.gaaservers.net/v1"
API_KEY = os.environ.get("WG_API_KEY") or "foir_prod_xYMlGrUPfwVUnxHCIcoRZWmuKMQNfPuQbAxphJIJBcPgS"
API_REFERER = "https://www.foireann.ie/"

# Teams to build player stats for: slug (filename) -> {id, name}.
TEAMS = [
    ("usgaa-southeast",  "8dfb940c-8f50-40a7-9132-030c9d464467", "USGAA Southeast"),
    ("new-york-camogie", "f08c98b9-878e-4e78-a31e-2770cbb5a485", "New York Camogie"),
]

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(HERE, "data", "players")

HTTP_TIMEOUT = 20
USER_AGENT = "wg-players-fetcher/1.0 (+github-actions)"
VERBOSE = False


def log(msg):
    print("[players] " + msg, flush=True)


def vlog(msg):
    if VERBOSE:
        print("[players:debug] " + msg, flush=True)


def api_get(url):
    """GET JSON with the public read key. Returns parsed object or None."""
    hdrs = {
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
        "Authorization": "bearer " + API_KEY,
        "Referer": API_REFERER,
    }
    req = urllib.request.Request(url, headers=hdrs, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
            if resp.getcode() != 200:
                vlog("  -> HTTP {0}".format(resp.getcode()))
                return None
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        vlog("  -> HTTPError {0}".format(e.code))
    except (urllib.error.URLError, OSError, ValueError, UnicodeDecodeError) as e:
        vlog("  -> {0}".format(e))
    return None


def fetch_team_fixtures(team_id):
    url = "{0}/fixtures?{1}".format(API_BASE, urllib.parse.urlencode({
        "involvedTeams": team_id,
        "size": "200",
    }))
    vlog("GET " + url)
    payload = api_get(url)
    if not isinstance(payload, dict):
        return None
    data = payload.get("data")
    return data if isinstance(data, list) else None


def full_name(p):
    name = ((p.get("givenName") or "") + " " + (p.get("familyName") or "")).strip()
    return name or None


def aggregate_team(team_id, fixtures):
    """Return (players list, meta dict) from a team's fixtures."""
    # personId -> {name, jersey} from every teamSheet belonging to this team.
    people = {}
    for m in fixtures:
        for side in ("homeTeam", "awayTeam"):
            t = m.get(side) or {}
            if t.get("id") != team_id:
                continue
            for p in t.get("teamSheet") or []:
                pid = p.get("personId")
                if not pid:
                    continue
                entry = people.setdefault(pid, {"name": None, "jersey": None})
                if entry["name"] is None:
                    entry["name"] = full_name(p)
                if entry["jersey"] is None and p.get("jerseyNumber") is not None:
                    entry["jersey"] = p.get("jerseyNumber")

    tally = {}                 # personId -> {goals, points, games:set(fixtureId)}
    games_total = 0            # completed games involving this team
    games_with_scorers = 0     # completed games that recorded >=1 SCORE event for us
    unattributed = 0           # SCORE events for us with no relatedPersonId

    for m in fixtures:
        if not m.get("isResult"):
            continue
        games_total += 1
        fid = m.get("id")
        my_scores_here = 0
        for e in m.get("events") or []:
            if e.get("eventType") != "SCORE" or e.get("team") != team_id:
                continue
            my_scores_here += 1
            pid = e.get("relatedPersonId")
            if not pid:
                unattributed += 1
                continue
            rec = tally.setdefault(pid, {"goals": 0, "points": 0, "games": set()})
            if str(e.get("info")).upper() == "GOAL":
                rec["goals"] += 1
            else:
                rec["points"] += 1
            if fid:
                rec["games"].add(fid)
        if my_scores_here > 0:
            games_with_scorers += 1

    players = []
    for pid, rec in tally.items():
        info = people.get(pid, {})
        goals, points = rec["goals"], rec["points"]
        players.append({
            "personId": pid,
            "name": info.get("name") or ("Player " + pid[:8]),
            "jersey": info.get("jersey"),
            "goals": goals,
            "points": points,
            "total": goals * 3 + points,
            "games": len(rec["games"]),
        })
    # Sort by total desc, then goals desc, then name.
    players.sort(key=lambda p: (-p["total"], -p["goals"], p["name"].lower()))

    meta = {
        "gamesTotal": games_total,
        "gamesWithScorers": games_with_scorers,
        "unattributedScores": unattributed,
    }
    return players, meta


def write_team(slug, team_id, name, players, meta, dry_run):
    path = os.path.join(DATA_DIR, slug + ".json")
    payload = {
        "slug": slug,
        "teamId": team_id,
        "teamName": name,
        "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "gamesTotal": meta["gamesTotal"],
        "gamesWithScorers": meta["gamesWithScorers"],
        "unattributedScores": meta["unattributedScores"],
        "players": players,
    }
    if dry_run:
        log("DRY-RUN would write {0} ({1} players, {2}/{3} games with scorers)".format(
            path, len(players), meta["gamesWithScorers"], meta["gamesTotal"]))
        return
    os.makedirs(DATA_DIR, exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, path)
    log("wrote {0} ({1} players, {2}/{3} games with scorers, {4} unattributed)".format(
        path, len(players), meta["gamesWithScorers"], meta["gamesTotal"], meta["unattributedScores"]))


def run(dry_run):
    log("teams={0}".format(len(TEAMS)))
    ok = failed = 0
    for slug, team_id, name in TEAMS:
        fixtures = fetch_team_fixtures(team_id)
        if fixtures is None:
            log("{0}: no fixtures payload — NOT clobbering".format(slug))
            failed += 1
            continue
        players, meta = aggregate_team(team_id, fixtures)
        try:
            write_team(slug, team_id, name, players, meta, dry_run)
            ok += 1
        except OSError as e:
            log("{0}: write failed: {1}".format(slug, e))
            failed += 1
    log("summary: wrote={0} failed={1}".format(ok, failed))
    return ok


def main():
    global VERBOSE
    ap = argparse.ArgumentParser(description="World Games per-player scorer stats")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--verbose", action="store_true")
    ap.add_argument("--strict", action="store_true", help="exit non-zero on total failure (debug only)")
    args = ap.parse_args()
    VERBOSE = args.verbose
    try:
        wrote = run(args.dry_run)
    except Exception as e:
        log("UNEXPECTED ERROR: {0}: {1}".format(type(e).__name__, e))
        wrote = 0
    if args.strict and wrote == 0:
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    main()
