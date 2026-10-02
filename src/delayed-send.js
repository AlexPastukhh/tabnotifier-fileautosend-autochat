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
