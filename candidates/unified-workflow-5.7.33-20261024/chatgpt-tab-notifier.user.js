// ==UserScript==
// @name         ChatGPT — значки вкладок, загрузка файлов и уведомления
// @namespace    local.chatgpt.tab-notifier
// @version      5.7.33
// @description  Статусы вкладки + автоотправка файлов + очередь сообщений + отложенная отправка + перетаскиваемые кнопки
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-idle
// @grant        GM_notification
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_listValues
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
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

  const SCRIPT_VERSION = '5.7.33';

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

  const SYMBOLS = Object.freeze({ working: '⏳', fresh: '●', viewed: '✓', uploading: '⇧', idle: '',
    'observatory-working': '🔵', 'observatory-fresh': '🔷', 'observatory-viewed': '🔹' });
  const ALL_PREFIX_SYMBOLS = Object.freeze(['⏳', '🔔', '✓', '📤', '●', '⇧', '🔵', '🔷', '🔹', '🟡', '🟣', '🟢', '🔴', '⏸', '◌']);
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
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ChatGPTTabNotifier = Object.assign(root.ChatGPTTabNotifier || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const TASK_PALETTE = Object.freeze({ yellow: '#facc15', blue: '#60a5fa', purple: '#c084fc',
    green: '#4ade80', red: '#f87171' });
  const COLORS = { prepared: null, waiting_ai: 'yellow', activity_observed: 'yellow',
    working: 'blue', silent: 'purple', unknown: 'purple', completed: 'green', failed: 'red', blocked: null };
  const MARK = { yellow: '🟡', blue: '🔵', purple: '🟣', green: '🟢', red: '🔴' };
  const owns = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

  function validateTaskOverview(value, now = Date.now()) {
    if (!value || value.version !== 2 || value.basis !== 'latest_task' || value.available !== true || !value.counts ||
        typeof value.counts !== 'object' || !Number.isFinite(value.checked_at_unix) ||
        value.checked_at_unix <= 0 || value.checked_at_unix * 1000 > now + 30000 ||
        now - value.checked_at_unix * 1000 > 20000) return null;
    const counts = {};
    for (const key of Object.keys(COLORS)) {
      if (!Number.isSafeInteger(value.counts[key]) || value.counts[key] < 0 || value.counts[key] > 1000000) return null;
      counts[key] = value.counts[key];
    }
    const primary = value.primary_state;
    if (primary === null ? Object.values(counts).some(Boolean) :
        typeof primary !== 'string' || !owns(COLORS, primary) || counts[primary] === 0) return null;
    if (value.primary_state !== primary || value.primary_color !== (primary ? COLORS[primary] : null)) return null;
    const totals = { pending_count: counts.waiting_ai + counts.activity_observed, working_count: counts.working,
      silent_count: counts.silent + counts.unknown, blocked_count: counts.blocked, draft_count: counts.prepared,
      completed_count: counts.completed, failed_count: counts.failed };
    for (const [key, total] of Object.entries(totals)) if (value[key] !== total) return null;
    // Copy only public scalar metadata. No raw API object, title, text or keys.
    return { primary_state: primary, primary_color: value.primary_color,
      checked_at_unix: value.checked_at_unix, incomplete: value.incomplete === true, ...totals,
      current_pending: primary === 'waiting_ai' || primary === 'activity_observed' };
  }

  function monoFaviconSvg(spec) {
    if (!spec || !['dom', 'local'].includes(spec.source)) return '';
    const paths = {
      hourglass: '<path d="M19 12h26M19 52h26M22 13v8l10 11-10 11v8M42 13v8L32 32l10 11v8"/>',
      check: '<path d="M15 32l11 12 22-25"/>',
      upload: '<path d="M32 13v30M21 24l11-11 11 11M18 49h28"/>'
    };
    if (!owns(paths, spec.kind)) return '';
    const unread = spec.unread === true
      ? '<circle cx="53" cy="53" r="6" fill="white" stroke="#10151f" stroke-width="3"/>' : '';
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">' +
      '<rect width="64" height="64" rx="15" fill="#10151f"/>' +
      '<g fill="none" stroke="white" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">' +
      paths[spec.kind] + '</g>' + unread + '</svg>';
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  }

  function taskFaviconSvg(spec) {
    if (spec && ['dom', 'local'].includes(spec.source)) return monoFaviconSvg(spec);
    if (spec?.source !== 'observatory') return '';
    if (!spec || !owns(TASK_PALETTE, spec.color)) return '';
    const ink = '#10151f';
    const paths = {
      upload: '<path d="M31 13v30M20 24l11-11 11 11M17 48h28"/>',
      dom: '<circle cx="17" cy="32" r="3"/><circle cx="31" cy="32" r="3"/><circle cx="45" cy="32" r="3"/>',
      work: '<path d="M21 14h20v7L26 43v7h15v-7L26 21v-7"/>',
      wait: '<circle cx="31" cy="32" r="17"/><path d="M31 21v12l9 6"/>',
      quiet: '<circle cx="31" cy="32" r="17"/><path d="M26 25v14M36 25v14"/>',
      check: '<path d="M15 32l11 12 22-25"/>',
      error: '<path d="M19 20l25 25M44 20L19 45"/>',
      bell: '<path d="M18 43h26l-5-7v-9c0-13-16-13-16 0v9z"/><path d="M28 49h6"/>'
    };
    const glyph = owns(paths, spec.kind) ? paths[spec.kind] : paths.work;
    const pending = spec.pending === true && spec.color !== 'yellow'
      ? '<circle cx="52" cy="12" r="10" fill="#facc15" stroke="#10151f" stroke-width="3"/>' : '';
    const unread = spec.unread === true
      ? '<circle cx="52" cy="52" r="7" fill="white" stroke="#10151f" stroke-width="3"/>' : '';
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">' +
      '<rect width="64" height="64" rx="15" fill="' + TASK_PALETTE[spec.color] + '"/>' +
      '<g fill="none" stroke="' + ink + '" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">' +
      glyph + '</g>' + pending + unread + '</svg>';
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  }

  function resolveTabVisual({ state = 'idle', uploadMarked = false, overview = null,
    bound = false, connection = 'unpaired', domGenerating = false } = {}) {
    const unread = ['fresh', 'observatory-fresh'].includes(state);
    const domActive = domGenerating && ['working', 'observatory-working'].includes(state);
    const pending = bound && overview ? overview.current_pending === true : false;
    const uncertain = bound && ((!overview && !['disabled', 'unpaired'].includes(connection)) || overview?.incomplete === true);
    const domKind = domActive || state === 'working' ? 'hourglass'
      : ['fresh', 'viewed'].includes(state) ? 'check' : null;
    const domMarker = domKind === 'hourglass' ? '⏳' : domKind === 'check' ? '✓' : '';
    let icon = null, marker = '';
    if (uploadMarked) {
      icon = { source: 'local', color: null, kind: 'upload', pending: false, unread };
      marker = '⇧';
    } else if (bound && overview) {
      const color = overview.primary_color;
      if (color) icon = { source: 'observatory', color,
        kind: { blue: 'work', yellow: 'wait', purple: 'quiet', green: 'check', red: 'error' }[color],
        pending, unread };
      marker = MARK[color] || (overview.primary_state === 'blocked' ? '⏸' : '');
    }
    // DOM indicators are independent shapes. They can never invent an
    // Observatory color, even when disconnected or after an expired summary.
    if (!icon && domKind) icon = { source: 'dom', color: null, kind: domKind, pending: false, unread };
    const markers = [marker, domMarker];
    if (unread) markers.push('●');
    if (domActive && bound && overview?.primary_state === 'completed')
      markers.push('[ChatGPT: генерация наблюдается]');
    if (uncertain) {
      const reason = overview?.incomplete === true ? 'неполная сводка' : ({
        checking: 'проверка', denied: 'нет доступа', stale: 'статус устарел', unsupported: 'старый API'
      }[connection] || 'нет связи');
      markers.push('◌', '[Observatory: ' + reason + ']');
    }
    return { icon,
      symbol: markers.filter(Boolean).join(' ') };
  }
  return { TASK_PALETTE, validateTaskOverview, monoFaviconSvg, taskFaviconSvg, resolveTabVisual };
});

