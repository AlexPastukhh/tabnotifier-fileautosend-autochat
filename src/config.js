(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ChatGPTTabNotifier = Object.assign(root.ChatGPTTabNotifier || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SCRIPT_VERSION = '5.5.0';

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
