/* WG.predictions — strength ratings + per-fixture prediction & "watch" flag.
 *
 * Full-tier (Camogie Div 1) only. Everything degrades gracefully to null / empty
 * when no scores have been posted yet.
 *
 * RATING MATH (simple, explainable, Massey-flavoured):
 *   1. Seed each team's rating with its average scoring margin over FINAL games
 *      (mean of (PF - PA) per played fixture). A team with 0 played games has no seed.
 *   2. Refine with a couple of iterative passes: a team's rating is re-estimated as
 *      the average, over its final games, of (its margin in that game + the current
 *      rating of the opponent it achieved that margin against). This spreads
 *      strength-of-schedule through ALL results (not just a single common-opponent
 *      chain): beating a strong team is worth more than beating a weak one, and we
 *      re-centre to mean 0 after each pass so ratings stay interpretable as
 *      "points better/worse than an average team". Two passes is enough to converge
 *      for a 5-team pool without overfitting a tiny sample.
 *   A fixture's projected margin is |ratingA - ratingB|; winProb is a logistic of it.
 */
(function () {
  'use strict';
  var WG = (window.WG = window.WG || {});

  // ---- helpers -------------------------------------------------------------

  // Resolve a fixture ref to a concrete teamId, or null if it's still a seed
  // token ('A1','B2') or a 'W:matchId' placeholder.
  function resolveTeamId(div, ref) {
    if (ref == null) return null;
    if (typeof ref === 'string' && (ref.indexOf('W:') === 0)) return null;
    // seed tokens look like A1..A5 / B1..B4 : single pool letter + digit(s)
    if (typeof ref === 'string' && /^[AB]\d+$/.test(ref)) return null;
    if (div && div.teams && div.teams[ref]) return ref;
    // Anything else (unknown id, malformed token) -> treat as unresolved.
    return null;
  }

  function isFinal(fx) {
    return fx && fx.status === 'final' && fx.home && fx.away &&
      typeof fx.home.total === 'number' && typeof fx.away.total === 'number';
  }

  // Collect final results as {home, away, homeMargin} using resolved team ids.
  function finalResults(div) {
    var out = [];
    var fixtures = (div && div.fixtures) || [];
    for (var i = 0; i < fixtures.length; i++) {
      var fx = fixtures[i];
      if (!isFinal(fx)) continue;
      var h = resolveTeamId(div, fx.homeRef);
      var a = resolveTeamId(div, fx.awayRef);
      if (!h || !a) continue;
      out.push({ home: h, away: a, margin: fx.home.total - fx.away.total,
                 homePF: fx.home.total, homePA: fx.away.total });
    }
    return out;
  }

  // Connected components of the "who has played whom" graph (final results only,
  // group + knockout). Two teams in DIFFERENT components have never been linked by
  // any chain of common opponents, so their ratings live on uncalibrated scales
  // (e.g. Group A vs Group B before any cross-pool game) and must not be trusted
  // to call a "strong" favourite. Returns { teamId: componentRootId }.
  function buildComponents(div) {
    var parent = {};
    function find(x) {
      if (parent[x] == null) parent[x] = x;
      return parent[x] === x ? x : (parent[x] = find(parent[x]));
    }
    function union(a, b) { parent[find(a)] = find(b); }
    var games = ((div && div.fixtures) || []).concat((div && div.knockout) || []);
    games.forEach(function (f) {
      if (!isFinal(f)) return;
      var h = resolveTeamId(div, f.homeRef), a = resolveTeamId(div, f.awayRef);
      if (!h || !a) return;
      union(h, a);
    });
    var comp = {};
    Object.keys(parent).forEach(function (t) { comp[t] = find(t); });
    return comp;
  }

  // ---- WG.predictions.build ------------------------------------------------

  // Returns a ratings object:
  //   { ratings: { [teamId]: number },   // points vs average team; higher = stronger
  //     games:   { [teamId]: count },    // final games played
  //     played:  Boolean }               // any final games at all?
  function build(div) {
    var results = finalResults(div);
    var teams = (div && div.teams) || {};

    var games = {};        // teamId -> count
    var marginSum = {};    // teamId -> summed margin (own perspective)
    var perTeam = {};      // teamId -> [{opp, margin}]

    Object.keys(teams).forEach(function (t) {
      games[t] = 0; marginSum[t] = 0; perTeam[t] = [];
    });

    results.forEach(function (r) {
      // home perspective
      games[r.home]++; marginSum[r.home] += r.margin;
      perTeam[r.home].push({ opp: r.away, margin: r.margin });
      // away perspective
      games[r.away]++; marginSum[r.away] += -r.margin;
      perTeam[r.away].push({ opp: r.home, margin: -r.margin });
    });

    var ratings = {};
    var anyPlayed = false;
    Object.keys(teams).forEach(function (t) {
      if (games[t] > 0) { ratings[t] = marginSum[t] / games[t]; anyPlayed = true; }
      else { ratings[t] = 0; }
    });

    // Iterative strength-of-schedule adjustment (2 passes), re-centred each pass.
    for (var pass = 0; pass < 2; pass++) {
      var next = {};
      Object.keys(teams).forEach(function (t) {
        if (games[t] === 0) { next[t] = ratings[t]; return; }
        var acc = 0;
        perTeam[t].forEach(function (g) {
          // Expected performance = my margin + opponent's current rating.
          acc += g.margin + (ratings[g.opp] || 0);
        });
        next[t] = acc / games[t];
      });
      // Re-centre played teams to mean 0.
      var vals = [], n = 0;
      Object.keys(teams).forEach(function (t) {
        if (games[t] > 0) { vals.push(next[t]); n++; }
      });
      var mean = 0;
      if (n > 0) { for (var k = 0; k < vals.length; k++) mean += vals[k]; mean /= n; }
      Object.keys(teams).forEach(function (t) {
        ratings[t] = games[t] > 0 ? next[t] - mean : 0;
      });
    }

    return { ratings: ratings, games: games, played: anyPlayed, component: buildComponents(div) };
  }

  // ---- WG.predictions.forFixture ------------------------------------------

  // Logistic mapping of projected margin -> win probability, clamped 0.5..0.99.
  // ~ every 6 points of margin ≈ a meaningful swing for camogie totals.
  function winProbFromMargin(margin) {
    var p = 1 / (1 + Math.exp(-Math.abs(margin) / 6));
    if (p < 0.5) p = 0.5;
    if (p > 0.99) p = 0.99;
    return p;
  }

  // opts: { stakes:Boolean } — optional hint from caller (scenarios) that this
  // fixture sits on a qualification cutoff for one/both teams.
  function forFixture(div, fixture, ratings, opts) {
    if (!fixture || !ratings || !ratings.ratings) return null;
    // Never predict something already decided.
    if (fixture.status === 'final') return null;

    var h = resolveTeamId(div, fixture.homeRef);
    var a = resolveTeamId(div, fixture.awayRef);
    if (!h || !a) return null;                       // seed / 'W:' still unresolved

    var g = ratings.games || {};
    if (!(g[h] > 0) || !(g[a] > 0)) return null;     // need data on BOTH teams

    var rh = ratings.ratings[h] || 0;
    var ra = ratings.ratings[a] || 0;
    var diff = rh - ra;
    var favTeamId = diff >= 0 ? h : a;
    var margin = Math.abs(diff);
    var winProb = winProbFromMargin(margin);

    // Watch flag is driven by how close the game is projected to be, so it's
    // selective (most games have a clear favourite). 'stakes' is accepted but no
    // longer forces 'must' — that made everything a must-watch mid-tournament.
    var watch = 'none';
    if (margin <= 2.5) watch = 'must';        // near coin-flip — don't miss
    else if (margin <= 5) watch = 'close';    // competitive
    // A genuine qualification decider nudges a clear-ish game up to 'close'.
    if (watch === 'none' && (opts && opts.stakes) && margin <= 7) watch = 'close';

    // Confidence tier on a symmetric 5-point scale (strong/likely/toss-up/likely/
    // strong) collapsed to three labels — the favourite is whichever side leads.
    // Margin-based (in total points) so it's sensitive with sparse early data:
    // only a genuinely lopsided projection reads as "Strong".
    var strength = 'strong';
    if (margin <= 4) strength = 'tossup';          // within ~a goal — coin flip
    else if (margin <= 14) strength = 'likely';    // clear edge but catchable

    // Cross-scale guard: if the two teams have never been connected by any chain
    // of common opponents (e.g. Group A vs Group B before a cross-pool game), the
    // rating gap isn't trustworthy — never claim a "strong" winner, cap at "likely".
    var comp = ratings.component;
    var unlinked = comp && comp[h] != null && comp[a] != null && comp[h] !== comp[a];
    if (unlinked && strength === 'strong') strength = 'likely';

    return {
      favTeamId: favTeamId,
      margin: Math.round(margin * 10) / 10,
      winProb: Math.round(winProb * 100) / 100,
      watch: watch,
      strength: strength,
      label: 'PREDICTION'
    };
  }

  // Display metadata for each confidence tier (label + emoji), shared by views.
  var STRENGTH = {
    tossup: { text: 'Toss-up', emoji: '🔥' },
    likely: { text: 'Likely winner', emoji: '👍' },
    strong: { text: 'Strong winner', emoji: '💪' }
  };

  WG.predictions = { build: build, forFixture: forFixture, STRENGTH: STRENGTH };
})();
