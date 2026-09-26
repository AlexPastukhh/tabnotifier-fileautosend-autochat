// ==UserScript==
// @name         ChatGPT — значки вкладок, загрузка файлов и уведомления
// @namespace    local.chatgpt.tab-notifier
// @version      5.1.0
// @description  Статусы вкладки + автоотправка после загрузки вложений + системное уведомление
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-idle
// @grant        GM_notification
// @grant        GM_registerMenuCommand
// ==/UserScript==

// GENERATED FILE — DO NOT EDIT MANUALLY.
// Source: src/**
// Build: npm run build

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ChatGPTTabNotifier = Object.assign(root.ChatGPTTabNotifier || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SETTINGS = Object.freeze({
    desktopNotificationEnabled: true,
    notifyOnlyInBackground: false,
    finishConfirmDelayMs: 1800,
    fallbackQuietDelayMs: 5000,
    armTimeoutMs: 20000,
    checkIntervalMs: 500,
    uiRepositionDelayMs: 180,
    uploadAutoSendEnabled: true,
    uploadReadyStableMs: 1500,
    uploadMinArmDelayMs: 900,
    uploadAutoSendTimeoutMs: 30 * 60 * 1000,
    recentFileActivityWindowMs: 15 * 60 * 1000
  });

  const SYMBOLS = Object.freeze({ working: '⏳', fresh: '●', viewed: '✓', uploading: '⇧', idle: '' });
  const ALL_PREFIX_SYMBOLS = Object.freeze(['⏳', '🔔', '✓', '📤', '●', '⇧']);
  const BROKEN_OLD_PREFIX_UNITS = new Set([0xDD14, 0xDCE4]);

  const STORAGE_KEY = 'chatgpt-tab-notifier-v5';
  const CUSTOM_ICON_ID = 'chatgpt-tab-notifier-custom-icon';
  const UPLOAD_HOST_ID = 'chatgpt-tab-notifier-upload-host';

  const COMPOSER_SELECTORS = Object.freeze([
    '#prompt-textarea[contenteditable="true"]',
    '[contenteditable="true"][role="textbox"][aria-label*="Chat with ChatGPT" i]',
    '[contenteditable="true"][role="textbox"][aria-label*="Message ChatGPT" i]',
    '[data-testid="composer-textarea"][contenteditable="true"]',
    'textarea[data-testid="composer-textarea"]',
    '#prompt-textarea',
    'textarea[name="prompt-textarea"]',
    'textarea[placeholder]'
  ]);

  const SEND_BUTTON_SELECTORS = Object.freeze([
    '#composer-submit-button',
    'button[data-testid="send-button"]',
    'button[data-testid="composer-submit-button"]',
    'button[aria-label*="Send prompt" i]',
    'button[aria-label*="Send" i]',
    'button[aria-label*="Отправить" i]'
  ]);

  const UPLOAD_BUSY_SELECTORS = Object.freeze([
    '[aria-busy="true"]',
    '[role="progressbar"]',
    '[data-uploading="true"]',
    '[data-loading="true"]',
    '[data-state="loading"]',
    '[data-state="uploading"]',
    '[data-testid*="uploading" i]',
    '[data-testid*="upload-progress" i]',
    '[aria-label*="Uploading" i]',
    '[aria-label*="Cancel upload" i]',
    '[aria-label*="Загрузка" i]',
    '[aria-label*="Отменить загрузку" i]'
  ]);

  const ATTACHMENT_SELECTORS = Object.freeze([
    'button[aria-label^="Remove file" i]',
    'button[aria-label*="Remove file" i]',
    'button[aria-label^="Удалить файл" i]',
    'button[aria-label*="Удалить файл" i]',
    '[data-testid*="attachment" i]',
    '[data-testid*="file-preview" i]',
    '[data-testid*="file-thumbnail" i]'
  ]);

  return {
    SETTINGS,
    SYMBOLS,
    ALL_PREFIX_SYMBOLS,
    BROKEN_OLD_PREFIX_UNITS,
    STORAGE_KEY,
    CUSTOM_ICON_ID,
    UPLOAD_HOST_ID,
    COMPOSER_SELECTORS,
    SEND_BUTTON_SELECTORS,
    UPLOAD_BUSY_SELECTORS,
    ATTACHMENT_SELECTORS
  };
});

