#!/usr/bin/env python3
"""
fetch_results.py — GAA World Games live-score fetcher (stdlib only).

WHAT THIS DOES
  For each tournament division, attempt to:
    1. obtain an anonymous Bearer token from Keycloak (realm 'gaa', client 'gaa-direct'),
    2. fetch that division's fixtures from the Foireann open-data API
       (keyed by division/competition id + season "2026"),
    3. normalise the response into the WG Fixture schema and write
       data/<slug>.json.

  On ANY failure (no token, HTTP error, unexpected shape, empty payload) it logs
  clearly and EXITS 0 WITHOUT clobbering existing files. The web app then falls
  back to its baked schedule + any manually-entered scores.

  Because no working anonymous token/endpoint has been confirmed yet (reads return
  302/401 and no scores exist), this script is safe to run today: it will simply
  log that it could not fetch and leave data/ untouched.

  >>> THE TWO PLACES YOU MUST EDIT ONCE YOU HAVE A WORKING TOKEN/ENDPOINT <<<
      Search for the markers:  # PASTE-TOKEN-HERE   and   # PASTE-ENDPOINT-HERE

USAGE
  python3 fetch_results.py            # live run (writes data/*.json on success)
  python3 fetch_results.py --dry-run  # do everything except write files
  python3 fetch_results.py --verbose  # extra logging

  Exit code is ALWAYS 0 unless you pass --strict (used only for local debugging).
"""

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta
import urllib.error
import urllib.parse
import urllib.request

# ---------------------------------------------------------------------------
# CONFIG
# ---------------------------------------------------------------------------

TOURNAMENT_ID = "13bbca25-b104-492b-8de4-198cc9e5fbd7"
SEASON = "2026"

# CONFIRMED public open-data API (the same endpoint + key foireann.ie itself uses,
# captured from the live site). The key is a publishable, read-only key shipped in
# Foireann's public web bundle to every anonymous visitor — not a login token.
# Overridable via env in case Foireann rotates it (set WG_API_KEY as a GH secret).
API_BASE = "https://open-data-prod.gaaservers.net/v1"
# Use the env override ONLY if it's non-empty. GitHub Actions injects an EMPTY
# string for an unset secret, and os.environ.get would return that "" (the key
# exists, just blank) instead of the default -> empty bearer token -> HTTP 401.
API_KEY = os.environ.get("WG_API_KEY") or "foir_prod_xYMlGrUPfwVUnxHCIcoRZWmuKMQNfPuQbAxphJIJBcPgS"
API_REFERER = "https://www.foireann.ie/"

# Division registry: slug -> {id, name}. Order matches the app's division list.
DIVISIONS = [
    ("intl-football-1", "d40dbd8a-2dba-4b12-befb-e734a3606fda", "International Men's Football Division 1"),
    ("intl-football-2", "13047959-a78e-42ef-b170-7473e812ad92", "International Men's Football Division 2"),
    ("intl-football-3", "ab0954b9-6ddc-4c99-bd70-0c4b4c6a9135", "International Men's Football Division 3"),
    ("intl-lgfa-1",     "c68943b0-f16b-4430-9d76-6c5f7dfbe3c0", "International LGFA Division 1"),
    ("intl-lgfa-2",     "91bc1ed7-8bba-4fb3-bd11-107bab50b6e5", "International LGFA Division 2"),
    ("intl-lgfa-3",     "36a70955-bdcf-43c3-9665-e74c8d9bf62d", "International LGFA Division 3"),
    ("intl-hurling-1",  "9299af37-700b-4cd6-8095-9a1a885c758d", "International Hurling Division 1"),
    ("intl-hurling-2",  "95d2587d-6e25-44c5-b7af-adc011086e2b", "International Hurling Division 2"),
    ("intl-camogie-1",  "7ece7fe6-087d-4d96-99c9-392c9a446081", "International Camogie Division 1"),
    ("intl-camogie-2",  "9948af9c-1ce8-440e-8c1b-b10f8ac12726", "International Camogie Division 2"),
    ("open-football",   "4a6be341-9852-4849-856c-b1d331744953", "Open Football"),
    ("open-lgfa",       "8917d15f-feb5-466d-a22c-00eb9443e9b4", "Open LGFA"),
    ("open-hurling",    "a544eda6-8ad4-4274-9f3b-27d7ab69f119", "Open Hurling"),
    ("open-camogie",    "706b1bad-2381-4444-8391-ac9fc2e1561d", "Open Camogie"),
]

HERE = os.path.dirname(os.path.abspath(__file__))
# Live overlays go in data/live/ so they never clobber the hand-authored baked
# schedules in data/ (e.g. data/intl-camogie-1.json). The app reads both.
DATA_DIR = os.path.join(HERE, "data", "live")

