/* WG.players — "Players" view: per-team scorer stats table.
 *
 * Self-contained: owns its team selector, fetches data/players/<slug>.json
 * (written by fetch_players.py), and renders a sortable goals/points/total table.
 * Independent of the division selector used by the Bracket/Calendar views.
 */
(function () {
  'use strict';
  var WG = window.WG = window.WG || {};

  // Teams with player stats available. Keep in sync with fetch_players.py TEAMS.
  var TEAMS = [
    { slug: 'usgaa-southeast',  name: 'USGAA Southeast' },
    { slug: 'new-york-camogie', name: 'New York Camogie' }
  ];

  var LS_TEAM = 'wg.players.team';
  var LS_SORT = 'wg.players.sort';

  // Sortable columns: key -> {label, get, numeric}. `def` marks the default sort.
  var COLS = [
    { key: 'name',   label: 'Player', numeric: false, get: function (p) { return (p.name || '').toLowerCase(); } },
    { key: 'jersey', label: '#',      numeric: true,  get: function (p) { return p.jersey == null ? 999 : p.jersey; } },
    { key: 'goals',  label: 'G',      numeric: true,  get: function (p) { return p.goals || 0; } },
    { key: 'points', label: 'P',      numeric: true,  get: function (p) { return p.points || 0; } },
    { key: 'total',  label: 'Total',  numeric: true,  get: function (p) { return p.total || 0; }, def: true },
    { key: 'games',  label: 'Games',  numeric: true,  get: function (p) { return p.games || 0; } }
  ];

  var _cache = {};   // slug -> Promise<data|null>
  var mounted = null;

  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fetchTeam(slug) {
    if (_cache[slug]) return _cache[slug];
    var p = (typeof fetch !== 'function')
      ? Promise.resolve(null)
      : fetch('data/players/' + slug + '.json', { cache: 'no-store' })
          .then(function (r) { return r && r.ok ? r.json() : null; })
          .catch(function () { return null; });
    _cache[slug] = p;
    return p;
  }

  function currentSort() {
    var raw = lsGet(LS_SORT);
    if (raw) {
      try { var s = JSON.parse(raw); if (colFor(s.key)) return s; } catch (e) {}
    }
    return { key: 'total', asc: false };
  }
  function colFor(key) { for (var i = 0; i < COLS.length; i++) if (COLS[i].key === key) return COLS[i]; return null; }

  function sortPlayers(players, sort) {
    var col = colFor(sort.key) || colFor('total');
    var arr = players.slice();
    arr.sort(function (a, b) {
      var av = col.get(a), bv = col.get(b);
      if (av < bv) return sort.asc ? -1 : 1;
      if (av > bv) return sort.asc ? 1 : -1;
      // stable tiebreak: total desc, then name asc
      if ((b.total || 0) !== (a.total || 0)) return (b.total || 0) - (a.total || 0);
      return (a.name || '').toLowerCase() < (b.name || '').toLowerCase() ? -1 : 1;
    });
    return arr;
  }

  function coverageNote(data) {
    var withS = data.gamesWithScorers || 0, tot = data.gamesTotal || 0;
    var un = data.unattributedScores || 0;
    var msg = 'Scorer data recorded for <b>' + withS + ' of ' + tot + '</b> completed game' + (tot === 1 ? '' : 's') + '. ';
    if (withS < tot) {
      msg += 'Group games usually list only the team total, so tallies reflect games with per-scorer data (mainly knockouts). ';
    }
    if (un > 0) {
      msg += '<b>' + un + '</b> score' + (un === 1 ? '' : 's') + ' in those games ' + (un === 1 ? 'was' : 'were') + " not attributed to a named player.";
    }
    return msg;
  }

  function renderTable(host, data, sort) {
    var players = (data && data.players) || [];
    if (!players.length) {
      host.innerHTML = '<div class="wg-players__empty">No per-player scorer data recorded yet for this team.<br>' +
        'This fills in as officials log scorers (typically the knockout games).</div>';
      return;
    }
    var rows = sortPlayers(players, sort);
    var topTotal = 0;
    rows.forEach(function (p) { if ((p.total || 0) > topTotal) topTotal = p.total || 0; });

    var html = '<div class="wg-players__scroll"><table class="wg-players__table"><thead><tr>';
    COLS.forEach(function (c) {
      var cls = c.key === sort.key ? ('is-sorted' + (sort.asc ? ' is-asc' : '')) : '';
      html += '<th class="' + cls + '" data-key="' + c.key + '" scope="col">' + esc(c.label) + '</th>';
    });
    html += '</tr></thead><tbody>';
    rows.forEach(function (p) {
      var isTop = topTotal > 0 && (p.total || 0) === topTotal;
      html += '<tr' + (isTop ? ' class="is-top"' : '') + '>' +
        '<td class="wg-players__name">' + esc(p.name) + '</td>' +
        '<td>' + (p.jersey == null ? '–' : esc(p.jersey)) + '</td>' +
        '<td>' + (p.goals || 0) + '</td>' +
        '<td>' + (p.points || 0) + '</td>' +
        '<td class="wg-players__total">' + (p.total || 0) + '</td>' +
        '<td>' + (p.games || 0) + '</td>' +
      '</tr>';
    });
    html += '</tbody></table></div>';
    host.innerHTML = html;

    // Wire sortable headers.
    var ths = host.querySelectorAll('thead th');
    for (var i = 0; i < ths.length; i++) {
      ths[i].addEventListener('click', function () {
        var key = this.getAttribute('data-key');
        var col = colFor(key);
        var next = { key: key, asc: (key === sort.key) ? !sort.asc : !col.numeric };
        lsSet(LS_SORT, JSON.stringify(next));
        renderTable(host, data, next);
      });
    }
  }

  function build(container) {
    var savedTeam = lsGet(LS_TEAM);
    var startSlug = TEAMS.some(function (t) { return t.slug === savedTeam; }) ? savedTeam : TEAMS[0].slug;

    var opts = TEAMS.map(function (t) {
      return '<option value="' + t.slug + '"' + (t.slug === startSlug ? ' selected' : '') + '>' + esc(t.name) + '</option>';
    }).join('');

    container.innerHTML =
      '<div class="wg-players">' +
        '<div class="wg-players__controls">' +
          '<label class="wg-visually-hidden" for="wg-players-team">Choose team</label>' +
          '<select class="wg-players__select" id="wg-players-team">' + opts + '</select>' +
          '<div class="wg-players__note" id="wg-players-note"></div>' +
        '</div>' +
        '<div id="wg-players-table"></div>' +
      '</div>';

    var sel = container.querySelector('#wg-players-team');
    var noteEl = container.querySelector('#wg-players-note');
    var tableEl = container.querySelector('#wg-players-table');

    function load(slug) {
      noteEl.textContent = 'Loading…';
      tableEl.innerHTML = '';
      fetchTeam(slug).then(function (data) {
        if (sel.value !== slug) return;            // user switched while loading
        if (!data) {
          noteEl.textContent = 'Could not load player stats for this team.';
          renderTable(tableEl, { players: [] }, currentSort());
          return;
        }
        noteEl.innerHTML = coverageNote(data);
        renderTable(tableEl, data, currentSort());
      });
    }

    sel.addEventListener('change', function () {
      lsSet(LS_TEAM, sel.value);
      load(sel.value);
    });
    load(startSlug);
  }

  function render(container) {
    if (!container) return;
    if (mounted !== container) {   // build the shell once per container
      build(container);
      mounted = container;
    }
    // If already built, leave it as-is (its own select drives updates).
  }

  WG.players = { render: render, TEAMS: TEAMS };
})();