(function (root, factory) {
  const deps = typeof require === 'function'
    ? Object.assign({}, require('./config.js'), require('./task-favicon.js'), root.ChatGPTTabNotifier || {})
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
      const withoutConnection = value.replace(/^\[(?:Observatory: (?:нет связи|нет доступа|статус устарел|старый API|проверка|неполная сводка)|ChatGPT: генерация наблюдается)\]\s*/, '');
      if (withoutConnection !== value) { value = withoutConnection; removed = true; }
    }
    return value.trim();
  }

  function faviconSvg(type) {
    const kind = { working: 'hourglass', fresh: 'check', viewed: 'check', uploading: 'upload' }[type];
    // Legacy/raw state alone never grants an Observatory status color.
    return kind ? deps.monoFaviconSvg({ source: type === 'uploading' ? 'local' : 'dom',
      kind, unread: type === 'fresh' }) : '';
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
    function showDesktopNotification(source = 'dom') {
      if (!deps.SETTINGS.desktopNotificationEnabled || typeof GM_notification !== 'function') return;
      try {
        GM_notification({
          title: source === 'observatory' ? 'Fortis Observatory — завершено по событию чата' : 'ChatGPT — ответ готов',
          text: tabState.getNaturalTitle(),
          timeout: 6500,
          silent: false,
          highlight: false
        });
      } catch (error) {
        console.warn('[ChatGPT notifier] Не удалось показать системное уведомление:', error);
      }
    }

    function notifyFinished(source = 'dom') {
      const background = document.hidden || !document.hasFocus();
      if (deps.SETTINGS.notifyOnlyInBackground && !background) return;
      showDesktopNotification(source);
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
  const LARGE_NATIVE_INSERT_THRESHOLD = 12000;
  const NATIVE_INSERT_CHUNK = 4096;

  function nextInsertBoundary(text, offset) {
    let end = Math.min(text.length, offset + NATIVE_INSERT_CHUNK);
    // Never cut a Unicode surrogate pair at the chunk boundary.
    if (end < text.length && end > offset &&
        text.charCodeAt(end - 1) >= 0xD800 && text.charCodeAt(end - 1) <= 0xDBFF) end--;
    return end;
  }

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

  function appendComposerChunk(composer, chunk, first) {
    if (first) return setComposerText(composer, chunk);
    const native = (
      (typeof HTMLTextAreaElement !== 'undefined' && composer instanceof HTMLTextAreaElement) ||
      (typeof HTMLInputElement !== 'undefined' && composer instanceof HTMLInputElement)
    );
    if (native) return setNativeValue(composer, composer.value + chunk);
    if (!(composer?.isContentEditable || composer?.getAttribute?.('contenteditable') === 'true')) return false;
    // Apply a bounded edit to the native rich editor, yielding to the browser
    // between chunks. Never replace the entire growing contenteditable tree.
    try {
      composer.focus();
      const selection = window.getSelection?.();
      if (!selection || typeof document.createRange !== 'function' ||
          typeof document.execCommand !== 'function') return false;
      const range = document.createRange();
      range.selectNodeContents(composer);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
      if (!document.execCommand('insertText', false, chunk)) return false;
      dispatchComposerInput(composer, chunk);
      return true;
    } catch (_) { return false; }
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

  // File-mode rich-editor readback only: browsers may add or remove
  // EMPTY paragraph separators when execCommand('insertText') builds <p>
  // nodes. Do not use the queue ownership normalizer here: that would also
  // discard repeated spaces, tabs and invisible characters from instructions.
  // Non-empty lines and their order MUST remain byte-for-byte equal (except
  // CRLF vs LF and browser NBSP vs a plain space). This checks the entire
  // prepared file instruction/context, NOT the uploaded file's contents.
  function fileContextTextMatches(received, expected) {
    if (typeof received !== 'string' || typeof expected !== 'string' ||
        !received.trim() || !expected.trim()) return false;
    const meaningfulLines = text => text.replace(/\r\n?/g, '\n')
      .replace(/\u00a0/g, ' ')
      .split('\n')
      .filter(line => line !== '');
    const actual = meaningfulLines(received);
    const wanted = meaningfulLines(expected);
    return actual.length === wanted.length &&
      actual.every((line, index) => line === wanted[index]);
  }

  // File uses a deliberately narrow tolerance for rendered blank lines;
  // ordinary Insert and other queue actions remain exact.
  function insertOnlyTextMatches(composer, expected, { fileContext = false } = {}) {
    if (!composer) return false;
    const native = (typeof HTMLTextAreaElement !== 'undefined' &&
      composer instanceof HTMLTextAreaElement) ||
      (typeof HTMLInputElement !== 'undefined' &&
      composer instanceof HTMLInputElement);
    // Unlike readComposerText (used for tolerant queue ownership), no NBSP,
    // newline or Unicode substitution is allowed when claiming exact transfer.
    const received = native ? composer.value :
      (typeof composer.innerText === 'string' ? composer.innerText :
        composer.textContent);
    if (typeof received !== 'string') return false;
    if (received === expected) return true;
    return fileContext && !native && fileContextTextMatches(received, expected);
  }

  // Empty ProseMirror/contenteditable usually renders a structural <p><br>
  // placeholder: its innerText can be "\n" even though no text is entered.
  // This check is ONLY for the untouched initial state. It must never be
  // used for verifying an inserted prefix or the complete prompt.
  function isComposerVisiblyEmpty(composer) {
    if (!composer) return false;
    if (readComposerText(composer).trim()) return false;
    // A hidden text node would otherwise be masked by a structural newline
    // returned from innerText; do not overwrite an occupied rich composer.
    if (typeof composer.textContent === 'string' && composer.textContent.trim()) return false;
    return true;
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

  function createQueuedPromptController({ onChange = () => {}, onSendResult = () => {}, beforeSendClick = () => true } = {}) {
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
      return items.filter(item => !item.persistent).map(item => ({ ...item }));
    }

    function getItem(id) {
      return items.find(item => item.id === id) || null;
    }

    function add(text, options = {}) {
      const value = String(text || '').trim();
      if (!value) return null;
      const item = { id: makeId(), text: value, createdAt: Date.now(), persistent: options.persistent === true };
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
      const abandoned = pending;
      clearRetry();
      pending = null;
      if (abandoned?.source === 'manual-persisted') {
        try { onSendResult({ source: abandoned.source, itemIds: [...abandoned.itemIds],
          status: abandoned.clickedAt ? 'unconfirmed' : 'failed' }); } catch (_) {}
      }
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
      const failedJob = pending;
      clearRetry();
      pending = null;
      jobSerial += 1;
      if (failedJob) {
        try { onSendResult({ source: failedJob.source, itemIds: [...failedJob.itemIds],
          status: failedJob.clickedAt ? 'unconfirmed' : 'failed' }); } catch (_) {}
      }
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
      try { onSendResult({ source: job.source, itemIds: [...job.itemIds], status: 'sent' }); } catch (_) {}
      console.info(`[ChatGPT notifier] Отправка из очереди (${job.source}) подтверждена.`);
      return true;
    }

    function beginSend({ itemIds, text, allowWhileGenerating, source, timeoutMs,
      minComposerDwellMs = 0 }) {
      const ids = Array.from(itemIds || []).filter(id => getItem(id));
      if (insertingOnly || pending?.source === 'manual-persisted') return false;
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
        // Opt-in only: quick textbox leaves the text visible in the native
        // composer for ~1 second before clicking the real Send button.
        // Old queue, file auto-send and delayed actions continue unchanged.
        minComposerDwellMs: source === 'manual-persisted'
          ? Math.min(1500, Math.max(0, Number(minComposerDwellMs) || 0)) : 0,
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
        clickedButton: null,
        largeInsert: source === 'manual-persisted' && value.length >= LARGE_NATIVE_INSERT_THRESHOLD
          ? { cursor: 0, accumulated: '', composer: null } : null
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

      if (job.largeInsert && job.largeInsert.cursor < job.text.length) {
        const progress = job.largeInsert;
        if (progress.composer && progress.composer !== composer)
          return failPending('Редактор сменился при переносе большого промпта; отправка отменена.', job.jobId);
        if (progress.cursor === 0 && currentText &&
            normalizeComposerTextForOwnership(currentText) === job.expectedNormalized) {
          progress.cursor = job.text.length;
          progress.accumulated = job.text;
          progress.composer = composer;
        } else {
          if (normalizeComposerTextForOwnership(currentText) !==
              normalizeComposerTextForOwnership(progress.accumulated)) {
            return failPending('Редактор занят или изменён при переносе большого текста. Автоотправки не было.', job.jobId);
          }
          const until = nextInsertBoundary(job.text, progress.cursor);
          const chunk = job.text.slice(progress.cursor, until);
          if (!appendComposerChunk(composer, chunk, progress.cursor === 0)) {
            return failPending('Не удалось вставить часть большого текста в ChatGPT. Оригинал сохранён локально.', job.jobId);
          }
          progress.cursor = until;
          progress.accumulated += chunk;
          progress.composer = composer;
        }
        if (progress.cursor >= job.text.length) {
          const inserted = normalizeComposerTextForOwnership(readComposerText(composer));
          if (inserted !== job.expectedNormalized) {
            return failPending('Большой промпт вставлен не полностью; Send отменён.', job.jobId);
          }
          job.insertedByScript = true;
          job.insertedAt = Date.now();
          job.insertedSnapshotNormalized = inserted;
        }
        scheduleRetry(25);
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

      // Wait AFTER native insertion, not before it. During this interval,
      // React can finish processing input and the user can see/edit text.
      // Ownership is checked again on every retry; an edited composer is
      // never silently clicked by a delayed operation.
      if (job.minComposerDwellMs > 0) {
        const remaining = job.minComposerDwellMs - (now - job.insertedAt);
        if (remaining > 0) {
          scheduleRetry(Math.min(remaining, 160));
          return false;
        }
      }

      // Ищем Send заново уже ПОСЛЕ того, как ChatGPT получил input-событие.
      const sendButton = context?.sendButton || deps.findSendButton(form);
      if (!deps.isSendButtonReady(sendButton)) {
        scheduleRetry(100);
        return false;
      }

      try {
        if (beforeSendClick({ source: job.source, itemIds: [...job.itemIds] }) === false) {
          return failPending('Отправка отменена: не удалось сохранить статус перед Send.', job.jobId);
        }
      } catch (_) {
        return failPending('Отправка отменена: не удалось сохранить статус перед Send.', job.jobId);
      }
      console.info(`[ChatGPT notifier] Нажимаю штатный Send (${job.source}).`);
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
      const first = items.find(item => !item.persistent);
      if (!first) return false;
      return beginSend({
        itemIds: [first.id],
        text: first.text,
        allowWhileGenerating: false,
        source: 'auto-after-response',
        timeoutMs: 10000
      });
    }

    function sendNow(id, options = {}) {
      const item = getItem(id);
      if (!item || (options.source === 'manual-persisted' && pending) ||
          Boolean(item.persistent) !== (options.source === 'manual-persisted')) return false;
      return beginSend({
        itemIds: [item.id],
        text: item.text,
        allowWhileGenerating: options.allowWhileGenerating ?? true,
        source: options.source || 'manual-item',
        minComposerDwellMs: options.minComposerDwellMs || 0,
        timeoutMs: options.source === 'manual-persisted' &&
          String(item.text).length >= LARGE_NATIVE_INSERT_THRESHOLD ? 90000 :
          (options.source === 'manual-persisted' && options.minComposerDwellMs > 0
            ? 6500 : 3500)
      });
    }

    function sendAllNow() {
      const snapshot = getItems();
      if (!snapshot.length) return false;
      return beginSend({
        itemIds: snapshot.map(item => item.id),
        text: snapshot.map(item => item.text).join('\n\n'),
        allowWhileGenerating: true,
        source: 'manual-all',
        timeoutMs: 3500
      });
    }

    // Exact live native draft reader: no newline / whitespace normalization.
    function readNativeDraft() {
      const editor = currentComposerContext()?.composer;
      if (!editor || editor.isConnected === false || editor.disabled || editor.readOnly)
        return null;
      // ChatGPT's empty rich editor can render a structural newline:
      // 5.7.11 already treated this as blank for insert-only.
      if (isComposerVisiblyEmpty(editor)) return '';
      const native = (typeof HTMLTextAreaElement !== 'undefined' &&
        editor instanceof HTMLTextAreaElement) ||
        (typeof HTMLInputElement !== 'undefined' && editor instanceof HTMLInputElement);
      return native ? editor.value :
        (typeof editor.innerText === 'string' ? editor.innerText : editor.textContent);
    }

    // Only APPEND to a populated composer, never replace it. Used by the file
    // route to preserve an existing draft while adding the next task context.
    async function appendOnly(suffix, expectedPrefix, { fileContext = false } = {}) {
      const addition = String(suffix ?? '');
      if (!addition.trim()) return { ok: false, reason: 'Нет текста для добавления.' };
      if (insertingOnly || pending)
        return { ok: false, reason: 'Другая передача уже выполняется.' };
      const editor = currentComposerContext()?.composer;
      if (!editor || editor.isConnected === false || editor.disabled || editor.readOnly)
        return { ok: false, reason: 'Редактор ChatGPT недоступен.' };
      const nativeBefore = readNativeDraft();
      if (typeof expectedPrefix !== 'string' || nativeBefore !== expectedPrefix)
        return { ok: false, reason: 'Штатный черновик изменился; текст не заменён.' };
      if (!expectedPrefix) return insertOnly(addition, {fileContext});
      const initialUrl = typeof location === 'undefined' ? '' : location.href;
      insertingOnly = true;
      try {
        const expected = expectedPrefix + addition;
        if (pending || editor.isConnected === false ||
            currentComposerContext()?.composer !== editor ||
            (initialUrl && typeof location !== 'undefined' && location.href !== initialUrl))
          throw Error('Беседа или редактор изменились. Send не нажимался.');
        if (!appendComposerChunk(editor, addition, false))
          throw Error('Редактор не принял дополнение. Send не нажимался.');
        if (!insertOnlyTextMatches(editor, expected, {fileContext}))
          throw Error('После добавления черновик отличается посимвольно. Send не нажимался.');
        return { ok: true, reason: 'Текст добавлен к штатному черновику без Send.' };
      } catch (error) {
        return { ok: false, reason: error?.message || 'Не удалось добавить текст.' };
      } finally {
        insertingOnly = false;
      }
    }

    let insertingOnly = false;
    function canInsertOnly() {
      if (insertingOnly || pending) return false;
      const editor = currentComposerContext()?.composer;
      return Boolean(editor && editor.isConnected !== false &&
        !editor.disabled && !editor.readOnly && isComposerVisiblyEmpty(editor));
    }
    async function insertOnly(text, { fileContext = false } = {}) {
      const value = String(text ?? '');
      if (!value.trim()) return {ok: false, reason: 'Нет текста для вставки.'};
      if (insertingOnly || pending) return {ok: false, reason: 'Другая передача уже выполняется.'};
      const current = currentComposerContext();
      const editor = current?.composer;
      if (!editor || editor.isConnected === false || editor.disabled || editor.readOnly)
        return {ok: false, reason: 'Штатное поле ChatGPT недоступно.'};
      if (!isComposerVisiblyEmpty(editor))
        return {ok: false, reason: 'Штатное поле уже содержит текст. Ничего не заменено.'};
      const initialUrl = typeof location === 'undefined' ? '' : location.href;
      insertingOnly = true;
      let accumulated = '';
      try {
        for (let offset = 0; offset < value.length;) {
          if (pending || editor.isConnected === false ||
              currentComposerContext()?.composer !== editor ||
              (initialUrl && typeof location !== 'undefined' && location.href !== initialUrl))
            throw Error('Вкладка или редактор изменились. Вставка остановлена, Send не нажимался.');
          if (accumulated === '' ? !isComposerVisiblyEmpty(editor) :
              !insertOnlyTextMatches(editor, accumulated, {fileContext}))
            throw Error('Редактор изменил часть текста (пробелы, переносы или символы). Исходник сохранён; Send не нажимался.');
          const end = nextInsertBoundary(value, offset);
          if (!appendComposerChunk(editor, value.slice(offset, end), offset === 0))
            throw Error('Редактор ChatGPT не принял часть текста. Send не нажимался.');
          accumulated += value.slice(offset, end);
          offset = end;
          if (offset < value.length) await new Promise(resolve => setTimeout(resolve, 16));
        }
        if (!insertOnlyTextMatches(editor, value, {fileContext}))
          throw Error('Вставка не совпала с исходником посимвольно. Исходник сохранён; Send не нажимался.');
        return {ok: true, reason: 'Текст вставлен в ChatGPT без отправки. Проверяйте и редактируйте перед Send.'};
      } catch (error) {
        return {ok: false, reason: error?.message || 'Не удалось вставить текст.'};
      } finally {
        insertingOnly = false;
      }
    }

    function resetForNavigation() {
      clear();
    }

    return {
      add,
      addFromComposer,
      insertOnly,
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
      getCount: () => getItems().length,
      hasQueued: () => getItems().length > 0,
      isWaitingToSend: () => Boolean(pending),
      isInsertingOnly: () => insertingOnly,
      canInsertOnly, readNativeDraft, appendOnly,
      getPendingIds: () => pending ? [...pending.itemIds] : [],
      getLastStatus: () => lastStatus
    };
  }

  return {
    readComposerText,
    setComposerText,
    normalizeComposerTextForOwnership, fileContextTextMatches, nextInsertBoundary,
    LARGE_NATIVE_INSERT_THRESHOLD, NATIVE_INSERT_CHUNK,
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

  function normalizeAssistantSnapshot(snapshot) {
    const count = Number(snapshot?.count);
    const fingerprint = typeof snapshot?.fingerprint === 'string' ? snapshot.fingerprint : '';
    if (!Number.isFinite(count) || count < 0 || !fingerprint) return null;
    return { count: Math.floor(count), fingerprint };
  }

  function assistantFingerprintTextLength(snapshot) {
    const normalized = normalizeAssistantSnapshot(snapshot);
    if (!normalized) return null;
    const match = normalized.fingerprint.match(/^\d+:(\d+):/);
    if (!match) return null;
    const length = Number(match[1]);
    return Number.isFinite(length) ? length : null;
  }

  function evaluateCheckpointResponseGuard({ baseline = null, current = null } = {}) {
    const before = normalizeAssistantSnapshot(baseline);
    const latest = normalizeAssistantSnapshot(current);
    if (!before || !latest) return { allow: false, answered: false, reason: 'snapshot-unavailable' };
    if (latest.count < before.count) return { allow: false, answered: false, reason: 'snapshot-not-ready' };
    if (latest.count > before.count) return { allow: false, answered: true, reason: 'assistant-count-advanced' };
    if (latest.fingerprint === before.fingerprint) return { allow: true, answered: false, reason: 'unchanged' };

    // After reload/sleep ChatGPT can hydrate the same assistant message progressively.
    // A temporarily shorter snapshot is not proof of a new answer: fail closed and wait.
    const beforeLength = assistantFingerprintTextLength(before);
    const latestLength = assistantFingerprintTextLength(latest);
    if (beforeLength !== null && latestLength !== null && latestLength < beforeLength) {
      return { allow: false, answered: false, reason: 'snapshot-not-ready' };
    }
    return { allow: false, answered: true, reason: 'assistant-fingerprint-changed' };
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
    getAssistantSnapshot = () => null,
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
            routeKey: checkpointJob.routeKey,
            assistantBaseline: checkpointJob.assistantBaseline
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
          const assistantBaseline = normalizeAssistantSnapshot(checkpoint.assistantBaseline);
          if (text && Number.isFinite(deadline) && String(checkpoint.routeKey || '') === routeKey && assistantBaseline) {
            checkpointJob = {
              phase: 'waiting',
              deadline,
              text,
              expectedNormalized: normalizeText(text),
              routeKey,
              assistantBaseline
            };
          } else if (text && Number.isFinite(deadline) && String(checkpoint.routeKey || '') === routeKey) {
            // v5.6.0 did not persist the assistant baseline. Restoring such a
            // checkpoint could send after an answer that arrived while sleeping,
            // so discard only that checkpoint and keep delayed-list items.
            lastStatus = 'Старый чекпоинт снят после обновления: невозможно проверить, был ли уже получен ответ.';
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
      const assistantBaseline = currentAssistantSnapshot();
      if (!assistantBaseline) {
        setStatus('Не удалось зафиксировать состояние ответа ChatGPT — чекпоинт не поставлен.');
        return false;
      }
      const timestamp = now();
      checkpointJob = {
        phase: 'waiting',
        deadline: timestamp + delayMs,
        text,
        expectedNormalized: normalizeText(text),
        routeKey: currentRouteKey(),
        assistantBaseline
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

    function currentAssistantSnapshot() {
      try { return normalizeAssistantSnapshot(getAssistantSnapshot()); } catch (_) { return null; }
    }

    function checkpointResponseGuard(baseline) {
      return evaluateCheckpointResponseGuard({ baseline, current: currentAssistantSnapshot() });
    }

    function clearOwnedCheckpointComposer(job, context = null) {
      if (!job?.insertedByScript) return false;
      const resolved = context || resolveContext();
      const composer = resolved?.composer;
      if (!composer) return false;
      const currentNormalized = normalizeText(readText(composer));
      if (!currentNormalized || currentNormalized !== job.expectedNormalized) return false;
      try { return Boolean(setText(composer, '')); } catch (_) { return false; }
    }

    function cancelCheckpointForAnswer(job = activeSend, context = null, reason = 'assistant-response-detected') {
      if (job?.kind === 'checkpoint') clearOwnedCheckpointComposer(job, context);
      activeSend = activeSend?.kind === 'checkpoint' ? null : activeSend;
      checkpointJob = null;
      lastRenderSignature = '';
      lastStatus = 'Ответ ChatGPT уже получен — чекпоинт снят.';
      persistState();
      emitChange();
      console.info(`[ChatGPT notifier] Чекпоинт снят гардом ответа (${reason}).`);
      return true;
    }

    function guardWaitingCheckpoint() {
      if (!checkpointJob || checkpointJob.phase !== 'waiting') return null;
      const guard = checkpointResponseGuard(checkpointJob.assistantBaseline);
      if (guard.answered) {
        cancelCheckpointForAnswer(activeSend?.kind === 'checkpoint' ? activeSend : null, null, guard.reason);
        return { ...guard, cancelled: true };
      }
      return guard;
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

      if (activeSend.kind === 'checkpoint' && activeSend.clickCount === 0) {
        const guard = checkpointResponseGuard(activeSend.assistantBaseline);
        if (guard.answered) return cancelCheckpointForAnswer(activeSend, context, guard.reason);
        if (!guard.allow) return false;
      }

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

      if (job.kind === 'checkpoint') {
        const guard = checkpointResponseGuard(job.assistantBaseline);
        if (guard.answered) return cancelCheckpointForAnswer(job, context, guard.reason);
        if (!guard.allow) return false;
      }

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

    function dueCandidate(timestamp, { checkpointAllowed = true } = {}) {
      const candidates = [];
      if (checkpointAllowed && checkpointJob?.phase === 'waiting' && checkpointJob.deadline <= timestamp) {
        candidates.push({
          kind: 'checkpoint',
          deadline: checkpointJob.deadline,
          text: checkpointJob.text,
          expectedNormalized: checkpointJob.expectedNormalized,
          assistantBaseline: checkpointJob.assistantBaseline
        });
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
      const checkpointGuard = guardWaitingCheckpoint();
      if (checkpointGuard?.cancelled) {
        // Continue below so an unrelated due delayed-list item may still run.
      }
      if (activeSend) return processActiveSend(timestamp);
      const candidate = dueCandidate(timestamp, {
        checkpointAllowed: checkpointJob ? Boolean(checkpointGuard?.allow) : false
      });
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
      let checkpointAllowed = false;
      if (checkpointJob?.phase === 'waiting') {
        const guard = checkpointResponseGuard(checkpointJob.assistantBaseline);
        checkpointAllowed = Boolean(guard.allow);
      }
      return Boolean(dueCandidate(timestamp, { checkpointAllowed }));
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
    normalizeAssistantSnapshot,
    evaluateCheckpointResponseGuard,
    evaluateDelayedSendConfirmation,
    createDelayedSendController
  };
});

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ChatGPTTabNotifier = Object.assign(root.ChatGPTTabNotifier || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Explicit finite local origins. In particular, never trust an origin
  // supplied by a pasted pairing code without validating the whole string.
  // 18754 is Docker internal; 18755 is the explicit owner-launched local
  // viewer's narrow per-session observer/original transport, not a Docker port.
  const OBSERVATORY_ORIGINS = Object.freeze([
    'http://127.0.0.1:18753',
    'http://127.0.0.1:18754',
    'http://127.0.0.1:18755'
  ]);
  function allowedObservatoryOrigin(value) {
    return typeof value === 'string' && OBSERVATORY_ORIGINS.includes(value);
  }
  return { allowedObservatoryOrigin };
});

(function (root, factory) {
  const deps = typeof require === 'function'
    ? Object.assign({}, require('./queued-prompt.js'), root.ChatGPTTabNotifier || {})
    : (root.ChatGPTTabNotifier || {});
  const api = factory(deps);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ChatGPTTabNotifier = Object.assign(root.ChatGPTTabNotifier || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  'use strict';

  const PREFIX = 'fortis-local-user-message-v1-';
  const ID_RE = /^task_[0-9a-f]{32}$/;

  // Some Tampermonkey environments allow synchronous GM_get/GM_set but
  // GM_listValues is missing, throws, or returns an unexpected value.
  // Keep a verified PER-CHAT index of task keys using only get/set. This is
  // a discovery index, never a replacement for individually verified originals.
  // Legacy object records remain readable; old unindexed records stay intact.
  const INDEX_PREFIX = 'fortis-local-user-message-index-v1-';
  const CHAT_RE = /^[A-Za-z0-9-]{8,100}$/;
  const INDEX_KEY_RE = /^fortis-local-user-message-v1-task_[0-9a-f]{32}$/;

  function createGMRecordStorage({ getValue, setValue, listValues } = {}) {
    function decode(stored) {
      if (typeof stored !== 'string') return stored;
      try { return JSON.parse(stored); }
      catch (_) { return null; }
    }

    function readIndex(chatId) {
      if (!CHAT_RE.test(chatId || '')) throw new Error('INDEX_BAD_CHAT');
      if (typeof getValue !== 'function') throw new Error('GM_READ_UNAVAILABLE');
      const raw = getValue(INDEX_PREFIX + chatId, null);
      if (raw === null || raw === undefined) return [];
      const value = decode(raw);
      if (!Array.isArray(value) || value.length > 100000 ||
          value.some(name => typeof name !== 'string' || !INDEX_KEY_RE.test(name)) ||
          new Set(value).size !== value.length) {
        throw new Error('INDEX_INVALID');
      }
      return value;
    }

    function verifyReadBack(key, expected) {
      if (typeof getValue !== 'function') throw new Error('GM_READ_UNAVAILABLE');
      const actual = decode(getValue(key, null));
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error('INDEX_READBACK_MISMATCH');
      }
    }

    return {
      get(key) {
        if (typeof getValue !== 'function') throw new Error('GM_READ_UNAVAILABLE');
        return decode(getValue(key, null));
      },
      set(key, record) {
        if (typeof setValue !== 'function') throw new Error('GM_WRITE_UNAVAILABLE');
        setValue(key, JSON.stringify(record));
        // All record updates first verify the record, then ensure its task is
        // discoverable even if GM_listValues cannot enumerate anything.
        if (!key.startsWith(PREFIX) || !ID_RE.test(record?.task_id || '') ||
            key !== PREFIX + record.task_id ||
            !CHAT_RE.test(record?.conversation_id || '')) return;
        verifyReadBack(key, record);
        const indexKey = INDEX_PREFIX + record.conversation_id;
        const names = readIndex(record.conversation_id);
        if (names.includes(key)) return;
        const updated = [...names, key];
        setValue(indexKey, JSON.stringify(updated));
        verifyReadBack(indexKey, updated);
      },
      list(chatId) {
        let nativeKeys = null;
        if (typeof listValues === 'function') {
          try {
            const found = listValues();
            if (Array.isArray(found)) nativeKeys = found;
          } catch (_) { /* Index fallback; no destructive cleanup. */ }
        }
        // The index also preserves discovery after a browser reload where the
        // platform has no working synchronous enumeration API.
        const indexedKeys = chatId ? readIndex(chatId) : [];
        if (nativeKeys) return [...new Set([...nativeKeys, ...indexedKeys])];
        if (chatId) return indexedKeys;
        throw new Error('GM_LIST_UNAVAILABLE');
      }
    };
  }

  function createTaskIdBehavior(cryptoSource = globalThis.crypto) {
    function newTaskId() {
      if (typeof cryptoSource?.randomUUID === 'function') {
        return 'task_' + cryptoSource.randomUUID().replace(/-/g, '').toLowerCase();
      }
      if (typeof cryptoSource?.getRandomValues !== 'function') {
        throw new Error('Нет криптографически стойкого генератора task_id');
      }
      const bytes = cryptoSource.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      return 'task_' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    }

    function prepare(originalText, repoContext = null, { fileName = null } = {}) {
      const original = String(originalText ?? '');
      if (!original.trim()) return null;
      const taskId = newTaskId();
      if (!ID_RE.test(taskId)) throw new Error('Неверный формат task_id');
      const guidance = [
        '[Fortis task context]',
        'Этот блок создан поведенческим модулем Notifier для ТЕКУЩЕГО сообщения.',
        'task_id: ' + taskId,
        'Все события и сообщения AI этого запроса должны использовать только этот task_id.',
        'НЕ переноси ID предыдущего запроса или ID из стартового bootstrap.',
        'Основной инструмент AI для Observatory: Fortis Repo.',
        'Метаданные посылай через repo_task.py event, полные interim/final через repo_task.py message (UTF-8 STDIN).',
        'Observatory и Windows Viewer не обязаны отвечать: записывай события и каждый полный interim/final локально через Fortis Repo.',
        'Не проверяй HTTP, pairing или receipt перед записью; недоступность Observatory не отменяет работу и не означает failed.',
        'STAGED_ONLY = очередь, не receipt. Оригинал пользователя архивирует Notifier, не AI.',
        'Не отправляй ответы AI через G2, Windows owner HOST или browser relay.'
      ];
      if ((repoContext?.origin === 'http://127.0.0.1:18754' ||
           repoContext?.origin === 'http://127.0.0.1:18755') &&
          /^rs_[0-9a-f]{32}$/.test(repoContext.reporting_session_id || '') &&
          /^[A-Za-z0-9-]{8,100}$/.test(repoContext.conversation_id || '')) {
        const command = 'python3 /workspace/repos/tunnel/observatory/v1/repo_task.py';
        const args = ' --session ' + repoContext.reporting_session_id +
          ' --chat-id ' + repoContext.conversation_id + ' --task ' + taskId;
        guidance.push(
          'reporting_session_id: ' + repoContext.reporting_session_id,
          'conversation_id: ' + repoContext.conversation_id,
          'route: repo',
          'Маркер пользователя: ' + command + ' event' + args +
            " --event user_message --stage other --summary 'Получено сообщение пользователя'",
          'Значимый промежуточный этап: ' + command + ' event' + args +
            " --event progress --stage reviewing --summary 'Проверяю запрос'",
          'Полный ответ: ' + command + ' message' + args + ' --kind final',
          'Полный текст AI передавай UTF-8 STDIN, не через аргументы CLI или metadata inbox.',
          'Не выдумывай положительные статусы без проверки архива; продолжай ответ при недоступности Repo.'
        );
      } else if (CHAT_RE.test(repoContext?.conversation_id || '')) {
        const command = 'python3 /workspace/repos/tunnel/observatory/v1/repo_task.py';
        const args = ' --chat-id ' + repoContext.conversation_id + ' --task ' + taskId;
        guidance.push(
          'conversation_id: ' + repoContext.conversation_id,
          'route: repo',
          'Browser pairing отсутствует. Сохраняй события и полные ответы в локальную очередь без --session.',
          'Маркер пользователя: ' + command + ' event' + args +
            " --event user_message --stage other --summary 'Получено сообщение пользователя'",
          'Значимый промежуточный этап: ' + command + ' event' + args +
            " --event progress --stage reviewing --summary 'Проверяю запрос'",
          'Полный ответ: ' + command + ' message' + args + ' --kind final',
          'После регистрации именно этого чата очередь будет обработана; не создавай привязку сам и не подставляй старые ID.',
          'Продолжай выполнять запрос и отвечать пользователю независимо от pairing.'
        );
      } else {
        guidance.push('Нет ID текущего чата: не выдумывай и не переноси ID. Выполняй запрос; не заявляй сохранение без STAGED_ONLY.');
      }
      guidance.push('[/Fortis task context]');
      const guidanceText = guidance.join('\n');
      // Full file payload contains the exact original, Fortis task metadata,
      // and (in prepareDraft) the selected Planning Helper prompt/modules.
      // ProseMirror gets ONLY a small, task-bound pointer.
      if (fileName) {
        const pointer = [
          'Полный текст запроса, Fortis task context и выбранные модули находятся в файле ' +
            JSON.stringify(fileName) + '. Прочитай весь файл перед ответом.',
          '[Fortis task context]',
          'task_id: ' + taskId,
          ...(repoContext?.reporting_session_id ?
            ['reporting_session_id: ' + repoContext.reporting_session_id] : []),
          ...(repoContext?.conversation_id ?
            ['conversation_id: ' + repoContext.conversation_id] : []),
          'route: repo',
          'Инструкции и команды для текущей задачи находятся внутри файла.',
          '[/Fortis task context]'
        ].join('\n');
        return { task_id: taskId, original_text: original,
          submitted_text: pointer,
          file_text: original + '\n\n' + guidanceText };
      }
      return { task_id: taskId, original_text: original,
        submitted_text: original.trimEnd() + '\n\n' + guidanceText };
    }
    return { prepare };
  }

  function createPersistentMessageController({
    queue, storage, getConversationId, getPairing = () => null, onChange = () => {},
    behavior = createTaskIdBehavior(), now = () => Date.now(), onSaved = () => {}
  } = {}) {
    const queueToTask = new Map();
    let lastStatus = '';

    function notify(message) {
      lastStatus = message;
      // UI redraw must not modify the result of a verified storage write
      // or interrupt queue bookkeeping after the original is safely stored.
      try { onChange(); } catch (_) {}
    }

    function key(id) { return PREFIX + id; }

    function load(id) {
      if (!ID_RE.test(id || '')) return null;
      try {
        const value = storage.get(key(id));
        return value?.version === 1 && value.task_id === id ? value : null;
      } catch (_) { return null; }
    }

    function save(record) {
      const storageKey = key(record.task_id);
      if (!storage || typeof storage.set !== 'function' ||
          typeof storage.get !== 'function' || typeof storage.list !== 'function') {
        throw new Error('STORAGE_UNAVAILABLE');
      }
      try { storage.set(storageKey, record); }
      catch (error) {
        if (/^INDEX_(BAD_CHAT|INVALID|READBACK_MISMATCH)$/.test(error?.message || '')) throw error;
        throw new Error('WRITE_FAILED');
      }
      let check;
      try { check = storage.get(storageKey); }
      catch (_) { throw new Error('READ_FAILED'); }
      if (!check || check.version !== 1 || check.task_id !== record.task_id ||
          JSON.stringify(check) !== JSON.stringify(record)) {
        throw new Error('READBACK_MISMATCH');
      }
      let names;
      try { names = storage.list(record.conversation_id); }
      catch (error) {
        if (/^INDEX_(BAD_CHAT|INVALID|READBACK_MISMATCH)$/.test(error?.message || '')) throw error;
        throw new Error('LIST_FAILED');
      }
      if (!Array.isArray(names)) throw new Error('LIST_NOT_ARRAY');
      if (!names.includes(storageKey)) throw new Error('LIST_NOT_VISIBLE');
      // A UI re-render problem is NOT a storage failure after verified write.
      try { onChange(); } catch (_) { /* keep successfully saved record */ }
      try { onSaved(); } catch (_) { /* metadata sync cannot break local persistence */ }
      return record;
    }

    function update(id, fields) {
      const record = load(id);
      if (!record) return null;
      return save({ ...record, ...fields });
    }

    function updateSend(id, fields, phase) {
      const item = load(id);
      if (!item) return null;
      return update(id, { ...fields, ...(item.intent_version === 1 ? {
        send_revision: (item.send_revision || 0) + 1,
        send_phase: phase, send_observed_at_client_ms: now()
      } : {}) });
    }

    function acceptIntentSync(taskId, expected, receipt) {
      const item = load(taskId);
      if (!item || item.intent_version !== 1 || receipt?.ok !== true || receipt.version !== 1 ||
          receipt.task_id !== taskId || receipt.conversation_id !== item.conversation_id ||
          receipt.reporting_session_id !== item.reporting_session_id ||
          item.conversation_id !== getConversationId?.()) return false;
      const pair = getPairing?.();
      if (pair?.conversation_id !== item.conversation_id ||
          pair?.reporting_session_id !== item.reporting_session_id ||
          pair?.origin !== item.observatory_origin) return false;
      if (expected === 0) {
        if (receipt.registered !== true || receipt.provenance !== 'notifier_local_save_claim' ||
            !['created', 'existing'].includes(receipt.status) ||
            !Number.isFinite(receipt.registered_at_unix) || receipt.registered_at_unix <= 0) return false;
        try { update(taskId, { intent_registered: true }); return true; } catch (_) { return false; }
      }
      if (!Number.isSafeInteger(expected) || expected <= 0 ||
          receipt.recorded !== true || receipt.revision !== expected ||
          !Number.isSafeInteger(receipt.stored_revision) || receipt.stored_revision < expected ||
          !['created', 'updated', 'existing', 'stale'].includes(receipt.status) ||
          !['send_requested', 'send_unconfirmed', 'send_observed', 'send_not_attempted'].includes(receipt.phase) ||
          receipt.provenance !== 'notifier_send_claim' || expected > item.send_revision) return false;
      try { update(taskId, { intent_send_revision: Math.max(item.intent_send_revision || 0, expected) });
        return true; } catch (_) { return false; }
    }

    function listForChat(chatId = getConversationId?.()) {
      if (!chatId || typeof storage?.list !== 'function') return [];
      try {
        return storage.list(chatId).filter(name => name.startsWith(PREFIX))
          .map(name => load(name.slice(PREFIX.length)))
          .filter(record => record && record.conversation_id === chatId)
          .sort((a, b) => b.created_at - a.created_at);
      } catch (_) { return []; }
    }

    function sendExisting(taskId, { minComposerDwellMs = 0 } = {}) {
      const record = load(taskId);
      if (!record || !['prepared', 'send_failed'].includes(record.send_status)) return false;
      if (record.conversation_id !== getConversationId?.() || queue?.isWaitingToSend?.()) {
        notify('Отправка занята или открыт другой чат; исходник сохранён.');
        return false;
      }
      let itemId = null;
      try {
        itemId = queue.add(record.submitted_text, { persistent: true });
        if (!itemId) throw new Error('Не удалось добавить сообщение в отправитель');
        queueToTask.set(itemId, taskId);
        update(taskId, { send_status: 'send_queued' });
        notify('Сообщение сохранено локально; проверяется штатная отправка.');
        queue.sendNow(itemId, { source: 'manual-persisted', allowWhileGenerating: false,
          minComposerDwellMs });
        return true;
      } catch (_) {
        if (itemId) { queueToTask.delete(itemId); queue.remove(itemId); }
        try { update(taskId, { send_status: 'send_failed' }); } catch (_) {}
        notify('Исходник сохранён, но отправка не подготовлена. Проверьте очередь.');
        return false;
      }
    }

    const DRAFT_MAX_BYTES = 512 * 1024;
    function prepareDraft(originalText, { extraText = '', mode = 'insert',
      fileName = null, nativePrefix = '' } = {}) {
      const original = String(originalText ?? '');
      if (!original.trim() || !['insert', 'file'].includes(mode) ||
          typeof nativePrefix !== 'string' || nativePrefix.length > DRAFT_MAX_BYTES ||
          typeof extraText !== 'string' || extraText.length > 100000 ||
          (mode === 'file' && !/^fortis-prompt-[0-9a-z-]+\.txt$/.test(fileName || ''))) {
        notify('Некорректный черновик или модули; ничего не отправлено.');
        return null;
      }
      if (new TextEncoder().encode(original).length > DRAFT_MAX_BYTES) {
        notify('Черновик превышает архивный предел 512 КиБ. Отправка/архивирование не подготовлены.');
        return null;
      }
      const chatId = getConversationId?.();
      if (!chatId || queue?.isWaitingToSend?.()) {
        notify('Нет текущего чата или занята очередь. Черновик не создан.');
        return null;
      }
      const pair = getPairing?.();
      const validPair = pair?.conversation_id === chatId &&
        (pair?.origin === 'http://127.0.0.1:18754' ||
         pair?.origin === 'http://127.0.0.1:18755') &&
        /^rs_[0-9a-f]{32}$/.test(pair?.reporting_session_id || '');
      const repoContext = validPair
        ? { origin: pair.origin, reporting_session_id: pair.reporting_session_id,
            conversation_id: chatId } : { conversation_id: chatId };
      let prepared;
      try {
        prepared = behavior.prepare(original, repoContext,
          { fileName: mode === 'file' ? fileName : null });
      } catch (_) {
        notify('Не удалось создать task_id и контекст черновика.');
        return null;
      }
      if (!prepared || !/^task_[0-9a-f]{32}$/.test(prepared.task_id)) return null;
      if (mode === 'insert') {
        // TaskIdBehavior trims the source on the ordinary Send route; this
        // insert-only route promises to preserve EVERY original character
        // before adding module/context text, including final spaces/newlines.
        const trimmedPrefix = original.trimEnd();
        if (!prepared.submitted_text.startsWith(trimmedPrefix + '\n\n')) {
          notify('Подготовка изменила исходный текст. Черновик не создан.');
          return null;
        }
        prepared.submitted_text = original +
          prepared.submitted_text.slice(trimmedPrefix.length);
      }
      if (mode === 'file') {
        if (typeof prepared.file_text !== 'string' ||
            !prepared.file_text.startsWith(original + '\n\n') ||
            !prepared.file_text.includes('task_id: ' + prepared.task_id)) {
          notify('Полный файл с Fortis context не подготовлен.');
          return null;
        }
        if (extraText) prepared.file_text += '\n\n' + extraText;
      } else if (extraText) prepared.submitted_text += '\n\n' + extraText;
      if (mode === 'file' && nativePrefix) {
        // The previous native text is explicitly retained, not overwritten.
        // A full read-back of this merged draft is required before manual Send.
        prepared.submitted_text = nativePrefix + '\n\n' + prepared.submitted_text;
      }
      // Protect the native composer: selected modules may be large even when
      // the attached original is carried separately.
      if (new TextEncoder().encode(prepared.submitted_text).length > DRAFT_MAX_BYTES) {
        notify('Текст подготовленного черновика больше 512 КиБ.');
        return null;
      }
      // Do not double-store the full payload in synchronous GM storage.
      // The full original is saved independently in original_text.
      const {file_text: fileText, ...storedPrepared} = prepared;
      const record = {
        version: 1, ...storedPrepared, conversation_id: chatId,
        reporting_session_id: validPair ? pair.reporting_session_id : null,
        observatory_origin: validPair ? pair.origin : null,
        intent_version: 1, send_revision: 0,
        created_at: now(), send_status: 'draft', sent_at: null,
        activity_status: 'pending', first_activity_at: null,
        archive_status: 'pending_activity', draft_mode: mode,
        ...(mode === 'file' ? { file_name: fileName } : {})
      };
      try { save(record); }
      catch (_) {
        notify('Не удалось сохранить точный оригинал и task_id. Черновик отменён.');
        return null;
      }
      try { update(record.task_id, { intent_ready: true }); } catch (_) { /* local original already verified */ }
      notify('Черновик и task_id сохранены локально. Send не нажат.');
      return { task_id: record.task_id, submitted_text: record.submitted_text,
        ...(mode === 'file' ? { file_text: fileText } : {}) };
    }

    function previewPreparedNativeDraft(nativeText, { fileNameVisible = () => false } = {}) {
      const chatId = getConversationId?.();
      if (!chatId || typeof nativeText !== 'string') return null;
      const paired = getPairing?.();
      // Multiple DIFFERENT file hashes may have been attached and their task
      // contexts appended to one composer. Only claim exact, unmodified prefix
      // snapshots in the final native text with the corresponding file cards.
      const matched = listForChat(chatId).filter(item => {
        if (item.send_status !== 'draft' ||
            typeof item.submitted_text !== 'string' ||
            !((item.draft_mode === 'file' && deps.fileContextTextMatches?.(
                nativeText, item.submitted_text)) ||
              item.submitted_text === nativeText ||
              (item.draft_mode === 'file' &&
               nativeText.startsWith(item.submitted_text + '\n\n')))) return false;
        if (item.draft_mode === 'file' && !fileNameVisible(item.file_name)) return false;
        if (item.reporting_session_id &&
            (paired?.conversation_id !== chatId ||
             paired?.reporting_session_id !== item.reporting_session_id ||
             paired?.origin !== item.observatory_origin)) return false;
        return true;
      });
      return matched;
    }

    function recordManualDraftSend(nativeText, { fileNameVisible = () => false } = {}) {
      const matched=previewPreparedNativeDraft(nativeText,{fileNameVisible});
      if(!matched?.length)return null;
      // A failed save must never cause automatic native Send (this function
      // only observes user action), and must never claim an archive receipt.
      const timestamp = now();
      let lastId = null;
      // Shorter native snapshots are earlier append-only prefixes; process
      // them first and return the task_id of the complete final draft.
      matched.sort((a, b) => a.submitted_text.length - b.submitted_text.length);
      for (const item of matched) {
        try {
          updateSend(item.task_id, { send_status: 'send_unconfirmed', sent_at: timestamp }, 'send_unconfirmed');
          lastId = item.task_id;
        } catch (_) {
          notify('Не удалось подтвердить статус ручного Send. Архив не подтверждён.');
        }
      }
      if (lastId)
        notify('Ручной Send обнаружен; точный черновик связан с task_id, ожидаем activity.');
      return lastId;
    }

    function saveAndSend(originalText, { minComposerDwellMs = 0, extraText = '' } = {}) {
      if (!getConversationId?.()) {
        notify('Откройте конкретный чат /c/..., чтобы связать сообщение с task_id.');
        return null;
      }
      if (queue?.isWaitingToSend?.()) {
        notify('Предыдущая отправка ещё выполняется.');
        return null;
      }
      const pairing = getPairing?.();
      const currentChat = getConversationId();
      const repoContext = (pairing?.origin === 'http://127.0.0.1:18754' ||
        pairing?.origin === 'http://127.0.0.1:18755') &&
        pairing?.conversation_id === currentChat &&
        /^rs_[0-9a-f]{32}$/.test(pairing?.reporting_session_id || '')
        ? { origin: pairing.origin, reporting_session_id: pairing.reporting_session_id,
            conversation_id: currentChat }
        : { conversation_id: currentChat };
      let prepared;
      try { prepared = behavior.prepare(originalText, repoContext); }
      catch (_) { notify('Нельзя создать безопасный task_id.'); return null; }
      if (!prepared) return null;
      if (typeof extraText !== 'string' || extraText.length > 100000) {
        notify('Некорректный текст подключённых модулей. Отправка отменена.');
        return null;
      }
      if (extraText) prepared.submitted_text += '\n\n' + extraText;
      const validPair = pairing?.conversation_id === getConversationId() &&
        (pairing?.origin === 'http://127.0.0.1:18753' ||
         pairing?.origin === 'http://127.0.0.1:18754' ||
         pairing?.origin === 'http://127.0.0.1:18755');
      const record = { version: 1, ...prepared, conversation_id: getConversationId(),
        reporting_session_id: validPair ? pairing.reporting_session_id : null,
        // Preserve the origin at creation: a later switch to Docker must never
        // migrate a legacy Windows-bound message, even for the same session ID.
        observatory_origin: validPair ? pairing.origin : null,
        intent_version: 1, send_revision: 0,
        created_at: now(), send_status: 'prepared', sent_at: null,
        activity_status: 'pending', first_activity_at: null,
        archive_status: 'pending_activity' };
      try { save(record); }
      catch (error) {
        const reason = /^[A-Z_]{5,40}$/.test(error?.message || '')
          ? error.message : 'UNKNOWN';
        try { notify('Не удалось сохранить исходник (' + reason + '). Отправка отменена.'); }
        catch (_) { /* never send if UI update itself fails */ }
        return null;
      }
      try { update(record.task_id, { intent_ready: true }); } catch (_) { /* metadata must not block Send */ }
      sendExisting(record.task_id, { minComposerDwellMs });
      return record.task_id;
    }

    function beforeSendClick({ source, itemIds }) {
      if (source !== 'manual-persisted') return true;
      const taskId = queueToTask.get(itemIds?.[0]);
      if (!taskId) return false;
      try { updateSend(taskId, { send_status: 'send_unconfirmed' }, 'send_requested'); return true; }
      catch (_) { notify('Ошибка сохранения перед Send: отправка отменена.'); return false; }
    }

    function handleSendResult({ source, itemIds, status }) {
      if (source !== 'manual-persisted') return;
      for (const itemId of itemIds || []) {
        const taskId = queueToTask.get(itemId);
        queueToTask.delete(itemId);
        if (!taskId) continue;
        try {
          updateSend(taskId, status === 'sent'
            ? { send_status: 'sent', sent_at: now() }
            : { send_status: status === 'unconfirmed' ? 'send_unconfirmed' : 'send_failed' },
            status === 'sent' ? 'send_observed' : status === 'unconfirmed' ? 'send_unconfirmed' : 'send_not_attempted');
        } catch (_) { notify('Не удалось сохранить статус отправки; проверьте историю.'); }
        if (status !== 'sent') queue.remove(itemId);
      }
      notify(status === 'sent' ? 'Отправлено; ожидает активности Observatory.'
        : status === 'unconfirmed'
          ? 'Отправка не подтверждена: не повторяйте её без проверки чата.'
          : 'Не отправлено; исходник сохранён, можно повторить.');
    }

    function acceptActivity(receipt) {
      if (!receipt || receipt.ok !== true || receipt.version !== 1 || receipt.found !== true ||
          !ID_RE.test(receipt.task_id || '') || !Number.isInteger(receipt.sequence) ||
          receipt.sequence < 0 || !Number.isFinite(receipt.accepted_unix) ||
          receipt.accepted_unix <= 0 || receipt.provenance !== 'sender_claim' ||
          !['started', 'progress', 'checkpoint', 'blocked', 'completed', 'failed',
            'user_message', 'assistant_message'].includes(receipt.event)) return false;
      const item = load(receipt.task_id);
      if (!item || item.conversation_id !== getConversationId?.() ||
          !item.reporting_session_id || item.reporting_session_id !== receipt.reporting_session_id ||
          item.conversation_id !== receipt.conversation_id ||
          !['sent', 'send_unconfirmed'].includes(item.send_status) ||
          item.activity_status === 'accepted') return false;
      try {
        update(item.task_id, {
          activity_status: 'accepted', archive_status: 'archive_pending',
          first_activity_at: receipt.accepted_unix * 1000,
          first_activity_event: receipt.event, first_activity_sequence: receipt.sequence
        });
        notify('Observatory принял сигнал по task_id; текст пока только локально.');
        return true;
      } catch (_) {
        notify('Не удалось сохранить подтверждение активности локально.');
        return false;
      }
    }

    function acceptArchive(receipt) {
      if (!receipt || receipt.ok !== true || receipt.version !== 1 ||
          receipt.archived !== true || !ID_RE.test(receipt.task_id || '') ||
          !['created', 'existing'].includes(receipt.status) ||
          !/^[0-9a-f]{64}$/.test(receipt.sha256 || '') ||
          typeof receipt.archived_at !== 'string' ||
          !Number.isFinite(Date.parse(receipt.archived_at))) return false;
      const item = load(receipt.task_id);
      if (!item || item.activity_status !== 'accepted' ||
          item.reporting_session_id !== receipt.reporting_session_id ||
          item.conversation_id !== receipt.conversation_id ||
          item.conversation_id !== getConversationId?.()) return false;
      try {
        update(item.task_id, {
          archive_status: 'archived', archived_at: receipt.archived_at,
          archive_sha256: receipt.sha256
        });
        notify('Исходное сообщение сохранено в архиве Observatory.');
        return true;
      } catch (_) {
        notify('Архив подтвердил запись, но локальный статус не сохранился.');
        return false;
      }
    }

    return { saveAndSend, prepareDraft, recordManualDraftSend, sendExisting,
      beforeSendClick, handleSendResult, acceptIntentSync,
      listForChat, load, previewPreparedNativeDraft, acceptActivity, acceptArchive,
      getLastStatus: () => lastStatus,
      getPairingInfo: () => {
        const pair = getPairing?.();
        return pair ? { reporting_session_id: pair.reporting_session_id,
          conversation_id: pair.conversation_id, origin: pair.origin } : null;
      },
      getStorageHealth: () => {
        try {
          if (!storage?.get || !storage?.set || !storage?.list) return false;
          const keys = storage.list(getConversationId?.());
          return Array.isArray(keys);
        } catch (_) { return false; }
      } };
  }

  return { createTaskIdBehavior, createGMRecordStorage, createPersistentMessageController };
});

(function (root, factory) {
  const api = factory(root.ChatGPTTabNotifier || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ChatGPTTabNotifier = Object.assign(root.ChatGPTTabNotifier || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  'use strict';

  const LEGACY_ORIGIN = 'http://127.0.0.1:18753';
  const allowedOrigin = deps.allowedObservatoryOrigin ||
    (origin => origin === LEGACY_ORIGIN || origin === 'http://127.0.0.1:18754' || origin === 'http://127.0.0.1:18755');
  const TASK_RE = /^task_[0-9a-f]{32}$/;
  const SESSION_RE = /^rs_[0-9a-f]{32}$/;
  const MIN_CHECK_INTERVAL_MS = 3500;

  function describeWaitingActivity({ record, pairing, connection = 'checking', now = Date.now(), warningDelayMs = 15000 } = {}) {
    if (!record || record.send_status !== 'sent' || record.activity_status === 'accepted') return '';
    if (!record.reporting_session_id) return 'Без привязки Observatory — пока только локально';
    if (!pairing || pairing.reporting_session_id !== record.reporting_session_id ||
        pairing.conversation_id !== record.conversation_id ||
        (record.observatory_origin ?? LEGACY_ORIGIN) !== pairing.origin) {
      return 'Нет прежней привязки Observatory — сообщение остаётся локально';
    }
    if (connection === 'unavailable') return 'Observatory недоступен — проверим после восстановления связи';
    if (connection === 'denied') return 'Observatory отклонил доступ — проверьте привязку';
    if (connection !== 'online') return 'Проверяем подтверждение активности Observatory';
    if (Number.isFinite(record.sent_at) && record.sent_at > 0 &&
        now - record.sent_at >= warningDelayMs) {
      return 'Пока нет подтверждения активности Observatory (более 15 секунд)';
    }
    return 'Ожидает активности Observatory';
  }

  function createTaskActivityMonitor({
    messages, getPairing, getConversationId, request, now = () => Date.now(),
    onStatus = () => {}
  } = {}) {
    let inFlight = false;
    let lastCheckAt = -Infinity;
    let nextIndex = 0;
    const taskConnections = new Map();

    function setConnection(taskId, value) {
      taskConnections.set(taskId, { ...value, checkedAt: now() });
      try { onStatus(); } catch (_) {}
    }

    function getTaskStatus(taskId) {
      const pairing = getPairing?.();
      const state = taskConnections.get(taskId);
      if (!pairing || !state || state.chat !== getConversationId?.() ||
          state.session !== pairing.reporting_session_id || state.key !== pairing.observer_key || state.origin !== pairing.origin ||
          now() - state.checkedAt > 12000) return 'checking';
      return state.status;
    }

    function check() {
      if (inFlight || typeof request !== 'function') return false;
      const chatId = getConversationId?.();
      const pairing = getPairing?.();
      if (!chatId || !pairing || !allowedOrigin(pairing.origin) ||
          pairing.conversation_id !== chatId ||
          !SESSION_RE.test(pairing.reporting_session_id || '') ||
          !/^[A-Za-z0-9_-]{40,70}$/.test(pairing.observer_key || '')) return false;
      const time = now();
      if (time - lastCheckAt < MIN_CHECK_INTERVAL_MS) return false;

      // Only tasks created in this chat under THIS reporting session are queried.
      // No raw message body, owner token, or arbitrary task is transmitted.
      const waiting = (messages?.listForChat(chatId) || [])
        .filter(record => TASK_RE.test(record.task_id || '') &&
          record.reporting_session_id === pairing.reporting_session_id &&
          (record.observatory_origin ?? LEGACY_ORIGIN) === pairing.origin &&
          record.activity_status !== 'accepted' &&
          ['sent', 'send_unconfirmed'].includes(record.send_status))
        .sort((a, b) => a.created_at - b.created_at);
      if (!waiting.length) return false;
      const selected = waiting[nextIndex++ % waiting.length];
      const expectedOrigin = pairing.origin;
      const expectedChat = chatId;
      const expectedSession = pairing.reporting_session_id;
      const expectedKey = pairing.observer_key;
      lastCheckAt = time;
      inFlight = true;

      function recordConnection(status) {
        const pairingNow = getPairing?.();
        if (getConversationId?.() !== expectedChat ||
            pairingNow?.reporting_session_id !== expectedSession ||
            pairingNow?.observer_key !== expectedKey ||
            pairingNow?.origin !== expectedOrigin) return;
        setConnection(selected.task_id, { chat: expectedChat, session: expectedSession,
          key: expectedKey, origin: expectedOrigin, status });
      }
      function settle() { inFlight = false; }
      try {
        request({
          method: 'GET',
          url: expectedOrigin + '/api/task-activity?session=' +
            encodeURIComponent(expectedSession) + '&task=' +
            encodeURIComponent(selected.task_id),
          headers: { 'X-Fortis-Observer-Key': expectedKey },
          timeout: 3000,
          onload(response) {
            settle();
            if (response?.status !== 200) {
              recordConnection(response?.status === 401 || response?.status === 403 ? 'denied' : 'unavailable');
              return;
            }
            try {
              const currentPairing = getPairing?.();
              if (getConversationId?.() !== expectedChat ||
                  currentPairing?.reporting_session_id !== expectedSession ||
                  currentPairing?.observer_key !== expectedKey ||
                  currentPairing?.origin !== expectedOrigin) return;
              const data = JSON.parse(response.responseText);
              if (data?.task_id !== selected.task_id ||
                  data?.reporting_session_id !== expectedSession ||
                  data?.conversation_id !== expectedChat) return;
              if (data?.ok !== true || data?.version !== 1 || typeof data.found !== 'boolean') return;
              recordConnection('online');
              if (data.found) messages.acceptActivity(data);
            } catch (_) { /* No private data in console logs. */ }
          },
          onerror() { settle(); recordConnection('unavailable'); },
          ontimeout() { settle(); recordConnection('unavailable'); }
        });
        return true;
      } catch (_) {
        settle();
        recordConnection('unavailable');
        return false;
      }
    }
    return { check, isChecking: () => inFlight, getTaskStatus };
  }
  return { createTaskActivityMonitor, describeWaitingActivity };
});

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ChatGPTTabNotifier = Object.assign(root.ChatGPTTabNotifier || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const SID = /^rs_[0-9a-f]{32}$/;
  const TASK = /^task_[0-9a-f]{32}$/;
  const KEY = /^[A-Za-z0-9_-]{40,70}$/;
  const PHASES = ['send_requested', 'send_unconfirmed', 'send_observed', 'send_not_attempted'];

  function createTaskIntentMonitor({ messages, getPairing, getConversationId, request,
    now = () => Date.now() } = {}) {
    let pending = null, lastCheck = -Infinity, cursor = 0, disposed = false;
    const retry = new Map();
    function check() {
      if (disposed || pending || typeof request !== 'function' || now() - lastCheck < 3500) return false;
      try {
        const pair = getPairing?.(), chat = getConversationId?.();
        if (!pair || pair.conversation_id !== chat || !SID.test(pair.reporting_session_id || '') ||
            !KEY.test(pair.task_intent_key || '') ||
            !['http://127.0.0.1:18754', 'http://127.0.0.1:18755'].includes(pair.origin)) return false;
        const binding = { chat, session: pair.reporting_session_id, origin: pair.origin,
          key: pair.task_intent_key };
        const valid = () => {
          const current = getPairing?.();
          return !disposed && getConversationId?.() === chat && current?.conversation_id === chat &&
            current?.origin === binding.origin && current?.reporting_session_id === binding.session &&
            current?.task_intent_key === binding.key;
        };
        const candidates = (messages?.listForChat(chat) || []).filter(record => {
          const state = retry.get(record.task_id);
          return record.intent_version === 1 && record.intent_ready === true && TASK.test(record.task_id || '') &&
            record.conversation_id === chat && record.reporting_session_id === binding.session &&
            record.observatory_origin === binding.origin &&
            Number.isSafeInteger(record.created_at) && record.created_at > 0 &&
            (record.intent_registered !== true ||
             (Number.isSafeInteger(record.send_revision) && record.send_revision > (record.intent_send_revision || 0) &&
              PHASES.includes(record.send_phase))) &&
            (!state || state.key !== binding.key || state.origin !== binding.origin ||
              state.session !== binding.session || now() >= state.next);
        }).sort((a, b) => a.created_at - b.created_at || a.task_id.localeCompare(b.task_id));
        if (!candidates.length) return false;
        const item = candidates[cursor++ % candidates.length];
        const revision = item.intent_registered === true ? item.send_revision : 0;
        const body = { version: 1, reporting_session_id: binding.session,
          conversation_id: chat, task_id: item.task_id,
          ...(revision === 0 ? { prepared_at_client_ms: item.created_at } : {
            revision, phase: item.send_phase, observed_at_client_ms: item.send_observed_at_client_ms }) };
        if (revision && (!Number.isSafeInteger(body.observed_at_client_ms) || body.observed_at_client_ms <= 0)) return false;
        const token = {};
        pending = token; lastCheck = now();
        function finish(status) {
          if (pending !== token) return;
          pending = null;
          if (!valid()) return;
          const previous = retry.get(item.task_id);
          const failures = status === 'online' ? 0 : Math.min((previous?.failures || 0) + 1, 6);
          retry.set(item.task_id, { ...binding, status, failures,
            next: now() + (status === 'online' ? 0 : Math.min(60000, 3500 * 2 ** failures)) });
          if (retry.size > 512) retry.delete(retry.keys().next().value);
        }
        try {
          request({ method: 'POST',
            url: binding.origin + (revision === 0 ? '/api/task-intents' : '/api/task-send-state'),
            headers: { 'Content-Type': 'application/json', 'X-Fortis-Task-Intent-Key': binding.key },
            data: JSON.stringify(body), timeout: 4000,
            onload(response) {
              if (pending !== token) return;
              if (!valid()) { pending = null; return; }
              if (![200, 201].includes(response?.status)) {
                finish([401, 403].includes(response?.status) ? 'denied' :
                  response?.status === 409 ? 'conflict' : 'unavailable'); return;
              }
              try {
                const receipt = JSON.parse(response.responseText);
                finish(messages.acceptIntentSync(item.task_id, revision, receipt) ? 'online' : 'unavailable');
              } catch (_) { finish('unavailable'); }
            },
            onerror() { finish('unavailable'); }, ontimeout() { finish('unavailable'); }
          });
        } catch (_) { finish('unavailable'); }
        return true;
      } catch (_) { return false; }
    }
    return { check, dispose() { disposed = true; pending = null; },
      isChecking: () => pending !== null,
      getTaskStatus(task) {
        const pair = getPairing?.(), state = retry.get(task);
        return state && state.chat === getConversationId?.() && state.session === pair?.reporting_session_id &&
          state.key === pair?.task_intent_key && state.origin === pair?.origin ? state.status : 'checking';
      } };
  }
  return { createTaskIntentMonitor };
});

(function (root, factory) {
  const api = factory(root.ChatGPTTabNotifier || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ChatGPTTabNotifier = Object.assign(root.ChatGPTTabNotifier || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  'use strict';

  const LEGACY_ORIGIN = 'http://127.0.0.1:18753';
  const allowedOrigin = deps.allowedObservatoryOrigin ||
    (origin => origin === LEGACY_ORIGIN || origin === 'http://127.0.0.1:18754' || origin === 'http://127.0.0.1:18755');
  const TASK_RE = /^task_[0-9a-f]{32}$/;
  const SESSION_RE = /^rs_[0-9a-f]{32}$/;
  const WRITER_RE = /^[A-Za-z0-9_-]{40,70}$/;
  const CHECK_INTERVAL_MS = 3500;

  function createUserMessageArchiveMonitor({
    messages, getPairing, getConversationId, request, now = () => Date.now()
  } = {}) {
    let inFlight = false;
    let lastCheckAt = -Infinity;
    let nextIndex = 0;

    function check() {
      if (inFlight || typeof request !== 'function') return false;
      const chat = getConversationId?.();
      const pair = getPairing?.();
      if (!chat || !pair || !allowedOrigin(pair.origin) ||
          pair.conversation_id !== chat ||
          !SESSION_RE.test(pair.reporting_session_id || '') ||
          !WRITER_RE.test(pair.message_writer_key || '')) return false;
      const current = now();
      if (current - lastCheckAt < CHECK_INTERVAL_MS) return false;

      const candidates = (messages?.listForChat(chat) || [])
        .filter(record => TASK_RE.test(record.task_id || '') &&
          record.conversation_id === chat &&
          record.reporting_session_id === pair.reporting_session_id &&
          (record.observatory_origin ?? LEGACY_ORIGIN) === pair.origin &&
          record.activity_status === 'accepted' &&
          record.archive_status !== 'archived' &&
          ['sent', 'send_unconfirmed'].includes(record.send_status))
        .sort((a, b) => a.created_at - b.created_at);
      if (!candidates.length) return false;
      const record = candidates[nextIndex++ % candidates.length];
      const expectedPair = { origin: pair.origin, conversation_id: chat,
        reporting_session_id: pair.reporting_session_id,
        message_writer_key: pair.message_writer_key };

      // Only an already accepted task is eligible. Full text never goes in
      // the event inbox, URLs, query string, or console.
      const body = JSON.stringify({
        reporting_session_id: record.reporting_session_id,
        conversation_id: record.conversation_id,
        task_id: record.task_id,
        original_text: record.original_text
      });
      lastCheckAt = current;
      inFlight = true;
      const settle = () => { inFlight = false; };
      try {
        request({
          method: 'POST',
          url: expectedPair.origin + '/api/user-messages',
          headers: {
            'Content-Type': 'application/json',
            'X-Fortis-Message-Writer-Key': expectedPair.message_writer_key
          },
          data: body,
          timeout: 4000,
          async onload(response) {
            settle();
            if (response?.status !== 201 && response?.status !== 200) return;
            try {
              const currentPair = getPairing?.();
              if (getConversationId?.() !== chat ||
                  currentPair?.origin !== expectedPair.origin ||
                  currentPair?.reporting_session_id !== expectedPair.reporting_session_id ||
                  currentPair?.message_writer_key !== expectedPair.message_writer_key) return;
              const receipt = JSON.parse(response.responseText);
              if (receipt.task_id !== record.task_id ||
                  receipt.reporting_session_id !== expectedPair.reporting_session_id ||
                  receipt.conversation_id !== chat) return;
              // Server read-back is required. Independently verify its digest
              // before changing local status to archived.
              if (!globalThis.crypto?.subtle || typeof TextEncoder !== 'function') return;
              const bytes = new TextEncoder().encode(record.original_text);
              const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
              const digestHex = Array.from(new Uint8Array(digest),
                value => value.toString(16).padStart(2, '0')).join('');
              if (receipt.sha256 !== digestHex) return;
              messages.acceptArchive(receipt);
            } catch (_) { /* preserve local pending for later retry */ }
          },
          onerror: settle,
          ontimeout: settle
        });
        return true;
      } catch (_) {
        settle();
        return false;
      }
    }

    return { check, isChecking: () => inFlight };
  }
  return { createUserMessageArchiveMonitor };
});

(function (root, factory) {
  const api = factory(root.ChatGPTTabNotifier || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ChatGPTTabNotifier = Object.assign(root.ChatGPTTabNotifier || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  'use strict';

  const SID = /^rs_[0-9a-f]{32}$/;
  const DID = /^dispatch_[0-9a-f]{32}$/;
  const KEY = /^[A-Za-z0-9_-]{40,70}$/;
  const TASK = /^task_[0-9a-f]{32}$/;
  const MAX_BYTES = 512 * 1024;

  function validDispatchPair(pair, chat) {
    return Boolean(pair && pair.origin === 'http://127.0.0.1:18755' &&
      pair.conversation_id === chat && SID.test(pair.reporting_session_id || '') &&
      KEY.test(pair.dispatch_key || ''));
  }

  function createSessionDispatchMonitor({
    getPairing, getConversationId, request, queue, messages, profiles,
    quickAction = null,
    findComposerContext = deps.findComposerContext,
    isGenerating = deps.isGenerating, canExecute = () => true,
    now = () => Date.now(),
    report = () => {}
  } = {}) {
    let pending = false;
    let lastCheck = -Infinity;
    let lastDispatch = '';
    let lastModulesSync = -Infinity;
    const MIN_POLL_MS = 3500;
    function syncModules(pair, chat) {
      if(!current(pair, chat) || !profiles?.getProfiles ||
         now()-lastModulesSync<12000)return;
      lastModulesSync=now();
      try {
        const state=profiles.getProfiles();
        if(!state || !Array.isArray(state.profiles) || !state.profiles.length)return;
        const catalog=profiles.getCatalog?.();
        const safe=(Array.isArray(catalog)?catalog:[]).slice(0,200).map(item=>({
          id:item.id,title:String(item.title||item.id).slice(0,140)
        }));
        const ids=new Set(safe.map(x=>x.id));
        const allProfiles=state.profiles.slice(0,40).map(p=>({
          id:p.id,name:p.name,module_ids:[...p.moduleIds]
        }));
        const active=state.profiles.find(p=>p.id===state.active)?.moduleIds||[];
        const defaults=active.filter(id=>ids.has(id));
        request({
          method:'POST',url:pair.origin+'/api/dispatch/modules',
          headers:{'Content-Type':'application/json',
            'X-Fortis-Dispatch-Key':pair.dispatch_key},
          data:JSON.stringify({session:pair.reporting_session_id,chat,
            modules:safe,default_module_ids:defaults,
            profiles:allProfiles,active_profile_id:state.active}),
          timeout:3000,onload(){},onerror(){},ontimeout(){}
        });
      }catch(_){}
    }

    function current(pair, chat) {
      const actual = getPairing?.();
      return getConversationId?.() === chat && validDispatchPair(actual, chat) &&
        actual.reporting_session_id === pair.reporting_session_id &&
        actual.dispatch_key === pair.dispatch_key;
    }
    function ack(pair, chat, command, status, taskId = null, reason = null,
                 detail = null) {
      if (!current(pair, chat)) return;
      try {
        request({
          method: 'POST',
          url: pair.origin + '/api/dispatch/ack',
          headers: {'Content-Type': 'application/json',
            'X-Fortis-Dispatch-Key': pair.dispatch_key},
          data: JSON.stringify({
            session: pair.reporting_session_id, chat,
            dispatch_id: command.dispatch_id, status, task_id: taskId,
            ...(reason?{reason}:{}),
            ...(detail?{detail}:{})
          }),
          timeout: 3000,
          onload() {}, onerror() {}, ontimeout() {}
        });
      } catch (_) {}
    }

    async function execute(data, pair, chat) {
      const command = data?.command;
      const moduleIds=command?.module_ids===undefined?null:command.module_ids;
      const profileId=command?.profile_id??null;
      if (!command || !DID.test(command.dispatch_id || '') ||
          !['insert','send','file','send_prepared'].includes(command.mode) ||
          (profileId!==null&&
           (typeof profileId!=='string'||!/^[a-z0-9][a-z0-9_-]{0,55}$/.test(profileId))) ||
          (command.delay_ms !== undefined &&
            (!Number.isSafeInteger(command.delay_ms)||command.delay_ms<0||
             command.delay_ms>10000||command.mode!=='send')) ||
          typeof command.text !== 'string' ||
          (command.mode!=='send_prepared'&&!command.text.trim()) ||
          (moduleIds!==null&&(!Array.isArray(moduleIds) || moduleIds.length>100 ||
          moduleIds.some(id=>typeof id!=='string'||
            !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(id)))) ||
          new TextEncoder().encode(command.text).length > MAX_BYTES ||
          !current(pair, chat)) return;
      // The local owner-local broker does not redeliver an already claimed
      // command. The local guard additionally rejects unexpected duplicated callbacks.
      if (lastDispatch === command.dispatch_id) return;
      lastDispatch = command.dispatch_id;
      let status = 'refused', taskId = null, reason = 'unknown', detail = null;
      try {
        const context = findComposerContext?.();
        const composer = context?.composer;
        if (!composer || composer.isConnected === false ||
            composer.disabled || composer.readOnly ||
            queue?.isWaitingToSend?.() || queue?.isInsertingOnly?.() ||
            isGenerating?.() || !canExecute(context)) return;
        if(typeof quickAction === 'function'){
          // Reuse Notifier File/Insert/Send button pipeline with its file
          // hash guard, Planning Helper context and task-id retention.
          if(command.mode==='send' &&
             (deps.readComposerText?.(composer)||composer.value||composer.innerText||'').trim())
            return;
          const outcome=await quickAction({
            mode:command.mode,text:command.text, moduleIds,profileId,
            ...(command.mode==='send' ? {delayMs:command.delay_ms===undefined?1000:command.delay_ms} : {})
          });
          if(command.mode==='file'&&typeof outcome?.detail==='string'&&
             outcome.detail.length<=512)detail=outcome.detail;
          if(!outcome?.ok){
            reason=outcome?.reason||'unknown';
            if(command.mode==='file'&&outcome?.attachmentAttempted&&current(pair,chat)){
              status=outcome.attachmentConfirmed?'attachment_only':'attachment_unconfirmed';
            }
          }
          if(outcome?.ok && current(pair,chat)){
            if(command.mode==='file'||command.mode==='insert'){
              if(TASK.test(outcome.taskId||'')){
                taskId=outcome.taskId;
                status=command.mode==='file'?'file_attached':'inserted';
              } else reason='prepared_missing';
            } else if(command.mode==='send_prepared'){
              if(TASK.test(outcome.taskId||'')){
                status='send_initiated';taskId=outcome.taskId;
              } else reason='not_confirmed';
            } else if(TASK.test(outcome.taskId||'')){
              const record=(messages?.listForChat?.(chat)||[]).find(
                entry=>entry.task_id===outcome.taskId);
              if(record&&['send_queued','send_unconfirmed','sent'].includes(record.send_status)){
                status='send_initiated';taskId=outcome.taskId;
              }
            }
          }
        }else if (command.mode === 'insert') {
          const outcome = await queue?.insertOnly?.(command.text);
          if (outcome?.ok && current(pair, chat)) status = 'inserted';
        } else if(command.mode==='send') {
          // Never replace another user's active ChatGPT draft.
          if ((deps.readComposerText?.(composer) || composer.value || composer.innerText || '').trim()) return;
          const options = profiles?.prepare
            ? profiles.prepare(command.text) : {minComposerDwellMs: 1000, extraText: ''};
          if (!current(pair, chat)) return;
          const id = messages?.saveAndSend?.(command.text, {
            minComposerDwellMs: options.minComposerDwellMs,
            extraText: options.extraText || ''
          });
          if (TASK.test(id || '')) {
            const record = (messages?.listForChat?.(chat) || []).find(item => item.task_id === id);
            if (record && ['send_queued', 'send_unconfirmed', 'sent'].includes(record.send_status)) {
              status = 'send_initiated';
              taskId = id;
            }
          }
        }
      } catch (_) {
        status = 'refused';
      } finally {
        ack(pair, chat, command, status, taskId,
          ['refused','attachment_only','attachment_unconfirmed'].includes(status)?reason:null,
          command.mode==='file'?detail:null);
        try { report(status); } catch (_) {}
      }
    }

    function check() {
      if (pending || typeof request !== 'function') return false;
      const pair = getPairing?.(), chat = getConversationId?.();
      if (!validDispatchPair(pair, chat)) return false;
      if (now() - lastCheck < MIN_POLL_MS) return false;
      lastCheck = now(); pending = true;
      syncModules(pair,chat);
      try {
        request({
          method: 'GET',
          url: pair.origin + '/api/dispatch/poll?session=' +
            encodeURIComponent(pair.reporting_session_id) + '&chat=' +
            encodeURIComponent(chat),
          headers: {'X-Fortis-Dispatch-Key': pair.dispatch_key},
          timeout: 3000,
          onload(response) {
            pending = false;
            if (response?.status !== 200 || !current(pair, chat)) return;
            try {
              const data = JSON.parse(response.responseText);
              if (data?.ok !== true || data.session !== pair.reporting_session_id ||
                  data.chat !== chat) return;
              // async execution acknowledges only once it tried the action.
              void execute(data, pair, chat);
            } catch (_) {}
          },
          onerror() { pending = false; },
          ontimeout() { pending = false; }
        });
        return true;
      } catch (_) {
        pending = false;
        return false;
      }
    }

    return {check, isPolling: () => pending};
  }
  return {createSessionDispatchMonitor, validDispatchPair};
});

(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.ChatGPTTabNotifier=Object.assign(root.ChatGPTTabNotifier||{},api);
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  // THE ONLY CODE REGISTRY FOR BEHAVIOR MODULES.
  // To add one, declare id/title/description, defaultEnabled and apply(context).
  // The Notifier settings switch appears automatically; NO JS editor or dynamic
  // code execution exists in either browser UI or the Planning Helper catalog.
  const TEXTBOX_BEHAVIOR_PLUGINS=Object.freeze([
    Object.freeze({
      id:'task-id',title:'Task ID и точный оригинал',required:true,
      description:'Штатная генерация и сохранение task_id. Защищённая основа всегда включена.',
      apply(){/* Implemented in persistentMessageController, deliberately non-disableable. */}
    }),
    Object.freeze({
      id:'native-send-dwell',title:'Пауза перед Send · 1 сек',
      required:false,defaultEnabled:true,
      description:'Ждать одну секунду после переноса текста в обычное поле ChatGPT.',
      apply(context){context.minComposerDwellMs=1000;}
    }),
    Object.freeze({
      id:'focus-after-send',title:'Возврат фокуса в Textbox',
      required:false,defaultEnabled:true,
      description:'После подготовки сообщения вернуть курсор в новое поле.',
      apply(context){context.focusAfterSend=true;}
    })
  ]);
  return {TEXTBOX_BEHAVIOR_PLUGINS};
});

(function(root,factory){
  const registry=typeof require==='function'?require('./textbox-behaviors.js'):(root.ChatGPTTabNotifier||{});
  const api=factory(registry);
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.ChatGPTTabNotifier=Object.assign(root.ChatGPTTabNotifier||{},api);
})(typeof globalThis!=='undefined'?globalThis:this,function(registry){
  'use strict';
  const CHANNEL='fortis-shared-helper-text-modules-v1';
  const STORAGE_KEY='fortis-textbox-profiles-v1';
  const MODULE_ID=/^[a-z0-9][a-z0-9._-]{0,79}$/;
  const BEHAVIORS=registry.TEXTBOX_BEHAVIOR_PLUGINS;
  function defaultProfiles(){
    return {version:1,active:'default',profiles:[{
      id:'default',name:'Обычный',moduleIds:[],
      behavior:Object.fromEntries(BEHAVIORS.filter(b=>!b.required)
        .map(b=>[b.id,b.defaultEnabled===true]))
    }]};
  }
  function normalizeProfiles(value){
    if(!value||value.version!==1||!Array.isArray(value.profiles)||
       !value.profiles.length||value.profiles.length>40)throw new Error('BAD_PROFILE_STORE');
    const ids=new Set();
    const profiles=value.profiles.map(p=>{
      if(typeof p.id!=='string'||!/^[a-z0-9][a-z0-9_-]{0,55}$/.test(p.id)||
         ids.has(p.id)||typeof p.name!=='string'||!p.name.trim()||p.name.length>70||
         !Array.isArray(p.moduleIds)||p.moduleIds.length>100||
         p.moduleIds.some(id=>!MODULE_ID.test(id))||
         new Set(p.moduleIds).size!==p.moduleIds.length)throw new Error('BAD_PROFILE');
      if(p.promptId!==undefined&&p.promptId!==null&&
         (typeof p.promptId!=='string'||!MODULE_ID.test(p.promptId)))throw new Error('BAD_PROFILE_PROMPT');
      ids.add(p.id);
      const behavior={};
      for(const b of BEHAVIORS.filter(item=>!item.required)){
        behavior[b.id]=typeof p.behavior?.[b.id]==='boolean'?
          p.behavior[b.id]:b.defaultEnabled===true;
      }
      return {id:p.id,name:p.name.trim(),moduleIds:[...p.moduleIds],
        ...(p.promptId?{promptId:p.promptId}:{}),behavior};
    });
    if(!ids.has(value.active))throw new Error('BAD_ACTIVE_PROFILE');
    return {version:1,active:value.active,profiles};
  }
  function normalizeCatalog(value){
    if(!Array.isArray(value)||value.length>2000)throw new Error('INVALID_MODULE_CATALOG');
    let total=0;
    const seen=new Set();
    return value.map(m=>{
      if(!m||typeof m.id!=='string'||!MODULE_ID.test(m.id)||seen.has(m.id)||
         typeof m.title!=='string'||m.title.length>300||
         typeof m.text!=='string'||m.text.length>100000)
        throw new Error('INVALID_MODULE_CATALOG');
      seen.add(m.id);total+=m.text.length;
      if(total>600000)throw new Error('MODULE_CATALOG_TOO_LARGE');
      return {id:m.id,title:m.title,text:m.text};
    });
  }
  function resolveSelectedText(profile,catalog,prompts=null){
    if(!profile?.moduleIds?.length&&!profile?.promptId)return '';
    if(catalog===null)throw new Error('Planning Helper не подключён. Модули недоступны.');
    const byId=new Map(catalog.map(m=>[m.id,m]));
    // Expand only literal module references. Bound every append, including
    // repeated references, before allocating an oversized composed string.
    function expand(text,stack=[]){
      let out='',cursor=0;
      function append(piece){
        if(out.length+piece.length>100000)throw new Error('Слишком длинный результат модулей');
        out+=piece;
      }
      for(const match of text.matchAll(/\[\[module:([a-z0-9][a-z0-9._-]{0,79})\]\]/g)){
        append(text.slice(cursor,match.index));
        append(resolve(match[1],stack));cursor=match.index+match[0].length;
      }
      append(text.slice(cursor));return out;
    }
    function resolve(id,stack=[]){
      if(stack.includes(id)||stack.length>24)throw new Error('Цикл ссылок модулей: '+id);
      const value=byId.get(id);
      if(!value)throw new Error('Нет локального модуля: '+id);
      return expand(value.text,[...stack,id]);
    }
    const content=[];
    if(profile.promptId){
      if(prompts===null)throw new Error('Helper не передал каталог промптов. Обнови вкладки ChatGPT и запроси каталог.');
      const prompt=prompts.find(p=>p.id===profile.promptId);
      if(!prompt)throw new Error('Нет локального промпта: '+profile.promptId);
      content.push(expand(prompt.text));
    }
    content.push(...profile.moduleIds.map(id=>resolve(id)));
    if(content.join('\n\n').length>100000)throw new Error('Слишком длинный результат модулей');
    return content.filter(Boolean).join('\n\n');
  }
  function createTextboxProfileManager({getValue,setValue,Channel=typeof BroadcastChannel==='function'?BroadcastChannel:null,onChange=()=>{}}={}){
    let value=defaultProfiles(),catalog=null,prompts=null,connected=false,channel=null,lastError='',profileReadFailed=false;
    let fullCatalogSeen=false;
    function notify(){try{onChange();}catch(_){}}
    try{
      const raw=getValue?.(STORAGE_KEY,null);
      if(raw!==null&&raw!==undefined)value=normalizeProfiles(
        typeof raw==='string'?JSON.parse(raw):raw);
    }catch(_){profileReadFailed=true;lastError='Не удалось прочитать профили; сохранение заблокировано.';}
    if(Channel){
      try{
        channel=new Channel(CHANNEL);
        const handler=event=>{
          const message=event?.data;
          if(message?.protocol!==CHANNEL||message.type!=='catalog')return;
          // Open tabs can still run the pre-prompts Helper. Once a verified
          // full catalog arrives, never downgrade to their module-only reply.
          // Keep the complete snapshot atomic, including its module bodies.
          if(fullCatalogSeen&&message.prompts===undefined)return;
          try{
            const modules=normalizeCatalog(message.modules);
            const nextPrompts=message.prompts===undefined?null:normalizeCatalog(message.prompts);
            catalog=modules;prompts=nextPrompts;connected=true;
            if(nextPrompts!==null)fullCatalogSeen=true;
            if(!profileReadFailed)lastError='';notify();}
          catch(_){catalog=null;prompts=null;connected=false;lastError='Некорректный каталог Helper';notify();}
        };
        if(typeof channel.addEventListener==='function')channel.addEventListener('message',handler);
        else channel.onmessage=handler;
      }catch(_){lastError='Канал Planning Helper недоступен';}
    }
    function persist(next){
      if(profileReadFailed)throw new Error('Нельзя перезаписывать повреждённые профили.');
      const checked=normalizeProfiles(next);
      if(typeof setValue!=='function'||typeof getValue!=='function')throw new Error('GM хранилище профилей недоступно');
      const serialized=JSON.stringify(checked);
      setValue(STORAGE_KEY,serialized);
      const actual=getValue(STORAGE_KEY,null);
      const normalized=normalizeProfiles(typeof actual==='string'?JSON.parse(actual):actual);
      if(JSON.stringify(normalized)!==serialized)throw new Error('Не удалось подтвердить сохранение профиля');
      value=checked;notify();
    }
    function current(){return value.profiles.find(p=>p.id===value.active);}
    function modify(changer){
      const next=structuredCloneFallback(value);
      changer(next,next.profiles.find(p=>p.id===next.active));
      persist(next);
    }
    function structuredCloneFallback(object){return JSON.parse(JSON.stringify(object));}
    function createProfile(name){
      const label=String(name||'').trim();
      if(!label||label.length>70)throw new Error('Название профиля: 1–70 символов');
      const id='p'+Date.now().toString(36)+Math.random().toString(36).slice(2,8);
      modify(next=>{const behavior=Object.fromEntries(
        BEHAVIORS.filter(b=>!b.required).map(b=>[b.id,b.defaultEnabled===true]));
        next.profiles.push({id,name:label,moduleIds:[],behavior});next.active=id;});
      return id;
    }
    function deleteProfile(){
      if(value.profiles.length===1)throw new Error('Последний профиль удалить нельзя');
      modify(next=>{next.profiles=next.profiles.filter(p=>p.id!==next.active);next.active=next.profiles[0].id;});
    }
    function setActive(id){
      if(!value.profiles.some(p=>p.id===id))throw new Error('Нет такого профиля');
      modify(next=>{next.active=id;});
    }
    function addModulesByReferences(value){
      // AI may SUGGEST existing IDs, but cannot mutate GM data itself.
      // User must paste the reference list and confirm via the settings UI.
      // Accept plain IDs or Helper's [[module:id]] references, separated by
      // commas, semicolons, newlines or spaces. Never execute instructions/JS.
      const input=String(value||'').trim();
      if(!input||input.length>1800)throw new Error('Укажи не более 20 ID модулей');
      const parts=input.split(/[\s,;]+/).filter(Boolean);
      if(parts.length>20)throw new Error('Допускается максимум 20 модулей за раз');
      const ids=parts.map(part=>{
        const id=part.startsWith('[[module:')&&part.endsWith(']]')
          ?part.slice(9,-2):part;
        if(!MODULE_ID.test(id))throw new Error('Неверная ссылка на модуль: '+part.slice(0,90));
        return id;
      });
      if(!catalog)throw new Error('Planning Helper не подключён. Нельзя подтвердить ID.');
      const known=new Set(catalog.map(m=>m.id));
      for(const id of ids){
        if(!known.has(id))throw new Error('Нет локального модуля Planning Helper: '+id);
      }
      const unique=[...new Set(ids)];
      const selected=current().moduleIds;
      const additions=unique.filter(id=>!selected.includes(id));
      if(additions.length){
        // Validate the entire proposed resulting profile, including nested
        // dependencies, before making any persistent changes.
        resolveSelectedText({...current(),moduleIds:[...selected,...additions]},catalog,prompts);
        modify((_next,p)=>{p.moduleIds.push(...additions);});
      }
      return additions;
    }
    function setPrompt(id){
      if(id===null){modify((_next,p)=>{delete p.promptId;});return;}
      if(typeof id!=='string'||!MODULE_ID.test(id))throw new Error('Неверный ID промпта');
      // Resolve the complete prospective profile before verified GM persistence.
      resolveSelectedText({...current(),promptId:id},catalog,prompts);
      modify((_next,p)=>{p.promptId=id;});
    }
    function addModule(id){return addModulesByReferences(id);}
    function removeModule(id){modify((_next,p)=>{p.moduleIds=p.moduleIds.filter(v=>v!==id);});}
    function moveModule(id,direction){
      modify((_next,p)=>{const i=p.moduleIds.indexOf(id),j=i+direction;
        if(i>=0&&j>=0&&j<p.moduleIds.length)
          [p.moduleIds[i],p.moduleIds[j]]=[p.moduleIds[j],p.moduleIds[i]];
      });
    }
    function setBehavior(id,enabled){
      if(!BEHAVIORS.some(b=>b.id===id&&!b.required))throw new Error('Этот JS-модуль нельзя переключить');
      modify((_next,p)=>{p.behavior[id]=Boolean(enabled);});
    }
    function prepareForProfile(original,profileId=null,moduleIds=null){
      if(profileReadFailed)throw new Error('Профили не прочитаны. Отправка из Textbox отменена.');
      const source=String(original);
      const active=profileId===null?current():value.profiles.find(p=>p.id===profileId);
      if(!active)throw new Error('Профиль Observatory больше не существует в Notifier.');
      let effective=active;
      if(moduleIds!==null){
        if(!Array.isArray(moduleIds)||moduleIds.length>100||
           moduleIds.some(id=>typeof id!=='string'||!MODULE_ID.test(id))||
           new Set(moduleIds).size!==moduleIds.length)
          throw new Error('Неверный список модулей Observatory.');
        // Only known catalog IDs; no remote module body or JS code accepted.
        if(moduleIds.length && (!catalog||moduleIds.some(id=>!catalog.some(item=>item.id===id))))
          throw new Error('Модули Observatory недоступны в Planning Helper.');
        effective={...active,moduleIds:[...moduleIds]};
      }
      const text=resolveSelectedText(effective,catalog,prompts);
      const context={original:source,extraText:text,
        minComposerDwellMs:0,focusAfterSend:false};
      for(const plugin of BEHAVIORS){
        if(plugin.required||active.behavior[plugin.id]!==false)
          plugin.apply(context);
      }
      return context;
    }
    function prepareForModules(original,moduleIds=null){
      return prepareForProfile(original,null,moduleIds);
    }
    function prepare(original){return prepareForProfile(original);}
    function requestCatalog(){channel?.postMessage({protocol:CHANNEL,type:'request'});}
    return {requestCatalog,getCatalog:()=>catalog?catalog.map(m=>({...m})):null,
      getPromptCatalog:()=>prompts?prompts.map(p=>({...p})):null,
      getProfiles:()=>structuredCloneFallback(value),getActive:()=>structuredCloneFallback(current()),
      isConnected:()=>connected,getError:()=>lastError,getBehaviors:()=>BEHAVIORS,
      createProfile,deleteProfile,setActive,setPrompt,addModule,addModulesByReferences,removeModule,moveModule,setBehavior,
      prepare,prepareForModules,prepareForProfile,close:()=>channel?.close?.()};
  }
  return {SHARED_MODULE_CHANNEL:CHANNEL,TEXTBOX_PROFILE_STORAGE_KEY:STORAGE_KEY,
    TEXTBOX_BEHAVIORS:BEHAVIORS,normalizeProfiles,normalizeCatalog,
    resolveSelectedText,createTextboxProfileManager};
});

(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.ChatGPTTabNotifier=Object.assign(root.ChatGPTTabNotifier||{},api);
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function mountTextboxSettings({shadow,manager,positionPanel}){
    const row=shadow.querySelector('.row');
    const auto=shadow.querySelector('[data-role="auto-send"]');
    if(!row||!auto)return null;
    const style=document.createElement('style');
    style.textContent=`
      .auto-stack{display:flex;flex:0 0 34px;flex-direction:column;gap:5px;
        align-items:center;justify-content:center;height:83px}
      .settings-button{width:33px;height:33px;border:1px solid #64748b;
        border-radius:999px;background:#243044;color:white;font:18px system-ui;cursor:pointer}
      .settings-button[aria-expanded=true]{background:#3b507a}
      .textbox-modules-panel{position:absolute;right:0;z-index:9;overflow:auto;
        width:min(440px,calc(100vw - 22px));max-height:min(74vh,590px);
        padding:13px;border:1px solid #64748b;border-radius:12px;
        background:#131e2d;color:#eef5ff;font:12px/1.45 system-ui;
        box-shadow:0 14px 40px #000a;cursor:default;
        user-select:text;-webkit-user-select:text;touch-action:auto}
      .textbox-modules-panel[hidden]{display:none}
      .textbox-modules-panel h3{margin:3px 0 7px;font-size:15px}
      .textbox-modules-panel h4{margin:12px 0 6px;font-size:13px}
      .textbox-modules-panel p{margin:4px 0;color:#aabdda}
      .textbox-modules-panel input,.textbox-modules-panel select{background:#0b1320;color:#fff;
        border:1px solid #536378;border-radius:7px;padding:7px;min-width:0;font:12px system-ui}
      .textbox-modules-panel input[type=checkbox]{width:15px;height:15px;accent-color:#8ca5ff}
      .textbox-modules-panel button{background:#253349;color:#eef5ff;border:1px solid #465e7c;
        border-radius:7px;padding:6px;cursor:pointer}
      .textbox-modules-panel button:disabled{opacity:.4;cursor:default}
      .textbox-modules-panel .fields{display:flex;flex-wrap:wrap;gap:5px;margin:7px 0}
      .textbox-modules-panel .fields select,.textbox-modules-panel .fields input{flex:1 1 150px}
      .textbox-modules-panel .module-row{display:flex;gap:5px;align-items:center;
        border:1px solid #33455e;border-radius:8px;margin:5px 0;padding:7px}
      .textbox-modules-panel .module-row[hidden]{display:none}
      .textbox-modules-panel .module-title{flex:1;overflow-wrap:anywhere}
      .textbox-modules-panel label.behavior{display:flex;gap:8px;align-items:center;margin:7px 0}
      .textbox-modules-panel .preview{max-height:110px;overflow:auto;white-space:pre-wrap;
        font:11px/1.5 ui-monospace,monospace;color:#d1dffc;background:#0b1320;
        border:1px solid #374761;border-radius:8px;padding:8px}
      .textbox-modules-panel .settings-error{color:#f4b8b8;white-space:pre-wrap}
    `;
    shadow.appendChild(style);
    const stack=document.createElement('div');stack.className='auto-stack';
    auto.replaceWith(stack);stack.appendChild(auto);
    const button=document.createElement('button');
    button.type='button';button.className='settings-button';
    button.setAttribute('aria-label','Настройки профилей, промптов и модулей Textbox');
    button.setAttribute('aria-expanded','false');button.textContent='⚙';
    stack.appendChild(button);
    const panel=document.createElement('section');
    panel.className='textbox-modules-panel';panel.hidden=true;
    panel.setAttribute('aria-label','Настройки Fortis Textbox');
    panel.innerHTML=`
      <h3>⚙ Профили Textbox <button type="button" class="close" aria-label="Закрыть">×</button></h3>
      <p>Текстовые модули создаются и редактируются только в Planning Helper.</p>
      <div class="fields"><select class="profiles" aria-label="Текущий профиль"></select>
        <button type="button" class="delete-profile">Удалить профиль</button></div>
      <div class="fields"><input class="new-profile" maxlength="70" placeholder="Название нового профиля">
        <button type="button" class="create-profile">+ Профиль</button></div>
      <h4>Промпт профиля</h4>
      <p>Один промпт из Helper добавляется после твоего текста, перед модулями. Выбор не нажимает Send.</p>
      <div class="module-row selected-prompt" hidden aria-label="Подключённый промпт">
        <span class="module-title prompt-title"></span>
        <button type="button" class="detach-prompt" aria-label="Отключить промпт" title="Отключить промпт">×</button>
      </div>
      <p class="no-prompt">Без промпта.</p>
      <div class="fields"><input class="prompt-search" aria-label="Поиск промптов Planning Helper" placeholder="Поиск промпта по имени или ID..."></div>
      <div class="fields"><select class="available-prompts" aria-label="Доступные промпты Helper"></select>
        <button type="button" class="attach-prompt">Подключить промпт</button></div>
      <h4>Текстовые модули профиля</h4><div class="selected"></div>
      <div class="fields"><input class="module-search" aria-label="Поиск готовых модулей Planning Helper" placeholder="Поиск по имени или ID..."></div>
      <div class="fields"><select class="available" aria-label="Доступные модули Helper"></select>
        <button type="button" class="attach">Подключить</button></div>
      <div class="fields"><input class="ai-module-ids" maxlength="1800"
        aria-label="ID существующих модулей от AI"
        placeholder="ID или [[module:id]] от AI, через запятую">
        <button type="button" class="attach-ids">Подключить по ID</button></div>
      <p class="source"></p>
      <h4>Поведенческие модули · код</h4><div class="behavior-list"></div>
      <h4>Предпросмотр</h4><div class="preview"></div>
      <p class="settings-error" role="status"></p>`;
    row.appendChild(panel);
    const $=selector=>panel.querySelector(selector);
    let cache='';
    function act(fn){
      try{fn();$('.settings-error').textContent='';cache='';render();}
      catch(error){$('.settings-error').textContent=error.message||'Ошибка';}
    }
    function control(text,fn,disabled=false){
      const element=document.createElement('button');
      element.type='button';element.textContent=text;element.disabled=disabled;
      element.addEventListener('click',()=>act(fn));return element;
    }
    function render(){
      if(panel.hidden||!manager)return;
      const state=manager.getProfiles(),active=manager.getActive(),catalog=manager.getCatalog();
      const prompts=manager.getPromptCatalog();
      const signature=JSON.stringify([state,catalog,prompts,manager.isConnected(),manager.getError()]);
      if(signature===cache)return;
      cache=signature;
      const select=$('.profiles');select.replaceChildren();
      for(const p of state.profiles){
        const option=document.createElement('option');
        option.value=p.id;option.textContent=p.name;select.appendChild(option);
      }
      select.value=state.active;$('.delete-profile').disabled=state.profiles.length===1;
      const chosen=prompts?.find(p=>p.id===active.promptId);
      $('.selected-prompt').hidden=!active.promptId;
      $('.no-prompt').hidden=Boolean(active.promptId);
      $('.prompt-title').textContent=active.promptId
        ? (chosen?chosen.title:active.promptId+' (недоступен)') : '';
      $('.prompt-title').title=active.promptId||'';
      const promptSelect=$('.available-prompts'),previous=promptSelect.value;
      promptSelect.replaceChildren();
      const promptTerm=$('.prompt-search').value.trim().toLowerCase();
      for(const p of prompts||[]){
        if(promptTerm&&!(p.id+' '+p.title).toLowerCase().includes(promptTerm))continue;
        const option=document.createElement('option');
        option.value=p.id;option.textContent=p.title+' · '+p.id;promptSelect.appendChild(option);
      }
      if([...promptSelect.options].some(o=>o.value===previous))promptSelect.value=previous;
      else if([...promptSelect.options].some(o=>o.value===active.promptId))promptSelect.value=active.promptId;
      $('.attach-prompt').disabled=prompts===null||!promptSelect.options.length;
      $('.detach-prompt').disabled=!active.promptId;
      const list=$('.selected');list.replaceChildren();
      for(const [index,id] of active.moduleIds.entries()){
        const info=catalog?.find(m=>m.id===id);
        const line=document.createElement('div');line.className='module-row';
        const name=document.createElement('span');name.className='module-title';
        name.textContent=info?.title||id+' (недоступен)';
        line.append(name,
          control('↑',()=>manager.moveModule(id,-1),index===0),
          control('↓',()=>manager.moveModule(id,1),index===active.moduleIds.length-1),
          control('×',()=>manager.removeModule(id)));
        list.appendChild(line);
      }
      if(!active.moduleIds.length){const p=document.createElement('p');
        p.textContent='Нет подключённых модулей.';list.appendChild(p);}
      const available=$('.available');available.replaceChildren();
      const term=$('.module-search').value.trim().toLowerCase();
      for(const m of catalog||[]){
        if(active.moduleIds.includes(m.id)||
           (term&&!(m.id+' '+m.title).toLowerCase().includes(term)))continue;
        const option=document.createElement('option');
        option.value=m.id;option.textContent=m.title+' · '+m.id;available.appendChild(option);
      }
      $('.attach').disabled=!catalog||!available.options.length;
      $('.source').textContent=catalog
        ? 'Единая локальная библиотека Planning Helper · '+catalog.length+' модулей · '+
          (prompts===null?'каталог промптов ещё не получен: обнови вкладки ChatGPT':prompts.length+' промптов')+'. GitHub и редактор — только в Helper.'
        : 'Ожидаю Planning Helper. Модули не дублируются и не загружаются автоматически из GitHub.';
      const behaviors=$('.behavior-list');behaviors.replaceChildren();
      for(const b of manager.getBehaviors()){
        const label=document.createElement('label');label.className='behavior';
        const checkbox=document.createElement('input');checkbox.type='checkbox';
        checkbox.checked=b.required||active.behavior[b.id]!==false;
        checkbox.disabled=b.required;
        checkbox.addEventListener('change',()=>act(()=>manager.setBehavior(b.id,checkbox.checked)));
        const title=document.createElement('span');
        title.textContent=b.title+(b.required?' · обязательный':'');
        title.title=b.description;label.append(checkbox,title);behaviors.appendChild(label);
      }
      try{
        const prepared=manager.prepare('Текст пользователя');
        $('.preview').textContent=prepared.original+
          (prepared.extraText?'\n\n'+prepared.extraText:'');
      }catch(error){$('.preview').textContent=error.message;}
    }
    button.addEventListener('click',()=>{
      panel.hidden=!panel.hidden;button.setAttribute('aria-expanded',String(!panel.hidden));
      if(!panel.hidden){manager?.requestCatalog();cache='';render();positionPanel?.(panel);}
    });
    $('.close').addEventListener('click',()=>button.click());
    $('.profiles').addEventListener('change',event=>act(()=>manager.setActive(event.target.value)));
    $('.create-profile').addEventListener('click',()=>act(()=>{
      manager.createProfile($('.new-profile').value);$('.new-profile').value='';
    }));
    $('.delete-profile').addEventListener('click',()=>act(()=>manager.deleteProfile()));
    $('.attach').addEventListener('click',()=>act(()=>manager.addModule($('.available').value)));
    $('.attach-ids').addEventListener('click',()=>act(()=>{
      manager.addModulesByReferences($('.ai-module-ids').value);
      $('.ai-module-ids').value='';
    }));
    $('.attach-prompt').addEventListener('click',()=>act(()=>manager.setPrompt($('.available-prompts').value)));
    $('.detach-prompt').addEventListener('click',()=>act(()=>manager.setPrompt(null)));
    $('.prompt-search').addEventListener('input',()=>{cache='';render();});
    $('.module-search').addEventListener('input',()=>{cache='';render();});
    return {panel,button,render,close(){panel.hidden=true;button.setAttribute('aria-expanded','false');}};
  }
  return {mountTextboxSettings};
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

  // The original three actions retain their click handlers and 34px targets; settings is a fourth button.
  // The always-visible textbox to their right shares one draggable host.
  const UI_WIDTH = 422;
  const UI_HEIGHT = 88;
  const VIEWPORT_MARGIN = 6;
  const DRAG_THRESHOLD_PX = 8;
  const LARGE_PASTE_THRESHOLD = 12000;
  // Bound the entire exact-original pipeline to 512 KiB. Notifier must
  // preserve the real raw original instead of sending data that cannot be archived.
  const MAX_QUICK_SEND_BYTES = 512 * 1024;
  const MAX_FILE_PROMPT_BYTES = 4 * 1024 * 1024;

  // Per-chat, consecutive SHA-256 of the *original text*, never the filename
  // or mutable ChatGPT DOM. A reservation is kept even after an uncertain
  // upload attempt: a second click cannot accidentally duplicate that file.
  // Only a DIFFERENT text hash advances the last-seen value for this chat.
  function createConsecutiveFileHashGuard({ getValue, setValue,
    cryptoSource = globalThis.crypto } = {}) {
    const PREFIX = 'fortis-file-last-sha256-v1-';
    const CHAT = /^[A-Za-z0-9-]{8,100}$/;
    const SHA = /^[0-9a-f]{64}$/;
    function read(key) {
      const raw = getValue(key, null);
      if (raw == null) return null;
      let record = raw;
      if (typeof raw === 'string') {
        try { record = JSON.parse(raw); } catch (_) { throw Error('BAD_HASH_STATE'); }
      }
      if (!record || record.version !== 1 || !SHA.test(record.sha256))
        throw Error('BAD_HASH_STATE');
      return record.sha256;
    }
    async function reserve(chatId, original) {
      if (!CHAT.test(chatId || '') ||
          typeof original !== 'string' || !original.trim() ||
          typeof getValue !== 'function' || typeof setValue !== 'function' ||
          typeof cryptoSource?.subtle?.digest !== 'function')
        return { ok: false, reason: 'Защита SHA-256 недоступна; файл не прикреплён.' };
      try {
        const bytes = new TextEncoder().encode(original);
        const result = await cryptoSource.subtle.digest('SHA-256', bytes);
        const digest = Array.from(new Uint8Array(result), item =>
          item.toString(16).padStart(2, '0')).join('');
        const key = PREFIX + chatId;
        if (read(key) === digest) {
          return { ok: false, duplicate: true,
            reason: 'Этот же исходник уже прикреплялся/проверялся подряд (SHA-256 совпал). ' +
              'Повтор не выполняю, независимо от текста или вложений в ChatGPT.' };
        }
        const record = { version: 1, sha256: digest };
        setValue(key, JSON.stringify(record));
        if (read(key) !== digest)
          return { ok: false, reason: 'SHA-256 не сохранился; повтор запрещён.' };
        return { ok: true, sha256: digest };
      } catch (_) {
        return { ok: false, reason: 'Не удалось проверить или сохранить SHA-256. Файл не прикреплён.' };
      }
    }
    return { reserve };
  }

  // Deliberately independent from Observatory's text-original writer. This
  // preserves the exact prompt as a text attachment when ChatGPT's rich editor
  // cannot safely accept a large direct insertion.
  function createPromptTextFile(originalText, name, FileClass = globalThis.File) {
    const text = String(originalText ?? '');
    if (!text.trim()) throw new Error('Введите текст промпта.');
    if (typeof FileClass !== 'function' || typeof TextEncoder !== 'function')
      throw new Error('Создание файлов недоступно в браузере.');
    const bytes = new TextEncoder().encode(text).length;
    if (bytes > MAX_FILE_PROMPT_BYTES)
      throw new Error('Файл больше 4 МиБ; автоматическое создание отменено.');
    const filename = typeof name === 'string' && /^fortis-prompt-[0-9a-z-]+\.txt$/.test(name)
      ? name : 'fortis-prompt.txt';
    const file = new FileClass([text], filename, { type: 'text/plain;charset=utf-8' });
    if (file.size !== bytes) throw new Error('Не удалось проверить размер файла.');
    return file;
  }

  function isEligiblePromptFileInput(input) {
    if (!input || input.disabled || input.type !== 'file' || input.isConnected === false)
      return false;
    // Refuse photo-only pickers rather than injecting a .txt into the wrong tool.
    const accept = String(input.accept || '').toLowerCase();
    return !accept || accept.split(',').some(piece =>
      !piece.trim() || piece.trim() === '.txt' || piece.trim() === 'text/plain' ||
      piece.trim() === 'text/*' || piece.trim() === '*/*');
  }

  function attachPromptTextFile(input, file, {
    DataTransferClass = globalThis.DataTransfer,
    EventClass = globalThis.Event
  } = {}) {
    if (!isEligiblePromptFileInput(input) ||
        typeof DataTransferClass !== 'function' ||
        typeof EventClass !== 'function') return false;
    try {
      const transfer = new DataTransferClass();
      transfer.items.add(file);
      // Native pickers normally REPLACE the previous selection on each
      // change. Do not re-add old input.files: that would re-upload old files.
      // Existing accepted attachment cards are owned by ChatGPT, not here.
      input.files = transfer.files;
      if (!Array.from(input.files || []).some(item =>
        item?.name === file.name && item?.size === file.size)) return false;
      input.dispatchEvent(new EventClass('change', { bubbles: true }));
      // An accepted file *selection* is not proof of completed upload.
      return true;
    } catch (_) { return false; }
  }

  // Distinguish NO COMPATIBLE INPUT from UNKNOWN RESULT AFTER ONE ATTEMPT.
  // A React event handler can throw after consuming the change event. Never
  // try another input or a drop in that case.
  function tryPromptFileInputOnce(file, inputs, attach = attachPromptTextFile) {
    const chosen = Array.from(inputs || []).find(isEligiblePromptFileInput);
    if (!chosen) return false;
    try { attach(chosen, file); } catch (_) { /* outcome unknown; do not retry */ }
    return true;
  }

  function dropPromptTextFile(target, file, {
    DataTransferClass = globalThis.DataTransfer,
    DragEventClass = globalThis.DragEvent,
    EventClass = globalThis.Event
  } = {}) {
    if (!target || target.isConnected === false ||
        typeof DataTransferClass !== 'function' || typeof EventClass !== 'function') return false;
    try {
      const transfer = new DataTransferClass();
      transfer.items.add(file);
      for (const name of ['dragenter', 'dragover', 'drop']) {
        let event;
        if (typeof DragEventClass === 'function') {
          event = new DragEventClass(name, {
            bubbles: true, cancelable: true, dataTransfer: transfer
          });
        } else {
          event = new EventClass(name, { bubbles: true, cancelable: true });
          Object.defineProperty(event, 'dataTransfer', { value: transfer });
        }
        target.dispatchEvent(event);
      }
      // The synthetic event is only an attempt. Wait for a real attachment UI.
      return true;
    } catch (_) { return false; }
  }

  // One UI click = at most ONE file upload trigger (change OR drop).
  // Once a native input accepted our file, lack of an attachment card is an
  // UNKNOWN outcome, never authorization to try drag/drop as a retry.
  async function attemptPromptFileOnce({
    tryDirectInput, findPlus, afterPlus, tryMenuInput,
    tryDrop, waitForCard
  } = {}) {
    let path = null;
    if (tryDirectInput?.()) {
      path = 'input';
    } else {
      const plus = findPlus?.();
      if (plus) {
        // Opening + is not evidence of successful attachment. It may
        // trigger an OS picker; do not fall through to a synthetic drop.
        plus.click();
        if (afterPlus) await afterPlus();
        if (!tryMenuInput?.())
          return { attempted: false, confirmed: false, reason: 'menu-no-input' };
        path = 'menu-input';
      } else if (tryDrop?.()) {
        path = 'drop';
      }
    }
    if (!path) return { attempted: false, confirmed: false, reason: 'no-path' };
    // The platform may already own the file even if DOM inspection throws.
    // An exception during confirmation is NOT permission to upload again.
    let confirmed=false;
    try {confirmed=Boolean(await waitForCard?.())} catch (_) {confirmed=false}
    return { attempted: true, confirmed, path };
  }

  // Only fixed, user-visible Notifier messages may cross into owner-local
  // event history. NEVER forward arbitrary error.message, source text,
  // filenames, browser DOM, secrets or a whole composer draft.
  const KNOWN_FILE_INSERT_FAILURES = Object.freeze([
    'Нет текста для добавления.',
    'Другая передача уже выполняется.',
    'Редактор ChatGPT недоступен.',
    'Штатный черновик изменился; текст не заменён.',
    'Беседа или редактор изменились. Send не нажимался.',
    'Редактор не принял дополнение. Send не нажимался.',
    'После добавления черновик отличается посимвольно. Send не нажимался.',
    'Не удалось добавить текст.',
    'Нет текста для вставки.',
    'Штатное поле ChatGPT недоступно.',
    'Штатное поле уже содержит текст. Ничего не заменено.',
    'Вкладка или редактор изменились. Вставка остановлена, Send не нажимался.',
    'Редактор изменил часть текста (пробелы, переносы или символы). Исходник сохранён; Send не нажимался.',
    'Редактор ChatGPT не принял часть текста. Send не нажимался.',
    'Вставка не совпала с исходником посимвольно. Исходник сохранён; Send не нажимался.',
    'Не удалось вставить текст.'
  ]);
  const STATIC_FILE_DETAILS = Object.freeze([
    'Файл прикреплён, модули и Fortis task context добавлены без замены существующего текста. SHA-256 записан, Send НЕ нажат.',
    'Файл прикреплён, но нативный редактор недоступен. Исходник сохранён, Send не нажат.',
    'Не удалось сохранить task_id. Файл прикреплён, Send не нажат.',
    'Модули/контекст слишком длинны для безопасного добавления. Файл прикреплён, но текст не вставлен. Send не нажат.',
    'Карточка файла обнаружена, но Fortis-контекст не подтверждён. Не отправляй сообщение и не прикрепляй файл повторно.',
    'Этот же исходник уже прикреплялся/проверялся подряд (SHA-256 совпал). Повтор не выполняю, независимо от текста или вложений в ChatGPT.'
  ]);
  const FILE_FAILURE_PREFIX = 'Файл прикреплён, но контекст не добавлен: ';
  const FILE_FAILURE_SUFFIX = ' Не отправляй до ручной проверки.';
  function safeNotifierFileDetail(message) {
    if (typeof message !== 'string' || message.length > 512) return null;
    if (STATIC_FILE_DETAILS.includes(message)) return message;
    if (KNOWN_FILE_INSERT_FAILURES.some(reason =>
      message === FILE_FAILURE_PREFIX + reason + FILE_FAILURE_SUFFIX)) return message;
    const attempted = /^Одна попытка прикрепления \((?:input|menu-input|drop)\) выполнена, но ChatGPT не подтвердил карточку\. Возможно, файл уже добавлен\. Второй попытки НЕ делаю; проверь вложения вручную\. Send не нажат\.$/;
    return attempted.test(message) ? message : null;
  }

  function fileAttachmentVisible(container, name) {
    if (!container || !name) return false;
    // Never treat the composer itself, typed prompt text, file input, or a
    // generic live status as proof of an attachment. Only a dedicated file
    // preview/card may confirm the platform accepted the selection.
    let targets = [];
    try {
      targets = Array.from(container.querySelectorAll(
        '[data-testid], [aria-label], [title]'
      ));
    } catch (_) { return false; }
    return targets.some(node => {
      if (!node || node === container ||
          node.matches?.('input[type="file"], textarea, [role="textbox"]') ||
          node.closest?.('[contenteditable="true"], textarea, [role="textbox"]') ||
          node.querySelector?.('[contenteditable="true"], textarea, [role="textbox"]'))
        return false;
      const testId = String(node.getAttribute?.('data-testid') || '');
      const accessible = String(node.getAttribute?.('aria-label') || '');
      const title = String(node.getAttribute?.('title') || '');
      // Actual ChatGPT attachment button (verified from the owner's DOM):
      // <button class="composer-attachment-surface ..." type="button"
      //         aria-label="fortis-prompt-....txt"></button>
      // The aria-label is JUST the filename, not "Attachment: filename".
      // Require this exact button selector, never a generic labelled button.
      const isComposerSurface = node.matches?.(
        'button.composer-attachment-surface[type="button"][aria-label]') === true;
      // These markers identify attachment UI, not arbitrary filenames
      // mentioned in a prompt or in surrounding container text.
      const identified = isComposerSurface ||
        /(?:attachment|file[-_](?:card|chip|upload|preview)|upload[-_](?:card|chip|preview|item))/i.test(testId) ||
        /^(?:attachment|attached file|file attachment)\b/i.test(accessible);
      if (!identified) return false;
      const state = [
        node.getAttribute?.('data-state'), node.getAttribute?.('aria-busy'),
        accessible
      ].filter(Boolean).join(' ');
      if (/(?:loading|uploading|pending|failed|error|retry|processing|progress|\btrue\b)/i.test(state))
        return false;
      // Exact match is important: names that share a prefix may refer to
      // different files already attached to the same native composer.
      if (isComposerSurface) return accessible === name;
      const content = String(node.textContent || '').slice(0, 2000);
      if ([content, accessible, title].some(value => value.includes(name)))return true;
      // ChatGPT sometimes puts the exact filename in a child's title or
      // accessibility label rather than the preview card's textContent.
      // Still require the enclosing element to be an identified file card.
      let children=[];
      try {children=Array.from(node.querySelectorAll?.('[title], [aria-label]')||[])}
      catch (_) {return false}
      return children.some(child=>!child.matches?.('input[type="file"], textarea, [role="textbox"]')&&
        !child.closest?.('[contenteditable="true"], textarea, [role="textbox"]')&&
        [child.getAttribute?.('title'),child.getAttribute?.('aria-label')].some(
          text=>typeof text==='string'&&text.includes(name)));

    });
  }

  function createLargePasteDraft(threshold = LARGE_PASTE_THRESHOLD) {
    let fullText = null;

    function capture(pastedText, existingText = '', selectionStart = 0, selectionEnd = 0) {
      if (fullText !== null || typeof pastedText !== 'string') return false;
      const before = String(existingText);
      const start = Number.isInteger(selectionStart)
        ? Math.min(Math.max(selectionStart, 0), before.length) : before.length;
      const end = Number.isInteger(selectionEnd)
        ? Math.min(Math.max(selectionEnd, start), before.length) : start;
      const next = before.slice(0, start) + pastedText + before.slice(end);
      if (next.length < threshold) return false;
      fullText = next;
      return true;
    }

    function preview() {
      if (fullText === null) return '';
      const excerpt = fullText.slice(0, 360);
      return 'Большой промпт (' + fullText.length.toLocaleString('ru-RU') +
        ' символов) хранится в памяти вкладки. Полный текст не показан, при отправке он берётся целиком (лимит оригинала 512 КиБ). ' +
        'Нажмите ↗, чтобы открыть и отредактировать весь текст, или ⧉, чтобы его скопировать.\n\nНачало:\n' +
        excerpt + (fullText.length > excerpt.length ? '…' : '');
    }

    return {
      capture, preview,
      active: () => fullText !== null,
      text: visible => fullText === null ? String(visible || '') : fullText,
      clear() { fullText = null; }
    };
  }

  function floatingWidth(viewportWidth) {
    return Math.min(UI_WIDTH, Math.max(1, viewportWidth - 2 * VIEWPORT_MARGIN));
  }

  function shouldSendQuickTextboxKey(event) {
    // Shift+Enter or Alt+Enter inserts a newline. Never submit during IME
    // composition (Cyrillic, Japanese, etc.) or from a repeated keydown.
    return event?.key === 'Enter' && !event.shiftKey && !event.altKey &&
      !event.isComposing && event.keyCode !== 229 && !event.repeat;
  }

  function canStartFloatingDrag(target) {
    // Only the old three buttons or the new dedicated drag grip.
    // A textarea and Send button must keep their normal text/click gestures.
    return target?.closest?.('.control, .quick-grip') != null;
  }

  function clampFloatingPosition(position, viewportWidth, viewportHeight) {
    const maxLeft = Math.max(VIEWPORT_MARGIN, viewportWidth - floatingWidth(viewportWidth) - VIEWPORT_MARGIN);
    const maxTop = Math.max(VIEWPORT_MARGIN, viewportHeight - UI_HEIGHT - VIEWPORT_MARGIN);
    return {
      left: Math.min(Math.max(VIEWPORT_MARGIN, Number(position?.left) || VIEWPORT_MARGIN), maxLeft),
      top: Math.min(Math.max(VIEWPORT_MARGIN, Number(position?.top) || VIEWPORT_MARGIN), maxTop)
    };
  }

  function pagePersistedHistory(records, visibleCount = 20) {
    const all = Array.isArray(records) ? records : [];
    const count = Number.isInteger(visibleCount) ? Math.max(0, visibleCount) : 20;
    const items = all.slice(0, count);
    return {
      items, total: all.length, visible: items.length,
      localPending: all.filter(item => item?.archive_status !== 'archived').length,
      remaining: all.length - items.length
    };
  }

  function createUploadButtonUi({ tabState, uploadController, queuedPromptController,
    delayedSendController, persistentMessageController, taskActivityMonitor,
    textboxProfileManager }) {
    let repositionTimer = null;
    let suppressClickUntil = 0;
    let dragState = null;
    let draggedItemId = null;
    let persistedVisibleCount = 20;
    let persistedVisibleChat = null;
    const largePaste = createLargePasteDraft();
    const fileHashGuard = createConsecutiveFileHashGuard({
      getValue: typeof GM_getValue === 'function' ? GM_getValue : null,
      setValue: typeof GM_setValue === 'function' ? GM_setValue : null
    });

    let resetLargePasteView = () => { largePaste.clear(); };
    let cancelFileTransfer = () => {};
    // The public owner dispatch function must have a stable identity: the
    // controller is returned before ensureUi() creates the DOM event handlers.
    // Do not export an uninitialised inner handler (startup ReferenceError),
    // or snapshot a noop before ensureUi() (silent owner dispatch failures).
    let handleQuickDispatch = null;
    async function dispatchQuickAction(mode,text,moduleIds=null,profileId=null,delayMs=1000) {
      if(!['file','insert','send','send_prepared'].includes(mode)||
         typeof text!=='string'||(mode!=='send_prepared'&&!text.trim())||
         (moduleIds!==null&&(!Array.isArray(moduleIds)||
            moduleIds.some(id=>typeof id!=='string'))))return {ok:false};
      ensureUi();
      if (typeof handleQuickDispatch !== 'function')return {ok:false};
      return handleQuickDispatch(mode,text,moduleIds,profileId,delayMs);
    }

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
      host.style.width = floatingWidth(viewport.width) + 'px';
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
        return clampFloatingPosition({ left: box.left + 10, top: box.bottom - UI_HEIGHT - 10 }, viewport.width, viewport.height);
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
        panel.style.bottom = (UI_HEIGHT + 10) + 'px';
      } else {
        panel.style.bottom = 'auto';
        panel.style.top = (UI_HEIGHT + 10) + 'px';
      }
    }

    function renderQueueList(ui) {
      if (ui.panel.hidden) return;
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
      if (ui.panel.hidden) return;
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

    function renderPersistedList(ui) {
      // This list can synchronously read many full originals from GM storage.
      // Never do that on every ordinary UI refresh while the plus panel is closed.
      if (ui.panel.hidden || !ui.persistedList || !ui.persistedStatus) return;
      const controller = persistentMessageController;
      const activeChat = deps.currentChatId?.() || '';
      if (activeChat !== persistedVisibleChat) {
        persistedVisibleChat = activeChat;
        persistedVisibleCount = 20;
      }
      const storageHealthy = controller?.getStorageHealth?.() !== false;
      const allRecords = storageHealthy ? controller?.listForChat?.() || [] : [];
      const page = pagePersistedHistory(allRecords, persistedVisibleCount);
      const records = page.items;
      ui.persistedStatus.textContent = !storageHealthy
        ? 'Ошибка чтения локальной истории — записи не считаются удалёнными.'
        : (controller?.getLastStatus?.() || '');
      if (ui.persistedSummary) {
        ui.persistedSummary.textContent = storageHealthy
          ? 'В этом чате: ' + page.total + ' · ещё не архивировано: ' + page.localPending +
            ' · показано: ' + page.visible : 'Локальная история временно недоступна';
      }
      if (ui.persistedMore) {
        ui.persistedMore.hidden = !storageHealthy || page.remaining === 0;
      }
      ui.persistedList.replaceChildren();
      for (const record of records) {
        const row = document.createElement('div');
        row.className = 'persisted-row';
        const label = document.createElement('span');
        const status = {
          prepared: 'Подготовлено', send_queued: 'Отправка не подтверждена (проверьте чат)',
          send_failed: 'Не отправлено', send_unconfirmed: 'Отправка не подтверждена',
          sent: record.archive_status === 'archived' ? 'Архивировано Observatory'
            : record.activity_status === 'accepted'
              ? 'Сигнал принят; ожидает архивирования'
              : (deps.describeWaitingActivity?.({ record,
                  pairing: controller?.getPairingInfo?.(),
                  connection: taskActivityMonitor?.getTaskStatus?.(record.task_id) || 'checking'
                }) || 'Ожидает активности')
        }[record.send_status] || record.send_status;
        label.textContent = status + ' · ' + record.task_id + ' · '
          + record.original_text.slice(0, 85);
        row.appendChild(label);
        const full=document.createElement('button');full.type='button';full.textContent='Просмотреть';
        full.addEventListener('click',()=>{
          const existing=row.querySelector('.saved-original');
          if(existing){existing.remove();return;}
          const area=document.createElement('textarea');area.className='saved-original';
          area.readOnly=true;area.value=record.original_text;area.rows=7;
          area.setAttribute('aria-label','Сохранённый полный оригинал');row.append(area);
        });
        row.append(full);
        const restore=document.createElement('button');restore.type='button';
        restore.textContent='Восстановить';
        restore.addEventListener('click',()=>{
          if(ui.quickInput.value.trim()||largePaste.active()){
            ui.persistedStatus.textContent='Сначала освободите текстбокс: текущий текст не заменён.';return;
          }
          const original=String(record.original_text||'');
          if(largePaste.capture(original)){
            ui.quickInput.value=largePaste.preview();ui.quickInput.readOnly=true;
            ui.quickCopy.hidden=false;ui.quickClear.hidden=false;ui.quickExpand.hidden=false;
          }else{ui.quickInput.readOnly=false;ui.quickInput.value=original;}
          ui.persistedStatus.textContent='Исходник восстановлен без Send; для нового запроса подготовьте его заново.';
        });row.append(restore);
        const copy=document.createElement('button');copy.type='button';copy.textContent='Копировать';
        copy.addEventListener('click',async()=>{
          try{await navigator.clipboard.writeText(record.original_text);
            ui.persistedStatus.textContent='Оригинал скопирован';}
          catch(_){ui.persistedStatus.textContent='Копирование недоступно; нажмите «Просмотреть».';}
        });row.append(copy);
        const download=document.createElement('button');download.type='button';download.textContent='TXT';
        download.addEventListener('click',()=>{
          const data=new Blob([record.original_text],{type:'text/plain;charset=utf-8'});
          const url=URL.createObjectURL(data);
          const a=document.createElement('a');a.href=url;a.download=record.task_id+'.txt';
          a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
        });row.append(download);
        if (['prepared', 'send_failed'].includes(record.send_status)) {
          const retry = document.createElement('button');
          retry.type = 'button';
          retry.textContent = 'Повторить отправку';
          retry.addEventListener('click', () => {
            controller.sendExisting(record.task_id);
            schedule();
          });
          row.appendChild(retry);
        }
        ui.persistedList.appendChild(row);
      }
    }

    function ensureUi() {
      let host = document.getElementById(deps.UPLOAD_HOST_ID);
      // Rebuild the host if an older userscript left behind buttons without
      // the new textbox (e.g. an in-page update).
      if (host?.shadowRoot?.querySelector('[data-role="delay-send"]') &&
          host.shadowRoot.querySelector('.quick-input') &&
          host.shadowRoot.querySelector('.quick-clear') &&
          host.shadowRoot.querySelector('.quick-copy') &&
          host.shadowRoot.querySelector('.quick-expand') &&
          host.shadowRoot.querySelector('.quick-file') &&
          host.shadowRoot.querySelector('.quick-insert') &&
          host.shadowRoot.querySelector('.settings-button')) {
        return {
          host,
          row: host.shadowRoot.querySelector('.row'),
          quickInput: host.shadowRoot.querySelector('.quick-input'),
          quickSend: host.shadowRoot.querySelector('.quick-send'),
          quickClear: host.shadowRoot.querySelector('.quick-clear'),
          quickCopy: host.shadowRoot.querySelector('.quick-copy'),
          quickExpand: host.shadowRoot.querySelector('.quick-expand'),
          quickFile: host.shadowRoot.querySelector('.quick-file'),
          quickInsert: host.shadowRoot.querySelector('.quick-insert'),
          quickFeedback: host.shadowRoot.querySelector('.quick-feedback'),
          settingsUi: host.__fortisTextboxSettings || null,
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
          persistSend: host.shadowRoot.querySelector('.persist-send'),
          persistedList: host.shadowRoot.querySelector('.persisted-list'),
          persistedStatus: host.shadowRoot.querySelector('.persisted-status'),
          persistedSummary: host.shadowRoot.querySelector('.persisted-summary'),
          persistedMore: host.shadowRoot.querySelector('.persisted-more'),
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
            display:flex; gap:6px; align-items:center; width:100%; height:100%;
            pointer-events:auto; touch-action:auto; user-select:none; cursor:grab; position:relative;
          }
          .row[data-dragging="true"] { cursor:grabbing; }
          .control {
            flex:0 0 34px; width:34px; height:34px; padding:0; border-radius:999px;
            border:1px solid rgba(128,128,128,.24); background:rgba(32,32,32,.88);
            color:#fff; font:16px/1 system-ui,sans-serif; display:inline-flex;
            align-items:center; justify-content:center; cursor:inherit;
            pointer-events:auto; box-shadow:0 2px 10px rgba(0,0,0,.24);
            -webkit-user-select:none; user-select:none;
          }
          .quick-compose {
            flex:1 1 0; min-width:0; height:68px; padding:5px 6px 5px 3px;
            display:flex; align-items:stretch; gap:4px;
            border:1px solid rgba(128,128,128,.36); border-radius:12px;
            background:rgba(30,30,30,.96); cursor:default;
            box-shadow:0 3px 14px rgba(0,0,0,.30);
          }
          .control, .quick-grip { touch-action:none; }
          .quick-grip {
            width:14px; flex:0 0 14px; align-self:stretch; display:flex;
            align-items:center; justify-content:center; cursor:grab;
            color:rgba(255,255,255,.54); font:600 13px/1 system-ui,sans-serif;
            border-radius:6px;
          }
          .quick-grip:hover { background:rgba(255,255,255,.08); color:#fff; }
          .row[data-dragging="true"] .quick-grip { cursor:grabbing; }
          .quick-input {
            flex:1 1 0; min-width:0; width:100%; height:100%; padding:4px 2px;
            color:#fff; background:transparent; border:0; outline:none;
            font:13px/1.35 system-ui,sans-serif; resize:none; cursor:text;
            touch-action:auto; user-select:text; -webkit-user-select:text;
          }
          .quick-input::placeholder { color:rgba(255,255,255,.40); }
          .quick-input:focus-visible { outline:2px solid rgba(109,93,252,.70); border-radius:4px; }
          .quick-input[readonly] { color:#b7d3ee; cursor:default; }
          .quick-clear, .quick-copy, .quick-expand, .quick-file, .quick-insert {
            width:25px; flex:0 0 25px; height:25px; padding:0; align-self:center;
            border:1px solid rgba(180,155,104,.6);border-radius:7px;
            background:rgba(76,60,39,.94);color:#fff;cursor:pointer;
          }
          .quick-copy[hidden], .quick-clear[hidden], .quick-expand[hidden] { display:none; }
          .quick-actions {
            width:45px;flex:0 0 45px;display:flex;flex-direction:column;
            justify-content:space-between;align-items:stretch;gap:3px;
          }
          .quick-file, .quick-insert {width:45px;flex:0 0 26px;height:26px;font-size:10px;}
          .quick-send {
            flex:0 0 30px; width:45px; align-self:stretch; height:30px; padding:0;
            border:1px solid rgba(112,183,144,.58); border-radius:9px;
            background:rgba(40,77,59,.98); color:#fff; cursor:pointer;
            font:18px/1 system-ui,sans-serif; touch-action:auto;
          }
          .quick-send:hover:not(:disabled) { background:rgba(58,100,78,.98); }
          .quick-send:disabled { opacity:.45; cursor:default; }
          .quick-feedback {
            position:absolute; top:91px; right:0;
            max-width:min(330px, calc(100vw - 24px)); padding:5px 8px;
            border:1px solid rgba(128,128,128,.35); border-radius:8px;
            background:rgba(30,30,30,.96); color:#d9f0e0;
            font:11px/1.3 system-ui,sans-serif; user-select:text; cursor:default;
            pointer-events:none;
          }
          .quick-feedback[hidden] { display:none; }
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
          .add:hover,.schedule-later:hover,.from-chat:hover,.persist-send:hover { background:rgba(64,64,64,.98); color:#fff; }
          .persist-send { border:1px solid rgba(112,183,144,.55); border-radius:8px; padding:7px 11px; cursor:pointer; background:rgba(40,77,59,.98); color:#fff; font:600 12px/1 system-ui,sans-serif; }
          .persisted-section { margin-top:9px; border-top:1px solid rgba(128,128,128,.22); padding-top:8px; }
          .persisted-row { margin:4px 0; padding:6px 7px; background:rgba(40,40,40,.88); border-radius:8px; color:#ddd; font:11px/1.45 system-ui,sans-serif; overflow-wrap:anywhere; }
          .persisted-row button { margin-left:6px; font:11px system-ui,sans-serif; }
          .persisted-status { margin-top:6px; color:#a3d7b2; font:11px/1.35 system-ui,sans-serif; }
          .persisted-summary { margin:5px 0; color:rgba(255,255,255,.62); font:11px/1.4 system-ui,sans-serif; }
          .persisted-list { max-height:245px; overflow-y:auto; scrollbar-width:thin; }
          .persisted-more { display:block; width:100%; padding:6px; margin-top:5px;
            border:1px solid rgba(128,128,128,.32); border-radius:7px;
            background:rgba(48,48,48,.96); color:#ddd; cursor:pointer;
            font:11px/1.3 system-ui,sans-serif; }
          .persisted-more[hidden] { display:none; }
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
                <button type="button" class="persist-send" title="Локально сохранить исходник и task_id, затем отправить через обычный ChatGPT">Сохранить и отправить</button>
                <button type="button" class="add">В очередь</button>
                <button type="button" class="schedule-later">Отправить позже</button>
                <button type="button" class="from-chat" title="Перенести весь текст из обычного поля ChatGPT в очередь">Из чата → очередь</button>
              </div>
              <span class="hint">Ctrl/⌘ + Enter</span>
            </div>
          </div>
          <div class="persisted-section">
            <div class="section-title">Локальная история запросов</div>
            <div class="persisted-status" role="status"></div>
            <div class="persisted-summary"></div>
            <div class="persisted-list"></div>
            <button type="button" class="persisted-more" hidden>Показать ещё 20</button>
          </div>
        </div>

        <div class="row" aria-label="ChatGPT notifier controls">
          <span class="meta-chip timer-chip"></span>
          <span class="meta-chip version-chip"></span>
          <button type="button" class="control" data-role="delay-send" aria-label="Чекпоинт по таймеру">◷</button>
          <button type="button" class="control" data-role="queue" aria-label="Очередь сообщений">+</button>
          <button type="button" class="control" data-role="auto-send" aria-label="Автоотправить после загрузки файлов">⇧</button>
          <div class="quick-compose" role="group" aria-label="Fortis Textbox — ввод сообщения">
            <span class="quick-grip" title="Перетащить четыре кнопки вместе с текстбоксом" aria-label="Переместить панель">⠿</span>
            <textarea class="quick-input" rows="2" aria-label="Новое сообщение Fortis Textbox" placeholder="Сообщение..."></textarea>
            <button type="button" class="quick-expand" hidden aria-label="Развернуть и редактировать большой промпт целиком" title="Показать весь текст для редактирования">↗</button>
            <button type="button" class="quick-copy" hidden aria-label="Скопировать полный большой промпт" title="Скопировать полный текст из памяти">⧉</button>
            <button type="button" class="quick-clear" hidden aria-label="Очистить большой промпт" title="Удалить большой промпт из памяти этой вкладки">×</button>
            <div class="quick-actions">
              <button type="button" class="quick-file" title="Весь промпт как .txt — без автоматического Send" aria-label="Передать промпт как текстовый файл">Файл</button>
              <button type="button" class="quick-insert" title="Вставить текст, активные модули и Fortis context без Send" aria-label="Вставить текст без отправки">Вставить</button>
              <button type="button" class="quick-send" aria-label="Нажать Send для подготовленного сообщения"
                title="Одна попытка Send только после кнопок Файл или Вставить">Нажать Send</button>
            </div>
          </div>
          <span class="quick-feedback" role="status" aria-live="polite" hidden></span>
          <span class="badge"></span>
        </div>`;

      const ui = {
        host,
        row: shadow.querySelector('.row'),
        quickInput: shadow.querySelector('.quick-input'),
        quickSend: shadow.querySelector('.quick-send'),
        quickClear: shadow.querySelector('.quick-clear'),
        quickCopy: shadow.querySelector('.quick-copy'),
        quickExpand: shadow.querySelector('.quick-expand'),
        quickFile: shadow.querySelector('.quick-file'),
        quickInsert: shadow.querySelector('.quick-insert'),
        quickFeedback: shadow.querySelector('.quick-feedback'),
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
        persistSend: shadow.querySelector('.persist-send'),
        persistedList: shadow.querySelector('.persisted-list'),
        persistedStatus: shadow.querySelector('.persisted-status'),
        persistedSummary: shadow.querySelector('.persisted-summary'),
        persistedMore: shadow.querySelector('.persisted-more'),
        versionChip: shadow.querySelector('.version-chip'),
        panelVersion: shadow.querySelector('.panel-version')
      };

      ui.settingsUi=deps.mountTextboxSettings?.({
        shadow,manager:textboxProfileManager,
        positionPanel:panel=>positionPanel(host,panel)
      })||null;
      host.__fortisTextboxSettings=ui.settingsUi;
      ui.versionChip.textContent = `v${deps.SCRIPT_VERSION}`;
      ui.panelVersion.textContent = `v${deps.SCRIPT_VERSION}`;
      ui.persistedMore?.addEventListener('click', () => {
        persistedVisibleCount += 20;
        schedule();
      });

      function addCurrent() {
        if (!queuedPromptController) return;
        const id = queuedPromptController.add(ui.textarea.value);
        if (!id) return;
        ui.textarea.value = '';
        render();
        setTimeout(() => ui.textarea.focus(), 0);
      }

      function sendPersistedCurrent() {
        const id = persistentMessageController?.saveAndSend(ui.textarea.value);
        if (!id) { render(); return; }
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
        if (event.button !== 0 || !event.isPrimary ||
            !canStartFloatingDrag(event.target)) return;
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
        positionPanel(host, ui.settingsUi?.panel);
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

      function clearLargePaste({ focus = true } = {}) {
        largePaste.clear();
        ui.quickInput.readOnly = false;
        ui.quickInput.value = '';
        ui.quickClear.hidden = true;
        ui.quickCopy.hidden = true;
        ui.quickExpand.hidden = true;
        ui.quickFeedback.textContent = '';
        ui.quickFeedback.hidden = true;
        if (focus) ui.quickInput.focus();
      }

      resetLargePasteView = () => clearLargePaste({ focus: false });
      ui.quickClear.addEventListener('click', () => clearLargePaste());
      ui.quickExpand.addEventListener('click', () => {
        if (!largePaste.active()) return;
        const fullText = largePaste.text('');
        largePaste.clear();
        ui.quickInput.readOnly = false;
        ui.quickInput.value = fullText;
        ui.quickExpand.hidden = true;
        ui.quickCopy.hidden = true;
        ui.quickClear.hidden = true;
        ui.quickFeedback.textContent = 'Показан полный исходник — можно редактировать перед отправкой.';
        ui.quickFeedback.hidden = false;
        ui.quickInput.focus();
      });
      ui.quickCopy.addEventListener('click', async () => {
        if (!largePaste.active()) return;
        try {
          await navigator.clipboard.writeText(largePaste.text(''));
          ui.quickFeedback.textContent = 'Полный большой промпт скопирован.';
        } catch (_) {
          ui.quickFeedback.textContent = 'Не удалось скопировать. Исходный текст остаётся в памяти вкладки.';
        }
        ui.quickFeedback.hidden = false;
      });
      ui.quickInput.addEventListener('paste', event => {
        if (event.clipboardData?.files?.length || largePaste.active()) return;
        const pasted = event.clipboardData?.getData?.('text/plain');
        if (!largePaste.capture(pasted, ui.quickInput.value,
          ui.quickInput.selectionStart, ui.quickInput.selectionEnd)) return;
        // Prevent a huge DOM textarea mutation/layout on the paste event.
        event.preventDefault();
        ui.quickInput.value = largePaste.preview();
        ui.quickInput.readOnly = true;
        ui.quickClear.hidden = false;
        ui.quickCopy.hidden = false;
        ui.quickExpand.hidden = false;
        ui.quickFeedback.textContent = 'Полный текст сохранён в памяти до отправки; при обновлении вкладки пропадёт.';
        ui.quickFeedback.hidden = false;
      });

      let fileTransferPending = false;
      let fileTransferEpoch = 0;
      cancelFileTransfer = () => {
        fileTransferEpoch += 1;
        fileTransferPending = false;
        ui.quickFile.disabled = false;
        ui.quickInsert.disabled = false;
        ui.quickSend.disabled = false;
      };
      const wait = ms => new Promise(resolve => window.setTimeout(resolve, ms));
      let lastFileStatus = '';
      const fileStatus = message => {
        lastFileStatus = String(message || '');
        ui.quickFeedback.textContent = lastFileStatus;
        ui.quickFeedback.hidden = false;
      };

      function currentFileContext(chatId) {
        if (!chatId || deps.currentChatId?.() !== chatId) return null;
        const context = deps.findComposerContext?.();
        if (!context?.composer?.isConnected) return null;
        return context;
      }

      function tryFileInputs(file, context) {
        const inputs = [];
        const primary = deps.findUploadFileInput?.(context.composer);
        if (primary) inputs.push(primary);
        // Current ChatGPT may mount its hidden input outside the composer form.
        for (const input of document.querySelectorAll('input[type="file"]'))
          if (!inputs.includes(input)) inputs.push(input);
        // Do not try a second file input if the first accepted candidate
        // dispatches change but its DOM handler throws or reports failure:
        // ChatGPT might have received the file despite that exception.
        return tryPromptFileInputOnce(file, inputs);

      }

      async function waitForFileCard(chatId, filename, duration, epoch) {
        const end = Date.now() + duration;
        while (Date.now() <= end) {
          if (epoch !== fileTransferEpoch) return false;
          const ctx = currentFileContext(chatId);
          if (!ctx) return false;
          const root=ctx.container||ctx.composer;
          // The modern preview may be a sibling mounted at the composer
          // wrapper level, but never search the entire conversation.
          const card=fileAttachmentVisible(root,filename)||
            fileAttachmentVisible(root?.parentElement,filename);
          if (card && !deps.composerHasUploadBusyEvidence?.(root,[filename]))return true;
          await wait(180);
        }
        return false;
      }

      function prepareActiveModules(originalText, moduleIds = null, profileId = null) {
        if (!textboxProfileManager?.prepare || !persistentMessageController?.prepareDraft ||
            !queuedPromptController?.insertOnly)
          throw Error('Модули / task_id / черновик Notifier недоступны.');
        const prepared = profileId !== null
          ? textboxProfileManager.prepareForProfile(originalText,profileId,moduleIds)
          : moduleIds === null
            ? textboxProfileManager.prepare(originalText)
            : textboxProfileManager.prepareForModules(originalText,moduleIds);
        if (!prepared || typeof prepared.extraText !== 'string' ||
            prepared.extraText.length > 100000)
          throw Error('Активный профиль не подготовлен.');
        return prepared;
      }

      async function completeFileDraft(record, file, chatId, epoch, nativeBefore) {
        if (epoch !== fileTransferEpoch || !currentFileContext(chatId)) {
          fileStatus('Чат изменился. Исходник остался в Textbox; Send не нажимался.');
          return {ok:false,reason:'context_mismatch'};
        }
        // task_id, exact original and ALL modules/context were prepared
        // BEFORE uploading. Do not generate a different task_id after attach.
        const nativeNow = queuedPromptController.readNativeDraft?.();
        if (typeof nativeNow !== 'string' || nativeNow !== nativeBefore ||
            !record || typeof record.submitted_text !== 'string' ||
            !(nativeBefore
              ? record.submitted_text.startsWith(nativeBefore + '\n\n')
              : record.submitted_text.length > 0)) {
          fileStatus('Редактор ChatGPT изменился при прикреплении файла. ' +
            'Контекст не вставлен и Send не нажат.');
          return {ok:false,reason:'context_mismatch'};
        }
        const addition = record.submitted_text.slice(nativeBefore.length);
        // Only the NEW short context is inserted into a busy native editor.
        // Never replace the complete native contents with the original file.
        if (addition.length >= LARGE_PASTE_THRESHOLD) {
          fileStatus('Модули/контекст слишком длинны для безопасного добавления. ' +
            'Файл прикреплён, но текст не вставлен. Send не нажат.');
          return false;
        }
        const result = nativeBefore
          ? await queuedPromptController.appendOnly(addition, nativeBefore,
              {fileContext:true})
          : await queuedPromptController.insertOnly(record.submitted_text,
              {fileContext:true});
        fileStatus(result.ok
          ? 'Полный исходник, модули и Fortis task context находятся в файле; ' +
            'в редакторе только ссылка с task_id. SHA-256 записан, Send НЕ нажат.'
          : 'Файл прикреплён, но ссылка с task_id не добавлена: ' + result.reason +
            ' Не отправляй до ручной проверки.');
        return result.ok ? {ok:true,taskId:record.task_id} : {ok:false,reason:'context_mismatch'};
      }

      async function handleQuickFile(originalText, moduleIds = null, profileId = null) {
        if (fileTransferPending) return {ok:false};
        originalText=String(originalText);

        if (!originalText.trim()) { fileStatus('Сначала вставьте текст.'); return; }
        if (queuedPromptController?.isWaitingToSend?.() ||
            uploadController?.isArmed?.() || uploadController?.isConfirmingSend?.()) {
          fileStatus('Завершите активную отправку или выключите ⇧ автоотправку файлов.');
          return;
        }
        const chatId = deps.currentChatId?.();
        const context = currentFileContext(chatId);
        if (!context) {
          fileStatus('Откройте конкретный чат ChatGPT. Промпт сохранён в текстбоксе.');
          return;
        }
        fileTransferPending = true;
        const epoch = ++fileTransferEpoch;
        ui.quickFile.disabled = true;
        ui.quickInsert.disabled = true;
        ui.quickSend.disabled = true;
        try {
          const profile = prepareActiveModules(originalText,moduleIds,profileId);
          if (new TextEncoder().encode(originalText).length > MAX_QUICK_SEND_BYTES)
            throw Error('Для архивации оригинала по task_id файл ограничен 512 КиБ.');
          // The duplicate check is based on SHA-256 of the complete original,
          // per Chat ID, NOT any occupied editor or existing attachment card.
          const reservation = await fileHashGuard.reserve(chatId, originalText);
          if (epoch !== fileTransferEpoch || !currentFileContext(chatId)) {
            fileStatus('Чат сменился во время SHA-проверки. Вложение отменено.');
            return;
          }
          if (!reservation.ok) {
            fileStatus(reservation.reason);
            // The Notifier UI already knows this is a SHA-256 duplicate.
            // Make the owner's event log equally precise. No file action.
            return {ok:false,reason:reservation.duplicate?'duplicate':'not_confirmed',
              detail:safeNotifierFileDetail(lastFileStatus)};
          }
          // Create a single task context and complete attachment BEFORE the
          // single upload attempt. Both owner Viewer and Notifier use this.
          const fileName='fortis-prompt-' + Date.now().toString(36) + '.txt';
          const nativeBefore=queuedPromptController.readNativeDraft?.();
          if (typeof nativeBefore !== 'string')
            throw Error('Нативный редактор недоступен. Файл не прикреплялся.');
          const record=persistentMessageController.prepareDraft(originalText,{
            mode:'file',fileName,extraText:profile.extraText,nativePrefix:nativeBefore
          });
          if (!record || typeof record.file_text !== 'string' ||
              !record.file_text.includes('task_id: ' + record.task_id))
            throw Error('Не удалось подготовить полный файл с task_id. Файл не прикреплялся.');
          const file = createPromptTextFile(record.file_text,fileName);
          fileStatus('Создал полный ' + file.name + '. Прикрепляю к текущему чату…');
          const transfer = await attemptPromptFileOnce({
            tryDirectInput: () => tryFileInputs(file, context),
            findPlus: () => {
              if (epoch !== fileTransferEpoch || !currentFileContext(chatId))
                return null;
              const plus = deps.findComposerPlusButton?.(context.composer);
              return plus?.isConnected ? plus : null;
            },
            afterPlus: () => wait(250),
            tryMenuInput: () => {
              const next = epoch === fileTransferEpoch ? currentFileContext(chatId) : null;
              return Boolean(next && tryFileInputs(file, next));
            },
            tryDrop: () => {
              const next = epoch === fileTransferEpoch ? currentFileContext(chatId) : null;
              if (!next) return false;
              const target = document.querySelector('[data-testid*="dropzone" i]') ||
                next.container || next.composer;
              return dropPromptTextFile(target, file);
            },
            waitForCard: () => waitForFileCard(chatId, file.name, 5000, epoch)
          });
          if (epoch !== fileTransferEpoch || !currentFileContext(chatId)) {
            fileStatus('Чат изменился. Прикрепление остановлено; повторов не было.');
            return;
          }
          if (transfer.confirmed) {
            let completed;
            try {completed=await completeFileDraft(record, file, chatId, epoch, nativeBefore)}
            catch (_) {
              fileStatus('Карточка файла обнаружена, но Fortis-контекст не подтверждён. ' +
                'Не отправляй сообщение и не прикрепляй файл повторно.');
              completed={ok:false,reason:'context_mismatch'}
            }
            return completed && typeof completed === 'object'
              ? {...completed, attachmentAttempted:true, attachmentConfirmed:true,
                 detail:safeNotifierFileDetail(lastFileStatus)}
              : {ok:false,reason:'prepared_missing',
                 attachmentAttempted:true,attachmentConfirmed:true,
                 detail:safeNotifierFileDetail(lastFileStatus)};
          }
          // CRITICAL: No retry or alternate upload path on an unknown result.
          // The ChatGPT UI may accept the file while our card detector times
          // out. Retrying here was the cause of duplicate attachments.
          if (transfer.attempted) {
            fileStatus('Одна попытка прикрепления (' + transfer.path +
              ') выполнена, но ChatGPT не подтвердил карточку. ' +
              'Возможно, файл уже добавлен. Второй попытки НЕ делаю; ' +
              'проверь вложения вручную. Send не нажат.');
            return {ok:false,reason:'upload_unconfirmed',
              attachmentAttempted:true,attachmentConfirmed:false,
              detail:safeNotifierFileDetail(lastFileStatus)};
          }
          fileStatus('Не удалось выбрать способ прикрепления файла (' +
            transfer.reason + '). Автоматического повтора и Send не было.');
        } catch (error) {
          fileStatus(error?.message || 'Не удалось прикрепить файл в ChatGPT.');
        } finally {
          if (epoch === fileTransferEpoch) {
            fileTransferPending = false;
            ui.quickFile.disabled = false;
            ui.quickInsert.disabled = false;
            ui.quickSend.disabled = false;
          }
        }
        return {ok:false};
      }
      let quickPrepared=null;
      ui.quickFile.addEventListener('click',async()=>{
        const original=largePaste.text(ui.quickInput.value);
        const outcome=await handleQuickFile(original);
        quickPrepared=outcome?.ok?{id:outcome.taskId,chat:deps.currentChatId?.(),original}:null;
      });

      async function handleQuickInsert(original, moduleIds = null, profileId = null) {
        if (ui.quickInsert.disabled || fileTransferPending) return {ok:false};
        original=String(original);
        if (!original.trim()) {
          ui.quickFeedback.textContent = 'Сначала вставьте текст.';
          ui.quickFeedback.hidden = false;
          return;
        }
        if (original.length >= LARGE_PASTE_THRESHOLD) {
          // Native editor froze on 68k+ characters in real Edge.
          // Route large inserts through the file with the same active modules.
          // Large local text uses the exact same single-attempt File route.
          return handleQuickFile(original,moduleIds,profileId);
        }
        ui.quickInsert.disabled = true;
        ui.quickSend.disabled = true;
        ui.quickFile.disabled = true;
        ui.quickFeedback.textContent = 'Подготавливаю модули и Fortis task context без Send…';
        ui.quickFeedback.hidden = false;
        try {
          const profile = prepareActiveModules(original,moduleIds,profileId);
          const record = persistentMessageController.prepareDraft(original, {
            mode: 'insert', extraText: profile.extraText
          });
          if (!record) {
            ui.quickFeedback.textContent =
              persistentMessageController.getLastStatus?.() || 'Черновик не сохранён.';
            return {ok:false,reason:'prepared_missing'};
          }
          if (record.submitted_text.length >= LARGE_PASTE_THRESHOLD) {
            ui.quickFeedback.textContent =
              'Черновик с модулями слишком длинный. Исходник сохранён; ' +
              'Send не нажат. Используйте «Файл».';
            return;
          }
          const result = await queuedPromptController.insertOnly(record.submitted_text);
          const success=Boolean(result?.ok);
          ui.quickFeedback.textContent = result.ok
            ? 'Текст, модули и Fortis task context вставлены; task_id сохранён. ' +
              'Отправь ВРУЧНУЮ.'
            : result.reason;
          return success ? {ok:true,taskId:record.task_id} : {ok:false,reason:'context_mismatch'};
        } catch (error) {
          ui.quickFeedback.textContent = error?.message || 'Модули недоступны.';
        } finally {
          ui.quickInsert.disabled = false;
          ui.quickSend.disabled = false;
          ui.quickFile.disabled = false;
        }
        return {ok:false};
      }
      ui.quickInsert.addEventListener('click',async()=>{
        const original=largePaste.text(ui.quickInput.value);
        const outcome=await handleQuickInsert(original);
        quickPrepared=outcome?.ok?{id:outcome.taskId,chat:deps.currentChatId?.(),original}:null;
      });

      function sendQuickCurrent(originalOverride = null, moduleIds = null, profileId = null) {
        if (ui.quickInsert.disabled) return;
        // Reuse the same controller as the plus-panel. No changes to existing
        // queue, delayed checkpoint or file-upload button handlers.
        const originalText = originalOverride === null
          ? largePaste.text(ui.quickInput.value) : String(originalOverride);
        if (new TextEncoder().encode(originalText).length > MAX_QUICK_SEND_BYTES) {
          ui.quickFeedback.textContent =
            'Этот текст превышает предел 512 КиБ для сохранения точного оригинала Observatory. ' +
            'Отправка отменена; промпт остался в поле/памяти.';
          ui.quickFeedback.hidden = false;
          return;
        }
        let options={minComposerDwellMs:1000,focusAfterSend:true};
        try{
          if(textboxProfileManager){
            const prepared=profileId!==null
              ?textboxProfileManager.prepareForProfile(originalText,profileId,moduleIds)
              :moduleIds===null
                ?textboxProfileManager.prepare(originalText)
                :textboxProfileManager.prepareForModules(originalText,moduleIds);
            options={minComposerDwellMs:prepared.minComposerDwellMs,
              extraText:prepared.extraText,focusAfterSend:prepared.focusAfterSend};
          }
        }catch(error){
          ui.quickFeedback.textContent=error?.message||'Модули недоступны';
          ui.quickFeedback.hidden=false;return;
        }
        // A short original may expand beyond safe rich-editor size after
        // Planning Helper modules. Auto-route the EXPLICIT quick Send through
        // the same full-File + verified single native click pipeline.
        if(originalOverride===null &&
           originalText.length + String(options.extraText||'').length >= LARGE_PASTE_THRESHOLD) {
          const existing=queuedPromptController?.readNativeDraft?.();
          if(typeof existing!=='string'||existing.trim()){
            ui.quickFeedback.textContent='Редактор уже содержит текст; отправка через файл отменена.';
            ui.quickFeedback.hidden=false;
            return {ok:false,reason:'native_draft_occupied'};
          }
          void (async()=>{
            const prepared=await handleQuickFile(originalText);
            if(!prepared?.ok)return;
            const result=sendPreparedNative(prepared.taskId);
            if(result?.ok){
              largePaste.clear();ui.quickInput.value='';
              ui.quickFeedback.textContent='Файл отправлен через штатную кнопку; приём ChatGPT не подтверждён.';
              ui.quickFeedback.hidden=false;
            }
          })();
          return;
        }
        const id = persistentMessageController?.saveAndSend(originalText,options);
        ui.quickFeedback.textContent = id
          ? 'Исходник сохранён; передаю в ChatGPT, Send примерно через 1 сек.'
          : (persistentMessageController?.getLastStatus?.() || 'Отправка не подготовлена.');
        ui.quickFeedback.hidden = false;
        window.setTimeout(() => { ui.quickFeedback.hidden = true; }, 4500);
        if (!id) return {ok:false};
        if (originalOverride !== null) return {ok:true,taskId:id};
        largePaste.clear();
        ui.quickInput.readOnly = false;
        ui.quickClear.hidden = true;
        ui.quickCopy.hidden = true;
        ui.quickExpand.hidden = true;
        ui.quickInput.value = '';
        render();
        if(options.focusAfterSend!==false)ui.quickInput.focus();
      }

      // Shared prepared Send for both File and Insert: never reprepare, replace text,
      // or reattach files. The exact saved draft, scoped task_id and file card
      // must already be present. A single synchronous click is attempted.
      function sendPreparedNative(expectedTaskId=null) {
        if(fileTransferPending || queuedPromptController?.isWaitingToSend?.() ||
           uploadController?.isArmed?.() || uploadController?.isConfirmingSend?.())
          return {ok:false,reason:'busy'};
        const chatId=deps.currentChatId?.();
        const ctx=currentFileContext(chatId);
        const context=deps.findComposerContext?.();
        const button=context?.sendButton;
        if(!chatId||!ctx||!context?.composer?.isConnected)
          return {ok:false,reason:'no_composer'};
        if(!button?.isConnected || !deps.isSendButtonReady?.(button))
          return {ok:false,reason:'send_button_not_ready'};
        const native=queuedPromptController?.readNativeDraft?.();
        if(typeof native!=='string'||!native.trim())
          return {ok:false,reason:'prepared_missing'};
        const root=ctx.container||ctx.composer;
        const fileVisible=name=>Boolean(
          (fileAttachmentVisible(root,name)||fileAttachmentVisible(root?.parentElement,name))&&
          !deps.composerHasUploadBusyEvidence?.(root,[name]));
        const drafts=persistentMessageController?.previewPreparedNativeDraft?.(native,
          {fileNameVisible:fileVisible});
        // Refuse ambiguous draft prefix chains or a raw attachment lacking
        // task context; this prevents accidental sending of an orphan file.
        if(!Array.isArray(drafts)||drafts.length!==1 ||
           !/^rs_[0-9a-f]{32}$/.test(drafts[0].reporting_session_id||'') ||
           !['insert','file'].includes(drafts[0].draft_mode) ||
           !(drafts[0].draft_mode==='insert'
             ? native===drafts[0].submitted_text
             : deps.fileContextTextMatches?.(native,drafts[0].submitted_text)) ||
           !native.includes('task_id: '+drafts[0].task_id) ||
           !native.includes('[Fortis task context]'))
          return {ok:false,reason:'prepared_missing'};
        const taskId=drafts[0].task_id;
        // Owner Send must send ONLY the File it just prepared.
        if (expectedTaskId !== null && taskId !== expectedTaskId)
          return {ok:false,reason:'context_mismatch'};
        const committed=persistentMessageController.recordManualDraftSend(native,
          {fileNameVisible:fileVisible});
        if(committed!==taskId)return {ok:false,reason:'not_confirmed'};
        // No retry even on exceptions: the click may already have reached ChatGPT.
        try{button.click()}catch(_){return {ok:false,reason:'not_confirmed'}}
        return {ok:true,taskId};
      }

      // One-shot owner dispatch enters the EXACT same native File/Insert/Send
      // pipeline as the Notifier buttons. No second upload algorithm and
      // no side effects on the Notifier's editable quick textbox.
      handleQuickDispatch = async function executeQuickDispatch(mode,text,moduleIds=null,profileId=null,delayMs=1000) {
        if(!['file','insert','send','send_prepared'].includes(mode)||
           typeof text!=='string'||(mode!=='send_prepared'&&!text.trim())||
           (moduleIds!==null&&(!Array.isArray(moduleIds)||
              moduleIds.some(id=>typeof id!=='string'))))return {ok:false};
        if(mode==='send_prepared')return sendPreparedNative();
        if(mode==='file')return handleQuickFile(text,moduleIds,profileId);
        if(mode==='insert')return handleQuickInsert(text,moduleIds,profileId);
        // Explicit owner "Отправить": file contains the original, complete
        // Fortis guidance and selected modules. Click native Send once only
        // after the file card and exact short task pointer are verified.
        const existing=queuedPromptController?.readNativeDraft?.();
        if(typeof existing!=='string'||existing.trim())
          return {ok:false,reason:'native_draft_occupied'};
        const initialChat=deps.currentChatId?.();
        const prepared=await handleQuickFile(text,moduleIds,profileId);
        if(!prepared?.ok)return prepared||{ok:false,reason:'not_confirmed'};
        if(!Number.isSafeInteger(delayMs)||delayMs<0||delayMs>10000)
          return {ok:false,reason:'invalid_delay'};
        if(delayMs)await wait(delayMs);
        if(initialChat!==deps.currentChatId?.())
          return {ok:false,reason:'context_mismatch'};
        // Native draft, task_id and attachment card are rechecked after dwell.
        return sendPreparedNative(prepared.taskId);
      }
      ui.quickSend.addEventListener('click',()=>{
        const result=sendPreparedNative();
        ui.quickFeedback.textContent=result?.ok
          ? 'Одна попытка штатного Send; приём ChatGPT не подтверждён. Оригинал в локальной истории.'
          : 'Send не нажат: '+(result?.reason||'не удалось подтвердить подготовку');
        ui.quickFeedback.hidden=false;
        if(result?.ok&&quickPrepared?.id===result.taskId&&
           quickPrepared.chat===deps.currentChatId?.()&&
           largePaste.text(ui.quickInput.value)===quickPrepared.original){
          clearLargePaste({focus:false});
          ui.quickFeedback.hidden=false;
          ui.quickFeedback.textContent='Send нажат один раз; текст сохранён в истории. Приём ChatGPT не подтверждён.';
        }
        if(result?.ok)quickPrepared=null;
      });
      // Enter edits the textbox. No implicit Send; explicit button is required.
      ui.persistSend?.addEventListener('click', sendPersistedCurrent);
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
      renderPersistedList(ui);
      positionPanel(host, ui.panel);
      positionPanel(host, ui.settingsUi?.panel);
      ui.settingsUi?.render();
    }

    function schedule() {
      if (repositionTimer !== null) return;
      repositionTimer = window.setTimeout(() => {
        repositionTimer = null;
        window.requestAnimationFrame(render);
      }, deps.SETTINGS.uiRepositionDelayMs);
    }

    function resetLargePasteDraft() {
      // Never allow an unsent in-memory prompt from another conversation
      // to be sent after ChatGPT client-side navigation.
      cancelFileTransfer();
      if (largePaste.active()) resetLargePasteView();
    }

    function closeQueuePanel() {
      const host = document.getElementById(deps.UPLOAD_HOST_ID);
      const panel = host?.shadowRoot?.querySelector('.panel');
      if (panel) panel.hidden = true;
    }

    return { render, schedule, closeQueuePanel, resetLargePasteDraft, dispatchQuickAction };
  }

  return { clampFloatingPosition, floatingWidth, canStartFloatingDrag,
    shouldSendQuickTextboxKey, pagePersistedHistory, createLargePasteDraft,
    LARGE_PASTE_THRESHOLD, MAX_QUICK_SEND_BYTES, MAX_FILE_PROMPT_BYTES,
    createPromptTextFile, isEligiblePromptFileInput, tryPromptFileInputOnce,
    attachPromptTextFile, dropPromptTextFile,
    fileAttachmentVisible, safeNotifierFileDetail, createConsecutiveFileHashGuard,
    attemptPromptFileOnce, createUploadButtonUi };
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

  function createResponseMonitor({ tabState, notifications, beforeArm = () => {}, onFinished = () => {}, onArmed = () => {}, isDomEnabled = () => true }) {
    let externallyFinished = false;
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
      if (!isDomEnabled()) return false;
      if (armed && Date.now() - lastArmAt < 1200) return;
      beforeArm();
      externallyFinished = false;
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
      try { onArmed(); } catch (_) { /* optional */ }

      const thisRun = runId;
      armTimer = setTimeout(() => {
        // Do not discard an armed response in Observatory-only test mode.
        if (isDomEnabled() && armed && runId === thisRun && !sawGenerating && !responseChanged()) {
          armed = false;
          tabState.setState('idle');
        }
      }, deps.SETTINGS.armTimeoutMs);
      console.debug(`[ChatGPT notifier] Ожидается ответ: ${source}`);
    }

    function finishAnswer() {
      if (!isDomEnabled() || !armed || finishedRunId === runId) return;
      finishedRunId = runId;
      armed = false;
      sawGenerating = false;
      clearTimers();
      const unread = document.hidden || !document.hasFocus();
      tabState.setState(unread ? 'fresh' : 'viewed');
      notifications.notifyFinished();
      try { onFinished(); } catch (error) { console.warn('[ChatGPT notifier] Ошибка действия после завершения ответа:', error); }
    }

    function startFromExternal() {
      // The browser never treats an Observatory report as a synthetic user click.
      if (armed && tabState.getState() === 'observatory-working') return true;
      clearTimers();
      externallyFinished = false;
      if (!armed) {
        runId += 1;
        armed = true;
        sawGenerating = false;
        finishedRunId = -1;
        const snapshot = assistantSnapshot();
        baselineAssistantCount = snapshot.count;
        baselineFingerprint = snapshot.fingerprint;
        currentAssistantCount = snapshot.count;
        currentFingerprint = snapshot.fingerprint;
        lastAssistantChangeAt = Date.now();
      }
      lastArmAt = Date.now();
      tabState.setState('observatory-working');
      return true;
    }

    function finishFromExternal() {
      if (!armed || finishedRunId === runId) return false;
      externallyFinished = true;
      finishedRunId = runId;
      armed = false;
      sawGenerating = false;
      clearTimers();
      const unread = document.hidden || !document.hasFocus();
      tabState.setState(unread ? 'observatory-fresh' : 'observatory-viewed');
      notifications.notifyFinished('observatory');
      return true;
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
      // In Observatory-only mode DOM neither begins nor ends the response.
      if (!isDomEnabled()) {
        if (finishTimer) { clearTimeout(finishTimer); finishTimer = null; }
        return;
      }
      const generating = isGenerating();
      // Ignore stuck generating DOM until a real new send or generator clears.
      if (externallyFinished) {
        if (generating) return;
        externallyFinished = false;
      }
      if (generating) {
        if (!armed) armAnswer('generation-detected');
        else updateAssistantSnapshot();
        sawGenerating = true;
        if (finishTimer) { clearTimeout(finishTimer); finishTimer = null; }
        if (tabState.getState() !== 'observatory-working') tabState.setState('working');
        return;
      }
      if (!armed) return;
      updateAssistantSnapshot();
      // DOM still detects the start but cannot conclude a response in test mode.
      if (!isDomEnabled()) {
        if (finishTimer) { clearTimeout(finishTimer); finishTimer = null; }
        return;
      }
      if (sawGenerating) { scheduleFinish(); return; }
      if (responseChanged() && Date.now() - lastAssistantChangeAt >= deps.SETTINGS.fallbackQuietDelayMs) finishAnswer();
    }

    function resetForNavigation() {
      externallyFinished = false;
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

    return { armAnswer, startFromExternal, check, resetForNavigation, finishFromExternal, isArmed: () => armed };
  }

  return { assistantSnapshot, isGenerating, createResponseMonitor };
});

(function (root, factory) {
  const api = factory(root.ChatGPTTabNotifier || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ChatGPTTabNotifier = Object.assign(root.ChatGPTTabNotifier || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  'use strict';

  const PREFIX = 'fortis-observatory-v1-pair-';
  const AUTO_PROOF_PREFIX = 'fortis-observatory-v1-client-proof-';
  const AUTO_ENROLL_ORIGIN = 'http://127.0.0.1:18755';
  const AUTO_ENROLL_INTERVAL = 7000;
  function makeClientProof() {
    if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function')
      return null;
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('');
  }
  const LEGACY_ORIGIN = 'http://127.0.0.1:18753';
  const allowedOrigin = deps.allowedObservatoryOrigin ||
    (origin => origin === LEGACY_ORIGIN || origin === 'http://127.0.0.1:18754' || origin === 'http://127.0.0.1:18755');

  function currentChatId(url = location.href) {
    try {
      const parsed = new URL(url);
      if (parsed.origin !== 'https://chatgpt.com' && parsed.origin !== 'https://chat.openai.com') return '';
      const match = parsed.pathname.match(/^\/c\/([A-Za-z0-9-]{8,100})\/?$/);
      return match ? match[1] : '';
    } catch (_) { return ''; }
  }

  function validatePairing(value, chatId) {
    if (!value || typeof value !== 'object' || value.version !== 1 ||
        !allowedOrigin(value.origin) || value.conversation_id !== chatId ||
        !/^rs_[0-9a-f]{32}$/.test(value.reporting_session_id || '') ||
        !/^[A-Za-z0-9_-]{40,70}$/.test(value.observer_key || '') ||
        (value.message_writer_key !== undefined &&
         !/^[A-Za-z0-9_-]{40,70}$/.test(value.message_writer_key || '')) ||
        (value.task_intent_key !== undefined &&
         !/^[A-Za-z0-9_-]{40,70}$/.test(value.task_intent_key || '')) ||
        (value.dispatch_key !== undefined &&
         !/^[A-Za-z0-9_-]{40,70}$/.test(value.dispatch_key || ''))) return null;
    return {
      version: 1, origin: value.origin, conversation_id: chatId,
      reporting_session_id: value.reporting_session_id, observer_key: value.observer_key,
      ...(value.message_writer_key ? { message_writer_key: value.message_writer_key } : {}),
      ...(value.task_intent_key ? { task_intent_key: value.task_intent_key } : {}),
      ...(value.dispatch_key ? { dispatch_key: value.dispatch_key } : {})
    };
  }

  function createObservatoryCompletionBridge({
    tabState, responseMonitor, notify = () => {}, isEnabled = () => true
  } = {}) {
    let chatId = '';
    let latestSequence = -1;
    let workStartedAt = 0;
    let requestPending = null;
    let lastCheckAt = 0;
    let pairing = null;
    let generation = 0;
    let lastAutoEnroll = 0;
    let autoEnrollPending = false;
    let autoProof = null;
    let titleReportingSupported = false;
    let lastTriggeredSequence = -1;
    let initialStatusRead = false;
    let startSequence = -1;
    // Old archives must not cause stale working indicators after a page reload.
    const MAX_EVENT_AGE_MS = 120000;

    function refreshChat() {
      const next = currentChatId();
      if (next === chatId) return;
      tabState?.setObservatoryBinding?.(null);
      generation += 1;
      chatId = next;
      latestSequence = -1;
      lastTriggeredSequence = -1;
      initialStatusRead = false;
      startSequence = -1;
      workStartedAt = 0;
      requestPending = null;
      autoEnrollPending = false;
      lastAutoEnroll = 0;
      autoProof = null;
      try {
        pairing = next && typeof GM_getValue === 'function'
          ? validatePairing(GM_getValue(PREFIX + next, null), next) : null;
      } catch (_) { pairing = null; }
    }

    function currentTabTitle() {
      try {
        let value = tabState?.getNaturalTitle?.();
        if (typeof value !== 'string') value = typeof document === 'undefined' ? '' : document.title;
        if (typeof deps.cleanTitle === 'function') value = deps.cleanTitle(value);
        value = String(value || '').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ')
          .replace(/\s+/g, ' ').trim();
        return [...value].filter(ch => {
          const code = ch.codePointAt(0);
          return code < 0xD800 || code > 0xDFFF;
        }).slice(0, 128).join('');
      } catch (_) { return ''; }
    }

    function checkAutoEnrollment() {
      if (!chatId || !isEnabled() || autoEnrollPending ||
          typeof GM_xmlhttpRequest !== 'function' ||
          typeof GM_getValue !== 'function' || typeof GM_setValue !== 'function' ||
          Date.now() - lastAutoEnroll < AUTO_ENROLL_INTERVAL) return;
      lastAutoEnroll = Date.now();
      try {
        if (!autoProof) {
          const stored = GM_getValue(AUTO_PROOF_PREFIX + chatId, null);
          if (typeof stored === 'string' && /^[a-f0-9]{64}$/.test(stored))
            autoProof = stored;
          else {
            autoProof = makeClientProof();
            if (!autoProof) return;
            GM_setValue(AUTO_PROOF_PREFIX + chatId, autoProof);
          }
        }
        const snapshot = generation;
        const intendedChat = chatId;
        const title = titleReportingSupported ? currentTabTitle() : '';
        const payload = {chat: intendedChat, proof: autoProof, ...(title ? {title} : {})};
        autoEnrollPending = true;
        GM_xmlhttpRequest({
          method: 'POST',
          url: AUTO_ENROLL_ORIGIN + '/api/notifier/enroll',
          headers: {'Content-Type': 'application/json'},
          data: JSON.stringify(payload),
          timeout: 3500,
          onload(reply) {
            autoEnrollPending = false;
            if (generation !== snapshot || currentChatId() !== intendedChat) return;
            // Older Viewers reject the optional field. Keep the old pairing
            // intact and retry legacy enrollment on the next normal heartbeat.
            if (reply?.status !== 200) {
              if (title && [400, 403].includes(reply?.status)) titleReportingSupported = false;
              return;
            }
            try {
              const info = JSON.parse(reply.responseText);
              if (info?.ok !== true) return;
              titleReportingSupported = info.supports_tab_titles === true;
              if (info.status !== 'approved') return;
              const candidate = validatePairing(info.pairing, intendedChat);
              if (!candidate || candidate.origin !== AUTO_ENROLL_ORIGIN) return;
              const updated = !pairing || pairing.reporting_session_id !== candidate.reporting_session_id ||
                pairing.dispatch_key !== candidate.dispatch_key ||
                pairing.observer_key !== candidate.observer_key ||
                pairing.message_writer_key !== candidate.message_writer_key ||
                pairing.task_intent_key !== candidate.task_intent_key;
              if (!updated) return;
              GM_setValue(PREFIX + intendedChat, candidate);
              generation += 1;
              pairing = candidate;
              requestPending = null;
              latestSequence = -1;
              lastTriggeredSequence = -1;
              initialStatusRead = false;
              startSequence = -1;
              workStartedAt = 0;
              lastCheckAt = 0;
              notify('Fortis: привязка чата подтверждена Observatory и сохранена.');
              check();
            } catch (_) { /* invalid enrollment must not change the pairing */ }
          },
          onerror() { autoEnrollPending = false; },
          ontimeout() { autoEnrollPending = false; }
        });
      } catch (_) { autoEnrollPending = false; }
    }

    function noteArmed() {
      refreshChat();
      workStartedAt = Date.now();
      startSequence = Math.max(startSequence, latestSequence);
    }

    function receive(data, snapshot) {
      if (!isEnabled() || !pairing || !allowedOrigin(pairing.origin) || snapshot !== generation || currentChatId() !== chatId) return false;
      if (!data || data.ok !== true || data.version !== 1 ||
          data.conversation_id !== chatId ||
          data.reporting_session_id !== pairing.reporting_session_id ||
          !Number.isInteger(data.sequence) || data.sequence < -1 ||
          !['none', 'started', 'progress', 'checkpoint', 'blocked', 'completed', 'failed'].includes(data.event)) {
        tabState?.clearObservatorySummary?.('unavailable', snapshot); return false;
      }
      // Summary age and task counts change even when latest work sequence does not.
      if (data.task_overview === undefined || data.task_overview?.version !== 2) tabState?.clearObservatorySummary?.('unsupported', snapshot);
      else if (tabState?.setObservatorySummary?.(data.task_overview, {
        conversation_id: chatId, reporting_session_id: pairing.reporting_session_id,
        generation: snapshot }) === false) tabState?.clearObservatorySummary?.('unavailable', snapshot);

      const acceptedMs = typeof data.accepted_unix === 'number' ? data.accepted_unix * 1000 : 0;
      const fresh = acceptedMs > 0 && Number.isFinite(acceptedMs) &&
        acceptedMs <= Date.now() + 30000 && Date.now() - acceptedMs <= MAX_EVENT_AGE_MS;
      const initialRead = !initialStatusRead;
      initialStatusRead = true;
      if (data.sequence <= latestSequence) return false;
      latestSequence = data.sequence;
      if (!fresh) return false;

      if (['started', 'progress', 'checkpoint'].includes(data.event)) {
        // Progress is active work when a rapid started event fell between polls.
        if (startSequence < 0 || data.event === 'started' ||
            !['working', 'observatory-working'].includes(tabState?.getState?.())) {
          startSequence = data.sequence;
          workStartedAt = acceptedMs;
        }
        if (responseMonitor?.startFromExternal?.()) {
          notify('Работа начата по событию Fortis Observatory');
          return true;
        }
        return false;
      }

      if (data.event === 'completed' && !initialRead && workStartedAt > 0 &&
          acceptedMs >= workStartedAt &&
          data.sequence > Math.max(startSequence, lastTriggeredSequence) &&
          ['working', 'observatory-working'].includes(tabState?.getState?.()) &&
          responseMonitor?.finishFromExternal?.()) {
        lastTriggeredSequence = data.sequence;
        workStartedAt = 0;
        startSequence = -1;
        notify('Работа завершена по событию Fortis Observatory');
        return true;
      }
      return false;
    }

    function check() {
      refreshChat();
      tabState?.setObservatoryBinding?.(pairing ? { conversation_id: chatId,
        reporting_session_id: pairing.reporting_session_id, generation } : null);
      tabState?.refreshObservatoryAge?.();
      checkAutoEnrollment();
      if (!isEnabled()) { tabState?.clearObservatorySummary?.('disabled', generation); return; }
      if (!pairing || requestPending || typeof GM_xmlhttpRequest !== 'function') return;
      if (Date.now() - lastCheckAt < 3000) return;
      lastCheckAt = Date.now();
      const snapshot = generation, expectedOrigin = pairing.origin, expectedKey = pairing.observer_key;
      const token = {};
      requestPending = token;
      function settle() {
        if (requestPending !== token) return false;
        requestPending = null;
        return snapshot === generation && pairing?.origin === expectedOrigin &&
          pairing?.observer_key === expectedKey && currentChatId() === chatId;
      }
      function fail(reason) {
        if (settle()) tabState?.clearObservatorySummary?.(reason, snapshot);
      }
      try {
        GM_xmlhttpRequest({
          method: 'GET',
          url: pairing.origin + '/api/observer-status?session=' + encodeURIComponent(pairing.reporting_session_id),
          headers: { 'X-Fortis-Observer-Key': expectedKey }, timeout: 3000,
          onload(response) {
            if (!settle()) return;
            if (!isEnabled()) { tabState?.clearObservatorySummary?.('disabled', snapshot); return; }
            if (response.status !== 200) {
              tabState?.clearObservatorySummary?.([401, 403].includes(response.status) ? 'denied' : 'unavailable', snapshot);
              return;
            }
            try { receive(JSON.parse(response.responseText), snapshot); }
            catch (_) { tabState?.clearObservatorySummary?.('unavailable', snapshot); }
          },
          onerror() { fail('unavailable'); }, ontimeout() { fail('unavailable'); }
        });
      } catch (_) { fail('unavailable'); }
    }

    function pairCurrent() {
      refreshChat();
      if (!chatId || typeof GM_setValue !== 'function') {
        alert('Открой обычную беседу /c/... для привязки.');
        return;
      }
      const raw = prompt('Вставь код привязки из Observatory (НЕ отправляй его в чат):');
      if (!raw) return;
      let candidate;
      try { candidate = validatePairing(JSON.parse(raw), chatId); } catch (_) { candidate = null; }
      if (!candidate) { alert('Код не подходит для этого Chat ID или сервера.'); return; }
      GM_setValue(PREFIX + chatId, candidate);
      generation += 1;
      pairing = candidate;
      requestPending = null;
      latestSequence = -1;
      lastTriggeredSequence = -1;
      initialStatusRead = false;
      startSequence = -1;
      workStartedAt = 0;
      lastCheckAt = 0;
      check();
      alert(candidate.dispatch_key
        ? 'Привязка сохранена. Этот чат может получать адресные команды из Owner Viewer.'
        : candidate.message_writer_key
          ? 'Привязка с записью исходных сообщений сохранена только для этого Chat ID.'
          : 'Привязка только для чтения сохранена для текущего Chat ID.');
    }

    function unpairCurrent() {
      refreshChat();
      if (chatId && typeof GM_deleteValue === 'function') {
        GM_deleteValue(PREFIX + chatId);
        GM_deleteValue(AUTO_PROOF_PREFIX + chatId);
      }
      generation += 1;
      pairing = null;
      tabState?.setObservatoryBinding?.(null);
      requestPending = null;
      workStartedAt = 0;
      startSequence = -1;
      initialStatusRead = false;
      alert('Привязка Observatory удалена для текущего чата.');
    }

    refreshChat();
    return {
      noteArmed, check, resetForNavigation: refreshChat, pairCurrent, unpairCurrent,
      isPaired: () => Boolean(pairing),
      getLatestSequence: () => latestSequence,
      getPairing: () => { refreshChat(); return pairing ? { ...pairing } : null; }
    };
  }

  // Each chat has a separate mode per browser tab, persisted for reloads.
  const MODE_PREFIX = 'fortis-observatory-v1-completion-mode-';
  const MODES = Object.freeze(['both', 'dom', 'observatory', 'off']);

  function createCompletionModeSettings({ show = message => alert(message) } = {}) {
    let chatId = null;
    let mode = 'both';

    function syncChat() {
      const next = currentChatId();
      if (next === chatId) return;
      chatId = next;
      mode = 'both';
      if (!chatId) return;
      try {
        const stored = sessionStorage.getItem(MODE_PREFIX + chatId);
        if (MODES.includes(stored)) mode = stored;
      } catch (_) { /* fail back to original native behavior */ }
    }

    function domEnabled() {
      syncChat();
      return mode === 'both' || mode === 'dom';
    }

    function observatoryEnabled() {
      syncChat();
      return mode === 'both' || mode === 'observatory';
    }

    function describe() {
      syncChat();
      return 'Источники начала и завершения текущего чата:\n' +
        'DOM Tab Notifier: ' + (domEnabled() ? 'ВКЛ' : 'ВЫКЛ') + '\n' +
        'Fortis Observatory: ' + (observatoryEnabled() ? 'ВКЛ' : 'ВЫКЛ') + '\n\n' +
        'Отключаются НАЧАЛО и КОНЕЦ по выбранному источнику; автоотправка не меняется.\n' +
        'Для сравнения запусти новую генерацию после переключения.';
    }

    function setMode(nextMode) {
      syncChat();
      if (!chatId || !MODES.includes(nextMode)) return false;
      try {
        sessionStorage.setItem(MODE_PREFIX + chatId, nextMode);
      } catch (_) {
        show('Не удалось сохранить режим для этой вкладки.');
        return false;
      }
      mode = nextMode;
      return true;
    }

    function toggleDom() {
      const next = domEnabled()
        ? (observatoryEnabled() ? 'observatory' : 'off')
        : (observatoryEnabled() ? 'both' : 'dom');
      if (!setMode(next)) return show('Открой обычный чат /c/... для настройки.');
      show(describe());
    }

    function toggleObservatory() {
      const next = observatoryEnabled()
        ? (domEnabled() ? 'dom' : 'off')
        : (domEnabled() ? 'both' : 'observatory');
      if (!setMode(next)) return show('Открой обычный чат /c/... для настройки.');
      show(describe());
    }

    function showStatus() { show(describe()); }

    syncChat();
    return {
      domEnabled, observatoryEnabled, toggleDom, toggleObservatory,
      showStatus, getMode: () => { syncChat(); return mode; }
    };
  }

  return { createObservatoryCompletionBridge, createCompletionModeSettings,
           currentChatId, validatePairing };
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
    let persistentMessageController = null;
    let taskActivityMonitor = null;
    let taskIntentMonitor = null;
    let userMessageArchiveMonitor = null;
    let delayedSendController = null;
    let observerBridge = null;

    function scheduleUi() {
      uploadUi?.schedule();
    }

    const completionModes = deps.createCompletionModeSettings?.() || null;
    const tabState = deps.createTabStateController({ scheduleUiUpdate: scheduleUi,
      isGenerating: () => (completionModes?.domEnabled() ?? true) && Boolean(deps.isGenerating?.()) });
    const notifications = deps.createNotificationService(tabState);

    const responseMonitor = deps.createResponseMonitor({
      isDomEnabled: () => completionModes?.domEnabled() ?? true,
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
      onArmed: () => observerBridge?.noteArmed(),
      onFinished: () => {
        delayedSendController?.check();
        if (!delayedSendController?.isSending?.() && !delayedSendController?.hasDueWork?.()) {
          queuedPromptController?.handleResponseFinished();
        }
      }
    });

    observerBridge = deps.createObservatoryCompletionBridge?.({
      tabState, responseMonitor,
      isEnabled: () => completionModes?.observatoryEnabled() ?? true
    }) || null;

    uploadController = deps.createUploadAutoSendController({ tabState, isGenerationActive: deps.isGenerating });
    queuedPromptController = deps.createQueuedPromptController({
      onChange: scheduleUi,
      beforeSendClick: info => persistentMessageController?.beforeSendClick(info) ?? true,
      onSendResult: info => persistentMessageController?.handleSendResult(info)
    });
    persistentMessageController = deps.createPersistentMessageController?.({
      queue: queuedPromptController, onChange: scheduleUi,
      onSaved: () => { Promise.resolve().then(() => taskIntentMonitor?.check()); },
      getConversationId: () => deps.currentChatId?.() || '',
      getPairing: () => observerBridge?.getPairing?.() || null,
      storage: deps.createGMRecordStorage?.({
        getValue: typeof GM_getValue === 'function' ? GM_getValue : null,
        setValue: typeof GM_setValue === 'function' ? GM_setValue : null,
        listValues: typeof GM_listValues === 'function' ? GM_listValues : null
      })
    }) || null;
    taskIntentMonitor = deps.createTaskIntentMonitor?.({
      messages: persistentMessageController,
      getPairing: () => observerBridge?.getPairing?.() || null,
      getConversationId: () => deps.currentChatId?.() || '',
      request: typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest : null
    }) || null;
    taskActivityMonitor = deps.createTaskActivityMonitor?.({
      messages: persistentMessageController,
      getPairing: () => observerBridge?.getPairing?.() || null,
      getConversationId: () => deps.currentChatId?.() || '',
      request: typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest : null,
      onStatus: scheduleUi
    }) || null;
    userMessageArchiveMonitor = deps.createUserMessageArchiveMonitor?.({
      messages: persistentMessageController,
      getPairing: () => observerBridge?.getPairing?.() || null,
      getConversationId: () => deps.currentChatId?.() || '',
      request: typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest : null
    }) || null;
    delayedSendController = deps.createDelayedSendController({
      onChange: scheduleUi,
      isGenerationActive: deps.isGenerating,
      isSendPipelineBusy: () => Boolean(queuedPromptController?.isWaitingToSend() || uploadController?.isConfirmingSend()),
      getAssistantSnapshot: deps.assistantSnapshot
    });
    const textboxProfileManager = deps.createTextboxProfileManager?.({
      getValue: typeof GM_getValue === 'function' ? GM_getValue : null,
      setValue: typeof GM_setValue === 'function' ? GM_setValue : null,
      onChange: scheduleUi
    }) || null;

    const sessionDispatchMonitor = deps.createSessionDispatchMonitor?.({
      getPairing: () => observerBridge?.getPairing?.() || null,
      getConversationId: () => deps.currentChatId?.() || '',
      request: typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest : null,
      queue: queuedPromptController, messages: persistentMessageController,
      profiles: textboxProfileManager,
      quickAction: ({mode,text,moduleIds,profileId,delayMs})=>
        uploadUi?.dispatchQuickAction?.(mode,text,moduleIds,profileId,delayMs) || {ok:false},
      findComposerContext: deps.findComposerContext,
      isGenerating: deps.isGenerating,
      canExecute: context => !uploadController.isArmed() &&
        !uploadController.isConfirmingSend() &&
        !delayedSendController?.isSending?.() &&
        !delayedSendController?.isCheckpointActive?.() &&
        !queuedPromptController?.hasQueued?.() &&
        !deps.composerHasUploadBusyEvidence?.(context.container || context.composer),
      report: () => scheduleUi()
    }) || null;
    textboxProfileManager?.requestCatalog();
    uploadUi = deps.createUploadButtonUi({ tabState, uploadController,
      queuedPromptController, delayedSendController, persistentMessageController,
      taskActivityMonitor, textboxProfileManager });
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

    function observeManualDraftSend() {
      const context = deps.findComposerContext?.();
      if (!context?.composer?.isConnected ||
          !deps.isSendButtonReady?.(context.sendButton)) return;
      const editor = context.composer;
      const text = typeof HTMLTextAreaElement !== 'undefined' &&
        editor instanceof HTMLTextAreaElement ? editor.value :
        (typeof HTMLInputElement !== 'undefined' &&
         editor instanceof HTMLInputElement ? editor.value :
         (typeof editor.innerText === 'string' ? editor.innerText : editor.textContent));
      if (typeof text !== 'string') return;
      persistentMessageController?.recordManualDraftSend?.(text, {
        fileNameVisible: name => Boolean(
          deps.fileAttachmentVisible?.(context.container || editor, name) &&
          !deps.composerHasUploadBusyEvidence?.(context.container || editor, [name]))
      });
    }

    document.addEventListener('click', event => {
      if (!deps.isComposerSendButton(event.target)) return;
      if (event.isTrusted) observeManualDraftSend();
      responseMonitor.armAnswer('send-button');
    }, true);

    document.addEventListener('keydown', event => {
      if (
        event.key === 'Enter' && !event.isComposing && !event.shiftKey && !event.ctrlKey &&
        !event.altKey && !event.metaKey && deps.isComposerTarget(event.target)
      ) {
        if (event.isTrusted) observeManualDraftSend();
        responseMonitor.armAnswer('enter-key');
      }
    }, true);

    document.addEventListener('submit', event => {
      if (typeof HTMLFormElement === 'undefined' || !(event.target instanceof HTMLFormElement)) return;
      if (!deps.COMPOSER_SELECTORS.some(selector => event.target.querySelector(selector))) return;
      if (event.isTrusted) observeManualDraftSend();
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
      observerBridge?.resetForNavigation();
      uploadController.reset({ clearMark: true, render: false });
      uploadController.resetFileHistory();
      queuedPromptController.resetForNavigation();
      delayedSendController?.resetForNavigation();
      uploadUi.closeQueuePanel?.();
      uploadUi.resetLargePasteDraft?.();
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
      if (tickCount % 8 === 0) {
        observerBridge?.check(); taskIntentMonitor?.check(); taskActivityMonitor?.check(); userMessageArchiveMonitor?.check();
        sessionDispatchMonitor?.check();
      }
      if (!document.hidden && tickCount % 6 === 0) scheduleUi();
    }, deps.SETTINGS.checkIntervalMs);

    if (typeof GM_registerMenuCommand === 'function') {
      GM_registerMenuCommand(`ℹ Версия: v${deps.SCRIPT_VERSION}`, () => console.info(`[ChatGPT notifier] v${deps.SCRIPT_VERSION}`));
      GM_registerMenuCommand('◷ Чекпоинт по таймеру', delayedSendController.toggleCheckpoint);
      GM_registerMenuCommand('⇧ Автоотправка после загрузки файлов', uploadController.toggle);
      GM_registerMenuCommand('● Проверить уведомление', notifications.showDesktopNotification);
      if (observerBridge) {
        GM_registerMenuCommand('Fortis: привязать текущий чат', observerBridge.pairCurrent);
        GM_registerMenuCommand('Fortis: отключить текущий чат', observerBridge.unpairCurrent);
      }
      if (completionModes) {
        GM_registerMenuCommand('Fortis: переключить DOM (начало и конец)', completionModes.toggleDom);
        GM_registerMenuCommand('Fortis: переключить Observatory (начало и конец)', completionModes.toggleObservatory);
        GM_registerMenuCommand('Fortis: показать источники состояния', completionModes.showStatus);
      }
    }

    tabState.render();
    responseMonitor.check();
    observerBridge?.check();
    taskIntentMonitor?.check();
    taskActivityMonitor?.check();
    userMessageArchiveMonitor?.check();
    sessionDispatchMonitor?.check();
    scheduleUi();
    console.info(`[ChatGPT notifier] v${deps.SCRIPT_VERSION} запущен. Перетаскиваемые кнопки: ◷ — чекпоинт по таймеру, + — очередь/отложенные, ⇧ — автоотправка файлов.`);

    return {
      dispose() {
        clearInterval(interval);
        uiObserver.disconnect();
        taskIntentMonitor?.dispose();
      },
      tabState,
      uploadController,
      queuedPromptController,
      persistentMessageController,
      taskActivityMonitor,
      taskIntentMonitor,
      userMessageArchiveMonitor,
      sessionDispatchMonitor,
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
