// ==UserScript==
// @name         ChatGPT — значки вкладок, загрузка файлов и уведомления
// @namespace    local.chatgpt.tab-notifier
// @version      5.6.0
// @description  Статусы вкладки + автоотправка файлов + очередь сообщений + отложенная отправка + перетаскиваемые кнопки
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

  const SCRIPT_VERSION = '5.6.0';

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
    recentFileActivityWindowMs: 15 * 60 * 1000,
    uploadActivityFallbackWindowMs: 90 * 1000
  });

  const SYMBOLS = Object.freeze({ working: '⏳', fresh: '●', viewed: '✓', uploading: '⇧', idle: '' });
  const ALL_PREFIX_SYMBOLS = Object.freeze(['⏳', '🔔', '✓', '📤', '●', '⇧']);
  const BROKEN_OLD_PREFIX_UNITS = new Set([0xDD14, 0xDCE4]);

  const STORAGE_KEY = 'chatgpt-tab-notifier-v5';
  const CUSTOM_ICON_ID = 'chatgpt-tab-notifier-custom-icon';
  const UPLOAD_HOST_ID = 'chatgpt-tab-notifier-upload-host';
  const FLOATING_UI_POSITION_KEY = 'chatgpt-tab-notifier-floating-ui-position-v1';

  const COMPOSER_SELECTORS = Object.freeze([
    '#prompt-textarea[contenteditable="true"]',
    '[contenteditable="true"][role="textbox"][aria-label*="Chat with ChatGPT" i]',
    '[contenteditable="true"][role="textbox"][aria-label*="Message ChatGPT" i]',
    '[data-testid="composer-textarea"][contenteditable="true"]',
    'textarea[data-testid="composer-textarea"]',
    '#prompt-textarea',
    'textarea[name="prompt-textarea"]',
    '[contenteditable="true"][role="textbox"]',
    'textarea[role="textbox"]',
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
    SCRIPT_VERSION,
    SETTINGS,
    SYMBOLS,
    ALL_PREFIX_SYMBOLS,
    BROKEN_OLD_PREFIX_UNITS,
    STORAGE_KEY,
    CUSTOM_ICON_ID,
    UPLOAD_HOST_ID,
    FLOATING_UI_POSITION_KEY,
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

  const COMPOSER_CONTROL_SELECTOR = [
    '#composer-submit-button',
    'button[data-testid="composer-submit-button"]',
    'button[data-testid="send-button"]',
    'button[data-testid="composer-plus-btn"]',
    'button[data-testid*="composer-plus" i]',
    'input#upload-files[type="file"]',
    'input#upload-photos[type="file"]'
  ].join(',');

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

  function scoreComposerCandidateMeta({
    selectorIndex = 999,
    area = 0,
    isPromptTextarea = false,
    isComposerTestId = false,
    isPromptName = false,
    isContentEditable = false,
    isRoleTextbox = false,
    hasComposerControls = false,
    hasSendButton = false
  } = {}) {
    // Selector specificity and ownership by the native composer controls matter
    // more than visual area. Area is only a bounded tie-breaker.
    let score = Math.max(0, 1000 - Math.max(0, Number(selectorIndex) || 0) * 70);
    if (isPromptTextarea) score += 900;
    if (isComposerTestId) score += 720;
    if (isPromptName) score += 620;
    if (isContentEditable) score += 180;
    if (isRoleTextbox) score += 150;
    if (hasComposerControls) score += 520;
    if (hasSendButton) score += 760;
    if (area > 0) score += Math.min(180, Math.log2(Math.max(2, area)) * 10);
    return score;
  }

  function isUsableComposerCandidate(element) {
    if (!isElement(element) || element.isConnected === false) return false;
    if (element.getAttribute?.('aria-hidden') === 'true') return false;
    if (element.hasAttribute?.('inert')) return false;
    if (element.disabled || element.readOnly) return false;
    if (!isVisible(element)) return false;
    const rect = element.getBoundingClientRect?.();
    return Boolean(rect && rect.width > 20 && rect.height > 10);
  }

  function findSendButton(root = document) {
    if (!root?.querySelectorAll) return null;
    for (const selector of deps.SEND_BUTTON_SELECTORS) {
      for (const button of root.querySelectorAll(selector)) {
        if (typeof HTMLButtonElement === 'undefined' || !(button instanceof HTMLButtonElement)) continue;
        if (!isVisible(button) || button.isConnected === false) continue;
        if (button.matches('[data-testid="stop-button"], [data-testid="stop-generating-button"]')) continue;
        return button;
      }
    }
    return null;
  }

  function isSendButtonReady(button) {
    if (typeof HTMLButtonElement === 'undefined' || !(button instanceof HTMLButtonElement)) return false;
    if (button.isConnected === false || !isVisible(button) || button.disabled) return false;
    if (button.getAttribute('aria-disabled') === 'true') return false;
    return getComputedStyle(button).pointerEvents !== 'none';
  }

  function findComposerContainer(composer) {
    if (!isElement(composer) || composer.isConnected === false) return null;

    const form = composer.closest?.('form');
    if (form && form.isConnected !== false) return form;

    let node = composer.parentElement;
    for (let depth = 0; node && depth < 10; depth += 1, node = node.parentElement) {
      if (node.querySelector?.(COMPOSER_CONTROL_SELECTOR)) return node;
    }
    return null;
  }

  function describeComposerCandidate(element, selectorIndex) {
    const rect = element.getBoundingClientRect?.();
    const container = findComposerContainer(element);
    const sendButton = container ? findSendButton(container) : null;
    const testId = String(element.getAttribute?.('data-testid') || '').toLowerCase();
    return {
      element,
      container,
      sendButton,
      selectorIndex,
      area: rect ? rect.width * rect.height : 0,
      isPromptTextarea: element.id === 'prompt-textarea',
      isComposerTestId: /composer.*textarea|textarea.*composer/.test(testId),
      isPromptName: element.getAttribute?.('name') === 'prompt-textarea',
      isContentEditable: element.isContentEditable || element.getAttribute?.('contenteditable') === 'true',
      isRoleTextbox: element.getAttribute?.('role') === 'textbox',
      hasComposerControls: Boolean(container?.querySelector?.(COMPOSER_CONTROL_SELECTOR)),
      hasSendButton: Boolean(sendButton)
    };
  }

  function findComposerContext(doc = document) {
    if (!doc?.querySelectorAll) return null;
    const selectorIndexByElement = new Map();

    deps.COMPOSER_SELECTORS.forEach((selector, selectorIndex) => {
      for (const element of doc.querySelectorAll(selector)) {
        if (!isUsableComposerCandidate(element)) continue;
        const previous = selectorIndexByElement.get(element);
        if (previous === undefined || selectorIndex < previous) selectorIndexByElement.set(element, selectorIndex);
      }
    });

    let best = null;
    for (const [element, selectorIndex] of selectorIndexByElement.entries()) {
      const meta = describeComposerCandidate(element, selectorIndex);
      const score = scoreComposerCandidateMeta(meta);
      if (!best || score > best.score || (score === best.score && meta.area > best.area)) {
        best = { ...meta, score };
      }
    }

    if (!best) return null;
    return {
      composer: best.element,
      container: best.container,
      form: best.container,
      sendButton: best.sendButton,
      score: best.score,
      selectorIndex: best.selectorIndex
    };
  }

  function findComposer(doc = document) {
    return findComposerContext(doc)?.composer || null;
  }

  function findComposerForm(doc = document) {
    const context = findComposerContext(doc);
    if (context?.container) return context.container;
    return findSendButton(doc)?.closest?.('form') || null;
  }

  function findComposerBox(composer) {
    if (!composer) return null;
    const form = findComposerContainer(composer);
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
    const form = findComposerContainer(composer) || findComposerContext()?.container;
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
    const root = findComposerContainer(composer) || findComposerContext()?.container || document;
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

  function elementHasUploadContext(element, form, knownFileNames = []) {
    const names = Array.from(knownFileNames || []).map(name => String(name || '')).filter(Boolean);
    let node = element;
    for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) {
      if (!isElement(node)) break;
      const metadata = [
        node.getAttribute('aria-label') || '',
        node.getAttribute('title') || '',
        node.getAttribute('data-testid') || '',
        node.getAttribute('data-state') || '',
        typeof node.className === 'string' ? node.className : ''
      ].join(' ');
      const text = String(node.textContent || '').slice(0, 1500);
      const haystack = `${metadata} ${text}`;
      if (/upload|attachment|file(?:-|_|\s)|загруз|файл/i.test(haystack)) return true;
      if (names.some(name => haystack.includes(name))) return true;
      if (node === form) break;
    }
    return false;
  }

  function composerHasUploadBusyEvidence(form, knownFileNames = []) {
    if (!isElement(form)) return false;
    const genericBusySelector = [
      '[aria-busy="true"]',
      '[role="progressbar"]',
      '[data-loading="true"]',
      '[data-state="loading"]'
    ].join(',');

    for (const selector of deps.UPLOAD_BUSY_SELECTORS) {
      for (const element of form.querySelectorAll(selector)) {
        if (!isVisible(element)) continue;
        if (!element.matches(genericBusySelector)) return true;
        if (elementHasUploadContext(element, form, knownFileNames)) return true;
      }
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
    if (button.matches('[data-testid="stop-button"], [data-testid="stop-generating-button"]')) return false;

    const context = findComposerContext();
    if (context?.container) return context.container.contains(button);

    const container = button.closest('form');
    return Boolean(container && deps.COMPOSER_SELECTORS.some(selector => container.querySelector?.(selector)));
  }

  return {
    isVisible,
    scoreComposerCandidateMeta,
    findComposerContext,
    findComposer,
    findSendButton,
    isSendButtonReady,
    findComposerContainer,
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

  const SEND_CONFIRM_TIMEOUT_MS = 12000;
  const SEND_RETRY_DELAY_MS = 1800;
  const SEND_MAX_CLICKS = 3;

  function evaluateUploadReadiness({
    attachment,
    activityFallback = false,
    busy,
    sendReady,
    hasFileRelation,
    armAgeMs,
    readyAgeMs
  }) {
    if (!attachment && !activityFallback) return { ready: false, reason: 'no-attachment' };
    if (busy) return { ready: false, reason: 'upload-busy' };
    if (!sendReady) return { ready: false, reason: 'send-not-ready' };
    if (!hasFileRelation) return { ready: false, reason: 'no-file-relation' };
    if (armAgeMs < deps.SETTINGS.uploadMinArmDelayMs) return { ready: false, reason: 'minimum-arm-delay' };
    if (readyAgeMs < deps.SETTINGS.uploadReadyStableMs) return { ready: false, reason: 'stability-delay' };
    return { ready: true, reason: 'ready' };
  }

  function evaluateUploadSendConfirmation({
    generationActive = false,
    contextAvailable = true,
    sameComposerContext = true,
    composerHadText = false,
    composerHasText = false,
    attachmentBefore = false,
    attachmentNow = false,
    fileInputBefore = false,
    fileInputNow = false,
    sendReadyNow = true,
    currentStrongFileEvidence = false,
    elapsedSinceClickMs = 0
  }) {
    if (generationActive) return { confirmed: true, reason: 'generation-started' };
    if (!contextAvailable) return { confirmed: false, reason: 'composer-context-missing' };

    // A transient React re-render can temporarily remove the current composer and
    // Send button. Never interpret that gap as a successful send. Consumption-based
    // confirmation is accepted only while we are still observing the same composer
    // instance that received the click; a replaced composer must be confirmed by
    // generation state instead.
    if (!sendReadyNow && sameComposerContext) {
      if (composerHadText && !composerHasText) return { confirmed: true, reason: 'composer-consumed' };
      if (attachmentBefore && !attachmentNow) return { confirmed: true, reason: 'attachment-consumed' };
      if (fileInputBefore && !fileInputNow) return { confirmed: true, reason: 'file-input-consumed' };
    }

    return { confirmed: false, reason: 'waiting' };
  }

  function shouldRetryUploadSend({
    elapsedSinceClickMs = 0,
    clickCount = 0,
    sendReadyNow = false,
    busy = false,
    currentStrongFileEvidence = false,
    sameReadyButton = false,
    sameComposerContext = false,
    composerUnchanged = false
  }) {
    if (clickCount >= SEND_MAX_CLICKS) return false;
    if (!sendReadyNow || busy) return false;
    if (elapsedSinceClickMs < SEND_RETRY_DELAY_MS) return false;
    // Never retry after the user (or ChatGPT) changed the composer contents. A
    // retry must only resend the exact still-pending composer state we observed.
    if (!composerUnchanged) return false;
    if (currentStrongFileEvidence) return true;

    // If the attachment DOM itself is unavailable, retry only when the exact same
    // ready Send button and composer contents are still untouched for longer. That
    // is a stronger signal that the previous click was ignored, while avoiding a
    // blind duplicate click after React has already transitioned the composer.
    return Boolean(
      sameReadyButton &&
      sameComposerContext &&
      composerUnchanged &&
      elapsedSinceClickMs >= SEND_RETRY_DELAY_MS + 700
    );
  }

  function createUploadAutoSendController({
    tabState,
    onAutoSend = () => {},
    isGenerationActive = () => false
  } = {}) {
    let armed = false;
    let armedAt = 0;
    let readySince = 0;
    let sawBusy = false;
    let sawAttachment = false;
    let sawFileActivity = false;
    let lastFileActivityAt = 0;
    let lastFileNames = [];
    let lastFallbackLogAt = 0;
    let sendAttempt = null;

    function resetFileHistory() {
      lastFileActivityAt = 0;
      lastFileNames = [];
    }

    function reset({ clearMark = true, render = true, clearFileHistory = false } = {}) {
      armed = false;
      armedAt = 0;
      readySince = 0;
      sawBusy = false;
      sawAttachment = false;
      sawFileActivity = false;
      lastFallbackLogAt = 0;
      sendAttempt = null;
      if (clearFileHistory) resetFileHistory();
      if (clearMark) tabState.setUploadMarked(false, { renderNow: render });
      else if (render) tabState.render();
    }

    function mergeFileNames(names) {
      const next = Array.from(names || []).map(name => String(name || '')).filter(Boolean);
      if (!next.length) return false;
      lastFileNames = [...new Set([...lastFileNames, ...next])];
      return true;
    }

    function currentInputFileNames(root = document) {
      return typeof deps.getInputFileNames === 'function' ? deps.getInputFileNames(root || document) : [];
    }

    function currentInputHasKnownFiles(root = document) {
      const current = currentInputFileNames(root);
      if (!current.length) return false;
      if (!lastFileNames.length) return true;
      const known = new Set(lastFileNames);
      return current.some(name => known.has(name));
    }

    function readComposerTextFrom(composer) {
      if (!composer) return '';
      if (typeof HTMLTextAreaElement !== 'undefined' && composer instanceof HTMLTextAreaElement) return composer.value || '';
      if (typeof HTMLInputElement !== 'undefined' && composer instanceof HTMLInputElement) return composer.value || '';
      return String(composer.innerText || composer.textContent || '').replace(/\u00a0/g, ' ');
    }

    function currentComposerContext() {
      if (typeof deps.findComposerContext !== 'function') return null;
      const context = deps.findComposerContext(document);
      const composer = context?.composer || null;
      const container = context?.container || context?.form || null;
      if (!composer || composer.isConnected === false || !container || container.isConnected === false) return null;

      let sendButton = context?.sendButton || null;
      if (!sendButton || sendButton.isConnected === false || !container.contains?.(sendButton)) {
        sendButton = typeof deps.findSendButton === 'function' ? deps.findSendButton(container) : null;
      }
      return { composer, container, form: container, sendButton };
    }

    function readUploadSnapshot(now = Date.now(), { syncFileInput = false } = {}) {
      const context = currentComposerContext();
      if (context && syncFileInput) syncCurrentFileInputEvidence(now, context.container);

      if (!context) {
        return {
          contextAvailable: false,
          context: null,
          composer: null,
          form: null,
          sendButton: null,
          sendReady: false,
          busy: false,
          attachment: false,
          fileInputHasKnownFiles: false,
          composerText: ''
        };
      }

      const { composer, container, sendButton } = context;
      return {
        contextAvailable: true,
        context,
        composer,
        form: container,
        sendButton,
        sendReady: deps.isSendButtonReady(sendButton),
        busy: deps.composerHasUploadBusyEvidence(container, lastFileNames),
        attachment: deps.composerHasAttachmentEvidence(container, lastFileNames),
        fileInputHasKnownFiles: currentInputHasKnownFiles(container),
        composerText: readComposerTextFrom(composer).trim()
      };
    }

    function syncCurrentFileInputEvidence(now = Date.now(), root = document) {
      const names = currentInputFileNames(root);
      if (!mergeFileNames(names)) return false;

      // A live file input with files is strong evidence for the current composer.
      // If the browser event was missed, anchor fallback freshness to this arm/check.
      if (!lastFileActivityAt || now - lastFileActivityAt > deps.SETTINGS.recentFileActivityWindowMs) {
        lastFileActivityAt = now;
      }
      sawFileActivity = true;
      return true;
    }

    function hasFreshActivityFallback(now = Date.now()) {
      return Boolean(
        sawFileActivity &&
        lastFileActivityAt > 0 &&
        now - lastFileActivityAt <= deps.SETTINGS.uploadActivityFallbackWindowMs
      );
    }

    function arm() {
      if (!deps.SETTINGS.uploadAutoSendEnabled) {
        tabState.setUploadMarked(true);
        return;
      }

      const now = Date.now();
      armed = true;
      sendAttempt = null;
      tabState.setUploadMarked(true, { renderNow: false });
      armedAt = now;
      readySince = 0;
      sawFileActivity = now - lastFileActivityAt <= deps.SETTINGS.recentFileActivityWindowMs;
      const snapshot = readUploadSnapshot(now, { syncFileInput: true });
      sawBusy = Boolean(snapshot.contextAvailable && (snapshot.busy || !snapshot.sendReady));
      sawAttachment = Boolean(snapshot.attachment);

      tabState.save();
      tabState.render();
      check();
      console.info('[ChatGPT notifier] Автоотправка после загрузки файлов включена.');
    }

    function toggle() {
      if (tabState.isUploadMarked() || armed) {
        reset({ clearMark: true, render: true, clearFileHistory: true });
        console.info('[ChatGPT notifier] Автоотправка после загрузки файлов отменена.');
        return;
      }
      arm();
    }

    function rememberFileActivity(files) {
      const list = Array.from(files || []);
      if (!list.length) return;

      const names = list.map(file => file?.name).filter(Boolean);
      lastFileActivityAt = Date.now();
      mergeFileNames(names);
      if (armed) sawFileActivity = true;
      console.debug('[ChatGPT notifier] Обнаружен выбор/перетаскивание файла:', names);
    }

    function finishConfirmedSend(reason) {
      console.info(`[ChatGPT notifier] Автоотправка подтверждена (${reason}).`);
      reset({ clearMark: true, render: true, clearFileHistory: true });
      try { onAutoSend(); } catch (error) { console.warn('[ChatGPT notifier] Ошибка post-send callback:', error); }
      return true;
    }

    function failSendAttempt(message) {
      console.warn(`[ChatGPT notifier] ${message}`);
      reset({ clearMark: true, render: true, clearFileHistory: true });
      return false;
    }

    function clickCurrentSend({ isRetry = false } = {}) {
      if (!armed || !sendAttempt) return false;
      const now = Date.now();
      const snapshot = readUploadSnapshot(now, { syncFileInput: true });
      if (!snapshot.contextAvailable || !snapshot.sendReady || snapshot.sendButton?.isConnected === false) return false;
      if (snapshot.busy) return false;

      const activityFallback = hasFreshActivityFallback(now);
      const strongFileEvidence = snapshot.attachment || snapshot.fileInputHasKnownFiles;
      if (!strongFileEvidence && !activityFallback) return false;

      sendAttempt.lastClickAt = now;
      sendAttempt.clickCount += 1;
      sendAttempt.lastButton = snapshot.sendButton;
      sendAttempt.lastComposer = snapshot.composer;
      sendAttempt.lastContainer = snapshot.form;
      sendAttempt.composerTextAtLastClick = snapshot.composerText;
      sendAttempt.composerHadText = Boolean(snapshot.composerText);
      sendAttempt.attachmentBefore = snapshot.attachment;
      sendAttempt.fileInputBefore = snapshot.fileInputHasKnownFiles;
      console.info(
        `[ChatGPT notifier] Нажимаю штатный Send для файла${isRetry ? ` повторно (${sendAttempt.clickCount}/${SEND_MAX_CLICKS})` : ''}.`
      );

      try {
        snapshot.sendButton.click();
      } catch (error) {
        console.warn('[ChatGPT notifier] Ошибка штатного Send click:', error);
        return false;
      }
      return true;
    }

    function beginSendAttempt() {
      if (!armed || sendAttempt) return false;

      const now = Date.now();
      const snapshot = readUploadSnapshot(now, { syncFileInput: true });
      if (!snapshot.contextAvailable || !snapshot.sendReady) return false;

      const activityFallback = hasFreshActivityFallback(now);
      if (!snapshot.attachment && !snapshot.fileInputHasKnownFiles && !activityFallback) return false;
      if (snapshot.busy) return false;

      if (!snapshot.attachment && !snapshot.fileInputHasKnownFiles && activityFallback && now - lastFallbackLogAt > 2000) {
        lastFallbackLogAt = now;
        console.info('[ChatGPT notifier] Карточка вложения не распознана; использую подтверждённую активность файла.');
      }

      sendAttempt = {
        startedAt: now,
        lastClickAt: 0,
        clickCount: 0,
        lastButton: null,
        lastComposer: null,
        lastContainer: null,
        composerTextAtLastClick: snapshot.composerText,
        composerHadText: Boolean(snapshot.composerText),
        attachmentBefore: snapshot.attachment,
        fileInputBefore: snapshot.fileInputHasKnownFiles
      };

      // IMPORTANT: keep the transaction armed through React re-renders. The actual
      // click reacquires one coherent composer/context snapshot and stores exactly
      // the elements that received that click for later confirmation.
      if (!clickCurrentSend()) {
        sendAttempt = null;
        readySince = 0;
        return false;
      }
      return true;
    }

    function checkSendAttempt(now = Date.now()) {
      if (!armed || !sendAttempt) return false;

      const snapshot = readUploadSnapshot(now, { syncFileInput: true });
      let generationActive = false;
      try { generationActive = Boolean(isGenerationActive()); } catch (_) {}

      const currentStrongFileEvidence = snapshot.attachment || snapshot.fileInputHasKnownFiles;
      const elapsedSinceClickMs = Math.max(0, now - (sendAttempt.lastClickAt || sendAttempt.startedAt));
      const sameComposerContext = Boolean(
        snapshot.contextAvailable &&
        snapshot.composer === sendAttempt.lastComposer &&
        snapshot.form === sendAttempt.lastContainer
      );

      const confirmation = evaluateUploadSendConfirmation({
        generationActive,
        contextAvailable: snapshot.contextAvailable,
        sameComposerContext,
        composerHadText: sendAttempt.composerHadText,
        composerHasText: Boolean(snapshot.composerText),
        attachmentBefore: sendAttempt.attachmentBefore,
        attachmentNow: snapshot.attachment,
        fileInputBefore: sendAttempt.fileInputBefore,
        fileInputNow: snapshot.fileInputHasKnownFiles,
        sendReadyNow: snapshot.sendReady,
        currentStrongFileEvidence,
        elapsedSinceClickMs
      });
      if (confirmation.confirmed) return finishConfirmedSend(confirmation.reason);

      if (now - sendAttempt.startedAt >= SEND_CONFIRM_TIMEOUT_MS) {
        return failSendAttempt('Send не удалось подтвердить за отведённое время; автоотправка выключена без дополнительных кликов.');
      }

      // Missing/replaced composer context is a temporary React state, not success.
      // Wait for a coherent replacement context, then retry only under the existing
      // conservative file-evidence rules.
      if (!snapshot.contextAvailable) return false;

      const retry = shouldRetryUploadSend({
        elapsedSinceClickMs,
        clickCount: sendAttempt.clickCount,
        sendReadyNow: snapshot.sendReady,
        busy: snapshot.busy,
        currentStrongFileEvidence,
        sameReadyButton: Boolean(
          snapshot.sendButton &&
          snapshot.sendButton === sendAttempt.lastButton &&
          snapshot.sendButton.isConnected !== false
        ),
        sameComposerContext,
        composerUnchanged: snapshot.composerText === sendAttempt.composerTextAtLastClick
      });
      if (!retry) return false;

      return clickCurrentSend({ isRetry: true });
    }

    function autoSend() {
      return beginSendAttempt();
    }

    function check() {
      if (!armed || !deps.SETTINGS.uploadAutoSendEnabled) return;

      const now = Date.now();
      if (now - armedAt > deps.SETTINGS.uploadAutoSendTimeoutMs) {
        console.warn('[ChatGPT notifier] Автоотправка отменена по таймауту ожидания загрузки.');
        reset({ clearMark: true, render: true, clearFileHistory: true });
        return;
      }

      if (sendAttempt) {
        checkSendAttempt(now);
        return;
      }

      const snapshot = readUploadSnapshot(now, { syncFileInput: true });
      if (!snapshot.contextAvailable) {
        readySince = 0;
        return;
      }

      const busy = snapshot.busy;
      const attachment = snapshot.attachment;
      const activityFallback = hasFreshActivityFallback(now);
      const sendReady = snapshot.sendReady;
      const fileInputHasKnownFiles = snapshot.fileInputHasKnownFiles;

      if (busy || !sendReady) sawBusy = true;
      if (attachment) sawAttachment = true;
      if (fileInputHasKnownFiles || now - lastFileActivityAt <= deps.SETTINGS.recentFileActivityWindowMs) sawFileActivity = true;

      if ((!attachment && !fileInputHasKnownFiles && !activityFallback) || busy || !sendReady) {
        readySince = 0;
        return;
      }

      const hasFileRelation = attachment || fileInputHasKnownFiles || activityFallback || sawFileActivity || sawBusy || sawAttachment;
      if (!hasFileRelation) {
        readySince = 0;
        return;
      }
      if (now - armedAt < deps.SETTINGS.uploadMinArmDelayMs) return;
      if (!readySince) {
        readySince = now;
        return;
      }

      const evaluation = evaluateUploadReadiness({
        attachment,
        activityFallback,
        busy,
        sendReady,
        hasFileRelation,
        armAgeMs: now - armedAt,
        readyAgeMs: now - readySince
      });
      if (evaluation.ready) beginSendAttempt();
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
      isConfirmingSend: () => Boolean(sendAttempt),
      getKnownFileNames: () => [...lastFileNames]
    };
  }

  return {
    evaluateUploadReadiness,
    evaluateUploadSendConfirmation,
    shouldRetryUploadSend,
    createUploadAutoSendController
  };
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

  const FROM_COMPOSER_RETRY_MS = 90;
  const FROM_COMPOSER_MAX_ATTEMPTS = 5;
  const FROM_COMPOSER_CLEAR_MAX_ATTEMPTS = 4;
  const QUEUE_SEND_CONFIRM_TIMEOUT_MS = 2200;

  function readComposerText(composer) {
    if (!composer) return '';
    if (typeof HTMLTextAreaElement !== 'undefined' && composer instanceof HTMLTextAreaElement) return composer.value || '';
    if (typeof HTMLInputElement !== 'undefined' && composer instanceof HTMLInputElement) return composer.value || '';
    return String(composer.innerText || composer.textContent || '').replace(/\u00a0/g, ' ');
  }

  function setNativeValue(element, value) {
    const proto = typeof HTMLTextAreaElement !== 'undefined' && element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : (typeof HTMLInputElement !== 'undefined' && element instanceof HTMLInputElement ? HTMLInputElement.prototype : null);
    const setter = proto && Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(element, value);
    else element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function dispatchComposerInput(element, value) {
    try {
      element.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        composed: true,
        inputType: 'insertText',
        data: value
      }));
    } catch (_) {
      element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    }
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setContentEditableValue(element, value) {
    element.focus();
    let inserted = false;
    try {
      const selection = window.getSelection?.();
      if (selection) {
        const range = document.createRange();
        range.selectNodeContents(element);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      if (typeof document.execCommand === 'function') {
        inserted = Boolean(document.execCommand('insertText', false, value));
      }
    } catch (_) {}

    if (!inserted) {
      element.replaceChildren();
      const lines = String(value).split('\n');
      lines.forEach((line, index) => {
        const paragraph = document.createElement('p');
        if (line) paragraph.textContent = line;
        else paragraph.appendChild(document.createElement('br'));
        element.appendChild(paragraph);
        if (index === lines.length - 1 && lines.length === 1 && !line) paragraph.appendChild(document.createElement('br'));
      });
    }

    // Даже execCommand не всегда синхронизирует внутреннее состояние редактора ChatGPT.
    // Явно уведомляем интерфейс, чтобы штатный Send успел активироваться.
    dispatchComposerInput(element, value);
    return true;
  }

  function setComposerText(composer, value) {
    if (!composer) return false;
    if (
      (typeof HTMLTextAreaElement !== 'undefined' && composer instanceof HTMLTextAreaElement) ||
      (typeof HTMLInputElement !== 'undefined' && composer instanceof HTMLInputElement)
    ) return setNativeValue(composer, value);
    if (composer.isContentEditable || composer.getAttribute?.('contenteditable') === 'true') return setContentEditableValue(composer, value);
    return false;
  }

  // contenteditable ChatGPT может менять представление переносов строк после вставки.
  // Для проверки принадлежности текста сравниваем не сырой innerText, а каноническую форму.
  function normalizeComposerTextForOwnership(value) {
    return String(value || '')
      .replace(/\r\n?/g, '\n')
      .replace(/\u00a0/g, ' ')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n+/g, '\n')
      .trim();
  }

  function composerTextBelongsToJob(currentText, job) {
    if (!job?.insertedByScript) return false;
    const current = normalizeComposerTextForOwnership(currentText);
    if (!current) return false;
    if (current === job.expectedNormalized) return true;
    return Boolean(job.insertedSnapshotNormalized && current === job.insertedSnapshotNormalized);
  }

  function shouldClearComposerTransfer(currentText, expectedNormalized) {
    const current = normalizeComposerTextForOwnership(currentText);
    const expected = normalizeComposerTextForOwnership(expectedNormalized);
    return Boolean(current && expected && current === expected);
  }

  function evaluateQueueSendConfirmation({
    generationActive = false,
    clickedComposerConnected = false,
    clickedComposerHasText = true
  } = {}) {
    if (generationActive) return { confirmed: true, reason: 'generation-started' };
    if (clickedComposerConnected && !clickedComposerHasText) {
      return { confirmed: true, reason: 'clicked-composer-consumed' };
    }
    return { confirmed: false, reason: 'waiting' };
  }

  function createQueuedPromptController({ onChange = () => {} } = {}) {
    let items = [];
    let nextId = 1;
    let pending = null;
    let retryTimer = null;
    let statusTimer = null;
    let composerTransferTimer = null;
    let composerTransfer = null;
    let transferSerial = 0;
    let jobSerial = 0;
    let lastStatus = '';

    function emitChange() {
      try { onChange(); } catch (error) { console.warn('[ChatGPT notifier] Ошибка обновления UI очереди:', error); }
    }

    function clearRetry() {
      if (retryTimer !== null) clearTimeout(retryTimer);
      retryTimer = null;
    }

    function clearStatusTimer() {
      if (statusTimer !== null) clearTimeout(statusTimer);
      statusTimer = null;
    }

    function setStatus(message, autoClearMs = 4500) {
      clearStatusTimer();
      lastStatus = String(message || '');
      emitChange();
      if (lastStatus && autoClearMs > 0) {
        statusTimer = setTimeout(() => {
          statusTimer = null;
          lastStatus = '';
          emitChange();
        }, autoClearMs);
      }
    }

    function makeId() {
      if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
      return `q-${Date.now().toString(36)}-${(nextId++).toString(36)}`;
    }

    function getItems() {
      return items.map(item => ({ ...item }));
    }

    function getItem(id) {
      return items.find(item => item.id === id) || null;
    }

    function add(text) {
      const value = String(text || '').trim();
      if (!value) return null;
      const item = { id: makeId(), text: value, createdAt: Date.now() };
      items.push(item);
      clearStatusTimer();
      lastStatus = '';
      emitChange();
      console.info(`[ChatGPT notifier] Добавлено в очередь. Элементов: ${items.length}`);
      return item.id;
    }

    function currentComposerContext() {
      if (typeof deps.findComposerContext === 'function') {
        const context = deps.findComposerContext();
        if (context?.composer) return context;
      }
      const composer = deps.findComposer?.();
      if (!composer) return null;
      const container = composer.closest?.('form') || deps.findComposerForm?.() || null;
      const sendButton = container ? deps.findSendButton?.(container) : null;
      return { composer, container, form: container, sendButton };
    }

    function clearComposerTransferTimer() {
      if (composerTransferTimer !== null) clearTimeout(composerTransferTimer);
      composerTransferTimer = null;
    }

    function finishComposerTransfer(message, autoClearMs = 2200) {
      clearComposerTransferTimer();
      composerTransfer = null;
      if (message) setStatus(message, autoClearMs);
    }

    function scheduleComposerTransfer(callback, transferId, delay = FROM_COMPOSER_RETRY_MS) {
      clearComposerTransferTimer();
      composerTransferTimer = setTimeout(() => {
        composerTransferTimer = null;
        if (!composerTransfer || composerTransfer.id !== transferId) return;
        callback();
      }, delay);
    }

    function attemptClearTransferredComposer(transferId, attempt = 0) {
      const transfer = composerTransfer;
      if (!transfer || transfer.id !== transferId || transfer.phase !== 'clear') return false;

      const preferred = transfer.originalComposer;
      let target = null;
      if (preferred?.isConnected !== false && shouldClearComposerTransfer(readComposerText(preferred), transfer.expectedNormalized)) {
        target = preferred;
      } else {
        const context = currentComposerContext();
        const current = context?.composer;
        if (current && shouldClearComposerTransfer(readComposerText(current), transfer.expectedNormalized)) target = current;
      }

      if (!target) {
        if (attempt + 1 < FROM_COMPOSER_CLEAR_MAX_ATTEMPTS) {
          scheduleComposerTransfer(() => attemptClearTransferredComposer(transferId, attempt + 1), transferId);
          return false;
        }
        finishComposerTransfer('Текст добавлен в очередь. Поле ChatGPT успело измениться — я его не очищал.', 5500);
        return false;
      }

      if (!setComposerText(target, '')) {
        if (attempt + 1 < FROM_COMPOSER_CLEAR_MAX_ATTEMPTS) {
          scheduleComposerTransfer(() => attemptClearTransferredComposer(transferId, attempt + 1), transferId);
          return false;
        }
        finishComposerTransfer('Текст добавлен в очередь, но обычное поле ChatGPT не удалось очистить.', 5500);
        return false;
      }

      const after = normalizeComposerTextForOwnership(readComposerText(target));
      if (!after) {
        finishComposerTransfer('Текст из ChatGPT добавлен в очередь.');
        return true;
      }

      // Повторяем очистку только пока в поле всё ещё находится ровно тот текст,
      // который уже скопирован в очередь. Новый пользовательский текст не трогаем.
      if (after === transfer.expectedNormalized && attempt + 1 < FROM_COMPOSER_CLEAR_MAX_ATTEMPTS) {
        scheduleComposerTransfer(() => attemptClearTransferredComposer(transferId, attempt + 1), transferId);
        return false;
      }

      finishComposerTransfer('Текст добавлен в очередь. Поле ChatGPT изменилось во время очистки — новый текст оставлен.', 5500);
      return false;
    }

    function attemptAddFromComposer(transferId, attempt = 0) {
      const transfer = composerTransfer;
      if (!transfer || transfer.id !== transferId || transfer.phase !== 'find') return false;

      const context = currentComposerContext();
      const composer = context?.composer;
      const rawText = composer ? readComposerText(composer) : '';
      const normalized = normalizeComposerTextForOwnership(rawText);

      if (!composer || !normalized) {
        if (attempt + 1 < FROM_COMPOSER_MAX_ATTEMPTS) {
          scheduleComposerTransfer(() => attemptAddFromComposer(transferId, attempt + 1), transferId);
          return false;
        }
        finishComposerTransfer(composer ? 'Обычное поле ChatGPT пустое.' : 'Не найдено обычное поле ChatGPT.', 4500);
        return false;
      }

      const id = add(rawText);
      if (!id) {
        finishComposerTransfer('Не удалось добавить текст из ChatGPT в очередь.', 4500);
        return false;
      }

      transfer.phase = 'clear';
      transfer.itemId = id;
      transfer.originalComposer = composer;
      transfer.expectedNormalized = normalized;
      attemptClearTransferredComposer(transferId, 0);
      return true;
    }

    function addFromComposer() {
      if (composerTransfer) {
        setStatus('Перенос из поля ChatGPT уже выполняется.', 1800);
        return false;
      }
      const transferId = ++transferSerial;
      composerTransfer = { id: transferId, phase: 'find' };
      return attemptAddFromComposer(transferId, 0);
    }

    function move(id, direction) {
      if (pending) return false;
      const index = items.findIndex(item => item.id === id);
      if (index < 0) return false;
      const target = index + Number(direction || 0);
      if (target < 0 || target >= items.length || target === index) return false;
      [items[index], items[target]] = [items[target], items[index]];
      clearStatusTimer();
      lastStatus = '';
      emitChange();
      return true;
    }

    function moveRelative(sourceId, targetId, placeAfter = false) {
      if (pending || sourceId === targetId) return false;
      const sourceIndex = items.findIndex(item => item.id === sourceId);
      if (sourceIndex < 0 || !items.some(item => item.id === targetId)) return false;

      const [moved] = items.splice(sourceIndex, 1);
      const targetIndex = items.findIndex(item => item.id === targetId);
      if (targetIndex < 0) {
        items.splice(Math.min(sourceIndex, items.length), 0, moved);
        return false;
      }

      items.splice(targetIndex + (placeAfter ? 1 : 0), 0, moved);
      clearStatusTimer();
      lastStatus = '';
      emitChange();
      return true;
    }

    function cancelPending() {
      clearRetry();
      pending = null;
      jobSerial += 1; // Инвалидирует уже запланированные callback старой операции.
    }

    function remove(id) {
      const index = items.findIndex(item => item.id === id);
      if (index < 0) return false;
      if (pending?.itemIds?.includes(id)) cancelPending();
      items.splice(index, 1);
      clearStatusTimer();
      lastStatus = '';
      emitChange();
      return true;
    }

    function cancelComposerTransfer() {
      clearComposerTransferTimer();
      composerTransfer = null;
      transferSerial += 1;
    }

    function clear() {
      cancelPending();
      cancelComposerTransfer();
      clearStatusTimer();
      items = [];
      lastStatus = '';
      emitChange();
    }

    function scheduleRetry(delay = 160) {
      if (retryTimer !== null || !pending) return;
      const jobId = pending.jobId;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (!pending || pending.jobId !== jobId) return;
        attemptSend(jobId);
      }, delay);
    }

    function failPending(message, expectedJobId = null) {
      if (expectedJobId !== null && (!pending || pending.jobId !== expectedJobId)) return false;
      clearRetry();
      pending = null;
      jobSerial += 1;
      setStatus(message, 4500);
      console.warn(`[ChatGPT notifier] ${message}`);
      return false;
    }

    function finishPendingSuccess(job) {
      if (!pending || pending.jobId !== job.jobId) return false;
      const sentIds = new Set(job.itemIds);
      clearRetry();
      pending = null;
      items = items.filter(item => !sentIds.has(item.id));
      clearStatusTimer();
      lastStatus = '';
      emitChange();
      console.info(`[ChatGPT notifier] Отправка из очереди (${job.source}) подтверждена:`, job.text);
      return true;
    }

    function beginSend({ itemIds, text, allowWhileGenerating, source, timeoutMs }) {
      const ids = Array.from(itemIds || []).filter(id => getItem(id));
      const value = String(text || '').trim();
      if (!ids.length || !value) return false;

      cancelPending();
      clearStatusTimer();
      const jobId = ++jobSerial;
      pending = {
        jobId,
        itemIds: ids,
        text: value,
        allowWhileGenerating: Boolean(allowWhileGenerating),
        source: source || 'queue',
        deadline: Date.now() + Math.max(1000, Number(timeoutMs) || 7000),
        phase: 'prepare',
        clickedAt: 0,
        insertedByScript: false,
        insertedAt: 0,
        expectedNormalized: normalizeComposerTextForOwnership(value),
        insertedSnapshotNormalized: '',
        clickedSnapshotNormalized: '',
        clickedComposer: null,
        clickedContainer: null,
        clickedButton: null
      };
      lastStatus = '';
      emitChange();
      return attemptSend(jobId);
    }

    function attemptSend(expectedJobId = null) {
      if (!pending) return false;
      const job = pending;
      if (expectedJobId !== null && job.jobId !== expectedJobId) return false;

      const now = Date.now();
      if (now > job.deadline) {
        return failPending('Не удалось отправить: штатное поле или кнопка Send не стали готовы. Сообщение осталось в очереди.', job.jobId);
      }

      const context = currentComposerContext();
      const composer = context?.composer;
      const form = context?.container || context?.form || null;

      if (job.phase === 'confirm') {
        let generationActive = false;
        try { generationActive = Boolean(typeof deps.isGenerating === 'function' && deps.isGenerating()); } catch (_) {}

        const clickedComposer = job.clickedComposer;
        const clickedComposerConnected = Boolean(clickedComposer && clickedComposer.isConnected !== false);
        const clickedComposerHasText = clickedComposerConnected
          ? Boolean(normalizeComposerTextForOwnership(readComposerText(clickedComposer)))
          : true;
        const confirmation = evaluateQueueSendConfirmation({
          generationActive,
          clickedComposerConnected,
          clickedComposerHasText
        });
        if (confirmation.confirmed) return finishPendingSuccess(job);

        if (now - job.clickedAt > QUEUE_SEND_CONFIRM_TIMEOUT_MS) {
          return failPending('Send не удалось надёжно подтвердить. Сообщение сохранено в очереди.', job.jobId);
        }
        scheduleRetry(90);
        return false;
      }

      if (!composer || !form) {
        scheduleRetry(180);
        return false;
      }

      const currentText = readComposerText(composer).trim();

      if (!job.allowWhileGenerating && typeof deps.isGenerating === 'function' && deps.isGenerating()) {
        scheduleRetry(220);
        return false;
      }

      const ownsCurrentText = composerTextBelongsToJob(currentText, job);

      if (currentText && !ownsCurrentText && normalizeComposerTextForOwnership(currentText) !== job.expectedNormalized) {
        // Только текст, который НЕ принадлежит текущей операции, считаем пользовательским.
        if (job.source.startsWith('manual-')) {
          return failPending('Не отправлено: обычное поле ChatGPT уже содержит другой текст. Сообщение осталось в очереди.', job.jobId);
        }
        scheduleRetry(250);
        return false;
      }

      if (!currentText || (!ownsCurrentText && normalizeComposerTextForOwnership(currentText) !== job.expectedNormalized)) {
        if (!setComposerText(composer, job.text)) {
          scheduleRetry(140);
          return false;
        }
        job.insertedByScript = true;
        job.insertedAt = Date.now();
        job.insertedSnapshotNormalized = normalizeComposerTextForOwnership(readComposerText(composer));
        scheduleRetry(90);
        return false;
      }

      // Если редактор преобразовал два переноса в один и т.п., но это всё ещё наш текст,
      // не трактуем его как чужой и продолжаем к штатной кнопке Send.
      if (!job.insertedByScript && normalizeComposerTextForOwnership(currentText) === job.expectedNormalized) {
        job.insertedByScript = true;
        job.insertedAt = Date.now();
        job.insertedSnapshotNormalized = normalizeComposerTextForOwnership(currentText);
      }

      // Ищем Send заново уже ПОСЛЕ того, как ChatGPT получил input-событие.
      const sendButton = context?.sendButton || deps.findSendButton(form);
      if (!deps.isSendButtonReady(sendButton)) {
        scheduleRetry(100);
        return false;
      }

      console.info(`[ChatGPT notifier] Нажимаю штатный Send (${job.source}):`, job.text);
      job.phase = 'confirm';
      job.clickedAt = Date.now();
      job.clickedSnapshotNormalized = normalizeComposerTextForOwnership(currentText);
      job.clickedComposer = composer;
      job.clickedContainer = form;
      job.clickedButton = sendButton;
      sendButton.click();
      scheduleRetry(90);
      return true;
    }

    function handleResponseFinished() {
      if (pending || !items.length) return false;
      const first = items[0];
      return beginSend({
        itemIds: [first.id],
        text: first.text,
        allowWhileGenerating: false,
        source: 'auto-after-response',
        timeoutMs: 10000
      });
    }

    function sendNow(id) {
      const item = getItem(id);
      if (!item) return false;
      return beginSend({
        itemIds: [item.id],
        text: item.text,
        allowWhileGenerating: true,
        source: 'manual-item',
        timeoutMs: 3500
      });
    }

    function sendAllNow() {
      if (!items.length) return false;
      const snapshot = items.map(item => ({ ...item }));
      return beginSend({
        itemIds: snapshot.map(item => item.id),
        text: snapshot.map(item => item.text).join('\n\n'),
        allowWhileGenerating: true,
        source: 'manual-all',
        timeoutMs: 3500
      });
    }

    function resetForNavigation() {
      clear();
    }

    return {
      add,
      addFromComposer,
      move,
      moveRelative,
      remove,
      clear,
      attemptSend,
      handleResponseFinished,
      sendNow,
      sendAllNow,
      resetForNavigation,
      getItems,
      getCount: () => items.length,
      hasQueued: () => items.length > 0,
      isWaitingToSend: () => Boolean(pending),
      getPendingIds: () => pending ? [...pending.itemIds] : [],
      getLastStatus: () => lastStatus
    };
  }

  return {
    readComposerText,
    setComposerText,
    normalizeComposerTextForOwnership,
    shouldClearComposerTransfer,
    evaluateQueueSendConfirmation,
    createQueuedPromptController
  };
});

