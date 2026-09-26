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