(function (root, factory) {
  const deps = typeof require === 'function'
    ? Object.assign({}, require('./config.js'), root.ChatGPTTabNotifier || {})
    : (root.ChatGPTTabNotifier || {});
  const api = factory(deps);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ChatGPTTabNotifier = Object.assign(root.ChatGPTTabNotifier || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  'use strict';

  function removeUnpairedSurrogates(text) {
    const source = String(text || '');
    let result = '';
    for (let index = 0; index < source.length; index += 1) {
      const code = source.charCodeAt(index);
      if (code >= 0xD800 && code <= 0xDBFF) {
        const next = source.charCodeAt(index + 1);
        if (next >= 0xDC00 && next <= 0xDFFF) {
          result += source[index] + source[index + 1];
          index += 1;
        }
        continue;
      }
      if (code >= 0xDC00 && code <= 0xDFFF) continue;
      result += source[index];
    }
    return result;
  }

  function cleanTitle(title) {
    let value = String(title || '');
    while (value.length && deps.BROKEN_OLD_PREFIX_UNITS.has(value.charCodeAt(0))) {
      value = value.slice(1).trimStart();
    }
    value = value.replace(/^\uFFFD+\s*/, '');
    value = removeUnpairedSurrogates(value);

    let removed = true;
    while (removed) {
      removed = false;
      for (const symbol of deps.ALL_PREFIX_SYMBOLS) {
        if (value.startsWith(symbol)) {
          value = value.slice(symbol.length).trimStart();
          removed = true;
          break;
        }
      }
    }
    return value.trim();
  }

  function faviconSvg(type) {
    const svgs = {
      working: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="15" fill="#f59e0b"/><circle cx="18" cy="32" r="5" fill="white"/><circle cx="32" cy="32" r="5" fill="white"/><circle cx="46" cy="32" r="5" fill="white"/></svg>',
      fresh: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="15" fill="#dc2626"/><path d="M20 43h24l-4-6V28c0-6-3-11-8-11s-8 5-8 11v9z" fill="white"/><circle cx="32" cy="48" r="4" fill="white"/></svg>',
      viewed: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="15" fill="#64748b"/><path d="M16 33 L27 44 L49 20" fill="none" stroke="white" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      uploading: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="15" fill="#2563eb"/><path d="M32 13v29M21 24l11-11 11 11M18 47h28" fill="none" stroke="white" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    };
    return svgs[type] ? `data:image/svg+xml,${encodeURIComponent(svgs[type])}` : '';
  }

  return { removeUnpairedSurrogates, cleanTitle, faviconSvg };
});

(function (root, factory) {
  const deps = typeof require === 'function'
    ? Object.assign({}, require('./config.js'), root.ChatGPTTabNotifier || {})
    : (root.ChatGPTTabNotifier || {});
  const api = factory(deps);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ChatGPTTabNotifier = Object.assign(root.ChatGPTTabNotifier || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  'use strict';

  function isElement(value) {
    return typeof Element !== 'undefined' && value instanceof Element;
  }

  function isVisible(element) {
    if (!isElement(element)) return false;
    const rect = element.getBoundingClientRect?.();
    if (!rect || rect.width < 1 || rect.height < 1) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function findComposer(doc = document) {
    // ChatGPT often keeps hidden fallback textareas in the DOM. Prefer the
    // largest visible candidate so a stale/hidden textarea cannot win.
    const candidates = [];
    for (const selector of deps.COMPOSER_SELECTORS) {
      for (const element of doc.querySelectorAll(selector)) {
        if (!isVisible(element)) continue;
        const rect = element.getBoundingClientRect?.();
        if (!rect || rect.width <= 20 || rect.height <= 10) continue;
        candidates.push({ element, area: rect.width * rect.height });
      }
    }
    candidates.sort((a, b) => b.area - a.area);
    return candidates[0]?.element || null;
  }

  function findSendButton(root = document) {
    for (const selector of deps.SEND_BUTTON_SELECTORS) {
      for (const button of root.querySelectorAll(selector)) {
        if (typeof HTMLButtonElement === 'undefined' || !(button instanceof HTMLButtonElement)) continue;
        if (!isVisible(button)) continue;
        if (button.matches('[data-testid="stop-button"], [data-testid="stop-generating-button"]')) continue;
        return button;
      }
    }
    return null;
  }

  function isSendButtonReady(button) {
    if (typeof HTMLButtonElement === 'undefined' || !(button instanceof HTMLButtonElement)) return false;
    if (!isVisible(button) || button.disabled) return false;
    if (button.getAttribute('aria-disabled') === 'true') return false;
    return getComputedStyle(button).pointerEvents !== 'none';
  }

  function findComposerForm(doc = document) {
    const composer = findComposer(doc);
    const composerForm = composer?.closest?.('form');
    if (composerForm) return composerForm;

    // Some current ChatGPT layouts wrap the editor in a composer container
    // that is not the editor's direct form ancestor. Walk upward and accept
    // a container that also owns the send/attach controls.
    let node = composer?.parentElement;
    for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
      if (node.querySelector?.('[data-testid="composer-plus-btn"], #composer-submit-button, [data-testid="send-button"], input#upload-files')) {
        return node;
      }
    }
    return findSendButton(doc)?.closest?.('form') || null;
  }

  function findComposerBox(composer) {
    if (!composer) return null;
    const form = composer.closest?.('form') || findComposerForm();
    if (form) {
      const rect = form.getBoundingClientRect?.();
      if (rect && rect.width >= 180 && rect.height >= 35 && rect.height <= 420) return rect;
    }

    const sendSelector = [
      '#composer-submit-button',
      'button[data-testid="composer-submit-button"]',
      'button[data-testid="send-button"]',
      'button[data-testid="stop-button"]',
      'button[data-testid="stop-generating-button"]'
    ].join(',');

    let node = composer.parentElement;
    for (let depth = 0; node && depth < 6; depth += 1, node = node.parentElement) {
      const rect = node.getBoundingClientRect?.();
      if (!rect || rect.width < 180 || rect.height < 35 || rect.height > 320) continue;
      if (node.querySelector?.(sendSelector)) return rect;
    }

    const rect = composer.getBoundingClientRect?.();
    return rect && rect.width > 20 ? rect : null;
  }

  function findComposerPlusButton(composer) {
    const form = composer?.closest?.('form') || findComposerForm();
    if (!form) return null;
    const selectors = [
      'button[data-testid="composer-plus-btn"]',
      'button[data-testid*="composer-plus" i]',
      'button[aria-label*="Add photos" i]',
      'button[aria-label="Add files and more" i]',
      'button[aria-label*="Add files" i]',
      'button[aria-label*="Attach" i]',
      'button[aria-label*="Добавить фото" i]',
      'button[aria-label*="Добавить файл" i]',
      'button[aria-label*="Прикреп" i]'
    ];
    for (const selector of selectors) {
      const button = form.querySelector(selector);
      if (button && isVisible(button)) return button;
    }
    return null;
  }


  function findUploadFileInput(composer) {
    const root = composer?.closest?.('form') || findComposerForm() || document;
    const selectors = [
      'input#upload-files[type="file"]',
      'input#upload-photos[type="file"]',
      'input[type="file"][multiple]',
      'input[type="file"]'
    ];
    for (const selector of selectors) {
      const input = root.querySelector?.(selector) || document.querySelector(selector);
      if (input) return input;
    }
    return null;
  }

  function chooseUploadPosition(box, composer) {
    const size = 34;
    const gap = 8;
    const plusButton = findComposerPlusButton(composer);
    if (plusButton) {
      const plusRect = plusButton.getBoundingClientRect();
      const candidate = {
        left: plusRect.left - size - gap,
        top: plusRect.top + (plusRect.height - size) / 2
      };
      if (
        candidate.left >= 6 && candidate.top >= 6 &&
        candidate.left + size <= innerWidth - 6 && candidate.top + size <= innerHeight - 6
      ) return candidate;
    }
    return {
      left: Math.min(Math.max(6, box.left - size - gap), Math.max(6, innerWidth - size - 6)),
      top: Math.min(Math.max(6, box.bottom - size - 7), Math.max(6, innerHeight - size - 6))
    };
  }

  function getInputFileNames(root = document) {
    const names = [];
    for (const input of root.querySelectorAll('input[type="file"]')) {
      try {
        for (const file of Array.from(input.files || [])) if (file?.name) names.push(file.name);
      } catch (_) {}
    }
    return [...new Set(names)];
  }

  function elementLooksLikeAttachment(element) {
    if (!isElement(element) || !isVisible(element)) return false;
    if (element.matches('input[type="file"], [data-testid="composer-plus-btn"]')) return false;
    const label = `${element.getAttribute('aria-label') || ''} ${element.getAttribute('data-testid') || ''}`.toLowerCase();
    return /remove file|удалить файл|attachment|file-preview|file-thumbnail/.test(label);
  }

  function composerHasAttachmentEvidence(form, knownFileNames = []) {
    if (!isElement(form)) return false;
    const knownNames = [...new Set([...knownFileNames, ...getInputFileNames(form)])];
    for (const selector of deps.ATTACHMENT_SELECTORS) {
      for (const element of form.querySelectorAll(selector)) {
        if (elementLooksLikeAttachment(element)) return true;
      }
    }
    if (knownNames.length) {
      const text = String(form.textContent || '');
      if (knownNames.some(name => name && text.includes(name))) return true;
      for (const element of form.querySelectorAll('[aria-label], [title]')) {
        const haystack = `${element.getAttribute('aria-label') || ''}\n${element.getAttribute('title') || ''}`;
        if (knownNames.some(name => name && haystack.includes(name))) return true;
      }
    }
    return false;
  }

  function composerHasUploadBusyEvidence(form) {
    if (!isElement(form)) return false;
    for (const selector of deps.UPLOAD_BUSY_SELECTORS) {
      for (const element of form.querySelectorAll(selector)) if (isVisible(element)) return true;
    }
    return false;
  }

  function isComposerTarget(target) {
    if (!isElement(target)) return false;
    return deps.COMPOSER_SELECTORS.some(selector => target.matches?.(selector) || Boolean(target.closest?.(selector)));
  }

  function isComposerSendButton(target) {
    if (!isElement(target)) return false;
    const button = target.closest('button');
    if (!button || button.disabled || !button.matches(deps.SEND_BUTTON_SELECTORS.join(','))) return false;
    const form = button.closest('form');
    return Boolean(form && deps.COMPOSER_SELECTORS.some(selector => form.querySelector(selector)));
  }

  return {
    isVisible,
    findComposer,
    findSendButton,
    isSendButtonReady,
    findComposerForm,
    findComposerBox,
    findComposerPlusButton,
    findUploadFileInput,
    chooseUploadPosition,
    getInputFileNames,
    composerHasAttachmentEvidence,
    composerHasUploadBusyEvidence,
    isComposerTarget,
    isComposerSendButton
  };
});

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

(function (root, factory) {
  const deps = typeof require === 'function'
    ? Object.assign({}, require('./config.js'), root.ChatGPTTabNotifier || {})
    : (root.ChatGPTTabNotifier || {});
  const api = factory(deps);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ChatGPTTabNotifier = Object.assign(root.ChatGPTTabNotifier || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  'use strict';

  function createNotificationService(tabState) {
    function showDesktopNotification() {
      if (!deps.SETTINGS.desktopNotificationEnabled || typeof GM_notification !== 'function') return;
      try {
        GM_notification({
          title: 'ChatGPT — ответ готов',
          text: tabState.getNaturalTitle(),
          timeout: 6500,
          silent: false,
          highlight: false
        });
      } catch (error) {
        console.warn('[ChatGPT notifier] Не удалось показать системное уведомление:', error);
      }
    }

    function notifyFinished() {
      const background = document.hidden || !document.hasFocus();
      if (deps.SETTINGS.notifyOnlyInBackground && !background) return;
      showDesktopNotification();
    }

    return { showDesktopNotification, notifyFinished };
  }

  return { createNotificationService };
});

(function (root, factory) {
  const deps = typeof require === 'function'
    ? Object.assign({}, require('./config.js'), require('./chatgpt-dom.js'), root.ChatGPTTabNotifier || {})
    : (root.ChatGPTTabNotifier || {});
  const api = factory(deps);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ChatGPTTabNotifier = Object.assign(root.ChatGPTTabNotifier || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  'use strict';

  function evaluateUploadReadiness({ attachment, busy, sendReady, hasFileRelation, armAgeMs, readyAgeMs }) {
    if (!attachment) return { ready: false, reason: 'no-attachment' };
    if (busy) return { ready: false, reason: 'upload-busy' };
    if (!sendReady) return { ready: false, reason: 'send-not-ready' };
    if (!hasFileRelation) return { ready: false, reason: 'no-file-relation' };
    if (armAgeMs < deps.SETTINGS.uploadMinArmDelayMs) return { ready: false, reason: 'minimum-arm-delay' };
    if (readyAgeMs < deps.SETTINGS.uploadReadyStableMs) return { ready: false, reason: 'stability-delay' };
    return { ready: true, reason: 'ready' };
  }

  function createUploadAutoSendController({ tabState, onAutoSend = () => {} } = {}) {
    let armed = false;
    let armedAt = 0;
    let readySince = 0;
    let sawBusy = false;
    let sawAttachment = false;
    let sawFileActivity = false;
    let lastFileActivityAt = 0;
    let lastFileNames = [];

    function reset({ clearMark = true, render = true } = {}) {
      armed = false;
      armedAt = 0;
      readySince = 0;
      sawBusy = false;
      sawAttachment = false;
      sawFileActivity = false;
      if (clearMark) tabState.setUploadMarked(false, { renderNow: render });
      else if (render) tabState.render();
    }

    function arm() {
      if (!deps.SETTINGS.uploadAutoSendEnabled) {
        tabState.setUploadMarked(true);
        return;
      }
      armed = true;
      tabState.setUploadMarked(true, { renderNow: false });
      armedAt = Date.now();
      readySince = 0;
      sawFileActivity = Date.now() - lastFileActivityAt <= deps.SETTINGS.recentFileActivityWindowMs;
      const form = deps.findComposerForm();
      sawBusy = Boolean(form && (deps.composerHasUploadBusyEvidence(form) || !deps.isSendButtonReady(deps.findSendButton(form))));
      sawAttachment = Boolean(form && deps.composerHasAttachmentEvidence(form, lastFileNames));
      tabState.save();
      tabState.render();
      check();
      console.info('[ChatGPT notifier] Автоотправка после загрузки файлов включена.');
    }

    function toggle() {
      if (tabState.isUploadMarked() || armed) {
        reset({ clearMark: true, render: true });
        console.info('[ChatGPT notifier] Автоотправка после загрузки файлов отменена.');
        return;
      }
      arm();
    }

    function rememberFileActivity(files) {
      const names = Array.from(files || []).map(file => file?.name).filter(Boolean);
      if (!names.length) return;
      lastFileActivityAt = Date.now();
      lastFileNames = [...new Set([...lastFileNames, ...names])];
      if (armed) sawFileActivity = true;
      console.debug('[ChatGPT notifier] Обнаружен выбор/перетаскивание файла:', names);
    }

    function autoSend() {
      if (!armed) return false;
      const form = deps.findComposerForm();
      const sendButton = form ? deps.findSendButton(form) : null;
      if (!form || !deps.isSendButtonReady(sendButton)) return false;
      if (!deps.composerHasAttachmentEvidence(form, lastFileNames)) return false;
      if (deps.composerHasUploadBusyEvidence(form)) return false;
      reset({ clearMark: true, render: true });
      console.info('[ChatGPT notifier] Файлы готовы — автоматически нажимаю Send.');
      sendButton.click();
      onAutoSend();
      return true;
    }

    function check() {
      if (!armed || !deps.SETTINGS.uploadAutoSendEnabled) return;
      const now = Date.now();
      if (now - armedAt > deps.SETTINGS.uploadAutoSendTimeoutMs) {
        console.warn('[ChatGPT notifier] Автоотправка отменена по таймауту ожидания загрузки.');
        reset({ clearMark: true, render: true });
        return;
      }

      const form = deps.findComposerForm();
      if (!form) { readySince = 0; return; }

      const busy = deps.composerHasUploadBusyEvidence(form);
      const attachment = deps.composerHasAttachmentEvidence(form, lastFileNames);
      const sendReady = deps.isSendButtonReady(deps.findSendButton(form));
      if (busy || !sendReady) sawBusy = true;
      if (attachment) sawAttachment = true;
      if (now - lastFileActivityAt <= deps.SETTINGS.recentFileActivityWindowMs) sawFileActivity = true;

      if (!attachment || busy || !sendReady) {
        readySince = 0;
        return;
      }

      const hasFileRelation = sawFileActivity || sawBusy || sawAttachment;
      if (!hasFileRelation) { readySince = 0; return; }
      if (now - armedAt < deps.SETTINGS.uploadMinArmDelayMs) return;
      if (!readySince) { readySince = now; return; }

      const evaluation = evaluateUploadReadiness({
        attachment,
        busy,
        sendReady,
        hasFileRelation,
        armAgeMs: now - armedAt,
        readyAgeMs: now - readySince
      });
      if (evaluation.ready) autoSend();
    }

    function resetFileHistory() {
      lastFileActivityAt = 0;
      lastFileNames = [];
    }

    return {
      arm,
      toggle,
      reset,
      rememberFileActivity,
      check,
      autoSend,
      resetFileHistory,
      isArmed: () => armed,
      getKnownFileNames: () => [...lastFileNames]
    };
  }

  return { evaluateUploadReadiness, createUploadAutoSendController };
});

(function (root, factory) {
  const deps = typeof require === 'function'
    ? Object.assign({}, require('./config.js'), require('./chatgpt-dom.js'), root.ChatGPTTabNotifier || {})
    : (root.ChatGPTTabNotifier || {});
  const api = factory(deps);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ChatGPTTabNotifier = Object.assign(root.ChatGPTTabNotifier || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  'use strict';

  function createUploadButtonUi({ tabState, uploadController }) {
    let repositionTimer = null;

    function ensureUi() {
      let host = document.getElementById(deps.UPLOAD_HOST_ID);
      if (host?.shadowRoot) {
        return {
          host,
          autoButton: host.shadowRoot.querySelector('[data-role="auto-send"]'),
          plusButton: host.shadowRoot.querySelector('[data-role="fallback-plus"]')
        };
      }
      host?.remove();
      host = document.createElement('div');
      host.id = deps.UPLOAD_HOST_ID;
      Object.assign(host.style, {
        position: 'fixed', left: '0px', top: '0px', width: '76px', height: '36px',
        zIndex: '2147483646', pointerEvents: 'none'
      });
      document.documentElement.appendChild(host);

      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = `
        <style>
          :host { all: initial; }
          .row { display:flex; gap:6px; align-items:center; pointer-events:none; }
          button {
            width: 34px; height: 34px; padding: 0; border-radius: 999px;
            border: 1px solid rgba(128,128,128,.24); background: rgba(32,32,32,.88);
            color: #fff; font: 16px/1 system-ui,sans-serif; display: inline-flex;
            align-items: center; justify-content: center; cursor: pointer; box-sizing: border-box;
            pointer-events: auto; box-shadow: 0 2px 10px rgba(0,0,0,.24);
          }
          button:hover { filter: brightness(1.12); }
          button[data-active="true"] {
            background: #2563eb; border-color: #2563eb; opacity: 1;
            box-shadow: 0 0 0 2px rgba(37,99,235,.18),0 2px 10px rgba(0,0,0,.24);
          }
          button[data-active="false"] { opacity: .72; }
          [data-role="fallback-plus"] { font-size:24px; font-weight:300; }
        </style>
        <div class="row">
          <button type="button" data-role="fallback-plus" aria-label="Добавить файлы">+</button>
          <button type="button" data-role="auto-send" aria-label="Автоотправить после загрузки файлов">⇧</button>
        </div>`;

      const autoButton = shadow.querySelector('[data-role="auto-send"]');
      const plusButton = shadow.querySelector('[data-role="fallback-plus"]');
      autoButton.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        uploadController.toggle();
      });
      plusButton.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        const composer = deps.findComposer();
        const nativePlus = deps.findComposerPlusButton(composer);
        if (nativePlus) {
          nativePlus.click();
          return;
        }
        deps.findUploadFileInput(composer)?.click();
      });
      return { host, autoButton, plusButton };
    }

    function render() {
      const composer = deps.findComposer();
      let host = document.getElementById(deps.UPLOAD_HOST_ID);
      if (!composer) { if (host) host.style.display = 'none'; return; }
      const box = deps.findComposerBox(composer);
      if (!box) { if (host) host.style.display = 'none'; return; }

      const ui = ensureUi();
      host = ui.host;
      const nativePlus = deps.findComposerPlusButton(composer);
      const active = tabState.isUploadMarked();

      // If ChatGPT still exposes its own +, keep only ⇧ beside it. If the
      // redesign hides/removes +, show our own + as a proxy for upload-files.
      ui.plusButton.style.display = nativePlus ? 'none' : 'inline-flex';
      host.style.width = nativePlus ? '34px' : '76px';

      let left;
      let top;
      if (nativePlus) {
        const r = nativePlus.getBoundingClientRect();
        left = r.left - 34 - 7;
        top = r.top + (r.height - 34) / 2;
      } else {
        left = box.left + 10;
        top = box.bottom - 44;
      }

      left = Math.min(Math.max(6, left), Math.max(6, innerWidth - (nativePlus ? 34 : 76) - 6));
      top = Math.min(Math.max(6, top), Math.max(6, innerHeight - 36 - 6));
      host.style.display = 'block';
      host.style.left = `${Math.round(left)}px`;
      host.style.top = `${Math.round(top)}px`;

      ui.autoButton.dataset.active = String(active);
      ui.autoButton.setAttribute('aria-pressed', String(active));
      ui.autoButton.title = active
        ? 'Жду окончания загрузки файлов и затем автоматически отправлю. Нажать ещё раз — отменить.'
        : 'Когда файлы загружаются: нажать, чтобы после завершения автоматически отправить сообщение';
      ui.plusButton.title = 'Добавить файлы';
    }

    function schedule() {
      if (repositionTimer !== null) return;
      repositionTimer = window.setTimeout(() => {
        repositionTimer = null;
        window.requestAnimationFrame(render);
      }, deps.SETTINGS.uiRepositionDelayMs);
    }

    return { render, schedule };
  }

  return { createUploadButtonUi };
});

(function (root, factory) {
  const deps = typeof require === 'function'
    ? Object.assign({}, require('./config.js'), root.ChatGPTTabNotifier || {})
    : (root.ChatGPTTabNotifier || {});
  const api = factory(deps);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ChatGPTTabNotifier = Object.assign(root.ChatGPTTabNotifier || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  'use strict';

  function assistantSnapshot() {
    const messages = document.querySelectorAll('[data-message-author-role="assistant"]');
    const count = messages.length;
    const last = count ? messages[count - 1] : null;
    if (!last) return { count: 0, fingerprint: '0:' };
    const text = String(last.textContent || '').replace(/\s+/g, ' ').trim();
    return { count, fingerprint: `${count}:${text.length}:${text.slice(-300)}` };
  }

  function isGenerating() {
    const selectors = [
      'button[data-testid="stop-button"]',
      'button[data-testid="stop-generating-button"]',
      '[data-testid="stop-button"]',
      '[data-testid="stop-generating-button"]',
      'button[aria-label*="Stop generating" i]',
      'button[aria-label*="Stop streaming" i]',
      'button[aria-label*="Stop responding" i]',
      'button[aria-label*="Остановить" i]',
      'button[aria-label*="Прекратить" i]',
      '[data-is-streaming="true"]',
      '.result-streaming'
    ];
    return Boolean(document.querySelector(selectors.join(',')));
  }

  function createResponseMonitor({ tabState, notifications, beforeArm = () => {} }) {
    let armed = false;
    let sawGenerating = false;
    let runId = 0;
    let finishedRunId = -1;
    let lastArmAt = 0;
    let finishTimer = null;
    let armTimer = null;

    const initial = assistantSnapshot();
    let baselineAssistantCount = initial.count;
    let baselineFingerprint = initial.fingerprint;
    let currentAssistantCount = initial.count;
    let currentFingerprint = initial.fingerprint;
    let lastAssistantChangeAt = Date.now();

    function updateAssistantSnapshot() {
      const next = assistantSnapshot();
      currentAssistantCount = next.count;
      if (next.fingerprint !== currentFingerprint) {
        currentFingerprint = next.fingerprint;
        lastAssistantChangeAt = Date.now();
      }
    }

    function responseChanged() {
      return currentAssistantCount > baselineAssistantCount || currentFingerprint !== baselineFingerprint;
    }

    function clearTimers() {
      if (finishTimer) clearTimeout(finishTimer);
      if (armTimer) clearTimeout(armTimer);
      finishTimer = null;
      armTimer = null;
    }

    function armAnswer(source = 'unknown') {
      if (armed && Date.now() - lastArmAt < 1200) return;
      beforeArm();
      lastArmAt = Date.now();
      runId += 1;
      armed = true;
      sawGenerating = false;
      finishedRunId = -1;
      clearTimers();

      const snapshot = assistantSnapshot();
      baselineAssistantCount = snapshot.count;
      baselineFingerprint = snapshot.fingerprint;
      currentAssistantCount = snapshot.count;
      currentFingerprint = snapshot.fingerprint;
      lastAssistantChangeAt = Date.now();
      tabState.setState('working');

      const thisRun = runId;
      armTimer = setTimeout(() => {
        if (armed && runId === thisRun && !sawGenerating && !responseChanged()) {
          armed = false;
          tabState.setState('idle');
        }
      }, deps.SETTINGS.armTimeoutMs);
      console.debug(`[ChatGPT notifier] Ожидается ответ: ${source}`);
    }

    function finishAnswer() {
      if (!armed || finishedRunId === runId) return;
      finishedRunId = runId;
      armed = false;
      sawGenerating = false;
      clearTimers();
      const unread = document.hidden || !document.hasFocus();
      tabState.setState(unread ? 'fresh' : 'viewed');
      notifications.notifyFinished();
    }

    function scheduleFinish() {
      if (finishTimer) return;
      const scheduledRun = runId;
      finishTimer = setTimeout(() => {
        finishTimer = null;
        updateAssistantSnapshot();
        if (armed && runId === scheduledRun && !isGenerating() && (sawGenerating || responseChanged())) finishAnswer();
      }, deps.SETTINGS.finishConfirmDelayMs);
    }

    function check() {
      const generating = isGenerating();
      if (generating) {
        if (!armed) armAnswer('generation-detected');
        else updateAssistantSnapshot();
        sawGenerating = true;
        if (finishTimer) { clearTimeout(finishTimer); finishTimer = null; }
        tabState.setState('working');
        return;
      }
      if (!armed) return;
      updateAssistantSnapshot();
      if (sawGenerating) { scheduleFinish(); return; }
      if (responseChanged() && Date.now() - lastAssistantChangeAt >= deps.SETTINGS.fallbackQuietDelayMs) finishAnswer();
    }

    function resetForNavigation() {
      armed = false;
      sawGenerating = false;
      finishedRunId = -1;
      clearTimers();
      const snapshot = assistantSnapshot();
      baselineAssistantCount = snapshot.count;
      baselineFingerprint = snapshot.fingerprint;
      currentAssistantCount = snapshot.count;
      currentFingerprint = snapshot.fingerprint;
      lastAssistantChangeAt = Date.now();
    }

    return { armAnswer, check, resetForNavigation, isArmed: () => armed };
  }

  return { assistantSnapshot, isGenerating, createResponseMonitor };
});

(function (root, factory) {
  const api = factory(root.ChatGPTTabNotifier || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ChatGPTTabNotifier = Object.assign(root.ChatGPTTabNotifier || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  'use strict';

  function startTabNotifier() {
    let uploadUi = null;
    const tabState = deps.createTabStateController({ scheduleUiUpdate: () => uploadUi?.schedule() });
    const notifications = deps.createNotificationService(tabState);
    let uploadController = null;
    const responseMonitor = deps.createResponseMonitor({
      tabState,
      notifications,
      beforeArm: () => {
        if (tabState.isUploadMarked() || uploadController?.isArmed()) {
          uploadController?.reset({ clearMark: true, render: false });
        }
      }
    });

    uploadController = deps.createUploadAutoSendController({ tabState });
    uploadUi = deps.createUploadButtonUi({ tabState, uploadController });
    let lastUrl = location.href;

    document.addEventListener('change', event => {
      const input = event.target;
      if (typeof HTMLInputElement === 'undefined' || !(input instanceof HTMLInputElement) || input.type !== 'file') return;
      uploadController.rememberFileActivity(input.files);
      if (uploadController.isArmed()) uploadController.check();
    }, true);

    document.addEventListener('drop', event => {
      if (!event.dataTransfer?.files?.length) return;
      uploadController.rememberFileActivity(event.dataTransfer.files);
      if (uploadController.isArmed()) uploadController.check();
    }, true);

    document.addEventListener('paste', event => {
      if (!event.clipboardData?.files?.length) return;
      uploadController.rememberFileActivity(event.clipboardData.files);
      if (uploadController.isArmed()) uploadController.check();
    }, true);

    document.addEventListener('click', event => {
      if (deps.isComposerSendButton(event.target)) responseMonitor.armAnswer('send-button');
    }, true);

    document.addEventListener('keydown', event => {
      if (
        event.key === 'Enter' && !event.isComposing && !event.shiftKey && !event.ctrlKey &&
        !event.altKey && !event.metaKey && deps.isComposerTarget(event.target)
      ) responseMonitor.armAnswer('enter-key');
    }, true);

    document.addEventListener('submit', event => {
      if (typeof HTMLFormElement === 'undefined' || !(event.target instanceof HTMLFormElement)) return;
      if (deps.COMPOSER_SELECTORS.some(selector => event.target.querySelector(selector))) responseMonitor.armAnswer('form-submit');
    }, true);

    function markViewed() {
      tabState.markViewed();
      responseMonitor.check();
    }

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        markViewed();
        uploadUi.schedule();
      }
    });
    window.addEventListener('focus', markViewed);
    window.addEventListener('resize', uploadUi.schedule, { passive: true });
    window.addEventListener('scroll', uploadUi.schedule, { passive: true, capture: true });

    function resetForNavigation() {
      lastUrl = location.href;
      responseMonitor.resetForNavigation();
      uploadController.reset({ clearMark: true, render: false });
      uploadController.resetFileHistory();
      tabState.resetForNavigation();
      setTimeout(responseMonitor.check, 400);
    }

    const uiObserver = new MutationObserver(() => {
      if (!document.hidden) uploadUi.schedule();
      if (uploadController.isArmed()) uploadController.check();
    });
    uiObserver.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        'data-testid', 'data-is-streaming', 'data-state', 'data-uploading', 'data-loading',
        'aria-busy', 'aria-disabled', 'disabled', 'aria-label'
      ]
    });

    const titleNode = document.querySelector('title');
    if (titleNode) {
      new MutationObserver(() => tabState.handleExternalTitle(document.title))
        .observe(titleNode, { childList: true, characterData: true, subtree: true });
    }

    let tickCount = 0;
    const interval = setInterval(() => {
      if (location.href !== lastUrl) resetForNavigation();
      responseMonitor.check();
      uploadController.check();
      tickCount += 1;
      if (!document.hidden && tickCount % 6 === 0) uploadUi.schedule();
    }, deps.SETTINGS.checkIntervalMs);

    if (typeof GM_registerMenuCommand === 'function') {
      GM_registerMenuCommand('⇧ Автоотправка после загрузки файлов', uploadController.toggle);
      GM_registerMenuCommand('● Проверить уведомление', notifications.showDesktopNotification);
    }

    tabState.render();
    responseMonitor.check();
    console.info('[ChatGPT notifier] v5.0 запущен. Исходники модульные; userscript собран автоматически.');

    return {
      dispose() {
        clearInterval(interval);
        uiObserver.disconnect();
      },
      tabState,
      uploadController,
      responseMonitor,
      uploadUi
    };
  }

  return { startTabNotifier };
});

(function () {
  'use strict';
  const api = globalThis.ChatGPTTabNotifier;
  if (!api || typeof api.startTabNotifier !== 'function') throw new Error('ChatGPT Tab Notifier build is incomplete.');
  api.startTabNotifier();
})();
