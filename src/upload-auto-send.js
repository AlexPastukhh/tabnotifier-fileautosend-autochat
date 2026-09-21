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
