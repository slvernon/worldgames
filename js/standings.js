/* WG.standings — group-stage table builder.
 * Attaches to window.WG.standings.
 * Pure function of a Division object; no DOM, no deps.
 *
 * Rules (GAA World Games, Camogie Div 1):
 *  - Only FINAL fixtures count toward the table.
 *  - 2 points for a win, 0 for a loss (draws not expected in knockout-feeding
 *    group play; if one occurs we award 1 pt each so the table stays coherent).
 *  - Tiebreak order (official GAA World Games):
 *      league points
 *      -> head-to-head result (ONLY when exactly two teams are level on points)
 *      -> score difference (total for minus total against)
 *      -> highest total score for
 *      -> most goals scored
 *      -> fewest goals conceded
 *      -> (penalty competition — cannot be modelled; falls through to name)
 *  - Zero games played => every row is all-zero, ranked alphabetically by name,
 *    and each row is flagged provisional:true.
 *  - Divisions WITHOUT hand-authored pools get a single combined table under key
 *    'all' (every team that appears in a group fixture).
 */
(function (WG) {
  'use strict';

  function totalOf(sc) {
    // sc is {goals,points,total} or {goals,points}; be defensive about total.
    if (!sc) return 0;
    if (typeof sc.total === 'number') return sc.total;
    return (sc.goals || 0) * 3 + (sc.points || 0);
  }

  function blankRow(teamId) {
    // PF/PA = total score for/against (goal=3,pt=1). GF/GA = goals only.
    return { teamId: teamId, P: 0, W: 0, L: 0, PF: 0, PA: 0, GF: 0, GA: 0, diff: 0, pts: 0, rank: 0 };
  }
  function goalsOf(sc) { return sc && typeof sc.goals === 'number' ? sc.goals : 0; }

  // Head-to-head points between exactly two tied teams, from their final meetings.
  function h2hPoints(finals, a, b) {
    var pa = 0, pb = 0;
    for (var i = 0; i < finals.length; i++) {
      var f = finals[i];
      var involvesBoth =
        (f.homeRef === a && f.awayRef === b) ||
        (f.homeRef === b && f.awayRef === a);
      if (!involvesBoth) continue;
      var ht = totalOf(f.home), at = totalOf(f.away);
      var homeIsA = f.homeRef === a;
      var aScore = homeIsA ? ht : at;
      var bScore = homeIsA ? at : ht;
      if (aScore > bScore) { pa += 2; }
      else if (bScore > aScore) { pb += 2; }
      else { pa += 1; pb += 1; }
    }
    return pa - pb; // >0 means a ahead
  }

  function computePool(div, teamIds) {
    var teams = div.teams || {};
    var rows = {};
    teamIds.forEach(function (id) { rows[id] = blankRow(id); });

    // Collect the FINAL group fixtures that are between two teams of THIS pool.
    var inPool = {};
    teamIds.forEach(function (id) { inPool[id] = true; });
    var finals = (div.fixtures || []).filter(function (f) {
      return f.stage === 'group' &&
        f.status === 'final' &&
        f.home && f.away &&
        inPool[f.homeRef] && inPool[f.awayRef] &&
        rows[f.homeRef] && rows[f.awayRef];
    });

    finals.forEach(function (f) {
      var h = rows[f.homeRef], a = rows[f.awayRef];
      var ht = totalOf(f.home), at = totalOf(f.away);
      var hg = goalsOf(f.home), ag = goalsOf(f.away);
      h.P++; a.P++;
      h.PF += ht; h.PA += at; h.GF += hg; h.GA += ag;
      a.PF += at; a.PA += ht; a.GF += ag; a.GA += hg;
      if (ht > at) { h.W++; a.L++; h.pts += 2; }
      else if (at > ht) { a.W++; h.L++; a.pts += 2; }
      else { h.pts += 1; a.pts += 1; } // draw
    });

    var list = teamIds.map(function (id) {
      var r = rows[id];
      r.diff = r.PF - r.PA;
      return r;
    });

    var anyPlayed = finals.length > 0;

    function nameOf(id) {
      return (teams[id] && teams[id].name) || id;
    }

    // Head-to-head only applies when EXACTLY two teams share a points total.
    var ptsCount = {};
    list.forEach(function (r) { ptsCount[r.pts] = (ptsCount[r.pts] || 0) + 1; });

    list.sort(function (x, y) {
      if (!anyPlayed) return nameOf(x.teamId).localeCompare(nameOf(y.teamId));
      if (y.pts !== x.pts) return y.pts - x.pts;                 // 1. league points
      if (ptsCount[x.pts] === 2) {                               // 2. head-to-head (two-team ties only)
        var h = h2hPoints(finals, x.teamId, y.teamId);
        if (h !== 0) return -h;                                  // positive => x ahead
      }
      if (y.diff !== x.diff) return y.diff - x.diff;             // 3. score difference
      if (y.PF !== x.PF) return y.PF - x.PF;                     // 4. highest total score for
      if (y.GF !== x.GF) return y.GF - x.GF;                     // 5. most goals scored
      if (x.GA !== y.GA) return x.GA - y.GA;                     // 6. fewest goals conceded
      return nameOf(x.teamId).localeCompare(nameOf(y.teamId));   // (penalties -> name)
    });

    list.forEach(function (r, i) {
      r.rank = i + 1;
      if (!anyPlayed) r.provisional = true;
    });

    return list;
  }

  function compute(div) {
    var out = {};
    var pools = div && div.pools;
    if (pools) {
      Object.keys(pools).forEach(function (p) {
        out[p] = computePool(div, pools[p] || []);
      });
      return out;
    }
    // No hand-authored pools: build one combined table of every real team that
    // appears in a group fixture (skip seed-token / winner-placeholder refs).
    var teams = (div && div.teams) || {};
    var seen = {};
    ((div && div.fixtures) || []).forEach(function (f) {
      if (f.stage !== 'group') return;
      [f.homeRef, f.awayRef].forEach(function (ref) {
        if (ref != null && teams[ref]) seen[ref] = true;
      });
    });
    var ids = Object.keys(seen);
    if (ids.length) out.all = computePool(div, ids);
    return out;
  }

  WG.standings = { compute: compute };
})(window.WG = window.WG || {});
