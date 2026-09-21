(function (root, factory) {
  const deps = typeof require === 'function'
    ? Object.assign({}, require('./config.js'), require('./title-utils.js'), root.ChatGPTTabNotifier || {})
    : (root.ChatGPTTabNotifier || {});
  const api = factory(deps);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ChatGPTTabNotifier = Object.assign(root.ChatGPTTabNotifier || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  'use strict';

  function createTabStateController({ scheduleUiUpdate = () => {} } = {}) {
    let state = 'idle';
    let uploadMarked = false;
    let naturalTitle = deps.cleanTitle(document.title) || 'ChatGPT';
    let lastRenderedTitle = null;
    let currentFaviconType = null;

    function loadSaved() {
      try { return JSON.parse(sessionStorage.getItem(deps.STORAGE_KEY) || '{}'); }
      catch (error) {
        console.warn('[ChatGPT notifier] Не удалось прочитать состояние:', error);
        return {};
      }
    }

    function initializeFromStorage() {
      const saved = loadSaved();
      if (saved.url === location.href && ['fresh', 'viewed'].includes(saved.state)) state = saved.state;
      // Автоотправка после reload не восстанавливается. Поэтому и синюю метку
      // не восстанавливаем: новый upload-arm всегда требует ручного нажатия.
      uploadMarked = false;
    }

    function save() {
      try {
        sessionStorage.setItem(deps.STORAGE_KEY, JSON.stringify({ url: location.href, state, uploadMarked }));
      } catch (error) {
        console.warn('[ChatGPT notifier] Не удалось сохранить состояние:', error);
      }
    }

    function renderFavicon(type) {
      if (currentFaviconType === type) return;
      currentFaviconType = type;
      const existing = document.getElementById(deps.CUSTOM_ICON_ID);
      if (!type) { existing?.remove(); return; }
      const icon = existing || document.createElement('link');
      if (!existing) {
        icon.id = deps.CUSTOM_ICON_ID;
        icon.rel = 'icon';
        document.head.appendChild(icon);
      }
      icon.href = deps.faviconSvg(type);
    }

    function renderTitle() {
      const displayState = uploadMarked ? 'uploading' : state;
      const symbol = deps.SYMBOLS[displayState] || '';
      const desired = symbol ? `${symbol} ${naturalTitle}` : naturalTitle;
      lastRenderedTitle = desired;
      if (document.title !== desired) document.title = desired;
    }

    function render() {
      const displayState = uploadMarked ? 'uploading' : state;
      renderTitle();
      renderFavicon(['working', 'fresh', 'viewed', 'uploading'].includes(displayState) ? displayState : null);
      scheduleUiUpdate();
    }

    function setState(nextState) {
      if (state === nextState) return;
      state = nextState;
      save();
      render();
    }

    function setUploadMarked(next, { renderNow = true } = {}) {
      uploadMarked = Boolean(next);
      save();
      if (renderNow) render();
    }

    function handleExternalTitle(current) {
      if (current === lastRenderedTitle) return;
      const cleaned = deps.cleanTitle(current);
      if (!cleaned) return;
      naturalTitle = cleaned;
      renderTitle();
    }

    function resetForNavigation() {
      const title = deps.cleanTitle(document.title);
      if (title) naturalTitle = title;
      state = 'idle';
      uploadMarked = false;
      save();
      render();
    }

    function markViewed() {
      if (state === 'fresh') setState('viewed');
    }

    initializeFromStorage();

    return {
      save,
      render,
      renderTitle,
      setState,
      setUploadMarked,
      handleExternalTitle,
      resetForNavigation,
      markViewed,
      getState: () => state,
      isUploadMarked: () => uploadMarked,
      getNaturalTitle: () => naturalTitle,
      getLastRenderedTitle: () => lastRenderedTitle
    };
  }

  return { createTabStateController };
});
