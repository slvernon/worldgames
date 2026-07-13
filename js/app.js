/* WG.app — integrator / wiring for the GAA World Games companion.
 *
 * Owns: division <select>, view toggle (Bracket | Calendar), localStorage
 * persistence, and dispatching to WG.bracket.render / WG.calendar.render.
 *
 * Rules:
 *   - Default division intl-camogie-1, default view 'bracket'.
 *   - FULL-tier division (intl-camogie-1) shows both Bracket + Calendar tabs.
 *   - SCHEDULE-tier divisions force Calendar and hide the Bracket tab.
 *   - Everything renders cleanly with null scores (pre-tournament).
 *
 * Play-out picks (bracket) persist per-division under a namespaced localStorage key.
 * Vanilla JS, no modules; attaches to window.WG.app.
 */
(function () {
  'use strict';
  var WG = (window.WG = window.WG || {});

  var LS = {
    div: 'wg.division',
    view: 'wg.view',
    playout: function (slug) { return 'wg.playout.' + slug; }
  };
  var DEFAULT_DIV = 'intl-camogie-1';
  var DEFAULT_VIEW = 'bracket';

  // ---- DOM refs (resolved on init) -----------------------------------------
  var elSelect, elDivName, elTabbar, elViewBracket, elViewCalendar, elTabs;

  // ---- runtime state -------------------------------------------------------
  var current = {
    slug: null,
    view: DEFAULT_VIEW,
    div: null,      // loaded Division object
    state: null     // per-division render state (playout picks, filters, onChange)
  };
  var loadToken = 0; // guards against out-of-order async loads

  // ---- localStorage (fail-soft; private-mode / file:// safe) ---------------
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }

  function loadPlayout(slug) {
    var raw = lsGet(LS.playout(slug));
    if (!raw) return {};
    try { var o = JSON.parse(raw); return (o && typeof o === 'object') ? o : {}; }
    catch (e) { return {}; }
  }
  function savePlayout(slug, playout) {
    try { lsSet(LS.playout(slug), JSON.stringify(playout || {})); } catch (e) {}
  }

  // ---- helpers -------------------------------------------------------------
  function metaFor(slug) {
    var list = (WG.data && WG.data.divisions) || [];
    for (var i = 0; i < list.length; i++) if (list[i].slug === slug) return list[i];
    return null;
  }
  function isFull(slug) {
    var m = metaFor(slug);
    return !!(m && m.tier === 'full');
  }

  // ---- rendering -----------------------------------------------------------
  function showEmpty(container, msg) {
    container.innerHTML = '';
    var d = document.createElement('div');
    d.className = 'wg-empty';
    d.textContent = msg;
    container.appendChild(d);
  }

  // Render whichever view is active for the current division.
  function renderActiveView() {
    var div = current.div;
    if (!div) return;

    if (current.view === 'bracket') {
      if (isFull(current.slug) && WG.bracket && typeof WG.bracket.render === 'function') {
        try {
          WG.bracket.render(elViewBracket, div, current.state);
        } catch (e) {
          console.error('bracket render failed', e);
          showEmpty(elViewBracket, 'Bracket unavailable.');
        }
      } else {
        // Should not happen (schedule-tier forces calendar), but stay safe.
        showEmpty(elViewBracket, 'Bracket not available for this division.');
      }
    } else { // calendar
      if (WG.calendar && typeof WG.calendar.render === 'function') {
        try {
          WG.calendar.render(elViewCalendar, div, current.state);
        } catch (e) {
          console.error('calendar render failed', e);
          showEmpty(elViewCalendar, 'Schedule unavailable.');
        }
      } else {
        showEmpty(elViewCalendar, 'Schedule not loaded yet.');
      }
    }
  }

  // Toggle .is-active on views + tabs; keep only the correct view mounted.
  function applyViewToggle() {
    elViewBracket.classList.toggle('is-active', current.view === 'bracket');
    elViewCalendar.classList.toggle('is-active', current.view === 'calendar');
    for (var i = 0; i < elTabs.length; i++) {
      var t = elTabs[i];
      t.classList.toggle('is-active', t.getAttribute('data-view') === current.view);
    }
  }

  // Show/hide the Bracket tab depending on tier. Schedule-tier => calendar only.
  function applyTierTabs() {
    var full = isFull(current.slug);
    for (var i = 0; i < elTabs.length; i++) {
      var t = elTabs[i];
      if (t.getAttribute('data-view') === 'bracket') {
        t.hidden = !full;
      }
    }
    // Single visible tab? drop the sticky/fixed bar chrome noise by keeping it,
    // but ensure it doesn't look empty — CSS handles a single flex child fine.
    if (!full && current.view === 'bracket') {
      current.view = 'calendar';
      lsSet(LS.view, current.view);
    }
  }

  function setView(view) {
    if (view !== 'bracket' && view !== 'calendar') return;
    // Guard: bracket only allowed on full tier.
    if (view === 'bracket' && !isFull(current.slug)) view = 'calendar';
    current.view = view;
    lsSet(LS.view, view);
    applyViewToggle();
    renderActiveView();
  }

  // Build a fresh render-state for a division, wiring persistence + re-render.
  function makeState(slug) {
    var st = {
      slug: slug,
      playout: loadPlayout(slug),
      calendarTeam: null,
      onChange: function () {
        // bracket mutated picks (or reset) -> persist + re-render active view.
        savePlayout(slug, st.playout);
        renderActiveView();
      }
    };
    return st;
  }

  // Load a division and render. `slug` is authoritative.
  function selectDivision(slug) {
    var meta = metaFor(slug);
    if (!meta) slug = DEFAULT_DIV;

    current.slug = slug;
    current.state = makeState(slug);
    lsSet(LS.div, slug);

    // Update chrome immediately (name + tabs), even before data arrives.
    if (elDivName) elDivName.textContent = metaFor(slug) ? metaFor(slug).name : '';
    if (elSelect && elSelect.value !== slug) elSelect.value = slug;
    applyTierTabs();
    applyViewToggle();

    // Loading placeholders while we fetch.
    showEmpty(elViewBracket, 'Loading…');
    showEmpty(elViewCalendar, 'Loading…');

    var myToken = ++loadToken;
    WG.data.loadDivision(slug).then(function (div) {
      if (myToken !== loadToken) return; // a newer selection superseded us
      current.div = div;
      // Re-apply tier tabs from loaded div.tier (metadata is authoritative, but
      // keep them in sync in case a baked file disagrees).
      if (div.tier === 'schedule' && current.view === 'bracket') {
        current.view = 'calendar';
        lsSet(LS.view, current.view);
      }
      applyTierTabs();
      applyViewToggle();
      renderActiveView();
    }).catch(function (e) {
      if (myToken !== loadToken) return;
      console.error('loadDivision failed', e);
      showEmpty(elViewBracket, 'Could not load this division.');
      showEmpty(elViewCalendar, 'Could not load this division.');
    });
  }

  // ---- auto-refresh --------------------------------------------------------
  // Periodically re-read data/<slug>.json (our own static file, refreshed by the
  // scheduled GitHub Action) so newly-posted fixtures/scores appear without a manual
  // reload. This never touches Foireann directly — only our committed JSON.
  var REFRESH_MS = 120000; // 2 min
  var refreshTimer = null;

  function divSignature(div) {
    if (!div) return '';
    try { return JSON.stringify({ f: div.fixtures, k: div.knockout, t: div.teams }); }
    catch (e) { return ''; }
  }

  function autoRefresh() {
    if (!current.slug || !current.div || document.hidden) return;
    var slug = current.slug;
    WG.data.refreshDivision(slug).then(function (div) {
      if (slug !== current.slug) return;                 // user switched divisions
      var ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'SELECT')) return; // don't disrupt typing
      if (divSignature(div) === divSignature(current.div)) return;           // nothing new
      current.div = div;
      if (div.tier === 'schedule' && current.view === 'bracket') { current.view = 'calendar'; applyTierTabs(); applyViewToggle(); }
      renderActiveView();
    }).catch(function () {});
  }

  function startAutoRefresh() {
    if (refreshTimer) return;
    refreshTimer = window.setInterval(autoRefresh, REFRESH_MS);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) autoRefresh(); });
  }

  // ---- init ----------------------------------------------------------------
  function populateSelect() {
    var list = (WG.data && WG.data.divisions) || [];
    var html = '';
    // Put the flagship full division first for prominence, then the rest in order.
    var full = list.filter(function (d) { return d.tier === 'full'; });
    var rest = list.filter(function (d) { return d.tier !== 'full'; });
    var ordered = full.concat(rest);
    ordered.forEach(function (d) {
      html += '<option value="' + d.slug + '">' + escapeHtml(d.name) + '</option>';
    });
    elSelect.innerHTML = html;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function init() {
    elSelect = document.getElementById('wg-divselect');
    elDivName = document.getElementById('wg-divname');
    elTabbar = document.getElementById('wg-tabbar');
    elViewBracket = document.getElementById('wg-view-bracket');
    elViewCalendar = document.getElementById('wg-view-calendar');
    elTabs = elTabbar ? elTabbar.querySelectorAll('.wg-tab') : [];

    if (!elSelect || !WG.data) {
      console.error('WG.app: required DOM / WG.data missing');
      return;
    }

    populateSelect();

    // Restore persisted selections.
    var savedDiv = lsGet(LS.div);
    var savedView = lsGet(LS.view);
    var startSlug = metaFor(savedDiv) ? savedDiv : DEFAULT_DIV;
    current.view = (savedView === 'calendar' || savedView === 'bracket') ? savedView : DEFAULT_VIEW;

    // Wire events.
    elSelect.addEventListener('change', function () {
      selectDivision(elSelect.value);
    });
    for (var i = 0; i < elTabs.length; i++) {
      elTabs[i].addEventListener('click', function () {
        setView(this.getAttribute('data-view'));
      });
    }

    elSelect.value = startSlug;
    selectDivision(startSlug);
    startAutoRefresh();
  }

  // ---- public API ----------------------------------------------------------
  WG.app = {
    init: init,
    selectDivision: selectDivision,
    setView: setView,
    get current() { return current; }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
