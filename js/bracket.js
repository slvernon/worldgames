/* WG.bracket — interactive bracket view for the FULL-tier division (Camogie Div 1).
   Renders: interactive group stage (tap a winner) -> live standings -> resolved
   knockout seeds -> clickable Cup/Shield play-out. Real FINAL scores lock and
   override manual picks. Predictions shown on undecided matches, clearly tagged.
   Self-contained: namespaced .bk-* classes + one injected <style> (no collisions). */
(function (WG) {
  'use strict';

  // ---- nominal scores used to represent a manual pick (real scores override) ----
  var WIN = { goals: 0, points: 1, total: 1 };
  var LOSE = { goals: 0, points: 0, total: 0 };
  var POOL_LABEL = { A: 'Group A', B: 'Group B' };
  var ORD = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'];
  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  var SVGNS = 'http://www.w3.org/2000/svg';
  var resizeBound = false;

  function teamName(div, id) {
    var t = div.teams && div.teams[id];
    return t ? t.name : id;
  }
  function dayLabel(dstr) {
    var d = new Date(dstr + 'T00:00:00');
    return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
  }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function totalOf(s) { return s && typeof s.total === 'number' ? s.total : null; }
  function isRealFinal(fx) {
    return fx && fx.status === 'final' && totalOf(fx.home) != null && totalOf(fx.away) != null;
  }
  // GAA score with its running total appended in muted text, e.g. "2-07 (13)".
  function scHtml(sc) {
    if (!sc) return '';
    var tot = (typeof sc.total === 'number') ? sc.total : ((sc.goals || 0) * 3 + (sc.points || 0));
    return WG.data.fmtScore(sc) + '<span class="bk-tot">(' + tot + ')</span>';
  }
  function favId(div) { return (WG.fav && div && div.slug) ? WG.fav.get(div.slug) : null; }

  function picks(state) {
    state.playout = state.playout || {};
    state.playout.group = state.playout.group || {};
    state.playout.knock = state.playout.knock || {};
    state.playout.scores = state.playout.scores || {};   // manual GAA scores: {id:{home:'2-14',away:'1-09'}}
    return state.playout;
  }

  /* Overlay real results (live finals already in the div + manually-entered scores)
     as final fixtures. This drives standings' real +/- and the prediction ratings. */
  function applyReal(div, state) {
    var sc = picks(state).scores;
    var fixtures = (div.fixtures || []).map(function (f) {
      if (f.stage !== 'group') return f;
      if (isRealFinal(f)) return f; // live/authoritative already
      var m = sc[f.id];
      if (m && m.home && m.away) {
        var h = WG.data.parseScore(m.home), a = WG.data.parseScore(m.away);
        if (h && a) return Object.assign({}, f, { home: h, away: a, status: 'final', _manual: true });
      }
      return f;
    });
    return Object.assign({}, div, { fixtures: fixtures });
  }

  /* Effective division: overlay manual group picks as nominal finals so
     WG.standings can compute a live table. Real finals always win. */
  function effectiveDiv(div, state) {
    var g = picks(state).group;
    var fixtures = (div.fixtures || []).map(function (f) {
      if (f.stage !== 'group') return f;
      if (isRealFinal(f)) return f;
      var p = g[f.id];
      if (p === 'home' || p === 'away') {
        return Object.assign({}, f, {
          home: p === 'home' ? WIN : LOSE,
          away: p === 'away' ? WIN : LOSE,
          status: 'final', _pick: true
        });
      }
      return f;
    });
    return Object.assign({}, div, { fixtures: fixtures });
  }

  function poolComplete(effDiv, pool) {
    var gs = effDiv.fixtures.filter(function (f) { return f.stage === 'group' && f.pool === pool; });
    return gs.length > 0 && gs.every(function (f) { return f.status === 'final'; });
  }

  // ordered team ids for a pool by rank (null until complete)
  function poolOrder(standings, pool) {
    if (!standings || !standings[pool]) return null;
    return standings[pool].slice().sort(function (a, b) { return a.rank - b.rank; })
      .map(function (r) { return r.teamId; });
  }

  // ---- knockout ref labels ----
  function shortRound(id) {
    if (/qf/.test(id)) return 'Preliminary';
    if (/sf1/.test(id)) return 'SF1';
    if (/sf2/.test(id)) return 'SF2';
    if (/final/.test(id)) return 'Final';
    return 'previous round';
  }
  function labelForRef(div, ref) {
    var m = /^([AB])([1-9])$/.exec(ref);
    if (m) return ORD[+m[2]] + ' ' + POOL_LABEL[m[1]];
    var w = /^W:(.+)$/.exec(ref);
    if (w) return 'Winner ' + shortRound(w[1]);
    return teamName(div, ref);
  }

  // has this pool played at least one game (pick/manual/live)?
  function poolHasResults(effDiv, pool) {
    return effDiv.fixtures.some(function (f) { return f.stage === 'group' && f.pool === pool && f.status === 'final'; });
  }

  /* Resolve seeds from the CURRENT standings as soon as a group has any results
     (provisional until the group is mathematically complete, then locked). */
  function resolveKnockout(div, effDiv, standings, state) {
    var kmap = {};
    (div.knockout || []).forEach(function (k) { kmap[k.id] = k; });
    var complete = { A: poolComplete(effDiv, 'A'), B: poolComplete(effDiv, 'B') };
    var has = { A: poolHasResults(effDiv, 'A'), B: poolHasResults(effDiv, 'B') };
    var order = { A: has.A ? poolOrder(standings, 'A') : null, B: has.B ? poolOrder(standings, 'B') : null };
    var knock = picks(state).knock;
    var out = {};

    function resolveRef(ref) { // -> {id, prov}
      if (div.teams && div.teams[ref]) return { id: ref, prov: false };
      var m = /^([AB])([1-9])$/.exec(ref);
      if (m) { var o = order[m[1]]; return { id: o ? o[+m[2] - 1] : null, prov: !complete[m[1]] }; }
      var w = /^W:(.+)$/.exec(ref);
      if (w) { var s = out[w[1]]; return s && s.winner ? { id: s.winner, prov: s.provWinner } : { id: null, prov: false }; }
      return { id: null, prov: false };
    }

    var ids = (div.knockout || []).map(function (k) { return k.id; });
    for (var pass = 0; pass < 4; pass++) {
      ids.forEach(function (id) {
        var k = kmap[id];
        var H = resolveRef(k.homeRef), A = resolveRef(k.awayRef);
        var winner = null, locked = false, provWinner = false;
        if (isRealFinal(k)) {
          locked = true;
          winner = totalOf(k.home) === totalOf(k.away) ? (H.id || null)
                 : (totalOf(k.home) > totalOf(k.away) ? H.id : A.id);
        } else if (H.id && A.id) {
          var p = knock[id];
          if (p === 'home') winner = H.id;
          else if (p === 'away') winner = A.id;
          if (winner) provWinner = true; // a picked winner is provisional
        }
        if ((H.prov || A.prov) && winner) provWinner = true;
        out[id] = { home: H.id, away: A.id, homeProv: H.prov, awayProv: A.prov,
                    winner: winner, locked: locked, provWinner: provWinner, ko: k };
      });
    }
    return out;
  }

  // ================= RENDER =================
  function render(rootEl, div, state) {
    // Divisions without hand-authored pools (everything except Camogie Div 1) get
    // a generic single-table + knockout-tree bracket instead of the Cup/Shield flow.
    if (!div.pools) return renderGeneric(rootEl, div, state);
    injectStyles();
    rootEl.innerHTML = '';
    var wrap = el('div', 'bk-wrap');
    rootEl.appendChild(wrap);

    state._editing = state._editing || {};
    var actualDiv = applyReal(div, state);         // live + manually-entered scores as real finals
    var effDiv = effectiveDiv(actualDiv, state);   // + hypothetical winner picks
    applyAutoCollapse(effDiv, state);              // mobile: default to only the current/next day open
    var standings = (WG.standings && WG.standings.compute) ? safe(function () { return WG.standings.compute(effDiv); }) : null;
    // predictions use REAL played/entered results only (never hypothetical picks)
    var ratings = (WG.predictions && WG.predictions.build) ? safe(function () { return WG.predictions.build(actualDiv); }) : null;
    var resolved = resolveKnockout(actualDiv, effDiv, standings, state);

    function rerender() {
      if (typeof state.onChange === 'function') state.onChange();
      else render(rootEl, div, state);
    }

    var intro = el('div', 'bk-intro');
    intro.appendChild(el('p', 'bk-hint', 'Tap a winner in the group games — standings, seeds and the bracket update live. Real final scores lock automatically.'));
    var reset = el('button', 'bk-reset', 'Reset picks');
    reset.onclick = function () { state.playout = { group: {}, knock: {} }; rerender(); };
    intro.appendChild(reset);
    wrap.appendChild(intro);

    wrap.appendChild(renderExplainer(state, rerender));
    wrap.appendChild(renderJumpNav());

    // Two-pane on desktop: group games (left) + sticky standings/bracket (right)
    // that stays in view and updates as you pick. On mobile it stacks in order.
    var cols = el('div', 'bk-cols');
    var left = el('div', 'bk-col-left');
    var right = el('div', 'bk-col-right');

    var gh = el('div', 'bk-h2row');
    gh.id = 'bk-sec-group';
    gh.appendChild(el('h2', 'bk-h2 flush', 'Group Stage'));
    var gsCtl = el('div', 'bk-gs-controls');
    gsCtl.appendChild(renderModeToggle(state, rerender));
    gsCtl.appendChild(renderCollapseAll(effDiv, state, rerender));
    gh.appendChild(gsCtl);
    left.appendChild(gh);
    if ((picks(state).scoreMode || 'pick') === 'pick') {
      left.appendChild(el('p', 'bk-pickhint', 'Tap a team to pick the winner — real scores lock in automatically.'));
    }
    left.appendChild(renderGroupDays(div, effDiv, state, rerender, ratings));

    right.appendChild(h2WithHelp('bk-sec-standings', 'Standings', 'What the columns mean', STANDINGS_HELP));
    var st = el('div', 'bk-standings');
    ['A', 'B'].forEach(function (p) { st.appendChild(renderPool(div, effDiv, standings, p, rerender)); });
    right.appendChild(st);

    cols.appendChild(left);
    cols.appendChild(right);
    wrap.appendChild(cols);

    // Knockout gets its own full-width band below the two panes so the tree can breathe.
    var koBand = el('div', 'bk-ko-band');
    koBand.appendChild(h2WithHelp('bk-sec-knockout', 'Knockout', 'How the Cup, Shield and predictions work', KNOCKOUT_HELP));
    var brackets = el('div', 'bk-brackets');
    brackets.appendChild(renderBracketCard(div, standings, resolved, ratings, state, 'cup', 'Cup'));
    brackets.appendChild(renderBracketCard(div, standings, resolved, ratings, state, 'shield', 'Shield'));
    koBand.appendChild(brackets);
    wrap.appendChild(koBand);

    drawAllConnectors(); // after the tree is in the DOM and laid out
    if (!resizeBound) { resizeBound = true; window.addEventListener('resize', drawAllConnectors); }
  }

  function safe(fn) { try { return fn(); } catch (e) { return null; } }

  // ================= GENERIC BRACKET (all non-pool divisions) =================
  var STANDINGS_HELP_GENERIC =
    '<b>Reading the table</b><br>' +
    '<b>#</b> current position &nbsp;·&nbsp; <b>P</b> games played &nbsp;·&nbsp; <b>W</b> won &nbsp;·&nbsp; ' +
    '<b>L</b> lost &nbsp;·&nbsp; <b>+/&minus;</b> score difference (total scored minus conceded, where a goal = 3, a point = 1) &nbsp;·&nbsp; ' +
    '<b>Pts</b> league points (2 for a win).<br><br>' +
    '<b>Ties are broken by</b>, in order: league points → head-to-head result (only when exactly two teams are level) → ' +
    'score difference → highest total score for → most goals scored → fewest goals conceded → penalty competition.';

  var KNOCKOUT_HELP_GENERIC =
    '<b>How predictions work.</b> Each team gets a strength rating from its scoring margins, adjusted for how strong its ' +
    'opponents were. A matchup’s projected margin is the gap between the two ratings; the win-% is a curve over that gap. ' +
    'Predictions use only real played scores and appear once both teams are known and have a game in.';

  function groupComplete(div) {
    var gs = (div.fixtures || []).filter(function (f) { return f.stage === 'group'; });
    return gs.length > 0 && gs.every(function (f) { return f.status === 'final'; });
  }

  function renderSingleStandings(div, standings, rerender) {
    var box = el('div', 'bk-pool pool-a');
    var complete = groupComplete(div);
    box.appendChild(el('div', 'bk-pool-h', '<span class="bk-dot"></span> Group Table' +
      '<span class="bk-prov">' + (complete ? 'Final' : 'Live') + '</span>'));
    var rows = (standings && standings.all) ? standings.all.slice().sort(function (a, b) { return a.rank - b.rank; }) : [];
    if (!rows.length) {
      box.appendChild(el('div', 'bk-scen', 'Standings appear once group games are played.'));
    } else {
      box.appendChild(buildStandingsTable(div, rows, rerender, null));
    }
    return box;
  }

  // Normalise a messy round label ('SF 2', 'QF1', 'Final', null) to a tier+label.
  function koTier(round) {
    var s = (round == null ? '' : String(round)).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (/^QF|QUARTER/.test(s)) return { t: 2, label: 'Quarter-Finals' };
    if (/^SF|SEMI/.test(s)) return { t: 3, label: 'Semi-Finals' };
    if (/PRELIM|^PRE/.test(s)) return { t: 1, label: 'Preliminary' };
    if (/FINAL/.test(s)) return { t: 4, label: 'Final' };
    return { t: 2, label: 'Knockout' };
  }

  function renderKoMatchGeneric(div, k, ratings) {
    var tier = koTier(k.round);
    var m = el('div', 'bk-match' + (tier.t === 4 ? ' final' : '') + (isRealFinal(k) ? ' locked' : ''));
    var meta = '<b>' + (k.time || '') + '</b>' + (k.pitch ? ' · ' + k.pitch : '') + (k.date ? ' · ' + dayLabel(k.date) : '');
    m.appendChild(el('div', 'bk-meta', meta));
    var win = null;
    if (isRealFinal(k)) {
      win = totalOf(k.home) > totalOf(k.away) ? 'home' : (totalOf(k.away) > totalOf(k.home) ? 'away' : null);
    }
    var fav = favId(div);
    [['home', k.homeRef, k.home], ['away', k.awayRef, k.away]].forEach(function (side) {
      var which = side[0], ref = side[1], sc = side[2];
      var known = !!(div.teams && div.teams[ref]);
      var slot = el('div', 'bk-slot');
      if (!known) slot.classList.add('seed');
      if (win === which) slot.classList.add('win');
      if (known && ref === fav) slot.classList.add('favteam');
      var label = known ? teamName(div, ref) : String(ref == null ? 'TBD' : ref);
      var scoreHtml = isRealFinal(k) ? '<span class="bk-sc">' + scHtml(sc) + '</span>' : '';
      slot.innerHTML = '<span class="bk-tn">' + label + '</span>' + scoreHtml;
      m.appendChild(slot);
      if (which === 'home') m.appendChild(el('div', 'bk-v', 'v'));
    });
    if (!isRealFinal(k)) {
      var h = (div.teams && div.teams[k.homeRef]) ? k.homeRef : null;
      var a = (div.teams && div.teams[k.awayRef]) ? k.awayRef : null;
      if (h && a) { var pe = predEl(div, h, a, ratings, false); if (pe) m.appendChild(pe); }
    }
    return m;
  }

  function renderKnockoutGeneric(div, ratings) {
    var kos = (div.fixtures || []).filter(function (f) { return f.stage === 'knockout'; });
    if (!kos.length) return null;
    var byTier = {};
    kos.forEach(function (k) {
      var ti = koTier(k.round);
      if (!byTier[ti.t]) byTier[ti.t] = { t: ti.t, label: ti.label, items: [] };
      byTier[ti.t].items.push(k);
    });
    var cols = Object.keys(byTier).map(function (key) { return byTier[key]; })
      .sort(function (a, b) { return a.t - b.t; });
    var card = el('div', 'bk-bracket cup');
    card.appendChild(el('div', 'bk-bracket-h', '<span class="bk-sq"></span>Knockout'));
    card.appendChild(el('div', 'bk-scrollhint', 'Swipe sideways to see all rounds →'));
    var tree = el('div', 'bk-tree'), scroll = el('div', 'bk-tree-scroll'), inner = el('div', 'bk-tree-inner');
    cols.forEach(function (col) {
      var c = el('div', 'bk-col');
      c.appendChild(el('div', 'bk-col-h', col.label));
      col.items.sort(function (a, b) { return (a.date + a.time || '').localeCompare(b.date + b.time || ''); });
      col.items.forEach(function (k) { c.appendChild(renderKoMatchGeneric(div, k, ratings)); });
      inner.appendChild(c);
    });
    scroll.appendChild(inner); tree.appendChild(scroll); card.appendChild(tree);
    return card;
  }

  function renderGeneric(rootEl, div, state) {
    injectStyles();
    rootEl.innerHTML = '';
    var wrap = el('div', 'bk-wrap');
    rootEl.appendChild(wrap);

    state._editing = state._editing || {};
    var actualDiv = applyReal(div, state);
    var effDiv = effectiveDiv(actualDiv, state);
    applyAutoCollapse(effDiv, state);
    var standings = (WG.standings && WG.standings.compute) ? safe(function () { return WG.standings.compute(effDiv); }) : null;
    var ratings = (WG.predictions && WG.predictions.build) ? safe(function () { return WG.predictions.build(actualDiv); }) : null;

    function rerender() {
      if (typeof state.onChange === 'function') state.onChange();
      else renderGeneric(rootEl, div, state);
    }

    var intro = el('div', 'bk-intro');
    intro.appendChild(el('p', 'bk-hint', 'Live schedule, standings and knockout. Tap a group winner to play it out — real final scores lock automatically.'));
    var reset = el('button', 'bk-reset', 'Reset picks');
    reset.onclick = function () { state.playout = { group: {}, knock: {} }; rerender(); };
    intro.appendChild(reset);
    wrap.appendChild(intro);
    wrap.appendChild(renderJumpNav());

    var hasGroup = (effDiv.fixtures || []).some(function (f) { return f.stage === 'group'; });

    var cols = el('div', 'bk-cols');
    var left = el('div', 'bk-col-left');
    var right = el('div', 'bk-col-right');

    if (hasGroup) {
      var gh = el('div', 'bk-h2row'); gh.id = 'bk-sec-group';
      gh.appendChild(el('h2', 'bk-h2 flush', 'Group Stage'));
      var gsCtl = el('div', 'bk-gs-controls');
      gsCtl.appendChild(renderModeToggle(state, rerender));
      gsCtl.appendChild(renderCollapseAll(effDiv, state, rerender));
      gh.appendChild(gsCtl);
      left.appendChild(gh);
      if ((picks(state).scoreMode || 'pick') === 'pick') {
        left.appendChild(el('p', 'bk-pickhint', 'Tap a team to pick the winner — real scores lock in automatically.'));
      }
      left.appendChild(renderGroupDays(div, effDiv, state, rerender, ratings));
    } else {
      left.appendChild(el('p', 'bk-hint', 'No group games listed for this division yet.'));
    }

    right.appendChild(h2WithHelp('bk-sec-standings', 'Standings', 'What the columns mean', STANDINGS_HELP_GENERIC));
    var st = el('div', 'bk-standings');
    st.appendChild(renderSingleStandings(effDiv, standings, rerender));
    right.appendChild(st);

    cols.appendChild(left);
    cols.appendChild(right);
    wrap.appendChild(cols);

    var koCard = renderKnockoutGeneric(effDiv, ratings);
    if (koCard) {
      var koBand = el('div', 'bk-ko-band');
      koBand.appendChild(h2WithHelp('bk-sec-knockout', 'Knockout', 'How predictions work', KNOCKOUT_HELP_GENERIC));
      var brackets = el('div', 'bk-brackets');
      brackets.appendChild(koCard);
      koBand.appendChild(brackets);
      wrap.appendChild(koBand);
    }
  }

  // ---- explainer (collapsible) + jump-nav + controls ----
  function renderExplainer(state, rerender) {
    var pk = picks(state);
    // Default: open on desktop, collapsed on phones (where it would bury content);
    // once the user toggles it, remember their choice.
    var open = (pk.explainOpen == null) ? isDesktopTwoPane() : pk.explainOpen;
    var box = el('div', 'bk-explain' + (open ? '' : ' closed'));
    var head = el('button', 'bk-explain-h', 'How it works <span class="bk-explain-chev">▾</span>');
    head.setAttribute('aria-expanded', String(open));
    head.onclick = function () { pk.explainOpen = !open; rerender(); };
    box.appendChild(head);
    box.appendChild(el('div', 'bk-explain-b',
      'Nine teams play in two groups — <b class="ga">Group A</b> (5 teams) and <b class="gb">Group B</b> (4) — everyone plays the others in their own group. ' +
      'The final group standings then split the field: <span class="bk-chip cup">Cup</span> = Group A top 3 + Group B top 2 &nbsp;·&nbsp; ' +
      '<span class="bk-chip shield">Shield</span> = the other four (Group A 4th–5th, Group B 3rd–4th).'));
    return box;
  }

  // A tucked-away "?" disclosure. Native <details> so it needs no JS wiring and
  // survives re-renders. `label` is the aria label; `bodyHtml` is the panel.
  function helpDetails(label, bodyHtml) {
    var d = document.createElement('details');
    d.className = 'bk-help';
    var s = document.createElement('summary');
    s.className = 'bk-help-s';
    s.setAttribute('aria-label', label);
    s.setAttribute('title', label);
    s.textContent = '?';
    d.appendChild(s);
    var b = el('div', 'bk-help-b', null);
    b.innerHTML = bodyHtml;
    d.appendChild(b);
    return d;
  }

  // Header row: an <h2> with a "?" help disclosure tucked on the right.
  function h2WithHelp(id, title, label, bodyHtml) {
    var row = el('div', 'bk-h2row');
    var h = el('h2', 'bk-h2 flush', title); h.id = id;
    row.appendChild(h);
    row.appendChild(helpDetails(label, bodyHtml));
    return row;
  }

  var STANDINGS_HELP =
    '<b>Reading the table</b><br>' +
    '<b>#</b> current position &nbsp;·&nbsp; <b>P</b> games played &nbsp;·&nbsp; <b>W</b> won &nbsp;·&nbsp; ' +
    '<b>L</b> lost &nbsp;·&nbsp; <b>+/&minus;</b> score difference (total scored minus conceded, where a goal = 3, a point = 1) &nbsp;·&nbsp; ' +
    '<b>Pts</b> league points (2 for a win, 0 for a loss).<br><br>' +
    '<b>Ties are broken by</b>, in order: league points → head-to-head result (only when exactly two teams are level) → ' +
    'score difference → highest total score for → most goals scored → fewest goals conceded → penalty competition. ' +
    'Each group is a double round-robin (every pair meets twice).';

  var KNOCKOUT_HELP =
    '<b>Cup</b> = Group A top 3 + Group B top 2. <b>Shield</b> = the other four. ' +
    'Seeds fill in from the <span class="bk-provkey">current standings</span> as games are played ' +
    '(dashed = provisional) and lock once a group is mathematically settled. Tap a team to play the bracket out yourself.<br><br>' +
    '<b>How predictions work.</b> Each team gets a strength rating: start with its average scoring margin over played games, ' +
    'then adjust twice for schedule strength (beating a strong team counts more than beating a weak one). ' +
    'A matchup’s projected margin is the gap between the two ratings; the win-% is a curve over that gap. ' +
    'Games projected within a few points are flagged <span class="bk-close">close</span> or 🔥 <b>toss-up</b>. ' +
    'Predictions use only real played scores — never your hypothetical picks — and appear once both teams have a game in.';

  // Compact sticky section nav (mobile only, via CSS).
  function renderJumpNav() {
    var nav = el('div', 'bk-jumpnav');
    nav.appendChild(el('span', 'bk-jumpnav-lbl', 'Jump to'));
    [['bk-sec-group', 'Group'], ['bk-sec-standings', 'Standings'], ['bk-sec-knockout', 'Knockout']].forEach(function (s) {
      var b = el('button', 'bk-jump', s[1]);
      b.onclick = function () { var t = document.getElementById(s[0]); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
      nav.appendChild(b);
    });
    return nav;
  }

  function groupDates(effDiv) {
    var set = {};
    effDiv.fixtures.forEach(function (f) { if (f.stage === 'group') set[f.date] = 1; });
    return Object.keys(set).sort();
  }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function todayStr() { var d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function isDesktopTwoPane() { return !!(window.matchMedia && window.matchMedia('(min-width: 1024px)').matches); }

  // The day to keep open by default: today if it has games, else the next upcoming
  // group day, else null (group stage is over — collapse everything).
  function focusDay(dates) {
    var today = todayStr();
    for (var i = 0; i < dates.length; i++) { if (dates[i] >= today) return dates[i]; }
    return null;
  }

  // On mobile, collapse all group days except the focus day — once, as a default
  // the user can still override by tapping headers.
  function applyAutoCollapse(effDiv, state) {
    if (state._autoCollapsedApplied) return;
    state._autoCollapsedApplied = true;
    if (isDesktopTwoPane()) return;               // desktop keeps days expanded
    state._collapsed = state._collapsed || {};
    var dates = groupDates(effDiv);
    if (!dates.length) return;
    var focus = focusDay(dates);
    dates.forEach(function (d) { state._collapsed[d] = (d !== focus); });
  }

  // Collapse/expand-all-days button — lives inline in the Group Stage header.
  function renderCollapseAll(effDiv, state, rerender) {
    state._collapsed = state._collapsed || {};
    var dates = groupDates(effDiv);
    var anyOpen = dates.some(function (d) { return !state._collapsed[d]; });
    var b = el('button', 'bk-collapse-all', anyOpen ? '▾ Collapse days' : '▸ Expand days');
    b.onclick = function () { dates.forEach(function (d) { state._collapsed[d] = anyOpen; }); rerender(); };
    return b;
  }
  function renderModeToggle(state, rerender) {
    var mode = picks(state).scoreMode || 'pick';
    var wrap = el('div', 'bk-mode');
    [['pick', 'Pick winner'], ['score', 'Enter score']].forEach(function (o) {
      var b = el('button', 'bk-mode-b' + (mode === o[0] ? ' on' : ''), o[1]);
      b.onclick = function () { picks(state).scoreMode = o[0]; rerender(); };
      wrap.appendChild(b);
    });
    return wrap;
  }

  function winSide(f) { // 'home'|'away'|null from a completed score
    var h = totalOf(f.home), a = totalOf(f.away);
    if (h == null || a == null) return null;
    return h >= a ? 'home' : 'away';
  }

  // ---- group stage: day cards ----
  function renderGroupDays(div, effDiv, state, rerender, ratings) {
    var mode = picks(state).scoreMode || 'pick';
    var byDay = {};
    effDiv.fixtures.filter(function (f) { return f.stage === 'group'; }).forEach(function (f) {
      (byDay[f.date] = byDay[f.date] || []).push(f);
    });
    state._collapsed = state._collapsed || {};
    var grid = el('div', 'bk-days');
    Object.keys(byDay).sort().forEach(function (date) {
      var list = byDay[date].sort(function (a, b) { return a.time < b.time ? -1 : 1; });
      var collapsed = !!state._collapsed[date];
      var card = el('div', 'bk-day' + (collapsed ? ' collapsed' : ''));
      // Only name a pitch in the header when EVERY game that day is on it.
      var pitchSet = {};
      list.forEach(function (g) { if (g.pitch) pitchSet[g.pitch] = 1; });
      var pitchKeys = Object.keys(pitchSet);
      var pitchMeta = pitchKeys.length === 1 ? ' · ' + pitchKeys[0] : '';
      var head = el('button', 'bk-day-h',
        '<span class="bk-day-title">' + dayLabel(date) + '</span>' +
        '<span class="bk-day-meta">' + list.length + ' games' + pitchMeta + '</span>' +
        '<span class="bk-day-chev" aria-hidden="true">▾</span>');
      head.setAttribute('aria-expanded', String(!collapsed));
      head.onclick = function () { state._collapsed[date] = !state._collapsed[date]; rerender(); };
      card.appendChild(head);
      var body = el('div', 'bk-day-body');
      list.forEach(function (f) { body.appendChild(renderGroupGame(div, f, state, rerender, mode, ratings)); });
      card.appendChild(body);
      grid.appendChild(card);
    });
    return grid;
  }

  function renderGroupGame(div, f, state, rerender, mode, ratings) {
    var pk = picks(state), g = pk.group;
    var live = isRealFinal(f) && !f._pick && !f._manual; // authoritative live result
    var row = el('div', 'bk-game pool-' + (f.pool || '').toLowerCase());
    var top = el('div', 'bk-game-top');
    top.appendChild(el('span', 'bk-time', f.time));

    // ENTER-SCORE mode: a compact scoreboard (live finals stay locked as buttons)
    if (mode === 'score' && !live) {
      top.appendChild(renderScoreInputs(div, f, state, rerender));
      row.appendChild(top);
    } else {
      // PICK mode (and locked live results): two tappable team buttons
      var real = live || !!f._manual;
      var winner = real ? winSide(f) : g[f.id];
      var fav = favId(div);
      var pair = el('div', 'bk-pair');
      [['home', f.homeRef], ['away', f.awayRef]].forEach(function (side, idx) {
        var which = side[0], id = side[1];
        var b = el('button', 'bk-team');
        if (winner === which) b.classList.add('win');
        else if (winner) b.classList.add('lose');
        if (real) b.classList.add('locked');
        if (id && id === fav) b.classList.add('favteam');
        b.innerHTML = '<span class="bk-tn">' + teamName(div, id) + '</span>' +
          (real ? '<span class="bk-sc">' + scHtml(which === 'home' ? f.home : f.away) + '</span>' : '');
        if (live) b.disabled = true;
        else b.onclick = function () { g[f.id] = (g[f.id] === which) ? undefined : which; if (!g[f.id]) delete g[f.id]; rerender(); };
        pair.appendChild(b);
        if (idx === 0) pair.appendChild(el('span', 'bk-vs-mini', 'v'));
      });
      top.appendChild(pair);
      row.appendChild(top);
    }

    // Prediction on an unplayed group game (only shows once both teams have data).
    if (!isRealFinal(f)) {
      var pe = predEl(div, f.homeRef, f.awayRef, ratings, false);
      if (pe) { pe.classList.add('bk-pred-group'); row.appendChild(pe); }
    }
    return row;
  }

  // compact goals-points scoreboard for one game
  function renderScoreInputs(div, f, state, rerender) {
    var pk = picks(state), m = pk.scores[f.id] || {};
    var hm = WG.data.parseScore(m.home) || {}, am = WG.data.parseScore(m.away) || {};
    var wrap = el('div', 'bk-scorebrd');
    function num(v, ph) {
      var i = document.createElement('input');
      i.className = 'bk-num'; i.type = 'text'; i.inputMode = 'numeric'; i.maxLength = 2; i.placeholder = ph;
      if (v != null) i.value = v;
      return i;
    }
    function teamRow(id, sc, isWin) {
      var r = el('div', 'bk-sbrow' + (isWin ? ' win' : ''));
      r.appendChild(el('span', 'bk-sbname', teamName(div, id)));
      var gi = num(sc.goals, '0'), pi = num(sc.points, '00');
      r.appendChild(gi); r.appendChild(el('span', 'bk-sbsep', '–')); r.appendChild(pi);
      return { r: r, g: gi, p: pi };
    }
    var full = m.home != null && m.away != null;
    var ws = full ? winSide({ home: hm, away: am }) : null;
    var H = teamRow(f.homeRef, hm, ws === 'home'), A = teamRow(f.awayRef, am, ws === 'away');
    wrap.appendChild(H.r); wrap.appendChild(A.r);
    function commit() {
      var v = [H.g.value.trim(), H.p.value.trim(), A.g.value.trim(), A.p.value.trim()];
      if (v.every(function (x) { return x === ''; })) delete pk.scores[f.id];
      else if (v.every(function (x) { return /^\d{1,2}$/.test(x); })) pk.scores[f.id] = { home: v[0] + '-' + v[1], away: v[2] + '-' + v[3] };
      else return; // incomplete — wait for the rest
      if (typeof state.onChange === 'function') state.onChange(); else rerender();
    }
    [H.g, H.p, A.g, A.p].forEach(function (i) { i.addEventListener('change', commit); });
    return wrap;
  }

  // Shared standings <table> builder with a "follow" star column + fav highlight.
  // extraCell(r) -> trailing-cell HTML (e.g. Cup/Shield badge) or '' for none.
  function buildStandingsTable(div, rows, rerender, extraCell) {
    var fav = favId(div);
    var table = el('table', 'bk-tbl');
    table.innerHTML = '<thead><tr><th></th><th>#</th><th class="l">Team</th><th>P</th><th>W</th><th>L</th><th>+/-</th><th>Pts</th>' +
      (extraCell ? '<th></th>' : '') + '</tr></thead>';
    var tb = el('tbody');
    rows.forEach(function (r) {
      var isFav = r.teamId === fav;
      var diff = (r.diff > 0 ? '+' : '') + r.diff;
      var tr = el('tr', isFav ? 'fav' : null);
      var star = '<button class="bk-star' + (isFav ? ' on' : '') + '" data-team="' + r.teamId +
        '" aria-label="Follow ' + teamName(div, r.teamId) + '">' + (isFav ? '★' : '☆') + '</button>';
      tr.innerHTML = '<td class="star">' + star + '</td><td>' + r.rank + '</td><td class="l">' + teamName(div, r.teamId) +
        '</td><td>' + r.P + '</td><td>' + r.W + '</td><td>' + r.L + '</td><td>' + diff +
        '</td><td class="pts">' + r.pts + '</td>' + (extraCell ? '<td>' + (extraCell(r) || '') + '</td>' : '');
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    if (rerender && WG.fav) {
      table.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest ? e.target.closest('.bk-star') : null;
        if (!btn) return;
        e.preventDefault();
        WG.fav.toggle(div.slug, btn.getAttribute('data-team'));
        rerender();
      });
    }
    return table;
  }

  // ---- standings pool table + Cup/Shield tags + scenario line ----
  function renderPool(div, effDiv, standings, pool, rerender) {
    var box = el('div', 'bk-pool pool-' + pool.toLowerCase());
    var complete = poolComplete(effDiv, pool);
    box.appendChild(el('div', 'bk-pool-h', '<span class="bk-dot"></span> ' + POOL_LABEL[pool] +
      '<span class="bk-prov">' + (complete ? 'Final' : 'Provisional') + '</span>'));
    var rows = (standings && standings[pool]) ? standings[pool].slice().sort(function (a, b) { return a.rank - b.rank; }) : [];
    var cutoff = pool === 'A' ? 3 : 2;
    box.appendChild(buildStandingsTable(div, rows, rerender, function (r) {
      if (!complete) return '';
      return r.rank <= cutoff ? '<span class="bk-badge cup">Cup</span>' : '<span class="bk-badge shield">Shield</span>';
    }));

    var scen = (WG.scenarios && WG.scenarios.forPool) ? safe(function () { return WG.scenarios.forPool(div, pool, standings); }) : null;
    if (scen && !complete) {
      var lines = [];
      rows.forEach(function (r) {
        var s = scen[r.teamId];
        if (!s) return;
        if (s.status === 'clinched') lines.push('<b>' + teamName(div, r.teamId) + ':</b> <span class="ok">through to Cup</span>');
        else if (s.status === 'eliminated') lines.push('<b>' + teamName(div, r.teamId) + ':</b> <span class="out">Shield only</span>');
        else if (s.need) lines.push('<b>' + teamName(div, r.teamId) + ':</b> ' + s.need);
      });
      if (lines.length) box.appendChild(el('div', 'bk-scen',
        '<div class="bk-scen-h">Cup race — top ' + cutoff + ' of this group make the Cup</div>' + lines.join('<br>')));
    }
    return box;
  }

  // ---- knockout bracket (cup / shield) ----
  function renderBracketCard(div, standings, resolved, ratings, state, bracket, title) {
    var kos = (div.knockout || []).filter(function (k) { return k.bracket === bracket; });
    var card = el('div', 'bk-bracket ' + bracket);
    card.appendChild(el('div', 'bk-bracket-h', '<span class="bk-sq"></span>' + title));
    card.appendChild(el('div', 'bk-scrollhint', 'Swipe sideways to see all rounds →'));
    var tree = el('div', 'bk-tree');
    var scroll = el('div', 'bk-tree-scroll');
    var inner = el('div', 'bk-tree-inner');
    inner.id = 'bk-inner-' + bracket;

    var roundsOrder = ['Preliminary', 'Semi-Final', 'Final'];
    var byRound = {};
    kos.forEach(function (k) { (byRound[k.roundLabel] = byRound[k.roundLabel] || []).push(k); });
    roundsOrder.forEach(function (rl) {
      if (!byRound[rl]) return;
      var col = el('div', 'bk-col');
      col.appendChild(el('div', 'bk-col-h', rl));
      byRound[rl].forEach(function (k) { col.appendChild(renderMatch(div, standings, resolved, ratings, state, k)); });
      inner.appendChild(col);
    });
    scroll.appendChild(inner);
    tree.appendChild(scroll);
    card.appendChild(tree);

    var fin = kos.filter(function (k) { return k.roundLabel === 'Final'; })[0];
    var champ = fin && resolved[fin.id] ? resolved[fin.id].winner : null;
    var locked = fin && resolved[fin.id] && resolved[fin.id].locked;
    card.appendChild(el('div', 'bk-champ' + (champ ? '' : ' tbd'),
      '<span>' + title + ' Champion</span> ' + (champ ? teamName(div, champ) + (locked ? '' : ' <i>(projected)</i>') : 'TBD')));
    return card;
  }

  // Shared prediction line for an undecided matchup (group or knockout).
  function predEl(div, homeId, awayId, ratings, stakes) {
    if (!(ratings && WG.predictions && homeId && awayId)) return null;
    var pred = safe(function () {
      return WG.predictions.forFixture(div,
        { homeRef: homeId, awayRef: awayId, home: null, away: null, status: 'scheduled' }, ratings, { stakes: !!stakes });
    });
    if (!pred || !pred.favTeamId) return null;
    var flag = pred.watch === 'must' ? '<span class="bk-fire">🔥 toss-up</span>'
             : pred.watch === 'close' ? '<span class="bk-close">close</span>' : '';
    var pct = pred.winProb != null ? ' <span class="bk-pred-pct">(' + Math.round(pred.winProb * 100) + '%)</span>' : '';
    return el('div', 'bk-pred', '<span class="bk-pred-tag">PREDICTION</span> ' +
      teamName(div, pred.favTeamId) + ' by ~' + pred.margin + pct + ' ' + flag);
  }

  function renderMatch(div, standings, resolved, ratings, state, k) {
    var r = resolved[k.id] || {};
    var m = el('div', 'bk-match' + (k.roundLabel === 'Final' ? ' final' : '') + (r.locked ? ' locked' : ''));
    m.id = 'bk-m-' + k.id;
    if (k.feedsTo) m.setAttribute('data-feeds', k.feedsTo.matchId);
    m.appendChild(el('div', 'bk-meta', '<b>' + k.time + '</b> · ' + k.pitch));
    var knock = picks(state).knock;
    var fav = favId(div);

    [['home', k.homeRef], ['away', k.awayRef]].forEach(function (side) {
      var which = side[0], ref = side[1];
      var id = which === 'home' ? r.home : r.away;
      var prov = which === 'home' ? r.homeProv : r.awayProv;
      var slot = el('div', 'bk-slot');
      var known = !!id;
      var label = known ? teamName(div, id) : labelForRef(div, ref);
      if (!known) slot.classList.add('seed');
      if (known && prov) slot.classList.add('prov');
      if (known && r.winner === id) slot.classList.add('win');
      if (known && id === fav) slot.classList.add('favteam');
      var scoreHtml = '';
      if (r.locked && isRealFinal(k)) {
        scoreHtml = '<span class="bk-sc">' + scHtml(which === 'home' ? k.home : k.away) + '</span>';
      }
      slot.innerHTML = '<span class="bk-tn">' + label + '</span>' + scoreHtml;
      if (known && !r.locked) {
        slot.classList.add('pick');
        slot.onclick = function () {
          knock[k.id] = (knock[k.id] === which) ? undefined : which;
          if (!knock[k.id]) delete knock[k.id];
          if (typeof state.onChange === 'function') state.onChange();
        };
      }
      m.appendChild(slot);
      if (which === 'home') m.appendChild(el('div', 'bk-v', 'v'));
    });

    // Show where this match's winner goes, so the flow is traceable.
    if (k.feedsTo) m.appendChild(el('div', 'bk-feeds', 'Winner → ' + shortRound(k.feedsTo.matchId)));

    if (!r.locked && r.home && r.away) {
      var pe = predEl(div, r.home, r.away, ratings, eitherContention(div, standings, r.home, r.away));
      if (pe) m.appendChild(pe);
    }
    return m;
  }

  function eitherContention(div, standings, homeId, awayId) {
    if (!(WG.scenarios && WG.scenarios.forPool) || !div.pools) return false;
    var res = false;
    ['A', 'B'].forEach(function (p) {
      var members = div.pools[p] || [];
      if (members.indexOf(homeId) < 0 && members.indexOf(awayId) < 0) return;
      var s = safe(function () { return WG.scenarios.forPool(div, p, standings); }) || {};
      [homeId, awayId].forEach(function (id) { if (s[id] && s[id].status === 'contention') res = true; });
    });
    return res;
  }

  // Draw elbow connector lines from each match to the match its winner feeds.
  function drawAllConnectors() {
    var inners = document.querySelectorAll('.bk-tree-inner');
    Array.prototype.forEach.call(inners, function (inner) {
      var old = inner.querySelector('svg.bk-conn');
      if (old) old.remove();
      var ir = inner.getBoundingClientRect();
      var svg = document.createElementNS(SVGNS, 'svg');
      svg.setAttribute('class', 'bk-conn');
      svg.setAttribute('width', inner.offsetWidth);
      svg.setAttribute('height', inner.offsetHeight);
      var srcs = inner.querySelectorAll('.bk-match[data-feeds]');
      Array.prototype.forEach.call(srcs, function (src) {
        var dst = document.getElementById('bk-m-' + src.getAttribute('data-feeds'));
        if (!dst) return;
        var s = src.getBoundingClientRect(), d = dst.getBoundingClientRect();
        var x1 = s.right - ir.left, y1 = s.top - ir.top + s.height / 2;
        var x2 = d.left - ir.left, y2 = d.top - ir.top + d.height / 2;
        var mx = x1 + Math.max(12, (x2 - x1) / 2);
        var p = document.createElementNS(SVGNS, 'path');
        p.setAttribute('d', 'M' + x1 + ' ' + y1 + ' H' + mx + ' V' + y2 + ' H' + x2);
        p.setAttribute('fill', 'none');
        p.setAttribute('stroke', '#cfcfda');
        p.setAttribute('stroke-width', '1.5');
        svg.appendChild(p);
      });
      inner.insertBefore(svg, inner.firstChild);
    });
  }

  // ================= STYLES =================
  function injectStyles() {
    if (document.getElementById('bk-style')) return;
    var css = [
    '.bk-wrap{--teal:#00b4a8;--crim:#e40048;--blue:#3f6fe6;--lilac:#c084d8;--gold:#f0b400;--ink:#182219;--mut:#6d7168;--line:#e7e7ee;}',
    '.bk-intro{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:2px 0 10px;}',
    '.bk-hint{margin:0;font-size:13px;color:var(--mut);flex:1 1 240px;}',
    '.bk-pickhint{margin:8px 0 2px;font-size:12px;color:var(--mut);display:flex;align-items:center;gap:6px;}',
    '.bk-pickhint::before{content:"\\1F449";font-size:13px;}',
    ".bk-reset{font:600 12px/1 'Poppins',sans-serif;letter-spacing:.4px;text-transform:uppercase;border:1px solid var(--line);background:#fff;color:var(--ink);padding:8px 12px;border-radius:8px;cursor:pointer;}",
    '.bk-reset:hover{border-color:var(--teal);}',
    ".bk-h2{font:600 15px/1 'Poppins',sans-serif;text-transform:uppercase;letter-spacing:1px;margin:26px 0 10px;padding-bottom:6px;border-bottom:2px solid var(--line);}",
    ".bk-collapse-all{font:600 11px/1 'Poppins',sans-serif;letter-spacing:.3px;color:var(--teal);background:#e6f7f5;border:1px solid #b9e6e0;border-radius:8px;padding:8px 12px;cursor:pointer;white-space:nowrap;}",
    '.bk-collapse-all:hover{background:#d7f3f0;}',
    '.bk-days{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;}',
    '.bk-day{background:#fff;border:1px solid var(--line);border-radius:12px;overflow:hidden;min-width:0;}',
    ".bk-day-h{width:100%;margin:0;padding:14px;background:#faf7ef;border:0;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:10px;cursor:pointer;text-align:left;color:var(--ink);-webkit-tap-highlight-color:rgba(0,180,168,.15);}",
    '.bk-day-h:active{background:#eee7cf;}',
    '.bk-day-h:hover{background:#f3eede;}',
    ".bk-day-title{font:600 14px/1 'Poppins',sans-serif;}",
    '.bk-day-meta{margin-left:auto;font-weight:500;font-size:11.5px;color:var(--mut);}',
    '.bk-day-chev{flex:none;color:var(--mut);font-size:12px;transition:transform .15s;}',
    '.bk-day.collapsed .bk-day-chev{transform:rotate(-90deg);}',
    '.bk-day.collapsed .bk-day-body{display:none;}',
    '.bk-day.collapsed .bk-day-h{border-bottom:0;}',
    '.bk-game{display:flex;flex-direction:column;gap:6px;padding:6px 12px;border-bottom:1px solid #f2f2f6;border-left:3px solid transparent;}',
    '.bk-game:last-child{border-bottom:0;}',
    '.bk-game.pool-a{border-left-color:var(--teal);}.bk-game.pool-b{border-left-color:var(--blue);}',
    '.bk-game-top{display:flex;align-items:center;gap:10px;}',
    ".bk-time{font:600 12px/1 'Poppins',sans-serif;color:var(--mut);width:40px;flex:none;}",
    // header row + pick/score mode toggle
    '.bk-h2row{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:26px 0 10px;border-bottom:2px solid var(--line);padding-bottom:8px;}',
    '.bk-h2.flush{margin:0;border:0;padding:0;}',
    '.bk-mode{display:inline-flex;background:#eef0f3;border-radius:9px;padding:3px;}',
    ".bk-mode-b{font:600 11px/1 'Poppins',sans-serif;letter-spacing:.3px;border:0;background:transparent;color:var(--mut);padding:7px 13px;border-radius:6px;cursor:pointer;}",
    '.bk-mode-b.on{background:#fff;color:var(--ink);box-shadow:0 1px 3px rgba(0,0,0,.1);}',
    // scoreboard (enter-score mode)
    '.bk-scorebrd{display:flex;flex-direction:column;gap:5px;flex:1;min-width:0;}',
    '.bk-sbrow{display:flex;align-items:center;gap:6px;padding:3px 5px;border-radius:6px;}',
    '.bk-sbrow.win{background:#e3f7ee;}',
    '.bk-sbrow.win .bk-sbname{color:#046b63;font-weight:700;}',
    '.bk-sbrow.win .bk-sbname::after{content:" \\2713";color:var(--teal);}',
    ".bk-sbname{flex:1;min-width:0;font:600 13px/1.2 'Inter',sans-serif;overflow-wrap:anywhere;word-break:break-word;}",
    ".bk-num{width:36px;padding:6px 2px;border:1px solid var(--line);border-radius:6px;font:600 13px/1 'Poppins',sans-serif;text-align:center;color:var(--ink);}",
    '.bk-num:focus{outline:none;border-color:var(--teal);box-shadow:0 0 0 2px rgba(0,180,168,.15);}',
    '.bk-sbsep{color:var(--mut);font-weight:700;}',
    // explainer
    '.bk-explain{background:#fff;border:1px solid var(--line);border-left:4px solid var(--gold);border-radius:10px;padding:0;margin-bottom:6px;overflow:hidden;}',
    ".bk-explain-h{width:100%;font:700 12px/1 'Poppins',sans-serif;text-transform:uppercase;letter-spacing:.6px;color:var(--ink);background:none;border:0;cursor:pointer;text-align:left;padding:12px 14px;display:flex;align-items:center;justify-content:space-between;gap:8px;}",
    '.bk-explain-chev{transition:transform .15s;color:var(--mut);}',
    '.bk-explain.closed .bk-explain-chev{transform:rotate(-90deg);}',
    '.bk-explain-b{font-size:12.5px;color:#454;line-height:1.55;padding:0 14px 12px;}',
    '.bk-explain.closed .bk-explain-b{display:none;}',
    // group-stage header controls (mode toggle + inline collapse button)
    '.bk-gs-controls{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}',
    // mobile section jump-nav + knockout scroll hint (shown via media queries)
    '.bk-jumpnav{display:none;}',
    '.bk-scrollhint{display:none;}',
    '.bk-h2row,.bk-h2{scroll-margin-top:56px;}',
    '.bk-explain-b .ga{color:var(--teal);}.bk-explain-b .gb{color:var(--blue);}',
    ".bk-chip{display:inline-block;font:700 10px/1 'Poppins',sans-serif;text-transform:uppercase;letter-spacing:.4px;padding:3px 7px;border-radius:5px;}",
    '.bk-chip.cup{background:#fff5d6;color:#a9791a;}.bk-chip.shield{background:#f5e9fb;color:#8a3fb0;}',
    ".bk-legend{margin:-4px 0 12px;font-size:12px;color:var(--mut);line-height:1.5;}",
    '.bk-legend b{color:var(--ink);}',
    '.bk-h2row{position:relative;}',
    '.bk-help{margin-left:auto;flex:none;}',
    '.bk-help>summary.bk-help-s{list-style:none;cursor:pointer;width:22px;height:22px;border-radius:50%;border:1px solid var(--line);color:var(--mut);background:#fff;font:700 12px/20px \'Poppins\',sans-serif;text-align:center;display:inline-block;-webkit-user-select:none;user-select:none;}',
    '.bk-help>summary.bk-help-s::-webkit-details-marker{display:none;}',
    '.bk-help[open]>summary.bk-help-s{background:var(--teal);color:#fff;border-color:var(--teal);}',
    '.bk-help-b{position:absolute;left:0;right:0;top:calc(100% + 6px);z-index:20;font-size:12px;color:var(--ink);line-height:1.65;background:#fff;border:1px solid var(--line);border-radius:10px;padding:12px 14px;box-shadow:0 10px 30px rgba(20,20,40,.14);}',
    '.bk-help-b b{color:var(--ink);}',
    '.bk-pred-pct{color:var(--mut);font-weight:600;}',
    '.bk-pair{display:flex;flex-direction:column;gap:4px;flex:1;min-width:0;}',
    '.bk-vs-mini{text-align:center;font:600 9px/1 \'Poppins\',sans-serif;color:#b3b3c0;letter-spacing:1px;margin:-1px 0;}',
    ".bk-team{width:100%;min-width:0;display:flex;justify-content:space-between;align-items:center;gap:6px;font:600 13px/1.2 'Inter',sans-serif;text-align:left;color:var(--ink);background:#fff;border:1px solid var(--line);border-radius:8px;padding:9px 11px;cursor:pointer;}",
    '.bk-team .bk-tn{overflow-wrap:anywhere;word-break:break-word;min-width:0;}',
    '.bk-team:hover:not(:disabled){border-color:var(--teal);}',
    '.bk-team.win{background:#e3f7ee;border-color:var(--teal);color:#046b63;}',
    '.bk-team.win .bk-tn::before{content:"\\2713 ";color:var(--teal);font-weight:700;}',
    '.bk-team.lose{background:#f6f6f8;color:#9497a6;}',
    '.bk-team.locked{cursor:default;}',
    // pickable teams get a clear "tap me" affordance, distinct from played rows
    '.bk-pair .bk-team:not(.win):not(.lose):not(.locked){border-style:dashed;border-color:#c9d2e3;background:#fcfdff;}',
    '.bk-pair .bk-team:not(.win):not(.lose):not(.locked)::after{content:"pick";flex:none;font:700 8px/1 \'Poppins\',sans-serif;letter-spacing:.5px;text-transform:uppercase;color:#aeb6c6;}',
    '.bk-pair .bk-team:not(.win):not(.lose):not(.locked):hover{background:#effaf8;border-style:solid;border-color:var(--teal);}',
    '.bk-pair .bk-team:not(.win):not(.lose):not(.locked):hover::after{color:var(--teal);}',
    // followed ("my team") emphasis, shared across group buttons + knockout slots
    '.bk-team.favteam{box-shadow:inset 3px 0 0 var(--gold);}',
    '.bk-slot.favteam{box-shadow:inset 3px 0 0 var(--gold);}',
    '.bk-tot{color:var(--mut);font-weight:600;font-size:.82em;margin-left:3px;}',
    ".bk-sc{font:700 12px/1 'Poppins',sans-serif;color:var(--ink);flex:none;}",
    '.bk-standings{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;}',
    '.bk-pool{background:#fff;border:1px solid var(--line);border-radius:12px;overflow:hidden;min-width:0;}',
    ".bk-pool-h{font:600 14px/1 'Poppins',sans-serif;padding:10px 14px;border-bottom:1px solid var(--line);display:flex;align-items:center;}",
    '.bk-dot{width:9px;height:9px;border-radius:50%;margin-right:8px;}',
    '.pool-a .bk-dot{background:var(--teal);}.pool-b .bk-dot{background:var(--blue);}',
    ".bk-prov{margin-left:auto;font:500 11px/1 'Poppins',sans-serif;color:var(--mut);}",
    // follow ("my team") star + highlighted row
    '.bk-tbl td.star{padding:0 0 0 6px;width:22px;}',
    ".bk-star{border:0;background:none;cursor:pointer;font-size:15px;line-height:1;color:#c7c7d2;padding:4px;}",
    '.bk-star.on{color:var(--gold);}',
    '.bk-star:hover{color:var(--gold);}',
    '.bk-tbl tr.fav td{background:rgba(240,180,0,.09);}',
    '.bk-tbl tr.fav td.l{box-shadow:inset 3px 0 0 var(--gold);}',
    '.bk-tbl{width:100%;border-collapse:collapse;font-size:13px;}',
    ".bk-tbl th{font:600 10px/1 'Poppins',sans-serif;text-transform:uppercase;letter-spacing:.4px;color:var(--mut);padding:8px 6px;border-bottom:1px solid var(--line);text-align:center;}",
    '.bk-tbl th.l,.bk-tbl td.l{text-align:left;}',
    '.bk-tbl td{padding:8px 6px;text-align:center;border-bottom:1px solid #f2f2f6;}',
    '.bk-tbl tbody tr:last-child td{border-bottom:0;}',
    '.bk-tbl td.l{font-weight:600;}.bk-tbl td.pts{font-weight:700;}',
    ".bk-badge{font:600 10px/1 'Poppins',sans-serif;text-transform:uppercase;letter-spacing:.4px;padding:3px 8px;border-radius:6px;}",
    '.bk-badge.cup{background:#e6f7f5;color:#046b63;}.bk-badge.shield{background:#f5e9fb;color:#8a3fb0;}',
    '.bk-scen{font-size:12px;color:var(--ink);padding:10px 14px;border-top:1px solid var(--line);background:#fbfbfd;line-height:1.7;}',
    ".bk-scen-h{font:600 10px/1 'Poppins',sans-serif;text-transform:uppercase;letter-spacing:.5px;color:var(--mut);margin-bottom:4px;}",
    '.bk-scen .ok{color:#046b63;font-weight:700;}.bk-scen .out{color:var(--crim);font-weight:700;}',
    '.bk-ko-band{margin-top:8px;}',
    '.bk-brackets{display:grid;grid-template-columns:minmax(0,1fr);gap:14px;}',
    '.bk-bracket{background:#fff;border:1px solid var(--line);border-radius:12px;padding:12px 14px;min-width:0;}',
    '.bk-tree{min-width:0;}',
    ".bk-bracket-h{font:700 15px/1 'Poppins',sans-serif;display:flex;align-items:center;margin-bottom:6px;}",
    '.bk-sq{width:12px;height:12px;border-radius:3px;margin-right:8px;}',
    '.bk-bracket.cup .bk-sq{background:var(--gold);}.bk-bracket.shield .bk-sq{background:var(--lilac);}',
    '.bk-tree-scroll{overflow-x:auto;}',
    '.bk-tree-inner{position:relative;display:flex;gap:30px;padding:6px 2px 4px;align-items:stretch;width:max-content;}',
    'svg.bk-conn{position:absolute;left:0;top:0;pointer-events:none;}',
    '.bk-col{position:relative;z-index:1;display:flex;flex-direction:column;justify-content:center;gap:16px;min-width:180px;}',
    ".bk-col-h{font:600 10px/1 'Poppins',sans-serif;text-transform:uppercase;letter-spacing:1.2px;color:var(--mut);text-align:center;margin-bottom:2px;}",
    '.bk-match{position:relative;background:#fff;border:1px solid var(--line);border-radius:9px;padding:8px 10px;box-shadow:0 1px 3px rgba(20,30,20,.05);}',
    '.bk-match.final{border-color:var(--gold);}',
    '.bk-meta{font-size:10.5px;color:var(--mut);margin-bottom:6px;}',
    '.bk-meta b{color:var(--teal);}.bk-match.final .bk-meta b{color:#a9791a;}',
    ".bk-slot{display:flex;justify-content:space-between;align-items:center;gap:6px;padding:6px 8px;border-radius:6px;font:600 13px/1.2 'Inter',sans-serif;border:1px solid transparent;}",
    '.bk-slot .bk-tn{overflow-wrap:anywhere;word-break:break-word;min-width:0;}',
    '.bk-slot.seed{color:#5c6070;font-weight:500;font-style:italic;}',
    '.bk-slot.prov .bk-tn{text-decoration:underline dashed var(--gold);text-underline-offset:3px;text-decoration-thickness:1px;}',
    ".bk-provkey{text-decoration:underline dashed var(--gold);text-underline-offset:2px;color:var(--ink);}",
    '.bk-slot.pick{cursor:pointer;}',
    '.bk-slot.pick:hover{background:#f2f8f7;border-color:#cfe8e4;}',
    '.bk-slot.win{background:#e6f7f5;border-color:var(--teal);color:#046b63;}',
    ".bk-v{text-align:center;font:600 9px/1 'Poppins',sans-serif;color:#bbb;letter-spacing:2px;margin:2px 0;}",
    '.bk-pred{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:8px;padding:6px 8px;font-size:12px;color:var(--ink);background:linear-gradient(90deg,rgba(240,180,0,.10),rgba(0,180,168,.10));border:1px dashed var(--gold);border-radius:10px;}',
    ".bk-pred-tag{font:800 9px/1 'Poppins',sans-serif;letter-spacing:.1em;background:var(--gold);color:#1c1c28;padding:3px 6px;border-radius:5px;}",
    '.bk-fire{color:var(--crim);font-weight:600;white-space:nowrap;}',
    '.bk-close{color:var(--mut);font-weight:600;white-space:nowrap;}',
    '.bk-pred-group{margin-left:48px;}',
    ".bk-feeds{font:600 9.5px/1.2 'Poppins',sans-serif;text-transform:uppercase;letter-spacing:.4px;color:var(--mut);margin-top:6px;}",
    ".bk-champ{margin-top:10px;padding-top:8px;border-top:1px solid var(--line);font:700 14px/1 'Poppins',sans-serif;}",
    ".bk-champ span{font:600 10px/1 'Poppins',sans-serif;text-transform:uppercase;letter-spacing:1px;color:var(--mut);margin-right:6px;}",
    '.bk-champ.tbd{color:#9aa;}.bk-champ i{color:var(--mut);font-weight:500;}',
    // knockout swipe hint on smaller screens (bracket fits without scroll on wide desktop)
    '@media (max-width:1023px){.bk-scrollhint{display:block;font:600 10.5px/1 \'Poppins\',sans-serif;letter-spacing:.3px;color:var(--mut);text-align:right;margin:-2px 0 6px;}}',
    // phones: sticky section jump-nav (tabbar is at the bottom here, so top is free)
    '@media (max-width:639px){.bk-jumpnav{display:flex;align-items:center;gap:6px;position:sticky;top:0;z-index:6;background:#f6f6f9;padding:8px 0;margin:2px 0 6px;}',
    ".bk-jumpnav-lbl{font:700 9px/1 'Poppins',sans-serif;text-transform:uppercase;letter-spacing:.6px;color:var(--mut);flex:none;}",
    ".bk-jump{font:600 11px/1 'Poppins',sans-serif;color:var(--mut);background:transparent;border:1px solid var(--line);border-radius:999px;padding:7px 12px;cursor:pointer;}",
    '.bk-jump:active{background:#e6f7f5;border-color:var(--teal);color:var(--ink);}}',
    // tablet: 3-column group days + side-by-side standings (single-pane)
    '@media (min-width:720px) and (max-width:1023px){.bk-days{grid-template-columns:repeat(3,minmax(0,1fr));}.bk-standings{grid-template-columns:minmax(0,1fr) minmax(0,1fr);}}',
    '.bk-tree-inner{gap:44px;}',
    // desktop: two panes — group games (left) + sticky standings/bracket (right)
    '@media (min-width:1024px){',
    '.bk-cols{display:grid;grid-template-columns:minmax(360px,40%) minmax(0,1fr);gap:22px;align-items:start;}',
    '.bk-col-right{position:sticky;top:10px;max-height:calc(100vh - 20px);overflow:auto;padding-right:2px;}',
    '.bk-col-left>.bk-h2row:first-child{margin-top:0;}',
    '.bk-col-right>.bk-h2:first-child{margin-top:0;}',
    '.bk-col-left .bk-days{grid-template-columns:minmax(0,1fr);}',   /* days stack in the narrow left pane (collapse helps here) */
    '.bk-standings{grid-template-columns:minmax(0,1fr);}',           /* stack Group A / B in the right pane */
    '.bk-col{min-width:150px;}',
    '.bk-ko-band .bk-brackets{grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:18px;}',  /* Cup + Shield side by side, full width */
    '}'
    ].join('');
    var s = document.createElement('style');
    s.id = 'bk-style';
    s.textContent = css;
    document.head.appendChild(s);
  }

  WG.bracket = { render: render };
})(window.WG = window.WG || {});