(function (root, factory) {
  const deps = typeof require === 'function'
    ? Object.assign({}, require('./config.js'), require('./chatgpt-dom.js'), require('./queued-prompt.js'), root.ChatGPTTabNotifier || {})
    : (root.ChatGPTTabNotifier || {});
  const api = factory(deps);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ChatGPTTabNotifier = Object.assign(root.ChatGPTTabNotifier || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  'use strict';

  const DEFAULT_DELAY_MS = 5 * 60 * 1000;
  const MIN_DELAY_MS = 10 * 1000;
  const MAX_DELAY_MS = 24 * 60 * 60 * 1000;
  const SEND_RETRY_DELAY_MS = 1600;
  const SEND_CONFIRM_TIMEOUT_MS = 10000;
  const SEND_MAX_CLICKS = 3;
  const SETTINGS_KEY = 'chatgpt-tab-notifier-delayed-send-settings-v1';
  const STATE_KEY = 'chatgpt-tab-notifier-delayed-send-state-v2';
  const LEGACY_STATE_KEY = 'chatgpt-tab-notifier-delayed-send-state-v1';

  function normalizeDelayMs(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return DEFAULT_DELAY_MS;
    return Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, Math.round(numeric)));
  }

  function delayMinutesToMs(value) {
    const numeric = Number(String(value ?? '').trim().replace(',', '.'));
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    return normalizeDelayMs(numeric * 60 * 1000);
  }

  function formatDelayMinutes(ms) {
    const minutes = normalizeDelayMs(ms) / (60 * 1000);
    if (Number.isInteger(minutes)) return String(minutes);
    return String(Math.round(minutes * 100) / 100);
  }

  function formatDelayedRemaining(ms) {
    const totalSeconds = Math.max(0, Math.ceil(Number(ms || 0) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function evaluateDelayedSendConfirmation({
    generationActive = false,
    clickedComposerConnected = false,
    clickedComposerHasText = true
  } = {}) {
    if (generationActive) return { confirmed: true, reason: 'generation-started' };
    if (clickedComposerConnected && !clickedComposerHasText) {
      return { confirmed: true, reason: 'clicked-composer-consumed' };
    }
    return { confirmed: false, reason: 'waiting' };
  }

  function createDelayedSendController({
    onChange = () => {},
    isGenerationActive = () => false,
    isSendPipelineBusy = () => false,
    storage = (typeof localStorage !== 'undefined' ? localStorage : null),
    now = () => Date.now(),
    getRouteKey = () => (typeof location !== 'undefined' ? location.href : ''),
    resolveContext = () => deps.findComposerContext?.(),
    isSendReady = button => deps.isSendButtonReady?.(button),
    readText = composer => deps.readComposerText?.(composer) || '',
    setText = (composer, value) => deps.setComposerText?.(composer, value),
    normalizeText = value => deps.normalizeComposerTextForOwnership?.(value) || String(value || '').trim()
  } = {}) {
    let delayMs = DEFAULT_DELAY_MS;
    let checkpointText = '';
    let checkpointJob = null;
    let scheduledItems = [];
    let activeSend = null;
    let lastStatus = '';
    let lastRenderSignature = '';
    let nextId = 1;

    function emitChange() {
      try { onChange(); } catch (error) { console.warn('[ChatGPT notifier] Ошибка обновления таймера:', error); }
    }

    function storageGet(key) {
      try { return storage?.getItem?.(key) ?? null; } catch (_) { return null; }
    }

    function storageSet(key, value) {
      try { storage?.setItem?.(key, value); } catch (_) {}
    }

    function storageRemove(key) {
      try { storage?.removeItem?.(key); } catch (_) {}
    }

    function makeId() {
      if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
      return `d-${Date.now().toString(36)}-${(nextId++).toString(36)}`;
    }

    function currentRouteKey() {
      return String(getRouteKey() || '');
    }

    function persistSettings() {
      storageSet(SETTINGS_KEY, JSON.stringify({ delayMs, checkpointText }));
    }

    function persistState() {
      const routeKey = currentRouteKey();
      const checkpoint = checkpointJob && checkpointJob.phase === 'waiting' && checkpointJob.routeKey === routeKey
        ? {
            deadline: checkpointJob.deadline,
            text: checkpointJob.text,
            routeKey: checkpointJob.routeKey
          }
        : null;
      const items = scheduledItems
        .filter(item => item.routeKey === routeKey)
        .map(item => ({
          id: item.id,
          text: item.text,
          deadline: item.deadline,
          routeKey: item.routeKey,
          state: item.state === 'uncertain' ? 'uncertain' : 'waiting',
          createdAt: item.createdAt
        }));

      if (!checkpoint && !items.length) {
        storageRemove(STATE_KEY);
        return;
      }
      storageSet(STATE_KEY, JSON.stringify({ routeKey, checkpoint, items }));
    }

    function setStatus(message) {
      lastStatus = String(message || '');
      emitChange();
    }

    function clearStatus() {
      if (!lastStatus) return;
      lastStatus = '';
      emitChange();
    }

    function loadPersistedState() {
      try {
        const settings = JSON.parse(storageGet(SETTINGS_KEY) || 'null');
        if (settings?.delayMs) delayMs = normalizeDelayMs(settings.delayMs);
        if (typeof settings?.checkpointText === 'string') checkpointText = settings.checkpointText;
      } catch (_) {}

      // v1 stored the old "send whatever is currently in ChatGPT composer" job.
      // It is intentionally not migrated into the new fixed-checkpoint model.
      storageRemove(LEGACY_STATE_KEY);

      try {
        const saved = JSON.parse(storageGet(STATE_KEY) || 'null');
        if (!saved) return;
        const routeKey = currentRouteKey();
        if (String(saved.routeKey || '') !== routeKey) {
          storageRemove(STATE_KEY);
          return;
        }

        const checkpoint = saved.checkpoint;
        if (checkpoint) {
          const text = String(checkpoint.text || '').trim();
          const deadline = Number(checkpoint.deadline);
          if (text && Number.isFinite(deadline) && String(checkpoint.routeKey || '') === routeKey) {
            checkpointJob = {
              phase: 'waiting',
              deadline,
              text,
              expectedNormalized: normalizeText(text),
              routeKey
            };
          }
        }

        const rawItems = Array.isArray(saved.items) ? saved.items : [];
        scheduledItems = rawItems.flatMap(item => {
          const text = String(item?.text || '').trim();
          const deadline = Number(item?.deadline);
          if (!text || !Number.isFinite(deadline) || String(item?.routeKey || '') !== routeKey) return [];
          return [{
            id: String(item.id || makeId()),
            text,
            expectedNormalized: normalizeText(text),
            deadline,
            routeKey,
            state: item.state === 'uncertain' ? 'uncertain' : 'waiting',
            createdAt: Number(item.createdAt) || now()
          }];
        });
      } catch (_) {
        checkpointJob = null;
        scheduledItems = [];
        storageRemove(STATE_KEY);
      }
    }

    function setDelayMs(value) {
      delayMs = normalizeDelayMs(value);
      lastStatus = '';
      persistSettings();
      emitChange();
      return delayMs;
    }

    function setDelayMinutes(value) {
      const next = delayMinutesToMs(value);
      if (next === null) {
        setStatus('Введите количество минут больше нуля.');
        return false;
      }
      delayMs = next;
      lastStatus = '';
      persistSettings();
      emitChange();
      return delayMs;
    }

    function setCheckpointText(value) {
      checkpointText = String(value ?? '');
      persistSettings();
      return checkpointText;
    }

    function armCheckpoint() {
      if (checkpointJob) return false;
      const text = String(checkpointText || '').trim();
      if (!text) {
        setStatus('Введите текст чекпоинта перед запуском таймера.');
        return false;
      }
      const timestamp = now();
      checkpointJob = {
        phase: 'waiting',
        deadline: timestamp + delayMs,
        text,
        expectedNormalized: normalizeText(text),
        routeKey: currentRouteKey()
      };
      lastStatus = '';
      lastRenderSignature = '';
      persistState();
      emitChange();
      console.info(`[ChatGPT notifier] Чекпоинт поставлен на ${formatDelayedRemaining(delayMs)}.`);
      return true;
    }

    function cancelCheckpoint(message = 'Таймер чекпоинта снят.') {
      if (!checkpointJob) return false;
      if (activeSend?.kind === 'checkpoint') {
        setStatus('Чекпоинт уже начал отправляться; отмена на этом этапе заблокирована.');
        return false;
      }
      checkpointJob = null;
      lastRenderSignature = '';
      persistState();
      setStatus(message);
      return true;
    }

    function toggleCheckpoint() {
      if (checkpointJob) return cancelCheckpoint();
      return armCheckpoint();
    }

    function addScheduled(text) {
      const value = String(text || '').trim();
      if (!value) {
        setStatus('Введите сообщение перед добавлением в отложенные.');
        return null;
      }
      const timestamp = now();
      const item = {
        id: makeId(),
        text: value,
        expectedNormalized: normalizeText(value),
        deadline: timestamp + delayMs,
        routeKey: currentRouteKey(),
        state: 'waiting',
        createdAt: timestamp
      };
      scheduledItems.push(item);
      lastStatus = '';
      lastRenderSignature = '';
      persistState();
      emitChange();
      console.info(`[ChatGPT notifier] Сообщение добавлено в отложенные на ${formatDelayedRemaining(delayMs)}.`);
      return item.id;
    }

    function removeScheduled(id) {
      const item = scheduledItems.find(entry => entry.id === id);
      if (!item) return false;
      if (activeSend?.kind === 'scheduled' && activeSend.itemId === id) {
        setStatus('Это сообщение уже начало отправляться; удаление на этом этапе заблокировано.');
        return false;
      }
      scheduledItems = scheduledItems.filter(entry => entry.id !== id);
      lastRenderSignature = '';
      persistState();
      emitChange();
      return true;
    }

    function currentGenerationActive() {
      try { return Boolean(isGenerationActive()); } catch (_) { return false; }
    }

    function currentPipelineBusy() {
      try { return Boolean(isSendPipelineBusy()); } catch (_) { return false; }
    }

    function markTargetClickInFlight() {
      if (!activeSend) return;
      if (activeSend.kind === 'checkpoint') {
        if (checkpointJob) checkpointJob.phase = 'confirm';
      } else {
        const item = scheduledItems.find(entry => entry.id === activeSend.itemId);
        if (item) item.state = 'uncertain';
      }
      persistState();
    }

    function restoreTargetAfterClickFailure() {
      if (!activeSend) return;
      if (activeSend.kind === 'checkpoint') {
        if (checkpointJob) checkpointJob.phase = 'waiting';
      } else {
        const item = scheduledItems.find(entry => entry.id === activeSend.itemId);
        if (item) item.state = 'waiting';
      }
      persistState();
    }

    function clickActiveSend(context, timestamp, { retry = false } = {}) {
      if (!activeSend) return false;
      const composer = context?.composer;
      const sendButton = context?.sendButton;
      if (!composer || !isSendReady(sendButton) || sendButton?.isConnected === false) return false;
      const currentNormalized = normalizeText(readText(composer));
      if (!currentNormalized || currentNormalized !== activeSend.expectedNormalized) return false;

      activeSend.phase = 'confirm';
      activeSend.clickCount += 1;
      activeSend.clickedAt ||= timestamp;
      activeSend.lastClickAt = timestamp;
      activeSend.clickedComposer = composer;
      activeSend.clickedButton = sendButton;
      markTargetClickInFlight();
      emitChange();

      console.info(
        `[ChatGPT notifier] Нажимаю штатный Send для ${activeSend.kind === 'checkpoint' ? 'чекпоинта' : 'отложенного сообщения'}` +
        `${retry ? ` повторно (${activeSend.clickCount}/${SEND_MAX_CLICKS})` : ''}.`
      );
      try {
        sendButton.click();
      } catch (error) {
        console.warn('[ChatGPT notifier] Ошибка штатного Send по таймеру:', error);
        activeSend.phase = 'prepare';
        restoreTargetAfterClickFailure();
        return false;
      }
      return true;
    }

    function finishActiveSend(reason) {
      const job = activeSend;
      if (!job) return false;
      if (job.kind === 'checkpoint') {
        checkpointJob = null;
        lastStatus = 'Чекпоинт отправлен.';
      } else {
        scheduledItems = scheduledItems.filter(item => item.id !== job.itemId);
        lastStatus = '';
      }
      activeSend = null;
      lastRenderSignature = '';
      persistState();
      emitChange();
      console.info(`[ChatGPT notifier] Отложенная отправка подтверждена (${reason}).`);
      return true;
    }

    function failActiveSend() {
      const job = activeSend;
      if (!job) return false;
      if (job.kind === 'checkpoint') {
        checkpointJob = null;
        lastStatus = 'Не удалось подтвердить отправку чекпоинта; автоматически повторять не буду.';
      } else {
        const item = scheduledItems.find(entry => entry.id === job.itemId);
        if (item) item.state = 'uncertain';
        lastStatus = 'Одну отложенную отправку не удалось подтвердить. Она помечена «?» и автоматически повторяться не будет.';
      }
      activeSend = null;
      lastRenderSignature = '';
      persistState();
      emitChange();
      return false;
    }

    function processActiveSend(timestamp) {
      const job = activeSend;
      if (!job) return false;

      if (job.phase === 'confirm') {
        const clickedComposer = job.clickedComposer;
        const clickedComposerConnected = Boolean(clickedComposer && clickedComposer.isConnected !== false);
        const clickedComposerHasText = clickedComposerConnected
          ? Boolean(normalizeText(readText(clickedComposer)))
          : true;
        const confirmation = evaluateDelayedSendConfirmation({
          generationActive: currentGenerationActive(),
          clickedComposerConnected,
          clickedComposerHasText
        });
        if (confirmation.confirmed) return finishActiveSend(confirmation.reason);

        if (timestamp - job.clickedAt >= SEND_CONFIRM_TIMEOUT_MS) return failActiveSend();
        if (timestamp - job.lastClickAt < SEND_RETRY_DELAY_MS || job.clickCount >= SEND_MAX_CLICKS) return false;
        if (currentGenerationActive() || currentPipelineBusy()) return false;

        const context = resolveContext();
        const currentNormalized = normalizeText(readText(context?.composer));
        if (!context?.composer || currentNormalized !== job.expectedNormalized || !isSendReady(context.sendButton)) return false;
        return clickActiveSend(context, timestamp, { retry: true });
      }

      if (currentGenerationActive() || currentPipelineBusy()) return false;
      const context = resolveContext();
      const composer = context?.composer;
      if (!composer) return false;

      const currentNormalized = normalizeText(readText(composer));
      if (!job.insertedByScript) {
        if (currentNormalized) return false; // Never overwrite unrelated user text.
        if (!setText(composer, job.text)) return false;
        job.insertedByScript = true;
        emitChange();
        return false;
      }

      if (currentNormalized !== job.expectedNormalized) {
        // The native editor can be replaced or edited after our insertion. Never
        // overwrite the differing text; release ownership and wait for an empty
        // composer before inserting the stored message again.
        job.insertedByScript = false;
        return false;
      }
      if (!isSendReady(context.sendButton)) return false;
      return clickActiveSend(context, timestamp);
    }

    function dueCandidate(timestamp) {
      const candidates = [];
      if (checkpointJob?.phase === 'waiting' && checkpointJob.deadline <= timestamp) {
        candidates.push({ kind: 'checkpoint', deadline: checkpointJob.deadline, text: checkpointJob.text, expectedNormalized: checkpointJob.expectedNormalized });
      }
      for (const item of scheduledItems) {
        if (item.state !== 'waiting' || item.deadline > timestamp) continue;
        candidates.push({ kind: 'scheduled', itemId: item.id, deadline: item.deadline, text: item.text, expectedNormalized: item.expectedNormalized });
      }
      candidates.sort((a, b) => a.deadline - b.deadline);
      return candidates[0] || null;
    }

    function startCandidate(candidate, timestamp) {
      activeSend = {
        ...candidate,
        phase: 'prepare',
        startedAt: timestamp,
        clickedAt: 0,
        lastClickAt: 0,
        clickCount: 0,
        insertedByScript: false,
        clickedComposer: null,
        clickedButton: null
      };
      emitChange();
      return processActiveSend(timestamp);
    }

    function noteRemaining(timestamp) {
      const checkpointSecond = checkpointJob?.phase === 'waiting'
        ? Math.max(0, Math.ceil((checkpointJob.deadline - timestamp) / 1000))
        : -1;
      const itemSignature = scheduledItems
        .map(item => `${item.id}:${item.state}:${item.state === 'waiting' ? Math.max(0, Math.ceil((item.deadline - timestamp) / 1000)) : -1}`)
        .join('|');
      const signature = `${checkpointSecond}::${itemSignature}::${activeSend?.kind || ''}:${activeSend?.itemId || ''}:${activeSend?.phase || ''}`;
      if (signature === lastRenderSignature) return;
      lastRenderSignature = signature;
      emitChange();
    }

    function check(timestamp = now()) {
      const routeKey = currentRouteKey();
      if ((checkpointJob && checkpointJob.routeKey !== routeKey) || scheduledItems.some(item => item.routeKey !== routeKey)) {
        return resetForNavigation();
      }

      noteRemaining(timestamp);
      if (activeSend) return processActiveSend(timestamp);
      const candidate = dueCandidate(timestamp);
      if (!candidate) return false;
      return startCandidate(candidate, timestamp);
    }

    function resetForNavigation() {
      checkpointJob = null;
      scheduledItems = [];
      activeSend = null;
      lastStatus = '';
      lastRenderSignature = '';
      storageRemove(STATE_KEY);
      emitChange();
      return true;
    }

    function getCheckpointRemainingMs(timestamp = now()) {
      if (!checkpointJob) return 0;
      return Math.max(0, checkpointJob.deadline - timestamp);
    }

    function getCheckpointRemainingLabel(timestamp = now()) {
      return checkpointJob ? formatDelayedRemaining(getCheckpointRemainingMs(timestamp)) : '';
    }

    function getScheduledItems(timestamp = now()) {
      return scheduledItems.map(item => ({
        id: item.id,
        text: item.text,
        deadline: item.deadline,
        state: item.state,
        createdAt: item.createdAt,
        remainingMs: item.state === 'waiting' ? Math.max(0, item.deadline - timestamp) : 0,
        remainingLabel: item.state === 'waiting' ? formatDelayedRemaining(Math.max(0, item.deadline - timestamp)) : '?'
      }));
    }

    function hasDueWork(timestamp = now()) {
      return Boolean(dueCandidate(timestamp));
    }

    loadPersistedState();

    return {
      setDelayMs,
      setDelayMinutes,
      getDelayMs: () => delayMs,
      getDelayMinutes: () => formatDelayMinutes(delayMs),
      setCheckpointText,
      getCheckpointText: () => checkpointText,
      armCheckpoint,
      cancelCheckpoint,
      toggleCheckpoint,
      addScheduled,
      removeScheduled,
      getScheduledItems,
      getScheduledCount: () => scheduledItems.length,
      hasDueWork,
      check,
      resetForNavigation,
      getCheckpointRemainingMs,
      getCheckpointRemainingLabel,
      getCheckpointDeadline: () => checkpointJob?.deadline || 0,
      getLastStatus: () => lastStatus,
      clearStatus,
      isCheckpointActive: () => Boolean(checkpointJob),
      isSending: () => Boolean(activeSend),
      isConfirmingSend: () => activeSend?.phase === 'confirm',
      // Compatibility aliases for older callers/tests.
      arm: armCheckpoint,
      toggle: toggleCheckpoint,
      cancel: cancelCheckpoint,
      getRemainingMs: getCheckpointRemainingMs,
      getRemainingLabel: getCheckpointRemainingLabel,
      getDeadline: () => checkpointJob?.deadline || 0,
      isActive: () => Boolean(checkpointJob)
    };
  }

  return {
    DEFAULT_DELAY_MS,
    MIN_DELAY_MS,
    MAX_DELAY_MS,
    normalizeDelayMs,
    delayMinutesToMs,
    formatDelayMinutes,
    formatDelayedRemaining,
    evaluateDelayedSendConfirmation,
    createDelayedSendController
  };
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

  const UI_WIDTH = 114;
  const UI_HEIGHT = 34;
  const VIEWPORT_MARGIN = 6;
  const DRAG_THRESHOLD_PX = 8;

  function clampFloatingPosition(position, viewportWidth, viewportHeight) {
    const maxLeft = Math.max(VIEWPORT_MARGIN, viewportWidth - UI_WIDTH - VIEWPORT_MARGIN);
    const maxTop = Math.max(VIEWPORT_MARGIN, viewportHeight - UI_HEIGHT - VIEWPORT_MARGIN);
    return {
      left: Math.min(Math.max(VIEWPORT_MARGIN, Number(position?.left) || VIEWPORT_MARGIN), maxLeft),
      top: Math.min(Math.max(VIEWPORT_MARGIN, Number(position?.top) || VIEWPORT_MARGIN), maxTop)
    };
  }

  function createUploadButtonUi({ tabState, uploadController, queuedPromptController, delayedSendController }) {
    let repositionTimer = null;
    let suppressClickUntil = 0;
    let dragState = null;
    let draggedItemId = null;

    function viewportSize() {
      return {
        width: Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1),
        height: Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1)
      };
    }

    function loadPosition() {
      try {
        const parsed = JSON.parse(localStorage.getItem(deps.FLOATING_UI_POSITION_KEY) || 'null');
        if (Number.isFinite(parsed?.left) && Number.isFinite(parsed?.top)) return parsed;
      } catch (_) {}
      return null;
    }

    function savePosition(position) {
      try { localStorage.setItem(deps.FLOATING_UI_POSITION_KEY, JSON.stringify(position)); }
      catch (_) {}
    }

    function setHostPosition(host, position, { persist = false } = {}) {
      const viewport = viewportSize();
      const next = clampFloatingPosition(position, viewport.width, viewport.height);
      host.style.left = `${Math.round(next.left)}px`;
      host.style.top = `${Math.round(next.top)}px`;
      if (persist) savePosition(next);
      return next;
    }

    function chooseInitialPosition() {
      const composer = deps.findComposer();
      const box = composer ? deps.findComposerBox(composer) : null;
      const viewport = viewportSize();
      if (box) {
        return clampFloatingPosition({ left: box.left + 10, top: box.bottom - 44 }, viewport.width, viewport.height);
      }
      return clampFloatingPosition({ left: 16, top: viewport.height - UI_HEIGHT - 72 }, viewport.width, viewport.height);
    }

    function clickWasDrag(event) {
      if (Date.now() >= suppressClickUntil) return false;
      event.preventDefault();
      event.stopPropagation();
      return true;
    }

    function positionPanel(host, panel) {
      if (!panel || panel.hidden) return;
      const viewport = viewportSize();
      const hostRect = host.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const panelWidth = Math.min(panelRect.width || 430, Math.max(240, viewport.width - 24));
      const panelHeight = panelRect.height || 330;

      let left = 0;
      if (hostRect.left + panelWidth > viewport.width - 12) {
        left = viewport.width - 12 - hostRect.left - panelWidth;
      }
      left = Math.max(12 - hostRect.left, left);
      panel.style.left = `${Math.round(left)}px`;

      if (hostRect.top >= panelHeight + 12) {
        panel.style.top = 'auto';
        panel.style.bottom = '44px';
      } else {
        panel.style.bottom = 'auto';
        panel.style.top = '44px';
      }
    }

    function renderQueueList(ui) {
      const controller = queuedPromptController;
      if (!controller) return;

      const items = controller.getItems();
      const pendingIds = new Set(controller.getPendingIds());
      const sending = controller.isWaitingToSend();
      ui.list.replaceChildren();

      items.forEach((item, index) => {
        const row = document.createElement('div');
        row.className = 'queue-item';
        row.dataset.pending = String(pendingIds.has(item.id));

        const drag = document.createElement('span');
        drag.className = 'drag-handle';
        drag.textContent = '☰';
        drag.title = 'Перетащить сообщение';
        drag.draggable = !sending;

        const number = document.createElement('span');
        number.className = 'number';
        number.textContent = String(index + 1);

        const text = document.createElement('span');
        text.className = 'queue-text';
        text.textContent = item.text;
        text.title = item.text;

        const up = document.createElement('button');
        up.type = 'button';
        up.className = 'item-action';
        up.textContent = '↑';
        up.title = 'Переместить выше';
        up.disabled = sending || index === 0;
        up.addEventListener('click', () => queuedPromptController.move(item.id, -1));

        const down = document.createElement('button');
        down.type = 'button';
        down.className = 'item-action';
        down.textContent = '↓';
        down.title = 'Переместить ниже';
        down.disabled = sending || index === items.length - 1;
        down.addEventListener('click', () => queuedPromptController.move(item.id, 1));

        const send = document.createElement('button');
        send.type = 'button';
        send.className = 'item-action send-one';
        send.textContent = pendingIds.has(item.id) ? '…' : '▶';
        send.title = 'Отправить это сообщение сейчас через обычное поле ChatGPT';
        send.disabled = sending;
        send.addEventListener('click', () => queuedPromptController.sendNow(item.id));

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'item-action remove';
        remove.textContent = '×';
        remove.title = 'Удалить из очереди';
        remove.disabled = pendingIds.has(item.id);
        remove.addEventListener('click', () => queuedPromptController.remove(item.id));

        drag.addEventListener('dragstart', event => {
          if (sending) { event.preventDefault(); return; }
          draggedItemId = item.id;
          row.dataset.dragging = 'true';
          try { event.dataTransfer.effectAllowed = 'move'; } catch (_) {}
        });
        drag.addEventListener('dragend', () => {
          draggedItemId = null;
          row.dataset.dragging = 'false';
          for (const element of ui.list.querySelectorAll('.queue-item')) delete element.dataset.drop;
        });
        row.addEventListener('dragover', event => {
          if (!draggedItemId || draggedItemId === item.id || sending) return;
          event.preventDefault();
          const rect = row.getBoundingClientRect();
          row.dataset.drop = event.clientY >= rect.top + rect.height / 2 ? 'after' : 'before';
          try { event.dataTransfer.dropEffect = 'move'; } catch (_) {}
        });
        row.addEventListener('dragleave', event => {
          if (!row.contains(event.relatedTarget)) delete row.dataset.drop;
        });
        row.addEventListener('drop', event => {
          if (!draggedItemId || draggedItemId === item.id || sending) return;
          event.preventDefault();
          const placeAfter = row.dataset.drop === 'after';
          queuedPromptController.moveRelative(draggedItemId, item.id, placeAfter);
          draggedItemId = null;
        });

        row.append(drag, number, text, up, down, send, remove);
        ui.list.appendChild(row);
      });

      ui.empty.style.display = items.length ? 'none' : 'block';
      ui.sendAll.style.display = items.length ? 'block' : 'none';
      ui.sendAll.disabled = sending;
      ui.add.disabled = sending;
      ui.fromChat.disabled = sending;
      ui.sendAll.textContent = items.length > 1
        ? `Отправить всё одним сообщением (${items.length})`
        : 'Отправить всё одним сообщением';

      const status = controller.getLastStatus();
      ui.status.textContent = status;
      ui.status.style.display = status ? 'block' : 'none';

      const count = controller.getCount();
      ui.badge.textContent = String(count);
      ui.badge.style.display = count ? 'flex' : 'none';
      ui.queueButton.dataset.active = String(count > 0);
      ui.queueButton.dataset.sending = String(sending);
      ui.queueButton.title = sending
        ? `ChatGPT notifier v${deps.SCRIPT_VERSION} · Очередь: ${count}. Сейчас выполняется отправка.`
        : count
          ? `ChatGPT notifier v${deps.SCRIPT_VERSION} · Очередь сообщений: ${count}`
          : `ChatGPT notifier v${deps.SCRIPT_VERSION} · Открыть очередь сообщений`;
    }

    function renderDelayedList(ui) {
      const items = delayedSendController?.getScheduledItems?.() || [];
      ui.delayedList.replaceChildren();

      items.forEach((item, index) => {
        const row = document.createElement('div');
        row.className = 'delayed-item';
        row.dataset.state = item.state || 'waiting';

        const number = document.createElement('span');
        number.className = 'number';
        number.textContent = String(index + 1);

        const text = document.createElement('span');
        text.className = 'queue-text';
        text.textContent = item.text;
        text.title = item.text;

        const time = document.createElement('span');
        time.className = 'delayed-time';
        time.textContent = item.state === 'uncertain' ? '?' : item.remainingLabel;
        time.title = item.state === 'uncertain'
          ? 'Отправка была начата, но результат не удалось надёжно подтвердить. Автоповтора нет.'
          : `Осталось: ${item.remainingLabel}`;

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'item-action remove';
        remove.textContent = '×';
        remove.title = 'Удалить из отложенных';
        remove.addEventListener('click', () => delayedSendController?.removeScheduled?.(item.id));

        row.append(number, text, time, remove);
        ui.delayedList.appendChild(row);
      });

      ui.delayedSection.style.display = items.length ? 'block' : 'none';
    }

    function ensureUi() {
      let host = document.getElementById(deps.UPLOAD_HOST_ID);
      if (host?.shadowRoot?.querySelector('[data-role="delay-send"]')) {
        return {
          host,
          row: host.shadowRoot.querySelector('.row'),
          delayButton: host.shadowRoot.querySelector('[data-role="delay-send"]'),
          queueButton: host.shadowRoot.querySelector('[data-role="queue"]'),
          autoButton: host.shadowRoot.querySelector('[data-role="auto-send"]'),
          timerChip: host.shadowRoot.querySelector('.timer-chip'),
          badge: host.shadowRoot.querySelector('.badge'),
          panel: host.shadowRoot.querySelector('.panel'),
          list: host.shadowRoot.querySelector('.queue-list'),
          empty: host.shadowRoot.querySelector('.empty'),
          status: host.shadowRoot.querySelector('.status'),
          timerStatus: host.shadowRoot.querySelector('.timer-status'),
          delaySelect: host.shadowRoot.querySelector('.delay-select'),
          delayMinutes: host.shadowRoot.querySelector('.delay-minutes'),
          checkpointInput: host.shadowRoot.querySelector('.checkpoint-input'),
          delayedSection: host.shadowRoot.querySelector('.delayed-section'),
          delayedList: host.shadowRoot.querySelector('.delayed-list'),
          sendAll: host.shadowRoot.querySelector('.send-all'),
          textarea: host.shadowRoot.querySelector('.queue-input'),
          add: host.shadowRoot.querySelector('.add'),
          scheduleLater: host.shadowRoot.querySelector('.schedule-later'),
          fromChat: host.shadowRoot.querySelector('.from-chat'),
          versionChip: host.shadowRoot.querySelector('.version-chip'),
          panelVersion: host.shadowRoot.querySelector('.panel-version')
        };
      }

      host?.remove();
      host = document.createElement('div');
      host.id = deps.UPLOAD_HOST_ID;
      Object.assign(host.style, {
        position: 'fixed', left: '16px', top: '16px', width: `${UI_WIDTH}px`, height: `${UI_HEIGHT}px`,
        zIndex: '2147483646', pointerEvents: 'auto', display: 'block', overflow: 'visible'
      });
      document.documentElement.appendChild(host);

      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = `
        <style>
          :host { all: initial; }
          * { box-sizing: border-box; }
          .row {
            display:flex; gap:6px; align-items:center; width:${UI_WIDTH}px; height:${UI_HEIGHT}px;
            pointer-events:auto; touch-action:none; user-select:none; cursor:grab; position:relative;
          }
          .row[data-dragging="true"] { cursor:grabbing; }
          .control {
            width:34px; height:34px; padding:0; border-radius:999px;
            border:1px solid rgba(128,128,128,.24); background:rgba(32,32,32,.88);
            color:#fff; font:16px/1 system-ui,sans-serif; display:inline-flex;
            align-items:center; justify-content:center; cursor:inherit;
            pointer-events:auto; box-shadow:0 2px 10px rgba(0,0,0,.24);
            -webkit-user-select:none; user-select:none;
          }
          .control:hover { filter:brightness(1.12); }
          .control[data-active="true"] { opacity:1; }
          [data-role="auto-send"][data-active="true"] {
            background:#2563eb; border-color:#2563eb;
            box-shadow:0 0 0 2px rgba(37,99,235,.18),0 2px 10px rgba(0,0,0,.24);
          }
          [data-role="auto-send"][data-active="false"] { opacity:.72; }
          [data-role="delay-send"] { font-size:18px; }
          [data-role="delay-send"][data-active="true"] { background:#383838; border-color:rgba(255,255,255,.25); }
          [data-role="queue"] { font-size:24px; font-weight:300; position:relative; }
          [data-role="queue"][data-active="true"] { background:#383838; border-color:rgba(255,255,255,.25); }
          [data-role="queue"][data-sending="true"] { animation:pulse .8s ease-in-out infinite alternate; }
          @keyframes pulse { from { opacity:.62; } to { opacity:1; } }
          .badge {
            position:absolute; left:24px; top:-7px; min-width:17px; height:17px; padding:0 4px;
            display:none; align-items:center; justify-content:center; border-radius:10px;
            background:#6d5dfc; color:#fff; font:600 10px/1 system-ui,sans-serif;
            pointer-events:none; box-shadow:0 1px 4px rgba(0,0,0,.35);
          }
          .meta-chip {
            position:absolute; top:-22px; height:17px; padding:0 6px;
            display:inline-flex; align-items:center; justify-content:center; white-space:nowrap;
            border:1px solid rgba(128,128,128,.24); border-radius:999px;
            background:rgba(32,32,32,.88); color:rgba(255,255,255,.62);
            font:600 9px/1 system-ui,sans-serif; pointer-events:none;
            box-shadow:0 2px 8px rgba(0,0,0,.18);
          }
          .version-chip { left:44px; }
          .timer-chip { left:-4px; display:none; }
          .panel {
            position:absolute; left:0; bottom:44px; width:min(430px, calc(100vw - 24px));
            pointer-events:auto; font:13px/1.35 system-ui,sans-serif; color:#fff;
          }
          .panel[hidden] { display:none; }
          .panel-header {
            display:flex; align-items:center; justify-content:space-between; gap:8px;
            margin:0 0 7px; padding:7px 9px; border:1px solid rgba(128,128,128,.24);
            border-radius:10px; background:rgba(40,40,40,.98);
            color:rgba(255,255,255,.78); font:600 11px/1.2 system-ui,sans-serif;
          }
          .panel-version { color:rgba(255,255,255,.48); font-weight:700; }
          .queue-list { max-height:220px; overflow-y:auto; margin-bottom:7px; scrollbar-width:thin; }
          .queue-item {
            display:flex; align-items:center; gap:7px; min-height:42px;
            padding:7px 8px 7px 9px; margin-bottom:5px;
            border:1px solid rgba(128,128,128,.28); border-radius:11px;
            background:rgba(48,48,48,.98); box-shadow:0 4px 14px rgba(0,0,0,.22);
          }
          .queue-item[data-pending="true"] { border-color:rgba(109,93,252,.72); }
          .queue-item[data-drop="before"] { box-shadow:inset 0 2px 0 #6d5dfc,0 4px 14px rgba(0,0,0,.22); }
          .queue-item[data-drop="after"] { box-shadow:inset 0 -2px 0 #6d5dfc,0 4px 14px rgba(0,0,0,.22); }
          .queue-item[data-dragging="true"] { opacity:.42; }
          .drag-handle { width:18px; flex:0 0 18px; color:rgba(255,255,255,.34); cursor:grab; user-select:none; font:13px/1 system-ui,sans-serif; text-align:center; }
          .drag-handle:active { cursor:grabbing; }
          .number { width:18px; flex:0 0 18px; opacity:.46; font:11px/1 system-ui,sans-serif; text-align:center; }
          .queue-text { flex:1; min-width:0; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; font:13px/1.35 system-ui,sans-serif; }
          .item-action {
            width:27px; height:27px; flex:0 0 27px; padding:0; border:0; border-radius:7px;
            background:transparent; color:#aaa; font:14px/1 system-ui,sans-serif; cursor:pointer;
          }
          .item-action:hover:not(:disabled) { background:rgba(255,255,255,.10); color:#fff; }
          .item-action.send-one:hover:not(:disabled) { background:rgba(109,93,252,.52); }
          .item-action.remove:hover:not(:disabled) { background:rgba(127,45,45,.58); }
          .item-action:disabled { opacity:.45; cursor:default; }
          .empty { display:none; margin-bottom:7px; padding:9px; border:1px dashed rgba(128,128,128,.22); border-radius:10px; color:rgba(255,255,255,.38); text-align:center; }
          .send-all {
            display:none; width:100%; margin:0 0 7px; padding:8px 10px;
            border:1px solid rgba(128,128,128,.28); border-radius:10px;
            background:rgba(48,48,48,.98); color:#ddd; font:12px/1.2 system-ui,sans-serif;
            cursor:pointer; box-shadow:0 4px 14px rgba(0,0,0,.16);
          }
          .send-all:hover:not(:disabled) { background:rgba(58,58,58,.98); color:#fff; }
          .send-all:disabled { opacity:.5; cursor:default; }
          .delay-settings {
            margin:0 0 7px; padding:8px 9px; border:1px solid rgba(128,128,128,.24); border-radius:10px;
            background:rgba(40,40,40,.98); color:rgba(255,255,255,.72);
          }
          .delay-settings-row { display:flex; align-items:center; gap:8px; }
          .delay-settings-title { font:600 11px/1.2 system-ui,sans-serif; white-space:nowrap; }
          .delay-select {
            margin-left:auto; min-width:106px; padding:5px 7px; border:1px solid rgba(128,128,128,.28); border-radius:7px;
            background:rgba(30,30,30,.98); color:#eee; font:11px/1.2 system-ui,sans-serif; outline:none;
          }
          .delay-manual-row { display:flex; align-items:center; gap:7px; margin-top:7px; }
          .delay-manual-label { color:rgba(255,255,255,.50); font:10px/1.2 system-ui,sans-serif; }
          .delay-minutes {
            width:76px; margin-left:auto; padding:5px 7px; border:1px solid rgba(128,128,128,.28); border-radius:7px;
            background:rgba(30,30,30,.98); color:#eee; font:11px/1.2 system-ui,sans-serif; outline:none;
          }
          .delay-unit { color:rgba(255,255,255,.46); font:10px/1 system-ui,sans-serif; }
          .delay-note { margin-top:5px; color:rgba(255,255,255,.34); font:10px/1.25 system-ui,sans-serif; }
          .checkpoint-label { margin-top:8px; color:rgba(255,255,255,.62); font:600 10px/1.2 system-ui,sans-serif; }
          textarea { display:block; width:100%; min-height:66px; max-height:190px; resize:vertical; padding:4px 4px 7px; border:0; outline:none; background:transparent; color:#fff; font:13px/1.42 system-ui,sans-serif; }
          textarea::placeholder { color:rgba(255,255,255,.36); }
          .checkpoint-input {
            min-height:52px; max-height:120px; margin-top:5px; padding:7px 8px; border:1px solid rgba(128,128,128,.24);
            border-radius:8px; background:rgba(30,30,30,.72); font-size:11px;
          }
          .timer-status { display:none; margin-top:6px; color:rgba(255,255,255,.58); font:10px/1.3 system-ui,sans-serif; }
          .delayed-section { display:none; margin:0 0 7px; }
          .section-title { margin:0 0 5px; color:rgba(255,255,255,.54); font:600 10px/1.2 system-ui,sans-serif; }
          .delayed-list { max-height:150px; overflow-y:auto; scrollbar-width:thin; }
          .delayed-item {
            display:flex; align-items:center; gap:7px; min-height:38px; margin-bottom:5px; padding:6px 8px;
            border:1px solid rgba(128,128,128,.24); border-radius:10px; background:rgba(43,43,43,.98);
          }
          .delayed-item[data-state="uncertain"] { border-color:rgba(202,153,58,.62); }
          .delayed-time { flex:0 0 auto; color:rgba(255,255,255,.62); font:600 10px/1 system-ui,sans-serif; }
          .composer { padding:9px; border:1px solid rgba(128,128,128,.28); border-radius:14px; background:rgba(30,30,30,.98); box-shadow:0 12px 34px rgba(0,0,0,.34); }
          .composer-bottom { display:flex; align-items:center; gap:7px; flex-wrap:wrap; }
          .actions-left { display:flex; align-items:center; gap:7px; min-width:0; flex-wrap:wrap; }
          .hint { margin-left:auto; color:rgba(255,255,255,.32); font:10px/1 system-ui,sans-serif; white-space:nowrap; }
          .add,.schedule-later,.from-chat {
            border:1px solid rgba(128,128,128,.28); border-radius:8px; padding:7px 11px; cursor:pointer;
            background:rgba(48,48,48,.98); color:#eee; font:600 12px/1 system-ui,sans-serif; white-space:nowrap;
          }
          .add:hover,.schedule-later:hover,.from-chat:hover { background:rgba(64,64,64,.98); color:#fff; }
          .schedule-later { background:rgba(48,58,78,.98); border-color:rgba(100,149,237,.34); }
          .schedule-later:hover { background:rgba(59,73,101,.98); }
          .from-chat { background:rgba(53,51,74,.98); border-color:rgba(109,93,252,.38); }
          .from-chat:hover { background:rgba(72,68,101,.98); }
          .add:disabled,.schedule-later:disabled,.from-chat:disabled { opacity:.48; cursor:default; }
          .status { display:none; margin:0 0 7px; padding:7px 9px; border-radius:9px; background:rgba(127,45,45,.38); color:#ffd7d7; font:11px/1.35 system-ui,sans-serif; }
        </style>

        <div class="panel" hidden>
          <div class="panel-header"><span>Очередь сообщений</span><span class="panel-version"></span></div>
          <div class="status"></div>
          <div class="empty">Очередь пуста</div>
          <div class="queue-list"></div>
          <button type="button" class="send-all">Отправить всё одним сообщением</button>
          <div class="delay-settings">
            <div class="delay-settings-row">
              <span class="delay-settings-title">Задержка</span>
              <select class="delay-select" aria-label="Время отложенной отправки">
                <option value="30000">30 сек</option>
                <option value="60000">1 мин</option>
                <option value="120000">2 мин</option>
                <option value="300000">5 мин</option>
                <option value="600000">10 мин</option>
                <option value="900000">15 мин</option>
                <option value="1800000">30 мин</option>
                <option value="3600000">1 час</option>
                <option value="custom">Своё время</option>
              </select>
            </div>
            <div class="delay-manual-row">
              <span class="delay-manual-label">Свои минуты</span>
              <input class="delay-minutes" type="text" inputmode="decimal" autocomplete="off" aria-label="Своё количество минут">
              <span class="delay-unit">мин</span>
            </div>
            <div class="delay-note">Эта задержка используется и для чекпоинта ◷, и для кнопки «Отправить позже». Спящая вкладка догонит просроченное после пробуждения.</div>
            <div class="checkpoint-label">Фиксированный текст чекпоинта для ◷</div>
            <textarea class="checkpoint-input" placeholder="Например: Проверь текущий прогресс и продолжай с последнего чекпоинта..."></textarea>
            <div class="timer-status"></div>
          </div>
          <div class="delayed-section">
            <div class="section-title">Отправятся позже</div>
            <div class="delayed-list"></div>
          </div>
          <div class="composer">
            <textarea class="queue-input" placeholder="Добавить следующее сообщение..."></textarea>
            <div class="composer-bottom">
              <div class="actions-left">
                <button type="button" class="add">В очередь</button>
                <button type="button" class="schedule-later">Отправить позже</button>
                <button type="button" class="from-chat" title="Перенести весь текст из обычного поля ChatGPT в очередь">Из чата → очередь</button>
              </div>
              <span class="hint">Ctrl/⌘ + Enter</span>
            </div>
          </div>
        </div>

        <div class="row" aria-label="ChatGPT notifier controls">
          <span class="meta-chip timer-chip"></span>
          <span class="meta-chip version-chip"></span>
          <button type="button" class="control" data-role="delay-send" aria-label="Чекпоинт по таймеру">◷</button>
          <button type="button" class="control" data-role="queue" aria-label="Очередь сообщений">+</button>
          <button type="button" class="control" data-role="auto-send" aria-label="Автоотправить после загрузки файлов">⇧</button>
          <span class="badge"></span>
        </div>`;

      const ui = {
        host,
        row: shadow.querySelector('.row'),
        delayButton: shadow.querySelector('[data-role="delay-send"]'),
        queueButton: shadow.querySelector('[data-role="queue"]'),
        autoButton: shadow.querySelector('[data-role="auto-send"]'),
        timerChip: shadow.querySelector('.timer-chip'),
        badge: shadow.querySelector('.badge'),
        panel: shadow.querySelector('.panel'),
        list: shadow.querySelector('.queue-list'),
        empty: shadow.querySelector('.empty'),
        status: shadow.querySelector('.status'),
        timerStatus: shadow.querySelector('.timer-status'),
        delaySelect: shadow.querySelector('.delay-select'),
        delayMinutes: shadow.querySelector('.delay-minutes'),
        checkpointInput: shadow.querySelector('.checkpoint-input'),
        delayedSection: shadow.querySelector('.delayed-section'),
        delayedList: shadow.querySelector('.delayed-list'),
        sendAll: shadow.querySelector('.send-all'),
        textarea: shadow.querySelector('.queue-input'),
        add: shadow.querySelector('.add'),
        scheduleLater: shadow.querySelector('.schedule-later'),
        fromChat: shadow.querySelector('.from-chat'),
        versionChip: shadow.querySelector('.version-chip'),
        panelVersion: shadow.querySelector('.panel-version')
      };

      ui.versionChip.textContent = `v${deps.SCRIPT_VERSION}`;
      ui.panelVersion.textContent = `v${deps.SCRIPT_VERSION}`;

      function addCurrent() {
        if (!queuedPromptController) return;
        const id = queuedPromptController.add(ui.textarea.value);
        if (!id) return;
        ui.textarea.value = '';
        render();
        setTimeout(() => ui.textarea.focus(), 0);
      }

      function scheduleCurrent() {
        const id = delayedSendController?.addScheduled?.(ui.textarea.value);
        if (!id) return;
        ui.textarea.value = '';
        render();
        setTimeout(() => ui.textarea.focus(), 0);
      }

      ui.row.addEventListener('pointerdown', event => {
        if (event.button !== 0 || !event.isPrimary) return;
        const rect = host.getBoundingClientRect();
        dragState = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          startLeft: rect.left,
          startTop: rect.top,
          moved: false
        };
      });

      ui.row.addEventListener('pointermove', event => {
        if (!dragState || dragState.pointerId !== event.pointerId) return;
        const dx = event.clientX - dragState.startX;
        const dy = event.clientY - dragState.startY;
        if (!dragState.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        dragState.moved = true;
        ui.row.dataset.dragging = 'true';
        ui.row.setPointerCapture?.(event.pointerId);
        event.preventDefault();
        setHostPosition(host, { left: dragState.startLeft + dx, top: dragState.startTop + dy });
        positionPanel(host, ui.panel);
      });

      function finishDrag(event) {
        if (!dragState || dragState.pointerId !== event.pointerId) return;
        const moved = dragState.moved;
        dragState = null;
        ui.row.dataset.dragging = 'false';
        try { ui.row.releasePointerCapture?.(event.pointerId); } catch (_) {}
        if (!moved) return;
        event.preventDefault();
        suppressClickUntil = Date.now() + 350;
        const rect = host.getBoundingClientRect();
        setHostPosition(host, { left: rect.left, top: rect.top }, { persist: true });
        positionPanel(host, ui.panel);
      }

      ui.row.addEventListener('pointerup', finishDrag);
      ui.row.addEventListener('pointercancel', finishDrag);

      ui.queueButton.addEventListener('click', event => {
        if (clickWasDrag(event)) return;
        event.preventDefault();
        event.stopPropagation();
        ui.panel.hidden = !ui.panel.hidden;
        render();
        if (!ui.panel.hidden) {
          setTimeout(() => {
            positionPanel(host, ui.panel);
            ui.textarea.focus();
          }, 0);
        }
      });

      ui.delayButton.addEventListener('click', event => {
        if (clickWasDrag(event)) return;
        event.preventDefault();
        event.stopPropagation();
        delayedSendController?.toggleCheckpoint?.();
        // The general UI scheduler is intentionally debounced for DOM churn, but
        // this control needs immediate visual feedback. Without this render a fast
        // second click can cancel the timer before the active state/chip ever appears.
        render();
      });

      ui.autoButton.addEventListener('click', event => {
        if (clickWasDrag(event)) return;
        event.preventDefault();
        event.stopPropagation();
        uploadController.toggle();
      });

      ui.delaySelect.addEventListener('change', () => {
        if (ui.delaySelect.value === 'custom') {
          ui.delayMinutes.focus();
          ui.delayMinutes.select?.();
          return;
        }
        delayedSendController?.setDelayMs(Number(ui.delaySelect.value));
        render();
      });

      function applyManualDelay() {
        const result = delayedSendController?.setDelayMinutes?.(ui.delayMinutes.value);
        if (result !== false) render();
      }

      ui.delayMinutes.addEventListener('change', applyManualDelay);
      ui.delayMinutes.addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        applyManualDelay();
        ui.delayMinutes.blur();
      });

      ui.checkpointInput.value = delayedSendController?.getCheckpointText?.() || '';
      ui.checkpointInput.addEventListener('input', () => {
        delayedSendController?.setCheckpointText?.(ui.checkpointInput.value);
      });

      ui.add.addEventListener('click', addCurrent);
      ui.scheduleLater.addEventListener('click', scheduleCurrent);
      ui.fromChat.addEventListener('click', () => queuedPromptController?.addFromComposer());
      ui.sendAll.addEventListener('click', () => queuedPromptController?.sendAllNow());
      ui.textarea.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          ui.panel.hidden = true;
          return;
        }
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          addCurrent();
        }
      });

      return ui;
    }

    function render() {
      const ui = ensureUi();
      const host = ui.host;
      host.style.display = 'block';

      let position = loadPosition();
      if (!position) {
        position = chooseInitialPosition();
        savePosition(position);
      }
      setHostPosition(host, position, { persist: true });

      const active = tabState.isUploadMarked();
      ui.autoButton.dataset.active = String(active);
      ui.autoButton.setAttribute('aria-pressed', String(active));
      ui.autoButton.title = active
        ? 'Жду окончания загрузки файлов и затем автоматически отправлю. Нажать ещё раз — отменить.'
        : 'Когда файлы загружаются: нажать, чтобы после завершения автоматически отправить сообщение';

      const delayActive = Boolean(delayedSendController?.isCheckpointActive?.());
      const remainingLabel = delayActive ? delayedSendController.getCheckpointRemainingLabel() : '';
      ui.delayButton.dataset.active = String(delayActive);
      ui.delayButton.setAttribute('aria-pressed', String(delayActive));
      ui.delayButton.title = delayActive
        ? `Чекпоинт через ${remainingLabel}. Нажать — снять таймер.`
        : 'Поставить таймер на фиксированный текст чекпоинта';
      ui.timerChip.textContent = remainingLabel;
      ui.timerChip.style.display = delayActive ? 'inline-flex' : 'none';
      const selectedDelay = String(delayedSendController?.getDelayMs?.() || 300000);
      const hasPreset = Array.from(ui.delaySelect.options).some(option => option.value === selectedDelay);
      const selectValue = hasPreset ? selectedDelay : 'custom';
      if (ui.delaySelect.value !== selectValue) ui.delaySelect.value = selectValue;
      const manualMinutes = delayedSendController?.getDelayMinutes?.() || '5';
      if (document.activeElement !== ui.delayMinutes && ui.delayMinutes.value !== String(manualMinutes)) {
        ui.delayMinutes.value = String(manualMinutes);
      }
      const checkpointText = delayedSendController?.getCheckpointText?.() || '';
      if (document.activeElement !== ui.checkpointInput && ui.checkpointInput.value !== checkpointText) {
        ui.checkpointInput.value = checkpointText;
      }
      const timerStatus = delayedSendController?.getLastStatus?.() || '';
      ui.timerStatus.textContent = timerStatus;
      ui.timerStatus.style.display = timerStatus ? 'block' : 'none';

      ui.versionChip.textContent = `v${deps.SCRIPT_VERSION}`;
      ui.panelVersion.textContent = `v${deps.SCRIPT_VERSION}`;
      renderQueueList(ui);
      renderDelayedList(ui);
      positionPanel(host, ui.panel);
    }

    function schedule() {
      if (repositionTimer !== null) return;
      repositionTimer = window.setTimeout(() => {
        repositionTimer = null;
        window.requestAnimationFrame(render);
      }, deps.SETTINGS.uiRepositionDelayMs);
    }

    function closeQueuePanel() {
      const host = document.getElementById(deps.UPLOAD_HOST_ID);
      const panel = host?.shadowRoot?.querySelector('.panel');
      if (panel) panel.hidden = true;
    }

    return { render, schedule, closeQueuePanel };
  }

  return { clampFloatingPosition, createUploadButtonUi };
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

  function createResponseMonitor({ tabState, notifications, beforeArm = () => {}, onFinished = () => {} }) {
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
      try { onFinished(); } catch (error) { console.warn('[ChatGPT notifier] Ошибка действия после завершения ответа:', error); }
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
    let uploadController = null;
    let queuedPromptController = null;
    let delayedSendController = null;

    function scheduleUi() {
      uploadUi?.schedule();
    }

    const tabState = deps.createTabStateController({ scheduleUiUpdate: scheduleUi });
    const notifications = deps.createNotificationService(tabState);

    const responseMonitor = deps.createResponseMonitor({
      tabState,
      notifications,
      beforeArm: () => {
        // A synthetic click from file auto-send reaches the same document click
        // listener as a manual Send. While that transaction is waiting for
        // confirmation it must stay armed; other sends still cancel file auto-send.
        if (uploadController?.isConfirmingSend()) return;
        if (tabState.isUploadMarked() || uploadController?.isArmed()) {
          uploadController?.reset({ clearMark: true, render: false, clearFileHistory: true });
        }
      },
      onFinished: () => {
        delayedSendController?.check();
        if (!delayedSendController?.isSending?.() && !delayedSendController?.hasDueWork?.()) {
          queuedPromptController?.handleResponseFinished();
        }
      }
    });

    uploadController = deps.createUploadAutoSendController({ tabState, isGenerationActive: deps.isGenerating });
    queuedPromptController = deps.createQueuedPromptController({ onChange: scheduleUi });
    delayedSendController = deps.createDelayedSendController({
      onChange: scheduleUi,
      isGenerationActive: deps.isGenerating,
      isSendPipelineBusy: () => Boolean(queuedPromptController?.isWaitingToSend() || uploadController?.isConfirmingSend())
    });
    uploadUi = deps.createUploadButtonUi({ tabState, uploadController, queuedPromptController, delayedSendController });
    let lastUrl = location.href;

    function recheckUploadSoon() {
      if (!uploadController?.isArmed()) return;
      uploadController.check();
      window.setTimeout(() => {
        if (uploadController?.isArmed()) uploadController.check();
      }, 250);
      window.setTimeout(() => {
        if (uploadController?.isArmed()) uploadController.check();
      }, 1200);
    }

    function handleFileInputEvent(event) {
      const input = event.target;
      if (typeof HTMLInputElement === 'undefined' || !(input instanceof HTMLInputElement) || input.type !== 'file') return;
      uploadController.rememberFileActivity(input.files);
      recheckUploadSoon();
    }

    document.addEventListener('input', handleFileInputEvent, true);
    document.addEventListener('change', handleFileInputEvent, true);

    document.addEventListener('drop', event => {
      if (!event.dataTransfer?.files?.length) return;
      uploadController.rememberFileActivity(event.dataTransfer.files);
      recheckUploadSoon();
    }, true);

    document.addEventListener('paste', event => {
      if (!event.clipboardData?.files?.length) return;
      uploadController.rememberFileActivity(event.clipboardData.files);
      recheckUploadSoon();
    }, true);

    document.addEventListener('click', event => {
      if (!deps.isComposerSendButton(event.target)) return;
      responseMonitor.armAnswer('send-button');
    }, true);

    document.addEventListener('keydown', event => {
      if (
        event.key === 'Enter' && !event.isComposing && !event.shiftKey && !event.ctrlKey &&
        !event.altKey && !event.metaKey && deps.isComposerTarget(event.target)
      ) {
        responseMonitor.armAnswer('enter-key');
      }
    }, true);

    document.addEventListener('submit', event => {
      if (typeof HTMLFormElement === 'undefined' || !(event.target instanceof HTMLFormElement)) return;
      if (!deps.COMPOSER_SELECTORS.some(selector => event.target.querySelector(selector))) return;
      responseMonitor.armAnswer('form-submit');
    }, true);

    function markViewed() {
      tabState.markViewed();
      responseMonitor.check();
    }

    function handleForeground() {
      markViewed();
      recheckUploadSoon();
      delayedSendController?.check();
      scheduleUi();
    }

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) handleForeground();
    });
    window.addEventListener('focus', handleForeground);
    window.addEventListener('pageshow', handleForeground);
    window.addEventListener('resize', scheduleUi, { passive: true });
    window.addEventListener('scroll', scheduleUi, { passive: true, capture: true });

    function resetForNavigation() {
      lastUrl = location.href;
      responseMonitor.resetForNavigation();
      uploadController.reset({ clearMark: true, render: false });
      uploadController.resetFileHistory();
      queuedPromptController.resetForNavigation();
      delayedSendController?.resetForNavigation();
      uploadUi.closeQueuePanel?.();
      tabState.resetForNavigation();
      setTimeout(responseMonitor.check, 400);
    }

    const uiObserver = new MutationObserver(() => {
      if (!document.hidden) scheduleUi();
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
      delayedSendController?.check();
      queuedPromptController.attemptSend();
      tickCount += 1;
      if (!document.hidden && tickCount % 6 === 0) scheduleUi();
    }, deps.SETTINGS.checkIntervalMs);

    if (typeof GM_registerMenuCommand === 'function') {
      GM_registerMenuCommand(`ℹ Версия: v${deps.SCRIPT_VERSION}`, () => console.info(`[ChatGPT notifier] v${deps.SCRIPT_VERSION}`));
      GM_registerMenuCommand('◷ Чекпоинт по таймеру', delayedSendController.toggleCheckpoint);
      GM_registerMenuCommand('⇧ Автоотправка после загрузки файлов', uploadController.toggle);
      GM_registerMenuCommand('● Проверить уведомление', notifications.showDesktopNotification);
    }

    tabState.render();
    responseMonitor.check();
    scheduleUi();
    console.info(`[ChatGPT notifier] v${deps.SCRIPT_VERSION} запущен. Перетаскиваемые кнопки: ◷ — чекпоинт по таймеру, + — очередь/отложенные, ⇧ — автоотправка файлов.`);

    return {
      dispose() {
        clearInterval(interval);
        uiObserver.disconnect();
      },
      tabState,
      uploadController,
      queuedPromptController,
      delayedSendController,
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