HTTP_TIMEOUT = 20  # seconds
USER_AGENT = "wg-fetcher/1.0 (+github-actions)"

# ---------------------------------------------------------------------------
# logging
# ---------------------------------------------------------------------------

VERBOSE = False


def log(msg):
    print("[fetch] " + msg, flush=True)


def vlog(msg):
    if VERBOSE:
        print("[fetch:debug] " + msg, flush=True)


# ---------------------------------------------------------------------------
# HTTP helpers (stdlib only)
# ---------------------------------------------------------------------------

def http_request(url, data=None, headers=None, method=None):
    """Return (status, body_bytes). Raises urllib.error on transport failure."""
    hdrs = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    if headers:
        hdrs.update(headers)
    req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
        return resp.getcode(), resp.read()


def http_json(url, data=None, headers=None, method=None):
    status, body = http_request(url, data=data, headers=headers, method=method)
    try:
        return status, json.loads(body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return status, None


# ---------------------------------------------------------------------------
# TOKEN
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# FETCH + NORMALISE  (confirmed open-data endpoint + publishable key)
# ---------------------------------------------------------------------------

def api_headers():
    return {
        "Authorization": "bearer " + API_KEY,
        "Referer": API_REFERER,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def build_fixtures_url(division_id, is_result):
    """Open-data fixtures endpoint, keyed by competition id.
    isResult=false -> scheduled/upcoming fixtures; isResult=true -> played results."""
    return "{0}/fixtures?{1}".format(API_BASE, urllib.parse.urlencode({
        "competition.id": division_id,
        "isResult": "true" if is_result else "false",
        "size": "200",
    }))


def fetch_division_raw(division_id):
    """Fetch both scheduled fixtures and results; return a merged list of records
    (results override scheduled by id), or None on failure."""
    merged = {}
    got_any = False
    for is_result in (False, True):
        url = build_fixtures_url(division_id, is_result)
        try:
            vlog("GET " + url)
            status, payload = http_json(url, headers=api_headers())
            if status == 200 and isinstance(payload, dict):
                got_any = True
                for rec in payload.get("data", []) or []:
                    if isinstance(rec, dict) and rec.get("id"):
                        merged[rec["id"]] = rec
            else:
                vlog("  -> HTTP {0}".format(status))
        except urllib.error.HTTPError as e:
            vlog("  -> HTTPError {0}".format(e.code))
        except (urllib.error.URLError, OSError) as e:
            vlog("  -> {0}".format(e))
    if not got_any:
        return None
    return list(merged.values())


def parse_gp(goals, points):
    """Return {goals,points,total}, or None only if BOTH components are missing.

    A half-entered upstream score (one of goals/points is null while the other
    is present) is treated as a real score with the missing side filled as 0, so
    the game still renders instead of vanishing. If an official later completes
    the entry, a subsequent poll overwrites it with the full score."""
    if goals is None and points is None:
        return None
    try:
        g = int(goals if goals is not None else 0)
        p = int(points if points is not None else 0)
    except (TypeError, ValueError):
        return None
    return {"goals": g, "points": p, "total": g * 3 + p}


def split_dt_local(dt):
    """ISO UTC datetime (e.g. '2026-07-17T12:20:00Z') -> ('YYYY-MM-DD','HH:MM')
    in Irish local time. July is IST = UTC+1, so we add one hour."""
    if not dt or "T" not in str(dt):
        return (str(dt) if dt else None, None)
    try:
        d = datetime.fromisoformat(str(dt).replace("Z", "+00:00")) + timedelta(hours=1)
        return (d.strftime("%Y-%m-%d"), d.strftime("%H:%M"))
    except ValueError:
        parts = str(dt).split("T")
        return (parts[0], parts[1][:5])


def extract_score(m, side, tobj):
    """Pull a GAA goals-points score for 'home'/'away' from whatever shape the
    feed uses. Field names beyond homeScore/awayScore are best-effort until a real
    result is observed."""
    sc = m.get(side + "Score")
    if isinstance(sc, dict):
        return parse_gp(sc.get("goals"), sc.get("points"))
    g = m.get(side + "Goals")
    p = m.get(side + "Points")
    if g is None and isinstance(tobj, dict):
        g = tobj.get("goals")
    if p is None and isinstance(tobj, dict):
        p = tobj.get("points")
    return parse_gp(g, p)


def normalise_fixtures(raw, division_id):
    """Map the open-data payload (a list of fixture records) to WG Fixture objects,
    plus a teams id->name map. Returns ([], {}) if there's nothing usable."""
    items = raw if isinstance(raw, list) else []
    fixtures = []
    teams = {}

    def team_ref(tobj, fallback):
        tid = tobj.get("id") if isinstance(tobj, dict) else None
        tname = tobj.get("name") if isinstance(tobj, dict) else None
        if tid:
            teams[str(tid)] = {"id": str(tid), "name": str(tname) if tname else str(tid)}
            return str(tid)
        # team not yet assigned (e.g. knockout) — use its name or the placeholder.
        return str(tname or fallback or "")

    for i, m in enumerate(items):
        if not isinstance(m, dict):
            continue
        home = m.get("homeTeam") if isinstance(m.get("homeTeam"), dict) else {}
        away = m.get("awayTeam") if isinstance(m.get("awayTeam"), dict) else {}
        home_ref = team_ref(home, m.get("homeTeamFallbackName"))
        away_ref = team_ref(away, m.get("awayTeamFallbackName"))

        home_score = extract_score(m, "home", home)
        away_score = extract_score(m, "away", away)

        raw_status = str(m.get("status") or "").lower()
        if m.get("isResult") or home_score or away_score or raw_status in (
                "completed", "complete", "final", "result", "played", "ft", "fulltime"):
            status = "final"
        elif raw_status in ("live", "inprogress", "in_progress", "playing"):
            status = "live"
        else:
            status = "scheduled"

        date_str, time_str = split_dt_local(m.get("startDate"))
        rnd = str(m.get("round") or "").strip()
        stage = "group" if re.match(r"^round\s*\d+$", rnd, re.I) else "knockout"
        place = m.get("place")
        pitch = place.get("name") if isinstance(place, dict) else None

        fixtures.append({
            "id": str(m.get("id") or "{0}-{1}".format(division_id, i)),
            "stage": stage,
            "date": date_str,
            "time": time_str,
            "pitch": pitch,
            "pool": None,           # open-data doesn't expose pool; baked schedule has it
            "round": rnd or None,
            "homeRef": home_ref,
            "awayRef": away_ref,
            "home": home_score,
            "away": away_score,
            "status": status,
        })

    return fixtures, teams


# ---------------------------------------------------------------------------
# WRITE
# ---------------------------------------------------------------------------

def write_division(slug, fixtures, teams, dry_run):
    """
    Write data/<slug>.json — the live overlay the app merges over the baked schedule.
    Carries the full posted schedule (fixtures with date/time/pitch/teams/scores/status)
    plus a teams id->name map, so newly-posted rounds/divisions render with real names.
    """
    path = os.path.join(DATA_DIR, slug + ".json")
    payload = {
        "slug": slug,
        "season": SEASON,
        "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "teams": teams,
        "fixtures": fixtures,
    }
    if dry_run:
        log("DRY-RUN would write {0} ({1} fixtures, {2} teams)".format(path, len(fixtures), len(teams)))
        return
    os.makedirs(DATA_DIR, exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, path)  # atomic
    log("wrote {0} ({1} fixtures)".format(path, len(fixtures)))


# ---------------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------------

def run(dry_run):
    log("season={0} tournament={1} divisions={2}".format(SEASON, TOURNAMENT_ID, len(DIVISIONS)))
    if dry_run:
        log("DRY-RUN: no files will be written")

    ok, skipped, failed = 0, 0, 0
    for slug, division_id, name in DIVISIONS:
        raw = fetch_division_raw(division_id)
        if raw is None:
            vlog("{0}: no payload from API".format(slug))
            skipped += 1
            continue
        fixtures, teams = normalise_fixtures(raw, division_id)
        if not fixtures:
            log("{0}: payload had no usable fixtures — NOT clobbering".format(slug))
            failed += 1
            continue
        try:
            write_division(slug, fixtures, teams, dry_run)
            ok += 1
        except OSError as e:
            log("{0}: write failed: {1}".format(slug, e))
            failed += 1

    log("summary: wrote={0} skipped(no-data)={1} failed={2}".format(ok, skipped, failed))
    if ok == 0:
        log("no live data fetched — app will use baked schedule + manual scores (this is fine).")
    return ok


def main():
    global VERBOSE
    ap = argparse.ArgumentParser(description="GAA World Games live-score fetcher")
    ap.add_argument("--dry-run", action="store_true", help="do everything except write files")
    ap.add_argument("--verbose", action="store_true", help="extra debug logging")
    ap.add_argument("--strict", action="store_true",
                    help="exit non-zero on total failure (debugging only; NOT for CI)")
    args = ap.parse_args()
    VERBOSE = args.verbose

    try:
        wrote = run(args.dry_run)
    except Exception as e:  # never let CI go red on a transient upstream issue
        log("UNEXPECTED ERROR: {0}: {1}".format(type(e).__name__, e))
        wrote = 0

    if args.strict and wrote == 0:
        sys.exit(1)
    sys.exit(0)  # default: always succeed so the workflow stays green


if __name__ == "__main__":
    main()
