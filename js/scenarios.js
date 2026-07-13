/* WG.scenarios — qualification scenarios per pool.
 * Attaches to window.WG.scenarios.
 *
 * WG.scenarios.forPool(div, pool, standings) ->
 *   { [teamId]: { status:'clinched'|'eliminated'|'contention', need:'...' } }
 *
 * "standings" is the object returned by WG.standings.compute(div); we read
 * standings[pool] (array of Rows) for the current, final-only table.
 *
 * Cutoffs (Camogie Div 1):
 *   Pool A: top 3 -> Cup  (4th/5th -> Shield)
 *   Pool B: top 2 -> Cup  (3rd/4th -> Shield)
 * "Progress" here means reaching the Cup cutoff for a team's pool.
 *
 * HOW clinched / eliminated is determined:
 *   We enumerate every combination of results for the REMAINING (non-final)
 *   pool fixtures (win/loss for each — draws ignored for scenario purposes as
 *   they don't occur in this competition). For each combination we build the
 *   final table using the SAME ordering as WG.standings (pts -> diff -> H2H ->
 *   name) and record each team's finishing rank.
 *     - CLINCHED (top N): the team finishes within the cutoff in EVERY combo.
 *     - ELIMINATED:       the team finishes outside the cutoff in EVERY combo.
 *     - CONTENTION:       otherwise (some combos in, some out).
 *   Only meaningful when >=1 game played AND >=1 game remaining; otherwise all
 *   teams are marked 'contention' with a provisional 'need' string.
 *
 * Enumeration is bounded: a pool has at most a handful of remaining games late
 * in the tournament. We cap at 2^MAX_ENUM combos; above that we return a
 * conservative 'contention' with a generic need string (never wrongly clinch).
 */
