/* WG.data — data layer for the GAA World Games companion.
 * Static site friendly: plain <script>, attaches to window.WG. No modules, no deps.
 *
 * Responsibilities:
 *   - WG.data.divisions            : list of {slug,id,name,sport,tier}
 *   - WG.data.loadDivision(slug)   : Promise<Division> (baked schedule + live overlay)
 *   - WG.data.parseScore / fmtScore: GAA "goals-points" <-> {goals,points,total}
 *
 * Only intl-camogie-1 is a full baked Division (loaded from data/intl-camogie-1.json).
 * Every other division is a minimal {tier:'schedule', fixtures:[]} placeholder that a
 * live data/<slug>.json can flesh out later.
 *
 * Live overlay: data/<slug>.json (if present) may carry an array of partial fixtures
 * (score/status updates). We match them onto baked fixtures by fixture id, and fall
 * back to (date,time,homeRef,awayRef). Missing / unreachable JSON (e.g. file://) is
 * swallowed and we just serve the baked schedule.
 */
(function () {
  'use strict';

  var WG = (window.WG = window.WG || {});

  // ---- Division registry (metadata only; full data loaded on demand) --------
  var DIVISIONS = [
    { slug: 'intl-football-1', id: 'd40dbd8a-2dba-4b12-befb-e734a3606fda', name: "International Men's Football Division 1", sport: 'Football', tier: 'schedule' },
    { slug: 'intl-football-2', id: '13047959-a78e-42ef-b170-7473e812ad92', name: "International Men's Football Division 2", sport: 'Football', tier: 'schedule' },
    { slug: 'intl-football-3', id: 'ab0954b9-6ddc-4c99-bd70-0c4b4c6a9135', name: "International Men's Football Division 3", sport: 'Football', tier: 'schedule' },
    { slug: 'intl-lgfa-1',     id: 'c68943b0-f16b-4430-9d76-6c5f7dfbe3c0', name: 'International LGFA Division 1',    sport: 'LGFA',    tier: 'schedule' },
    { slug: 'intl-lgfa-2',     id: '91bc1ed7-8bba-4fb3-bd11-107bab50b6e5', name: 'International LGFA Division 2',    sport: 'LGFA',    tier: 'schedule' },
    { slug: 'intl-lgfa-3',     id: '36a70955-bdcf-43c3-9665-e74c8d9bf62d', name: 'International LGFA Division 3',    sport: 'LGFA',    tier: 'schedule' },
    { slug: 'intl-hurling-1',  id: '9299af37-700b-4cd6-8095-9a1a885c758d', name: 'International Hurling Division 1', sport: 'Hurling', tier: 'schedule' },
    { slug: 'intl-hurling-2',  id: '95d2587d-6e25-44c5-b7af-adc011086e2b', name: 'International Hurling Division 2', sport: 'Hurling', tier: 'schedule' },
    { slug: 'intl-camogie-1',  id: '7ece7fe6-087d-4d96-99c9-392c9a446081', name: 'International Camogie Division 1', sport: 'Camogie', tier: 'full' },
    { slug: 'intl-camogie-2',  id: '9948af9c-1ce8-440e-8c1b-b10f8ac12726', name: 'International Camogie Division 2', sport: 'Camogie', tier: 'schedule' },
    { slug: 'open-football',   id: '4a6be341-9852-4849-856c-b1d331744953', name: 'Open Football', sport: 'Football', tier: 'schedule' },
    { slug: 'open-lgfa',       id: '8917d15f-feb5-466d-a22c-00eb9443e9b4', name: 'Open LGFA',     sport: 'LGFA',    tier: 'schedule' },
    { slug: 'open-hurling',    id: 'a544eda6-8ad4-4274-9f3b-27d7ab69f119', name: 'Open Hurling',  sport: 'Hurling', tier: 'schedule' },
    { slug: 'open-camogie',    id: '706b1bad-2381-4444-8391-ac9fc2e1561d', name: 'Open Camogie',  sport: 'Camogie', tier: 'schedule' }
  ];

  var TOURNAMENT_ID = '13bbca25-b104-492b-8de4-198cc9e5fbd7';
  var SEASON = '2026';

  // Where baked full-division JSON lives (only intl-camogie-1 today).
  // Relative path keeps it working from file:// and GitHub Pages subpaths.
  var BAKED = {
    'intl-camogie-1': 'data/intl-camogie-1.json'
  };

  // ---- Score parsing --------------------------------------------------------
  // GAA format "G-PP": total = goals*3 + points. Null/blank -> null.
  function parseScore(str) {
    if (str == null) return null;
    if (typeof str === 'object') {
      // Already a score object? normalise & return a copy.
      if (typeof str.goals === 'number' && typeof str.points === 'number') {
        return { goals: str.goals, points: str.points, total: str.goals * 3 + str.points };
      }
      return null;
    }
    var s = String(str).trim();
    if (s === '') return null;
    var m = /^(\d+)\s*-\s*(\d+)$/.exec(s);
    if (!m) return null;
    var goals = parseInt(m[1], 10);
    var points = parseInt(m[2], 10);
    return { goals: goals, points: points, total: goals * 3 + points };
  }

  function fmtScore(obj) {
    if (!obj || typeof obj.goals !== 'number' || typeof obj.points !== 'number') return '';
    // GAA convention zero-pads points to 2 digits, e.g. "1-05". Goals are not padded.
    var pts = obj.points < 10 && obj.points >= 0 ? '0' + obj.points : String(obj.points);
    return obj.goals + '-' + pts;
  }

  // Coerce whatever a live feed put in a home/away slot into a score object|null.
  function coerceScore(v) {
    if (v == null) return null;
    if (typeof v === 'string') return parseScore(v);
    if (typeof v === 'object' && typeof v.goals === 'number' && typeof v.points === 'number') {
      return { goals: v.goals, points: v.points, total: v.goals * 3 + v.points };
    }
    return null;
  }

  // ---- Fetch helpers (fail soft) -------------------------------------------
  // Returns Promise<object|null>. Never rejects: file:// / 404 / bad JSON -> null.
  function fetchJSON(path) {
    if (typeof fetch !== 'function') return Promise.resolve(null);
    return fetch(path, { cache: 'no-store' })
      .then(function (res) { return res && res.ok ? res.json() : null; })
      .catch(function () { return null; });
  }

  // ---- Baked-division builders ---------------------------------------------
  function placeholderDivision(meta) {
    return {
      slug: meta.slug,
      id: meta.id,
      name: meta.name,
      sport: meta.sport,
      tier: 'schedule',
      teams: {},
      pools: null,
      fixtures: [],
      knockout: null
    };
  }

  // Deep-ish clone so callers never mutate a shared cached object.
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // ---- Live overlay ---------------------------------------------------------
  // `live` may be either a full/partial Division-shaped object, or a bare
  // { fixtures:[...] } / array of fixture patches. We only overlay scores &
  // status onto existing baked fixtures (schedule stays authoritative).
  function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, ''); }
  // date|time|pitch — a stable key to match a live fixture to a baked one.
  function dtpKey(f) { return [f.date || '', f.time || '', norm(f.pitch)].join('|'); }
  function teamNameOf(div, ref) { var t = div.teams && div.teams[ref]; return t ? t.name : ref; }

  // Copy a live fixture's status + scores onto a baked fixture/match, mapping
  // home/away by TEAM NAME so a home/away swap upstream can't flip the scoreline.
  function applyScores(target, p, div, liveTeams) {
    if (p.status) target.status = p.status;
    var ph = ('home' in p) ? coerceScore(p.home) : undefined;
    var pa = ('away' in p) ? coerceScore(p.away) : undefined;
    if (ph === undefined && pa === undefined) return;
    var liveHome = liveTeams[p.homeRef] ? liveTeams[p.homeRef].name : p.homeRef;
    var baseHome = teamNameOf(div, target.homeRef);
    var baseAway = teamNameOf(div, target.awayRef);
    var flip = norm(liveHome) && norm(liveHome) === norm(baseAway) && norm(liveHome) !== norm(baseHome);
    if (flip) { if (pa !== undefined) target.home = pa; if (ph !== undefined) target.away = ph; }
    else { if (ph !== undefined) target.home = ph; if (pa !== undefined) target.away = pa; }
  }

  function overlayLive(div, live) {
    if (!live) return div;
    if (live.updatedAt) div.updatedAt = live.updatedAt;   // when the fetcher last refreshed this file
    var liveTeams = (live.teams && typeof live.teams === 'object') ? live.teams : {};
    var patches = Array.isArray(live) ? live : (Array.isArray(live.fixtures) ? live.fixtures : []);

    // FULL baked division (e.g. Camogie Div 1): the schedule/pools/knockout are
    // authoritative. Match live records to baked games by date+time+pitch and copy
    // only status + scores. Never append (avoids duplicate UUID-keyed fixtures).
    if (div.tier === 'full') {
      var idx = {};
      (div.fixtures || []).forEach(function (f) { idx[dtpKey(f)] = f; });
      (div.knockout || []).forEach(function (k) { idx[dtpKey(k)] = k; });
      patches.forEach(function (p) {
        var target = idx[dtpKey(p)];
        if (target) applyScores(target, p, div, liveTeams);
      });
      return div;
    }

    // SCHEDULE-tier division: the live feed IS the source. Adopt its teams and
    // append its fixtures (this is how football/hurling/etc. get populated).
    Object.keys(liveTeams).forEach(function (id) { if (!div.teams[id]) div.teams[id] = liveTeams[id]; });
    if (!div.pools && live.pools) div.pools = clone(live.pools);
    if (Array.isArray(live.knockout) && !div.knockout) div.knockout = clone(live.knockout);

    var byId = {}, byDtp = {};
    div.fixtures.forEach(function (f) { byId[f.id] = f; byDtp[dtpKey(f)] = f; });
    patches.forEach(function (p) {
      var target = (p.id && byId[p.id]) || byDtp[dtpKey(p)];
      if (!target) {
        if (p.id && p.homeRef && p.awayRef) {
          var nf = clone(p);
          if ('home' in nf) nf.home = coerceScore(nf.home);
          if ('away' in nf) nf.away = coerceScore(nf.away);
          nf.status = nf.status || 'scheduled';
          div.fixtures.push(nf);
          byId[nf.id] = nf; byDtp[dtpKey(nf)] = nf;
        }
        return;
      }
      if ('home' in p) target.home = coerceScore(p.home);
      if ('away' in p) target.away = coerceScore(p.away);
      if (p.status) target.status = p.status;
      if (p.time) target.time = p.time;
      if (p.pitch) target.pitch = p.pitch;
      if (p.date) target.date = p.date;
    });
    return div;
  }

  // ---- loadDivision ---------------------------------------------------------
  var _cache = {}; // slug -> Promise<Division>

  function metaFor(slug) {
    for (var i = 0; i < DIVISIONS.length; i++) {
      if (DIVISIONS[i].slug === slug) return DIVISIONS[i];
    }
    return null;
  }

  function loadDivision(slug, force) {
    if (force) delete _cache[slug];        // re-fetch live data (e.g. periodic refresh)
    if (_cache[slug]) return _cache[slug];

    var meta = metaFor(slug);
    if (!meta) {
      return Promise.reject(new Error('Unknown division slug: ' + slug));
    }

    var p = new Promise(function (resolve) {
      // Step 1: obtain the baked base division.
      var basePromise;
      if (BAKED[slug]) {
        basePromise = fetchJSON(BAKED[slug]).then(function (baked) {
          return baked ? baked : placeholderDivision(meta);
        });
      } else {
        basePromise = Promise.resolve(placeholderDivision(meta));
      }

      basePromise.then(function (base) {
        var div = clone(base);
        // Ensure required keys exist regardless of baked completeness.
        if (!div.teams) div.teams = {};
        if (!('pools' in div)) div.pools = null;
        if (!Array.isArray(div.fixtures)) div.fixtures = [];
        if (!('knockout' in div)) div.knockout = null;
        div.slug = meta.slug;
        div.id = meta.id;
        div.name = meta.name;
        div.sport = meta.sport;
        div.tier = div.tier || meta.tier;

        // Step 2: overlay live scores/status from data/<slug>.json (if any).
        // Skip re-fetching the baked file for camogie (its own live file is separate
        // convention; here baked IS the schedule and live is the same path only for
        // schedule-tier divisions). For the full division we still allow a live file
        // at the same path to carry scores, so always attempt an overlay fetch.
        fetchJSON('data/live/' + slug + '.json').then(function (live) {
          // Guard: if the live file IS the baked schedule (same object we just used
          // as base for camogie), don't double-append. We detect that by identity of
          // the schedule: a live file used purely as bake has no distinct score data,
          // so overlaying it is idempotent (scores are null). Safe to run either way.
          resolve(overlayLive(div, live));
        });
      });
    });

    _cache[slug] = p;
    return p;
  }

  // ---- Public API -----------------------------------------------------------
  WG.data = {
    tournamentId: TOURNAMENT_ID,
    season: SEASON,
    divisions: DIVISIONS.map(function (d) {
      return { slug: d.slug, id: d.id, name: d.name, sport: d.sport, tier: d.tier };
    }),
    loadDivision: loadDivision,
    refreshDivision: function (slug) { return loadDivision(slug, true); },
    parseScore: parseScore,
    fmtScore: fmtScore,
    // exposed so other modules can reuse consistent score coercion
    _coerceScore: coerceScore
  };

  // ---- Favourite ("my team"), persisted per division -----------------------
  WG.fav = {
    get: function (slug) { try { return window.localStorage.getItem('wg.fav.' + slug) || null; } catch (e) { return null; } },
    set: function (slug, teamId) {
      try {
        if (teamId) window.localStorage.setItem('wg.fav.' + slug, teamId);
        else window.localStorage.removeItem('wg.fav.' + slug);
      } catch (e) {}
    },
    toggle: function (slug, teamId) {
      var cur = WG.fav.get(slug);
      WG.fav.set(slug, cur === teamId ? null : teamId);
      return WG.fav.get(slug);
    }
  };
})();
