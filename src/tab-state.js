(function (root, factory) {
  const deps = typeof require === 'function'
    ? Object.assign({}, require('./config.js'), require('./title-utils.js'), require('./task-favicon.js'), root.ChatGPTTabNotifier || {})
    : (root.ChatGPTTabNotifier || {});
  const api = factory(deps);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ChatGPTTabNotifier = Object.assign(root.ChatGPTTabNotifier || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  'use strict';

  function createTabStateController({ scheduleUiUpdate = () => {}, isGenerating = () => false } = {}) {
    let state = 'idle', uploadMarked = false;
    let naturalTitle = deps.cleanTitle(document.title) || 'ChatGPT';
    let lastRenderedTitle = null, currentFaviconHref = null;
    let binding = null, overview = null, connection = 'unpaired';

    function currentChat() {
      try {
        const url = new URL(location.href);
        if (!['https://chatgpt.com', 'https://chat.openai.com'].includes(url.origin)) return '';
        return url.pathname.match(/^\/c\/([A-Za-z0-9-]{8,100})\/?$/)?.[1] || '';
      } catch (_) { return ''; }
    }
    function initializeFromStorage() {
      try {
        const saved = JSON.parse(sessionStorage.getItem(deps.STORAGE_KEY) || '{}');
        if (saved.url === location.href && ['fresh', 'viewed', 'observatory-fresh', 'observatory-viewed'].includes(saved.state)) state = saved.state;
      } catch (_) { /* No source text or keys in diagnostics. */ }
      uploadMarked = false;
      // Server summaries never survive reload as an apparently fresh cache.
    }
    function save() {
      try { sessionStorage.setItem(deps.STORAGE_KEY, JSON.stringify({ url: location.href, state, uploadMarked })); }
      catch (_) { /* Preserve existing operation without leaking browser storage. */ }
    }
    function visual() {
      const bound = binding !== null && binding.conversation_id === currentChat();
      const fresh = bound && overview && Date.now() - overview.checked_at_unix * 1000 <= 20000 &&
        overview.checked_at_unix * 1000 <= Date.now() + 30000;
      let domGenerating = false;
      try { domGenerating = Boolean(isGenerating()); } catch (_) {}
      return deps.resolveTabVisual({ state, uploadMarked, bound, domGenerating,
        overview: fresh ? overview : null,
        connection: bound ? (overview && !fresh ? 'stale' : connection) : 'unpaired' });
    }
    function renderFavicon(spec) {
      const href = spec ? deps.taskFaviconSvg(spec) : '';
      if (currentFaviconHref === href) return;
      currentFaviconHref = href;
      const existing = document.getElementById(deps.CUSTOM_ICON_ID);
      if (!href) { existing?.remove(); return; }
      const icon = existing || document.createElement('link');
      if (!existing) {
        icon.id = deps.CUSTOM_ICON_ID; icon.rel = 'icon'; document.head.appendChild(icon);
      }
      icon.href = href;
    }
    function renderTitle(view = visual()) {
      const desired = view.symbol ? `${view.symbol} ${naturalTitle}` : naturalTitle;
      lastRenderedTitle = desired;
      if (document.title !== desired) document.title = desired;
    }
    function render() {
      const view = visual();
      renderTitle(view); renderFavicon(view.icon); scheduleUiUpdate();
    }
    function setState(nextState) {
      if (state === nextState) return;
      state = nextState; save(); render();
    }
    function setUploadMarked(next, { renderNow = true } = {}) {
      uploadMarked = Boolean(next); save(); if (renderNow) render();
    }
    function handleExternalTitle(current) {
      if (current === lastRenderedTitle) return;
      const cleaned = deps.cleanTitle(current);
      if (!cleaned) return;
      naturalTitle = cleaned; renderTitle();
    }
    function resetForNavigation() {
      const title = deps.cleanTitle(document.title);
      if (title) naturalTitle = title;
      state = 'idle'; uploadMarked = false;
      binding = null; overview = null; connection = 'unpaired'; save(); render();
    }
    function markViewed() {
      if (state === 'fresh') setState('viewed');
      if (state === 'observatory-fresh') setState('observatory-viewed');
    }
    function setObservatoryBinding(next) {
      if (next && (next.conversation_id !== currentChat() ||
          !/^rs_[0-9a-f]{32}$/.test(next.reporting_session_id || '') ||
          !Number.isSafeInteger(next.generation) || next.generation < 0)) return false;
      if (binding && next && binding.conversation_id === next.conversation_id &&
          binding.reporting_session_id === next.reporting_session_id && binding.generation === next.generation) return true;
      binding = next ? { conversation_id: next.conversation_id,
        reporting_session_id: next.reporting_session_id, generation: next.generation } : null;
      overview = null; connection = next ? 'checking' : 'unpaired'; render(); return true;
    }
    function setObservatorySummary(raw, scope) {
      if (!binding || scope?.generation !== binding.generation ||
          scope?.conversation_id !== binding.conversation_id || scope?.reporting_session_id !== binding.reporting_session_id ||
          binding.conversation_id !== currentChat()) return false;
      const valid = deps.validateTaskOverview(raw);
      if (!valid) return false;
      overview = valid; connection = 'online'; render(); return true;
    }
    function clearObservatorySummary(reason = 'unavailable', generation) {
      if (!binding || (generation !== undefined && generation !== binding.generation)) return;
      overview = null;
      connection = ['checking', 'unavailable', 'denied', 'unsupported', 'disabled'].includes(reason) ? reason : 'unavailable';
      render();
    }
    initializeFromStorage();
    return { save, render, renderTitle, setState, setUploadMarked, handleExternalTitle,
      resetForNavigation, markViewed, setObservatoryBinding, setObservatorySummary,
      clearObservatorySummary, refreshObservatoryAge: render, getVisual: visual,
      getState: () => state, isUploadMarked: () => uploadMarked,
      getNaturalTitle: () => naturalTitle, getLastRenderedTitle: () => lastRenderedTitle };
  }
  return { createTabStateController };
});
