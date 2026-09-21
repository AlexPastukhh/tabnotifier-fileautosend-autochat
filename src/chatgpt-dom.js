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
    for (const selector of deps.COMPOSER_SELECTORS) {
      const element = doc.querySelector(selector);
      if (!element) continue;
      const rect = element.getBoundingClientRect?.();
      if (rect && rect.width > 20 && rect.height > 10) return element;
    }
    return null;
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
    return findSendButton(doc)?.closest?.('form') || null;
  }

  function findComposerBox(composer) {
    if (!composer) return null;
    const form = composer.closest?.('form');
    if (form) {
      const rect = form.getBoundingClientRect?.();
      if (rect && rect.width >= 180 && rect.height >= 35 && rect.height <= 320) return rect;
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
    chooseUploadPosition,
    getInputFileNames,
    composerHasAttachmentEvidence,
    composerHasUploadBusyEvidence,
    isComposerTarget,
    isComposerSendButton
  };
});
