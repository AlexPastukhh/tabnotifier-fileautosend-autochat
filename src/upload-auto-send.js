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
