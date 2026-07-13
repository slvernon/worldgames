/* WG.calendar — day-by-day schedule view for ALL divisions.
 * Full tier (Camogie Div1) additionally shows PREDICTION chips on upcoming games.
 * Schedule tier shows schedule + score + pitch ONLY.
 * Attaches to window.WG.calendar. Vanilla JS, no modules. */
(function () {
  'use strict';
  var WG = (window.WG = window.WG || {});

  /* ---- small helpers (self-contained; don't hard-depend on other modules) ---- */

  function el(tag, cls, txt) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  }

  // Format a score object using WG.data.fmtScore when available, else fallback.
  function fmtScore(s) {
    if (!s) return '';
    if (WG.data && typeof WG.data.fmtScore === 'function') return WG.data.fmtScore(s);
    return (s.goals != null ? s.goals : 0) + '-' + (s.points != null ? s.points : 0);
  }

  // Resolve a team ref (teamId | seed token 'A1' | 'W:matchId') to a display name.
  function refName(div, ref) {
    if (ref == null) return 'TBD';
    var teams = div.teams || {};
    if (teams[ref]) return teams[ref].name;
    if (typeof ref === 'string') {
      if (ref.indexOf('W:') === 0) return 'Winner ' + ref.slice(2);
      if (/^[AB]\d+$/.test(ref)) return 'Pool ' + ref.charAt(0) + ' #' + ref.slice(1);
    }
    return String(ref);
  }

  // Both sides of a fixture reference a known team (teamId present in div.teams).
  function refIsTeam(div, ref) {
    return ref != null && div.teams && !!div.teams[ref];
  }

  // Which pool a teamId belongs to (null if none).
  function poolOfTeam(div, teamId) {
    var pools = div.pools || {};
    var keys = Object.keys(pools);
    for (var i = 0; i < keys.length; i++) {
      if ((pools[keys[i]] || []).indexOf(teamId) !== -1) return keys[i];
    }
    return null;
  }

  // Build a { [teamId]: {status,need} } scenarios map across all pools, once.
  // Returns {} if WG.scenarios is unavailable.
  function buildScenarios(div, standings) {
    var map = {};
    if (!(WG.scenarios && typeof WG.scenarios.forPool === 'function')) return map;
    if (!standings && WG.standings && typeof WG.standings.compute === 'function') {
      try { standings = WG.standings.compute(div); } catch (e) { standings = null; }
    }
    var pools = div.pools || {};
    Object.keys(pools).forEach(function (p) {
      var res;
      try { res = WG.scenarios.forPool(div, p, standings) || {}; } catch (e) { res = {}; }
      Object.keys(res).forEach(function (id) { map[id] = res[id]; });
    });
    return map;
  }

  // A pool is "complete" when every group fixture in it has a final score.
  function poolComplete(div, pool) {
    var fx = (div.fixtures || []).filter(function (f) {
      return f.stage === 'group' && f.pool === pool;
    });
    if (!fx.length) return false;
    return fx.every(function (f) { return f.status === 'final'; });
  }

  // Resolve a pool-seed token ('A1','B2') to a concrete teamId ONLY when that pool
  // is complete (its final standings are settled). 'W:' winner tokens are NOT
  // resolved here — they depend on knockout results and could yield false
  // predictions. Returns the resolved teamId, or the original ref unchanged.
  function resolveSeedRef(div, standings, ref) {
    if (typeof ref !== 'string') return ref;
    var m = /^([AB])(\d+)$/.exec(ref);
    if (!m) return ref;
    var pool = m[1];
    if (!standings || !standings[pool] || !poolComplete(div, pool)) return ref;
    var order = standings[pool].slice().sort(function (a, b) { return a.rank - b.rank; });
    var row = order[parseInt(m[2], 10) - 1];
    return (row && row.teamId) ? row.teamId : ref;
  }

  // High stakes when EITHER side is currently in 'contention' for its cutoff.
  function fixtureStakes(div, fx, scen) {
    if (!scen) return false;
    var ids = [fx.homeRef, fx.awayRef];
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      if (refIsTeam(div, id) && scen[id] && scen[id].status === 'contention') return true;
    }
    return false;
  }

  // Human-friendly day header, e.g. "Sat 12 Jul".
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function dayHeader(dateStr) {
    if (!dateStr) return 'Date TBD';
    var p = dateStr.split('-');
    // Construct as local date to avoid TZ drift.
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    if (isNaN(d.getTime())) return dateStr;
    return DOW[d.getDay()] + ' ' + Number(p[2]) + ' ' + MON[Number(p[1]) - 1];
  }

  // Sort key so undated fixtures fall last.
  function sortKey(fx) {
    return (fx.date || '9999-99-99') + 'T' + (fx.time || '99:99');
  }

  /* ---- prediction chip (full tier only) ---- */

  var WATCH_META = {
    close: { icon: '', text: 'Close' },
    stakes: { icon: '🔥', text: 'Big stakes' },
    must: { icon: '🔥', text: 'Toss-up' }
  };

  function predictionChip(div, fx, ratings, stakes) {
    if (!(WG.predictions && typeof WG.predictions.forFixture === 'function')) return null;
    var pred;
    try {
      pred = WG.predictions.forFixture(div, fx, ratings, { stakes: !!stakes });
    } catch (e) {
      return null;
    }
    if (!pred) return null;

    var wrap = el('div', 'wg-pred');
    var tag = el('span', 'wg-pred-tag', pred.label || 'PREDICTION');
    wrap.appendChild(tag);

    if (pred.favTeamId) {
      var pct = pred.winProb != null ? Math.round(pred.winProb * 100) + '%' : '';
      var favTxt = refName(div, pred.favTeamId);
      if (pred.margin != null) favTxt += ' by ~' + Math.abs(Math.round(pred.margin));
      if (pct) favTxt += ' (' + pct + ')';
      wrap.appendChild(el('span', 'wg-pred-fav', favTxt));
    }

    var w = WATCH_META[pred.watch];
    if (w) {
      var fire = el('span', 'wg-pred-watch', w.icon + ' ' + w.text);
      wrap.appendChild(fire);
    }
    return wrap;
  }

  /* ---- fixture row ---- */

  function statusBadge(fx) {
    var st = fx.status || 'scheduled';
    var label = st === 'live' ? 'LIVE' : st === 'final' ? 'FINAL' : 'UPCOMING';
    return el('span', 'wg-status wg-status-' + st, label);
  }

  function scoreCell(fx) {
    var cell = el('div', 'wg-score');
    if (fx.home && fx.away) {
      cell.appendChild(el('span', 'wg-score-num', fmtScore(fx.home)));
      cell.appendChild(el('span', 'wg-score-sep', '–'));
      cell.appendChild(el('span', 'wg-score-num', fmtScore(fx.away)));
    } else {
      cell.appendChild(el('span', 'wg-score-num wg-score-vs', 'vs'));
    }
    return cell;
  }

  function fixtureRow(div, fx, ratings, showPredictions, scen) {
    var row = el('div', 'wg-fx wg-fx-' + (fx.status || 'scheduled'));

    // Left: time + pitch
    var when = el('div', 'wg-fx-when');
    when.appendChild(el('span', 'wg-time', fx.time || '--:--'));
    when.appendChild(el('span', 'wg-pitch', fx.pitch || 'Pitch TBD'));
    if (fx.pool) when.appendChild(el('span', 'wg-pool wg-pool-' + fx.pool, 'Pool ' + fx.pool));
    else if (fx.stage === 'knockout') when.appendChild(el('span', 'wg-pool wg-pool-ko', 'Knockout'));
    row.appendChild(when);

    // Middle: teams + score
    var body = el('div', 'wg-fx-body');
    var teams = el('div', 'wg-teams');
    var homeEl = el('span', 'wg-team', refName(div, fx.homeRef));
    var awayEl = el('span', 'wg-team', refName(div, fx.awayRef));
    // Highlight winner when final.
    if (fx.status === 'final' && fx.home && fx.away) {
      var ht = fx.home.total, at = fx.away.total;
      if (ht > at) homeEl.classList.add('wg-team-win');
      else if (at > ht) awayEl.classList.add('wg-team-win');
    }
    teams.appendChild(homeEl);
    teams.appendChild(scoreCell(fx));
    teams.appendChild(awayEl);
    body.appendChild(teams);

    // Prediction chip only for full-tier upcoming (not final) games.
    if (showPredictions && fx.status !== 'final') {
      var chip = predictionChip(div, fx, ratings, fixtureStakes(div, fx, scen));
      if (chip) body.appendChild(chip);
    }
    row.appendChild(body);

    // Right: status badge
    row.appendChild(statusBadge(fx));

    return row;
  }

  /* ---- Now / Next ---- */

  // Pick a "now" fixture (any live) and a "next" upcoming (earliest scheduled).
  function pickNowNext(fixtures) {
    var live = null, next = null;
    for (var i = 0; i < fixtures.length; i++) {
      var fx = fixtures[i];
      if (fx.status === 'live' && !live) live = fx;
      if ((fx.status === 'scheduled' || fx.status == null) && !next) next = fx;
    }
    return { now: live, next: next };
  }

  function nowNextBar(div, nn, ratings, showPredictions, scen) {
    if (!nn.now && !nn.next) return null;
    var bar = el('div', 'wg-nownext');

    function card(kind, fx) {
      if (!fx) return null;
      var c = el('div', 'wg-nn-card wg-nn-' + kind);
      c.appendChild(el('div', 'wg-nn-label', kind === 'now' ? 'NOW' : 'NEXT UP'));
      var line = el('div', 'wg-nn-match',
        refName(div, fx.homeRef) + ' v ' + refName(div, fx.awayRef));
      c.appendChild(line);
      var meta = el('div', 'wg-nn-meta');
      var bits = [];
      if (fx.date) bits.push(dayHeader(fx.date));
      if (fx.time) bits.push(fx.time);
      if (fx.pitch) bits.push(fx.pitch);
      meta.textContent = bits.join(' · ');
      c.appendChild(meta);
      if (kind === 'now' && fx.home && fx.away) {
        c.appendChild(el('div', 'wg-nn-score',
          fmtScore(fx.home) + ' – ' + fmtScore(fx.away)));
      }
      if (kind === 'next' && showPredictions) {
        var chip = predictionChip(div, fx, ratings, fixtureStakes(div, fx, scen));
        if (chip) c.appendChild(chip);
      }
      return c;
    }

    var n1 = card('now', nn.now);
    var n2 = card('next', nn.next);
    if (n1) bar.appendChild(n1);
    if (n2) bar.appendChild(n2);
    return bar;
  }

  /* ---- team filter ---- */

  function buildFilter(div, fixtures, state, onChange) {
    // Collect team ids that actually appear in fixtures (real teams only).
    var seen = {};
    fixtures.forEach(function (fx) {
      if (refIsTeam(div, fx.homeRef)) seen[fx.homeRef] = true;
      if (refIsTeam(div, fx.awayRef)) seen[fx.awayRef] = true;
    });
    var ids = Object.keys(seen);
    if (!ids.length) return null;
    ids.sort(function (a, b) {
      return refName(div, a).localeCompare(refName(div, b));
    });

    var wrap = el('div', 'wg-filter');
    wrap.appendChild(el('label', 'wg-filter-lbl', 'Team'));
    var sel = el('select', 'wg-filter-sel');
    var optAll = el('option', null, 'All teams');
    optAll.value = '';
    sel.appendChild(optAll);
    ids.forEach(function (id) {
      var o = el('option', null, refName(div, id));
      o.value = id;
      if (state && state.calendarTeam === id) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', function () {
      onChange(sel.value || null);
    });
    wrap.appendChild(sel);
    return wrap;
  }

  /* ---- empty state ---- */

  function emptyState(msg) {
    var e = el('div', 'wg-empty');
    e.appendChild(el('div', 'wg-empty-icon', '📅')); // 📅
    e.appendChild(el('div', 'wg-empty-msg', msg || 'Schedule not loaded yet.'));
    e.appendChild(el('div', 'wg-empty-sub', 'Fixtures will appear here once they are published.'));
    return e;
  }

  /* ---- main render ---- */

  function render(rootEl, div, state) {
    if (!rootEl) return WG.calendar;
    rootEl.innerHTML = '';
    rootEl.classList.add('wg-calendar');
    state = state || {};

    if (!div) {
      rootEl.appendChild(emptyState('No division selected.'));
      return WG.calendar;
    }

    var showPredictions = div.tier === 'full';

    // Standings drive both scenario stakes and seed-token resolution below.
    var standings = null;
    if (showPredictions && WG.standings && typeof WG.standings.compute === 'function') {
      try { standings = WG.standings.compute(div); } catch (e) { standings = null; }
    }

    // Build a working list of fixtures (group + knockout combined for the timeline).
    var all = [];
    (div.fixtures || []).forEach(function (f) { all.push(f); });
    // Knockout matches may live in div.knockout with a slightly different shape;
    // normalise them into fixture-like rows so they show on the calendar too.
    // Resolve pool-seed refs (e.g. 'B2') to real team ids once their pool is
    // complete, so a prediction can show. 'W:' refs are left as-is.
    (div.knockout || []).forEach(function (k) {
      all.push({
        id: k.id,
        stage: 'knockout',
        date: k.date,
        time: k.time,
        pitch: k.pitch,
        pool: null,
        homeRef: resolveSeedRef(div, standings, k.homeRef),
        awayRef: resolveSeedRef(div, standings, k.awayRef),
        home: k.home || null,
        away: k.away || null,
        status: k.status || 'scheduled',
        _bracket: k.bracket,
        _round: k.roundLabel
      });
    });

    if (!all.length) {
      // Friendly empty state (schedule-tier before live data, or no fixtures baked).
      rootEl.appendChild(emptyState('Schedule not loaded yet for ' + (div.name || 'this division') + '.'));
      return WG.calendar;
    }

    // Compute prediction ratings once (full tier).
    var ratings = null;
    if (showPredictions && WG.predictions && typeof WG.predictions.build === 'function') {
      try { ratings = WG.predictions.build(div); } catch (e) { ratings = null; }
    }

    // Qualification scenarios once (full tier) — used to flag 'stakes' games.
    var scen = showPredictions ? buildScenarios(div, standings) : null;

    // Sort chronologically.
    all.sort(function (a, b) { return sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0; });

    // --- controls: Now/Next + filter ---
    var controls = el('div', 'wg-cal-controls');

    var teamFilter = state.calendarTeam || null;
    var filterEl = buildFilter(div, all, state, function (teamId) {
      state.calendarTeam = teamId;
      render(rootEl, div, state); // re-render with filter applied
    });

    // Now/Next uses the UNFILTERED list so it reflects the whole tournament.
    var nn = pickNowNext(all);
    var nnBar = nowNextBar(div, nn, ratings, showPredictions, scen);
    if (nnBar) rootEl.appendChild(nnBar);

    if (filterEl) {
      controls.appendChild(filterEl);
      rootEl.appendChild(controls);
    }

    // Apply filter to the day list.
    var list = all;
    if (teamFilter) {
      list = all.filter(function (fx) {
        return fx.homeRef === teamFilter || fx.awayRef === teamFilter;
      });
    }

    if (!list.length) {
      rootEl.appendChild(emptyState('No fixtures for ' + refName(div, teamFilter) + ' yet.'));
      return WG.calendar;
    }

    // --- group by date ---
    var days = [];
    var byDate = {};
    list.forEach(function (fx) {
      var key = fx.date || 'TBD';
      if (!byDate[key]) { byDate[key] = []; days.push(key); }
      byDate[key].push(fx);
    });

    var timeline = el('div', 'wg-timeline');
    days.forEach(function (dateKey) {
      var section = el('section', 'wg-day');
      var head = el('div', 'wg-day-head');
      head.appendChild(el('span', 'wg-day-name', dateKey === 'TBD' ? 'Date TBD' : dayHeader(dateKey)));
      head.appendChild(el('span', 'wg-day-count', byDate[dateKey].length + ' ' +
        (byDate[dateKey].length === 1 ? 'game' : 'games')));
      section.appendChild(head);
      byDate[dateKey].forEach(function (fx) {
        section.appendChild(fixtureRow(div, fx, ratings, showPredictions, scen));
      });
      timeline.appendChild(section);
    });
    rootEl.appendChild(timeline);

    return WG.calendar;
  }

  WG.calendar = { render: render };
})();