(function (WG) {
  'use strict';

  var MAX_ENUM = 16; // 2^16 = 65536 combos worst case; pools are far smaller live.

  function totalOf(sc) {
    if (!sc) return 0;
    if (typeof sc.total === 'number') return sc.total;
    return (sc.goals || 0) * 3 + (sc.points || 0);
  }

  function nameOf(div, id) {
    return (div.teams && div.teams[id] && div.teams[id].name) || id;
  }

  function cutoffFor(pool) {
    return pool === 'A' ? 3 : 2;
  }

  // Build a ranked ordering (array of teamIds) from accumulated stats.
  function rankTeams(div, teamIds, stat, h2h) {
    var arr = teamIds.slice();
    arr.sort(function (x, y) {
      var sx = stat[x], sy = stat[y];
      if (sy.pts !== sx.pts) return sy.pts - sx.pts;
      var h = h2h(x, y);            // head-to-head before score difference
      if (h !== 0) return -h;
      if (sy.diff !== sx.diff) return sy.diff - sx.diff;
      return nameOf(div, x).localeCompare(nameOf(div, y));
    });
    return arr;
  }

  function forPool(div, pool, standings) {
    var teamIds = (div.pools && div.pools[pool]) || [];
    var result = {};
    if (!teamIds.length) return result;

    var cutoff = cutoffFor(pool);
    var inPool = {};
    teamIds.forEach(function (id) { inPool[id] = true; });

    var groupFx = (div.fixtures || []).filter(function (f) {
      return f.stage === 'group' && inPool[f.homeRef] && inPool[f.awayRef];
    });
    var finals = groupFx.filter(function (f) {
      return f.status === 'final' && f.home && f.away;
    });
    var remaining = groupFx.filter(function (f) {
      return !(f.status === 'final' && f.home && f.away);
    });

    var played = finals.length;
    var left = remaining.length;

    // Base (final-only) stats.
    function baseStat() {
      var s = {};
      teamIds.forEach(function (id) { s[id] = { pts: 0, PF: 0, PA: 0, diff: 0 }; });
      finals.forEach(function (f) {
        var h = s[f.homeRef], a = s[f.awayRef];
        var ht = totalOf(f.home), at = totalOf(f.away);
        h.PF += ht; h.PA += at; a.PF += at; a.PA += ht;
        if (ht > at) h.pts += 2;
        else if (at > ht) a.pts += 2;
        else { h.pts += 1; a.pts += 1; }
      });
      teamIds.forEach(function (id) { s[id].diff = s[id].PF - s[id].PA; });
      return s;
    }

    // Head-to-head over finals only (hypothetical remaining games use a small
    // nominal margin, so their H2H effect is captured via diff, not this fn).
    function h2hFinals(a, b) {
      var pa = 0, pb = 0;
      for (var i = 0; i < finals.length; i++) {
        var f = finals[i];
        var both = (f.homeRef === a && f.awayRef === b) ||
                   (f.homeRef === b && f.awayRef === a);
        if (!both) continue;
        var ht = totalOf(f.home), at = totalOf(f.away);
        var homeIsA = f.homeRef === a;
        var aS = homeIsA ? ht : at, bS = homeIsA ? at : ht;
        if (aS > bS) pa += 2; else if (bS > aS) pb += 2; else { pa++; pb++; }
      }
      return pa - pb;
    }

    // --- Not-meaningful cases: provisional 'contention' ---
    if (played < 1 || left < 1) {
      teamIds.forEach(function (id) {
        var need;
        if (left < 1) {
          // Group complete: read final table directly.
          var row = (standings && standings[pool] || []).filter(function (r) {
            return r.teamId === id;
          })[0];
          var rank = row ? row.rank : null;
          if (rank && rank <= cutoff) {
            result[id] = { status: 'clinched', need: 'Finished ' + ordinal(rank) + ' — into the Cup' };
          } else if (rank) {
            result[id] = { status: 'eliminated', need: 'Finished ' + ordinal(rank) + ' — into the Shield' };
          } else {
            result[id] = { status: 'contention', need: 'Awaiting final table' };
          }
          return;
        }
        need = 'Group not started — provisional';
        result[id] = { status: 'contention', need: need };
      });
      return result;
    }

    // --- Meaningful: enumerate remaining outcomes ---
    // If too many remaining games to enumerate, be conservative.
    if (left > MAX_ENUM) {
      teamIds.forEach(function (id) {
        result[id] = { status: 'contention', need: nextNeed(div, id, remaining, cutoff) };
      });
      return result;
    }

    // For each team: does it finish <=cutoff in ALL / NONE / SOME combos?
    var inAll = {}, inAny = {};
    // 'ambiguous' flags a team whose in/out at the cutoff was decided in some
    // combo by an unmodelled tiebreak (a tie on pts AND diff resolved only by
    // name, because the deciding head-to-head is an unplayed remaining game).
    // We downgrade such teams to 'contention' rather than asserting.
    var ambiguous = {};
    teamIds.forEach(function (id) { inAll[id] = true; inAny[id] = false; ambiguous[id] = false; });

    var combos = 1 << left; // 2^left
    // Nominal winning margin for hypothetical games so 'diff' moves sensibly.
    var MARGIN = 5;

    // Do teams a & b have an unplayed (remaining) head-to-head game between them?
    function h2hUnplayed(a, b) {
      for (var i = 0; i < remaining.length; i++) {
        var f = remaining[i];
        if ((f.homeRef === a && f.awayRef === b) ||
            (f.homeRef === b && f.awayRef === a)) return true;
      }
      return false;
    }

    for (var mask = 0; mask < combos; mask++) {
      var stat = baseStat();
      for (var b = 0; b < left; b++) {
        var fx = remaining[b];
        var homeWins = (mask >> b) & 1;
        var winner = homeWins ? fx.homeRef : fx.awayRef;
        var loser = homeWins ? fx.awayRef : fx.homeRef;
        stat[winner].pts += 2;
        stat[winner].diff += MARGIN;
        stat[loser].diff -= MARGIN;
      }
      var order = rankTeams(div, teamIds, stat, h2hFinals);
      for (var r = 0; r < order.length; r++) {
        var tid = order[r];
        var isIn = r < cutoff;
        if (!isIn) inAll[tid] = false;
        if (isIn) inAny[tid] = true;
      }
      // Guard: if the team straddling the cutoff boundary is only separated from
      // its neighbour by an unmodelled tiebreak (equal pts & diff, no finals H2H
      // to decide it, and their deciding game is still to be played), flag both
      // as ambiguous so we don't wrongly clinch/eliminate either.
      if (cutoff >= 1 && cutoff < order.length) {
        var last = order[cutoff - 1], first = order[cutoff];
        var sl = stat[last], sf = stat[first];
        if (sl.pts === sf.pts && sl.diff === sf.diff &&
            h2hFinals(last, first) === 0 && h2hUnplayed(last, first)) {
          ambiguous[last] = true;
          ambiguous[first] = true;
        }
      }
    }

    // Current live rank per team (from the standings we were handed), so a
    // contention message can be honest about where a team actually sits.
    var rankOf = {};
    (standings && standings[pool] || []).forEach(function (r) { rankOf[r.teamId] = r.rank; });

    teamIds.forEach(function (id) {
      var status, need;
      if (inAll[id] && !ambiguous[id]) {
        status = 'clinched';
        need = 'Guaranteed top ' + cutoff + ' — into the Cup';
      } else if (!inAny[id] && !ambiguous[id]) {
        status = 'eliminated';
        need = 'Cannot reach top ' + cutoff + ' — headed for the Shield';
      } else {
        status = 'contention';
        need = contentionNeed(div, id, remaining, cutoff, rankOf[id], teamIds.length);
      }
      result[id] = { status: status, need: need };
    });

    return result;
  }

  // Plain-English, position-aware hint for a team still in contention. Reads the
  // team's CURRENT rank so a leader isn't told to "win to reach top N", and names
  // its next game as a secondary hint.
  function contentionNeed(div, teamId, remaining, cutoff, rank, teamCount) {
    var inZone = rank && rank <= cutoff;
    var head;
    if (rank) {
      head = inZone
        ? 'Currently ' + ordinal(rank) + ' — holding a Cup place, not yet safe'
        : 'Currently ' + ordinal(rank) + (teamCount ? ' of ' + teamCount : '') +
          ' — needs to climb into the top ' + cutoff;
    } else {
      head = 'In the hunt for a top ' + cutoff + ' place';
    }
    // Secondary: name the earliest remaining game, if any.
    var mine = remaining.filter(function (f) {
      return f.homeRef === teamId || f.awayRef === teamId;
    });
    if (mine.length) {
      mine.sort(function (a, b) { return (a.date + a.time).localeCompare(b.date + b.time); });
      var g = mine[0];
      var oppId = g.homeRef === teamId ? g.awayRef : g.homeRef;
      var opp = (div.teams && div.teams[oppId] && div.teams[oppId].name) || oppId;
      head += ' · next: ' + opp;
    }
    return head;
  }

  function ordinal(n) {
    var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  WG.scenarios = { forPool: forPool };
})(window.WG = window.WG || {});
