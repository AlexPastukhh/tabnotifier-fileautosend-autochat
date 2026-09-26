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

    // After an accepted send ChatGPT normally consumes the composer/attachment and
    // temporarily removes or disables Send. Requiring both sides of that transition
    // avoids treating a user edit by itself as confirmation.
    if (!sendReadyNow) {
      if (composerHadText && !composerHasText) return { confirmed: true, reason: 'composer-consumed' };
      if (attachmentBefore && !attachmentNow) return { confirmed: true, reason: 'attachment-consumed' };
      if (fileInputBefore && !fileInputNow) return { confirmed: true, reason: 'file-input-consumed' };
      if (!currentStrongFileEvidence && elapsedSinceClickMs >= 180) {
        return { confirmed: true, reason: 'send-became-unavailable' };
      }
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
    composerUnchanged = false
  }) {
    if (clickCount >= SEND_MAX_CLICKS) return false;
    if (!sendReadyNow || busy) return false;
    if (elapsedSinceClickMs < SEND_RETRY_DELAY_MS) return false;
    if (currentStrongFileEvidence) return true;

    // If the attachment DOM itself is unavailable, retry only when the exact same
    // ready Send button and composer contents are still untouched for longer. That
    // is a stronger signal that the previous click was ignored, while avoiding a
    // blind duplicate click after React has already transitioned the composer.
    return Boolean(
      sameReadyButton &&
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

    function currentInputFileNames() {
      return typeof deps.getInputFileNames === 'function' ? deps.getInputFileNames(document) : [];
    }

    function currentInputHasKnownFiles() {
      const current = currentInputFileNames();
      if (!current.length) return false;
      if (!lastFileNames.length) return true;
      const known = new Set(lastFileNames);
      return current.some(name => known.has(name));
    }

    function currentSendButton(form) {
      return (form && deps.findSendButton(form)) || deps.findSendButton(document);
    }

    function readComposerText() {
      const composer = typeof deps.findComposer === 'function' ? deps.findComposer() : null;
      if (!composer) return '';
      if (typeof HTMLTextAreaElement !== 'undefined' && composer instanceof HTMLTextAreaElement) return composer.value || '';
      if (typeof HTMLInputElement !== 'undefined' && composer instanceof HTMLInputElement) return composer.value || '';
      return String(composer.innerText || composer.textContent || '').replace(/\u00a0/g, ' ');
    }

    function syncCurrentFileInputEvidence(now = Date.now()) {
      const names = currentInputFileNames();
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
      syncCurrentFileInputEvidence(now);

      const form = deps.findComposerForm();
      const sendButton = currentSendButton(form);
      sawBusy = Boolean(
        form && (
          deps.composerHasUploadBusyEvidence(form, lastFileNames) ||
          !deps.isSendButtonReady(sendButton)
        )
      );
      sawAttachment = Boolean(form && deps.composerHasAttachmentEvidence(form, lastFileNames));

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
      const form = deps.findComposerForm();
      if (!form) return false;

      const sendButton = currentSendButton(form);
      if (!deps.isSendButtonReady(sendButton) || sendButton?.isConnected === false) return false;
      if (deps.composerHasUploadBusyEvidence(form, lastFileNames)) return false;

      sendAttempt.lastClickAt = now;
      sendAttempt.clickCount += 1;
      sendAttempt.lastButton = sendButton;
      sendAttempt.composerTextAtLastClick = readComposerText().trim();
      console.info(
        `[ChatGPT notifier] Нажимаю штатный Send для файла${isRetry ? ` повторно (${sendAttempt.clickCount}/${SEND_MAX_CLICKS})` : ''}.`
      );

      try {
        sendButton.click();
      } catch (error) {
        console.warn('[ChatGPT notifier] Ошибка штатного Send click:', error);
        return false;
      }
      return true;
    }

    function beginSendAttempt() {
      if (!armed || sendAttempt) return false;

      const now = Date.now();
      syncCurrentFileInputEvidence(now);

      const form = deps.findComposerForm();
      const sendButton = currentSendButton(form);
      if (!form || !deps.isSendButtonReady(sendButton)) return false;

      const attachment = deps.composerHasAttachmentEvidence(form, lastFileNames);
      const activityFallback = hasFreshActivityFallback(now);
      if (!attachment && !activityFallback) return false;
      if (deps.composerHasUploadBusyEvidence(form, lastFileNames)) return false;

      if (!attachment && activityFallback && now - lastFallbackLogAt > 2000) {
        lastFallbackLogAt = now;
        console.info('[ChatGPT notifier] Карточка вложения не распознана; использую подтверждённую активность файла.');
      }

      const composerText = readComposerText().trim();
      sendAttempt = {
        startedAt: now,
        lastClickAt: 0,
        clickCount: 0,
        lastButton: null,
        composerTextAtLastClick: composerText,
        composerHadText: Boolean(composerText),
        attachmentBefore: attachment,
        fileInputBefore: currentInputHasKnownFiles()
      };

      // IMPORTANT: do not reset/disarm before click. The controller remains armed
      // until ChatGPT consumption/generation confirms that the send was accepted.
      if (!clickCurrentSend()) {
        sendAttempt = null;
        readySince = 0;
        return false;
      }
      return true;
    }

    function checkSendAttempt(now = Date.now()) {
      if (!armed || !sendAttempt) return false;

      const form = deps.findComposerForm();
      const sendButton = currentSendButton(form);
      const sendReadyNow = deps.isSendButtonReady(sendButton);
      const attachmentNow = Boolean(form && deps.composerHasAttachmentEvidence(form, lastFileNames));
      const fileInputNow = currentInputHasKnownFiles();
      const composerTextNow = readComposerText().trim();
      const composerHasText = Boolean(composerTextNow);
      let generationActive = false;
      try { generationActive = Boolean(isGenerationActive()); } catch (_) {}
      const currentStrongFileEvidence = attachmentNow || fileInputNow;
      const elapsedSinceClickMs = Math.max(0, now - (sendAttempt.lastClickAt || sendAttempt.startedAt));

      const confirmation = evaluateUploadSendConfirmation({
        generationActive,
        composerHadText: sendAttempt.composerHadText,
        composerHasText,
        attachmentBefore: sendAttempt.attachmentBefore,
        attachmentNow,
        fileInputBefore: sendAttempt.fileInputBefore,
        fileInputNow,
        sendReadyNow,
        currentStrongFileEvidence,
        elapsedSinceClickMs
      });
      if (confirmation.confirmed) return finishConfirmedSend(confirmation.reason);

      if (now - sendAttempt.startedAt >= SEND_CONFIRM_TIMEOUT_MS) {
        return failSendAttempt('Send не удалось подтвердить за отведённое время; автоотправка выключена без дополнительных кликов.');
      }

      if (!form) return false;
      const busy = deps.composerHasUploadBusyEvidence(form, lastFileNames);
      const retry = shouldRetryUploadSend({
        elapsedSinceClickMs,
        clickCount: sendAttempt.clickCount,
        sendReadyNow,
        busy,
        currentStrongFileEvidence,
        sameReadyButton: Boolean(sendButton && sendButton === sendAttempt.lastButton && sendButton.isConnected !== false),
        composerUnchanged: composerTextNow === sendAttempt.composerTextAtLastClick
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

      syncCurrentFileInputEvidence(now);

      const form = deps.findComposerForm();
      if (!form) {
        readySince = 0;
        return;
      }

      const sendButton = currentSendButton(form);
      const busy = deps.composerHasUploadBusyEvidence(form, lastFileNames);
      const attachment = deps.composerHasAttachmentEvidence(form, lastFileNames);
      const activityFallback = hasFreshActivityFallback(now);
      const sendReady = deps.isSendButtonReady(sendButton);

      if (busy || !sendReady) sawBusy = true;
      if (attachment) sawAttachment = true;
      if (now - lastFileActivityAt <= deps.SETTINGS.recentFileActivityWindowMs) sawFileActivity = true;

      if ((!attachment && !activityFallback) || busy || !sendReady) {
        readySince = 0;
        return;
      }

      const hasFileRelation = attachment || activityFallback || sawFileActivity || sawBusy || sawAttachment;
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
