/* WG.forecast — Monte-Carlo "chance to win the title" per team.
 *
 * WG.forecast.titleChances(div, ratings) -> { byTeam:{id:pct}, label, ok } | null
 *
 * Simulates the rest of the tournament many times from the CURRENT REAL results
 * (never hypothetical picks): remaining group games decide seeds, then the
 * knockout is played out, using the prediction ratings as per-game win odds.
 *
 * Coverage (best-effort):
 *  - FULL division (Camogie Div 1): pools + baked knockout seed tokens (A1..B4,
 *    W:matchId) -> P(win the CUP).
 *  - SINGLE-GROUP divisions whose knockout refs are plain positions ("1st","2nd")
 *    and "Winner <round>" -> P(win the single Title.
 *  - Divisions that seed the knockout from unknown pools ("1st Pool A" with no
 *    pool membership in the feed) return null and simply show no column.
 *
 * Results are cached per division until a real score changes.
 */
(function (WG) {
  'use strict';

  var SIMS = 4000;
  var cache = {};

  function tot(s) {
    if (!s) return null;
    return (typeof s.total === 'number') ? s.total : ((s.goals || 0) * 3 + (s.points || 0));
  }
  function isFinal(f) { return f && f.status === 'final' && tot(f.home) != null && tot(f.away) != null; }
  function ratingOf(r, id) { return (r && r.ratings && r.ratings[id]) || 0; }
  // Directional win prob for the home side, from the rating gap.
  function pHome(r, h, a) {
    var p = 1 / (1 + Math.exp(-((ratingOf(r, h) - ratingOf(r, a)) / 6)));
    return p < 0.02 ? 0.02 : (p > 0.98 ? 0.98 : p);
  }
  function normRound(x) { return String(x == null ? '' : x).toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function ordinalOf(ref) {
    var m = /^\s*(\d+)\s*(?:st|nd|rd|th)?\s*$/i.exec(String(ref == null ? '' : ref));
    return m ? parseInt(m[1], 10) : null;
  }

  // A signature of the real results, so we only re-simulate when scores change.
  function realSig(div) {
    var s = [];
    (div.fixtures || []).forEach(function (f) { if (isFinal(f)) s.push(f.id + ':' + tot(f.home) + '-' + tot(f.away)); });
    (div.knockout || []).forEach(function (k) { if (isFinal(k)) s.push(k.id + ':' + tot(k.home) + '-' + tot(k.away)); });
    return (div.slug || '?') + '|' + s.sort().join(',');
  }

  // Rank a set of team ids from real finals + simulated remaining games.
  function rankGroup(teamIds, groupFx, ratings, jitter) {
    var pts = {}, diff = {}, inSet = {};
    teamIds.forEach(function (id) { pts[id] = 0; diff[id] = 0; inSet[id] = 1; });
    groupFx.forEach(function (f) {
      var h = f.homeRef, a = f.awayRef;
      if (!inSet[h] || !inSet[a]) return;
      var hw, m;
      if (isFinal(f)) {
        var ht = tot(f.home), at = tot(f.away);
        if (ht === at) { pts[h]++; pts[a]++; return; }
        hw = ht > at; m = Math.abs(ht - at);
      } else {
        hw = Math.random() < pHome(ratings, h, a);
        m = 1 + Math.floor(Math.random() * 8);
      }
      if (hw) { pts[h] += 2; diff[h] += m; diff[a] -= m; }
      else { pts[a] += 2; diff[a] += m; diff[h] -= m; }
    });
    return teamIds.slice().sort(function (x, y) {
      return (pts[y] - pts[x]) || (diff[y] - diff[x]) ||
        (ratingOf(ratings, y) - ratingOf(ratings, x)) || (jitter[x] - jitter[y]);
    });
  }

  // Play out a set of knockout matches; returns { matchId: winnerTeamId }.
  // resolveSeed(ref, winners) -> teamId|null resolves refs to teams.
  function playKnockout(matches, resolveSeed, ratings) {
    var winners = {};
    for (var pass = 0; pass < matches.length + 2; pass++) {
      var changed = false;
      for (var i = 0; i < matches.length; i++) {
        var m = matches[i];
        if (winners[m.id]) continue;
        var h = resolveSeed(m.homeRef, winners);
        var a = resolveSeed(m.awayRef, winners);
        if (!h || !a) continue;
        if (isFinal(m)) {
          var ht = tot(m.home), at = tot(m.away);
          winners[m.id] = (at > ht) ? a : h;
        } else {
          winners[m.id] = (Math.random() < pHome(ratings, h, a)) ? h : a;
        }
        changed = true;
      }
      if (!changed) break;
    }
    return winners;
  }

  // ---- FULL division (pools + baked seed-token knockout) -> Cup champion ----
  function fullChances(div, ratings) {
    var pools = div.pools, ko = div.knockout || [];
    var cupFinal = ko.filter(function (k) { return k.bracket === 'cup' && k.roundLabel === 'Final'; })[0];
    if (!cupFinal) return null;
    var groupFx = (div.fixtures || []).filter(function (f) { return f.stage === 'group'; });
    var teamsAll = Object.keys(div.teams || {});
    var poolKeys = Object.keys(pools);
    var counts = {}; teamsAll.forEach(function (id) { counts[id] = 0; });

    for (var s = 0; s < SIMS; s++) {
      var jitter = {}; teamsAll.forEach(function (id) { jitter[id] = Math.random(); });
      var seedMap = {};
      poolKeys.forEach(function (p) {
        rankGroup(pools[p] || [], groupFx, ratings, jitter).forEach(function (id, i) { seedMap[p + (i + 1)] = id; });
      });
      var resolveSeed = function (ref, winners) {
        if (div.teams[ref]) return ref;
        if (/^[AB]\d+$/.test(ref)) return seedMap[ref] || null;
        var w = /^W:(.+)$/.exec(ref); if (w) return winners[w[1]] || null;
        return null;
      };
      var champ = playKnockout(ko, resolveSeed, ratings)[cupFinal.id];
      if (champ) counts[champ]++;
    }
    var out = {}; teamsAll.forEach(function (id) { out[id] = counts[id] / SIMS * 100; });
    return { byTeam: out, label: 'Cup', ok: true };
  }

  // ---- SINGLE-GROUP division (ordinal seeds + Winner<round>) -> Title ----
  function genericChances(div, ratings) {
    var kos = (div.fixtures || []).filter(function (f) { return f.stage === 'knockout'; });
    if (!kos.length) return null;
    var teams = div.teams || {};

    var byRound = {};
    kos.forEach(function (k) { var r = normRound(k.round); if (!r) return; byRound[r] = byRound[r] ? 'DUP' : k; });
    var finals = kos.filter(function (k) { return normRound(k.round) === 'FINAL'; });
    if (finals.length !== 1) return null;
    var finalMatch = finals[0];

    // Every non-team ref must be a pure position ("1st") or "Winner <unique round>".
    var ok = true;
    kos.forEach(function (k) {
      [k.homeRef, k.awayRef].forEach(function (ref) {
        if (ref == null) { ok = false; return; }
        if (teams[ref]) return;
        var w = /^\s*winner\s+(.+)$/i.exec(String(ref));
        if (w) { var rk = normRound(w[1]); if (byRound[rk] && byRound[rk] !== 'DUP') return; ok = false; return; }
        if (ordinalOf(ref) != null && !/pool/i.test(String(ref))) return;
        ok = false;
      });
    });
    if (!ok) return null;

    var groupFx = (div.fixtures || []).filter(function (f) { return f.stage === 'group'; });
    var seen = {};
    groupFx.forEach(function (f) { if (teams[f.homeRef]) seen[f.homeRef] = 1; if (teams[f.awayRef]) seen[f.awayRef] = 1; });
    var ids = Object.keys(seen);
    if (ids.length < 2) return null;

    var counts = {}; Object.keys(teams).forEach(function (id) { counts[id] = 0; });
    for (var s = 0; s < SIMS; s++) {
      var jitter = {}; ids.forEach(function (id) { jitter[id] = Math.random(); });
      var order = rankGroup(ids, groupFx, ratings, jitter);
      var resolveSeed = function (ref, winners) {
        if (teams[ref]) return ref;
        var w = /^\s*winner\s+(.+)$/i.exec(String(ref));
        if (w) { var mk = byRound[normRound(w[1])]; return (mk && mk !== 'DUP') ? (winners[mk.id] || null) : null; }
        var o = ordinalOf(ref); if (o != null) return order[o - 1] || null;
        return null;
      };
      var champ = playKnockout(kos, resolveSeed, ratings)[finalMatch.id];
      if (champ) counts[champ]++;
    }
    var out = {}; Object.keys(teams).forEach(function (id) { out[id] = counts[id] / SIMS * 100; });
    return { byTeam: out, label: 'Title', ok: true };
  }

  function titleChances(div, ratings) {
    if (!div || !ratings) return null;
    var key = realSig(div);
    if (Object.prototype.hasOwnProperty.call(cache, key)) return cache[key];
    var res = null;
    try { res = div.pools ? fullChances(div, ratings) : genericChances(div, ratings); }
    catch (e) { res = null; }
    cache[key] = res;
    return res;
  }

  WG.forecast = { titleChances: titleChances };
})(window.WG = window.WG || {});
