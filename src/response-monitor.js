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
