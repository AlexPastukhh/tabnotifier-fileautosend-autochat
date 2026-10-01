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
  const TEXT_MISMATCH_GRACE_MS = 700;
  const SEND_RETRY_DELAY_MS = 1600;
  const SEND_CONFIRM_TIMEOUT_MS = 10000;
  const SEND_MAX_CLICKS = 3;
  const SETTINGS_KEY = 'chatgpt-tab-notifier-delayed-send-settings-v1';
  const STATE_KEY = 'chatgpt-tab-notifier-delayed-send-state-v1';

  function normalizeDelayMs(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return DEFAULT_DELAY_MS;
    return Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, Math.round(numeric)));
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
    storage = (typeof localStorage !== 'undefined' ? localStorage : null),
    now = () => Date.now(),
    getRouteKey = () => (typeof location !== 'undefined' ? location.href : ''),
    resolveContext = () => deps.findComposerContext?.(),
    isSendReady = button => deps.isSendButtonReady?.(button),
    readText = composer => deps.readComposerText?.(composer) || '',
    normalizeText = value => deps.normalizeComposerTextForOwnership?.(value) || String(value || '').trim()
  } = {}) {
    let delayMs = DEFAULT_DELAY_MS;
    let job = null;
    let lastStatus = '';
    let lastRenderedSecond = null;

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

    function persistSettings() {
      storageSet(SETTINGS_KEY, JSON.stringify({ delayMs }));
    }

    function persistWaitingJob() {
      if (!job || job.phase !== 'waiting') {
        storageRemove(STATE_KEY);
        return;
      }
      storageSet(STATE_KEY, JSON.stringify({
        deadline: job.deadline,
        expectedNormalized: job.expectedNormalized,
        routeKey: job.routeKey
      }));
    }

    function clearPersistedJob() {
      storageRemove(STATE_KEY);
    }

    function setStatus(message) {
      lastStatus = String(message || '');
      emitChange();
    }

    function clearJob({ status = '', persist = true } = {}) {
      job = null;
      lastRenderedSecond = null;
      if (persist) clearPersistedJob();
      lastStatus = String(status || '');
      emitChange();
    }

    function loadPersistedState() {
      try {
        const settings = JSON.parse(storageGet(SETTINGS_KEY) || 'null');
        if (settings?.delayMs) delayMs = normalizeDelayMs(settings.delayMs);
      } catch (_) {}

      try {
        const saved = JSON.parse(storageGet(STATE_KEY) || 'null');
        if (!saved) return;
        const deadline = Number(saved.deadline);
        const expectedNormalized = normalizeText(saved.expectedNormalized);
        const routeKey = String(saved.routeKey || '');
        if (!Number.isFinite(deadline) || !expectedNormalized || routeKey !== String(getRouteKey() || '')) {
          clearPersistedJob();
          return;
        }
        job = {
          phase: 'waiting',
          deadline,
          expectedNormalized,
          routeKey,
          mismatchSince: 0,
          clickCount: 0,
          clickedAt: 0,
          lastClickAt: 0,
          clickedComposer: null,
          clickedButton: null
        };
      } catch (_) {
        clearPersistedJob();
      }
    }

    function setDelayMs(value) {
      delayMs = normalizeDelayMs(value);
      persistSettings();
      emitChange();
      return delayMs;
    }

    function cancel(message = 'Отложенная отправка снята.') {
      if (!job) return false;
      clearJob({ status: message });
      return true;
    }

    function arm() {
      const context = resolveContext();
      const composer = context?.composer;
      if (!composer) {
        setStatus('Не найдено обычное поле ChatGPT для таймера.');
        return false;
      }

      const expectedNormalized = normalizeText(readText(composer));
      if (!expectedNormalized) {
        setStatus('Обычное поле ChatGPT пустое — таймер не поставлен.');
        return false;
      }

      const timestamp = now();
      job = {
        phase: 'waiting',
        deadline: timestamp + delayMs,
        expectedNormalized,
        routeKey: String(getRouteKey() || ''),
        mismatchSince: 0,
        clickCount: 0,
        clickedAt: 0,
        lastClickAt: 0,
        clickedComposer: null,
        clickedButton: null
      };
      lastStatus = '';
      lastRenderedSecond = null;
      persistWaitingJob();
      emitChange();
      console.info(`[ChatGPT notifier] Отложенная отправка включена на ${formatDelayedRemaining(delayMs)}.`);
      return true;
    }

    function toggle() {
      if (job) return cancel();
      return arm();
    }

    function finishConfirmed(reason) {
      console.info(`[ChatGPT notifier] Отложенная отправка подтверждена (${reason}).`);
      clearJob({ status: 'Отложенное сообщение отправлено.' });
      return true;
    }

    function fail(message) {
      console.warn(`[ChatGPT notifier] ${message}`);
      clearJob({ status: message });
      return false;
    }

    function noteRemaining(timestamp) {
      if (!job) return;
      const second = Math.max(0, Math.ceil((job.deadline - timestamp) / 1000));
      if (second === lastRenderedSecond) return;
      lastRenderedSecond = second;
      emitChange();
    }

    function currentGenerationActive() {
      try { return Boolean(isGenerationActive()); } catch (_) { return false; }
    }

    function clickWithContext(context, timestamp, { retry = false } = {}) {
      const composer = context?.composer;
      const sendButton = context?.sendButton;
      if (!job || !composer || !isSendReady(sendButton) || sendButton?.isConnected === false) return false;

      const currentNormalized = normalizeText(readText(composer));
      if (currentNormalized !== job.expectedNormalized) return false;

      job.phase = 'confirm';
      job.clickCount += 1;
      job.clickedAt ||= timestamp;
      job.lastClickAt = timestamp;
      job.clickedComposer = composer;
      job.clickedButton = sendButton;
      clearPersistedJob(); // Never restore a click-in-flight after a reload: that could duplicate a send.
      emitChange();

      console.info(
        `[ChatGPT notifier] Нажимаю штатный Send по таймеру${retry ? ` повторно (${job.clickCount}/${SEND_MAX_CLICKS})` : ''}.`
      );
      try {
        sendButton.click();
      } catch (error) {
        console.warn('[ChatGPT notifier] Ошибка штатного Send по таймеру:', error);
        return false;
      }
      return true;
    }

    function check(timestamp = now()) {
      if (!job) return false;
      if (String(getRouteKey() || '') !== job.routeKey) {
        return cancel('Отложенная отправка снята: открыт другой чат.');
      }

      noteRemaining(timestamp);

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
        if (confirmation.confirmed) return finishConfirmed(confirmation.reason);

        if (timestamp - job.clickedAt >= SEND_CONFIRM_TIMEOUT_MS) {
          return fail('Не удалось подтвердить отправку по таймеру; повторной отправки не будет.');
        }

        if (timestamp - job.lastClickAt < SEND_RETRY_DELAY_MS || job.clickCount >= SEND_MAX_CLICKS) return false;
        const context = resolveContext();
        const currentNormalized = normalizeText(readText(context?.composer));
        if (!context?.composer || currentNormalized !== job.expectedNormalized || !isSendReady(context.sendButton)) return false;
        return clickWithContext(context, timestamp, { retry: true });
      }

      const context = resolveContext();
      if (context?.composer) {
        const currentNormalized = normalizeText(readText(context.composer));
        if (currentNormalized !== job.expectedNormalized) {
          if (!job.mismatchSince) job.mismatchSince = timestamp;
          if (timestamp - job.mismatchSince >= TEXT_MISMATCH_GRACE_MS) {
            return cancel('Отложенная отправка снята: текст в поле ChatGPT изменился.');
          }
          return false;
        }
        job.mismatchSince = 0;
      }

      if (timestamp < job.deadline) return false;
      if (currentGenerationActive()) return false;
      if (!context?.composer || !isSendReady(context.sendButton)) return false;

      return clickWithContext(context, timestamp);
    }

    function resetForNavigation() {
      if (job) clearJob({ status: '', persist: true });
      else clearPersistedJob();
    }

    function getRemainingMs(timestamp = now()) {
      if (!job) return 0;
      return Math.max(0, job.deadline - timestamp);
    }

    function getRemainingLabel(timestamp = now()) {
      return job ? formatDelayedRemaining(getRemainingMs(timestamp)) : '';
    }

    loadPersistedState();

    return {
      arm,
      toggle,
      cancel,
      check,
      resetForNavigation,
      setDelayMs,
      getDelayMs: () => delayMs,
      getRemainingMs,
      getRemainingLabel,
      getDeadline: () => job?.deadline || 0,
      getLastStatus: () => lastStatus,
      isActive: () => Boolean(job),
      isConfirmingSend: () => job?.phase === 'confirm'
    };
  }

  return {
    DEFAULT_DELAY_MS,
    MIN_DELAY_MS,
    MAX_DELAY_MS,
    normalizeDelayMs,
    formatDelayedRemaining,
    evaluateDelayedSendConfirmation,
    createDelayedSendController
  };
});
