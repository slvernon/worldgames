/* WG.squad — "Squad" view: Southeast offensive analytics (companion to Final).
 * Celebrates the team's scoring depth, then ranks players two ways:
 *   1. Total contribution  (goals×3 + points)
 *   2. Quality-weighted     (each score × opponent-difficulty weight)
 * Scorer log is manual (the API only records scorers for knockout games).
 */
(function () {
  'use strict';
  var WG = window.WG = window.WG || {};

  // Player tallies from the full Southeast scorer log. g=goals, p=points,
  // wt=quality-weighted total (each goal=3 / point=1, ×opponent weight).
  // Opponent weights: Rust Belt 0.48 · An Triúr 0.68 · Heartland 1.17 · Twin Cities 1.35.
  var PLAYERS = [
    { no: 10, name: 'Kristen Bolt',     g: 9, p: 3, wt: 18.9 },
    { no: 14, name: 'Valerie Munoz',    g: 4, p: 4, wt: 14.6 },
    { no: 2,  name: 'Jennifer Hagerty', g: 5, p: 1, wt: 12.4 },
    { no: 7,  name: 'Danielle Lanfear', g: 2, p: 6, wt: 12.6 },
    { no: 5,  name: 'Amanda DuShane',   g: 1, p: 5, wt: 7.5 },
    { no: 6,  name: 'Colleen Kerger',   g: 1, p: 3, wt: 4.8 },
    { no: 12, name: 'Rebecca Brown',    g: 1, p: 2, wt: 3.2 },
    { no: 11, name: 'Nicole Gordon',    g: 1, p: 1, wt: 4.0 },
    { no: 8,  name: 'Clare Nolan',      g: 1, p: 0, wt: 2.0 },
    { no: 3,  name: 'Sarah Spiller',    g: 0, p: 2, wt: 1.6 }
  ];
  // Opponent difficulty weights, for the key.
  var WEIGHTS = [
    { team: 'Twin Cities', w: '1.35', hard: true },
    { team: 'Heartland',   w: '1.17', hard: true },
    { team: 'An Triúr',    w: '0.68', hard: false },
    { team: 'Rust Belt',   w: '0.48', hard: false }
  ];
  var TEAM = { goals: 28, points: 28, scorers: 10, games: 7 };

  function tot(pl) { return pl.g * 3 + pl.p; }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function first(name){ return esc(name.split(' ')[0]); }
  function last(name){ return esc(name.split(' ').slice(1).join(' ')); }

  function template() {
    var byRaw = PLAYERS.slice().sort(function (a, b) { return tot(b) - tot(a) || b.wt - a.wt; });
    var byWt  = PLAYERS.slice().sort(function (a, b) { return b.wt - a.wt || tot(b) - tot(a); });
    var rawRank = {}; byRaw.forEach(function (p, i) { rawRank[p.no] = i; });
    var maxTot = tot(byRaw[0]);      // Bolt = 30
    var maxWt  = byWt[0].wt;         // Bolt = 18.9

    var h = '<div class="wg-sq">';

    // hero
    h += '<div class="sqhero">' +
      '<div class="eyebrow">USGAA Southeast · Camogie Div 1</div>' +
      '<h1>We score from everywhere</h1>' +
      '<p>Ten different players found the target across the tournament — a squad that hurts you from all over the pitch.</p>' +
      '<div class="sqstats">' +
        stat(TEAM.goals, 'Goals') + stat(TEAM.points, 'Points') + stat(TEAM.scorers, 'Scorers') +
      '</div></div>';

    // raw contribution
    h += '<section><h2 class="sqsec">Top scorers — total contribution</h2>' +
      '<p class="sqsub">Every player’s scoring, in points (a goal = 3, a point = 1) across all ' + TEAM.games + ' games.</p>' +
      '<div class="sqcard">' +
      '<div class="legend"><span><i class="swatch g"></i>Goals (×3)</span><span><i class="swatch p"></i>Points</span></div>';
    byRaw.forEach(function (p, i) {
      var gv = p.g * 3, pv = p.p, t = gv + pv;
      var gPct = gv / maxTot * 100, pPct = pv / maxTot * 100;
      h += '<div class="prow">' +
        '<div class="rank">' + (i + 1) + '</div>' +
        '<div class="jersey">' + p.no + '</div>' +
        '<div class="pmain">' +
          '<div class="pname"><span class="first">' + first(p.name) + '</span> ' + last(p.name) + '</div>' +
          '<div class="ptrack">' +
            (gv ? '<div class="pfill-g" style="width:' + gPct + '%"></div>' : '') +
            (pv ? '<div class="pfill-p" style="width:' + pPct + '%"></div>' : '') +
          '</div>' +
        '</div>' +
        '<div class="pend"><div class="ptot">' + t + '</div><div class="pbreak">' + p.g + 'G · ' + p.p + 'P</div></div>' +
      '</div>';
    });
    h += '</div></section>';

    // quality-weighted
    h += '<section><h2 class="sqsec">Ranked by quality of opposition</h2>' +
      '<p class="sqsub">The same scores, re-weighted so goals and points against tougher defences count for more.</p>' +
      '<div class="sqcard">';
    byWt.forEach(function (p, i) {
      var delta = rawRank[p.no] - i;   // +ve = moved up vs raw
      var move = delta > 0 ? '<span class="move up">▲ ' + delta + '</span>'
               : delta < 0 ? '<span class="move down">▼ ' + (-delta) + '</span>'
               : '<span class="move same">—</span>';
      h += '<div class="wrow">' +
        '<div class="rank">' + (i + 1) + '</div>' +
        '<div class="jersey">' + p.no + '</div>' +
        '<div class="wbarwrap">' +
          '<div class="pname"><span class="first">' + first(p.name) + '</span> ' + last(p.name) + '</div>' +
          '<div class="wtrack" style="margin-top:5px;"><div class="wfill" style="width:' + (p.wt / maxWt * 100) + '%"></div></div>' +
        '</div>' +
        '<div class="wval">' + p.wt.toFixed(1) + '</div>' +
        move +
      '</div>';
    });
    h += '<p class="fmnote"><b>What shifts:</b> Danielle Lanfear climbs above Jennifer Hagerty — more of her scores came against the better sides — while tallies padded against the weakest defences carry less weight. Kristen Bolt leads both lists, but her raw total is flattered by big hauls versus the bottom teams.</p>' +
      '<div class="wkey" style="margin-top:12px;">';
    WEIGHTS.forEach(function (w) {
      h += '<span class="wchip' + (w.hard ? ' hard' : '') + '"><b>' + esc(w.team) + '</b> ×' + w.w + '</span>';
    });
    h += '</div></div></section>';

    h += '<div class="sqfoot">Scorer log is hand-recorded (the live feed only attributes scorers for knockout games); ' +
      'a few group-stage scores weren’t attributed to a named player. Weights derive from each opponent’s schedule-adjusted rating.</div>';

    h += '</div>';
    return h;
  }

  function stat(v, l) { return '<div class="sqstat"><div class="v">' + v + '</div><div class="l">' + l + '</div></div>'; }

  function render(container) {
    if (!container) return;
    if (container.getAttribute('data-sq') !== '1') {
      container.innerHTML = template();
      container.setAttribute('data-sq', '1');
    }
  }

  WG.squad = { render: render };
})();
