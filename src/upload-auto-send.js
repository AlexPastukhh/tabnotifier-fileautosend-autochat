(function (root, factory) {
  const deps = typeof require === 'function'
    ? Object.assign({}, require('./config.js'), require('./chatgpt-dom.js'), root.ChatGPTTabNotifier || {})
    : (root.ChatGPTTabNotifier || {});
  const api = factory(deps);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ChatGPTTabNotifier = Object.assign(root.ChatGPTTabNotifier || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  'use strict';

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

  function createUploadAutoSendController({ tabState, onAutoSend = () => {} } = {}) {
    let armed = false;
    let armedAt = 0;
    let readySince = 0;
    let sawBusy = false;
    let sawAttachment = false;
    let sawFileActivity = false;
    let lastFileActivityAt = 0;
    let lastFileNames = [];
    let lastFallbackLogAt = 0;

    function reset({ clearMark = true, render = true } = {}) {
      armed = false;
      armedAt = 0;
      readySince = 0;
      sawBusy = false;
      sawAttachment = false;
      sawFileActivity = false;
      lastFallbackLogAt = 0;
      if (clearMark) tabState.setUploadMarked(false, { renderNow: render });
      else if (render) tabState.render();
    }

    function mergeFileNames(names) {
      const next = Array.from(names || []).map(name => String(name || '')).filter(Boolean);
      if (!next.length) return false;
      lastFileNames = [...new Set([...lastFileNames, ...next])];
      return true;
    }

    function currentSendButton(form) {
      return (form && deps.findSendButton(form)) || deps.findSendButton(document);
    }

    function syncCurrentFileInputEvidence(now = Date.now()) {
      const names = typeof deps.getInputFileNames === 'function' ? deps.getInputFileNames(document) : [];
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
        reset({ clearMark: true, render: true });
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

    function autoSend() {
      if (!armed) return false;

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

      // ChatGPT changes attachment-card markup frequently. A real file input/drop/paste
      // event is therefore accepted as a short-lived fallback, but only while Send is
      // stable and there is no upload-busy evidence.
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
