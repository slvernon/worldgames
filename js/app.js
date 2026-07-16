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
  var elSelect, elDivName, elTabbar, elViewBracket, elViewCalendar, elViewFinal, elViewSquad, elTabs, elFooter;

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

  // Format the data's updatedAt for the footer. Local time; fail-soft.
  function fmtUpdated(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    try {
      return d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    } catch (e) { return d.toISOString().slice(0, 16).replace('T', ' '); }
  }
  function updateFooter() {
    if (!elFooter) return;
    var iso = current.div && current.div.updatedAt;
    elFooter.textContent = iso ? ('Scores last updated ' + fmtUpdated(iso) + ' · auto-refreshes during games') : '';
  }

  // Render whichever view is active for the current division.
  function renderActiveView() {
    // Final Match is a standalone scouting view, independent of the selected
    // division, so it renders even before/without a loaded division.
    if (current.view === 'finalmatch') {
      if (WG.finalmatch && typeof WG.finalmatch.render === 'function') {
        try { WG.finalmatch.render(elViewFinal); }
        catch (e) { console.error('finalmatch render failed', e); showEmpty(elViewFinal, 'Final Match unavailable.'); }
      } else {
        showEmpty(elViewFinal, 'Final Match not available.');
      }
      return;
    }

    // Squad — our-team offensive analytics, also division-independent.
    if (current.view === 'squad') {
      if (WG.squad && typeof WG.squad.render === 'function') {
        try { WG.squad.render(elViewSquad); }
        catch (e) { console.error('squad render failed', e); showEmpty(elViewSquad, 'Squad unavailable.'); }
      } else {
        showEmpty(elViewSquad, 'Squad not available.');
      }
      return;
    }

    var div = current.div;
    if (!div) return;
    updateFooter();

    if (current.view === 'bracket') {
      if (WG.bracket && typeof WG.bracket.render === 'function') {
        try {
          WG.bracket.render(elViewBracket, div, current.state);
        } catch (e) {
          console.error('bracket render failed', e);
          showEmpty(elViewBracket, 'Bracket unavailable.');
        }
      } else {
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
    if (elViewFinal) elViewFinal.classList.toggle('is-active', current.view === 'finalmatch');
    if (elViewSquad) elViewSquad.classList.toggle('is-active', current.view === 'squad');
    for (var i = 0; i < elTabs.length; i++) {
      var t = elTabs[i];
      t.classList.toggle('is-active', t.getAttribute('data-view') === current.view);
    }
  }

  // Bracket + Calendar are now available for EVERY division, so both tabs always show.
  function applyTierTabs() {
    for (var i = 0; i < elTabs.length; i++) {
      elTabs[i].hidden = false;
    }
  }

  function setView(view) {
    if (view !== 'bracket' && view !== 'calendar' && view !== 'finalmatch' && view !== 'squad') return;
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
      if (current.div) current.div.updatedAt = div.updatedAt;               // keep footer time fresh
      updateFooter();
      if (divSignature(div) === divSignature(current.div)) return;           // no fixture/score change
      current.div = div;
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
    elViewFinal = document.getElementById('wg-view-finalmatch');
    elViewSquad = document.getElementById('wg-view-squad');
    elFooter = document.getElementById('wg-footer');
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
    current.view = (savedView === 'calendar' || savedView === 'bracket' || savedView === 'finalmatch' || savedView === 'squad') ? savedView : DEFAULT_VIEW;

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
