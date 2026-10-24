(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ChatGPTTabNotifier = Object.assign(root.ChatGPTTabNotifier || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const SID = /^rs_[0-9a-f]{32}$/;
  const TASK = /^task_[0-9a-f]{32}$/;
  const KEY = /^[A-Za-z0-9_-]{40,70}$/;
  const PHASES = ['send_requested', 'send_unconfirmed', 'send_observed', 'send_not_attempted'];

  function createTaskIntentMonitor({ messages, getPairing, getConversationId, request,
    now = () => Date.now() } = {}) {
    let pending = null, lastCheck = -Infinity, cursor = 0, disposed = false;
    const retry = new Map();
    function check() {
      if (disposed || pending || typeof request !== 'function' || now() - lastCheck < 3500) return false;
      try {
        const pair = getPairing?.(), chat = getConversationId?.();
        if (!pair || pair.conversation_id !== chat || !SID.test(pair.reporting_session_id || '') ||
            !KEY.test(pair.task_intent_key || '') ||
            !['http://127.0.0.1:18754', 'http://127.0.0.1:18755'].includes(pair.origin)) return false;
        const binding = { chat, session: pair.reporting_session_id, origin: pair.origin,
          key: pair.task_intent_key };
        const valid = () => {
          const current = getPairing?.();
          return !disposed && getConversationId?.() === chat && current?.conversation_id === chat &&
            current?.origin === binding.origin && current?.reporting_session_id === binding.session &&
            current?.task_intent_key === binding.key;
        };
        const candidates = (messages?.listForChat(chat) || []).filter(record => {
          const state = retry.get(record.task_id);
          return record.intent_version === 1 && record.intent_ready === true && TASK.test(record.task_id || '') &&
            record.conversation_id === chat && record.reporting_session_id === binding.session &&
            record.observatory_origin === binding.origin &&
            Number.isSafeInteger(record.created_at) && record.created_at > 0 &&
            (record.intent_registered !== true ||
             (Number.isSafeInteger(record.send_revision) && record.send_revision > (record.intent_send_revision || 0) &&
              PHASES.includes(record.send_phase))) &&
            (!state || state.key !== binding.key || state.origin !== binding.origin ||
              state.session !== binding.session || now() >= state.next);
        }).sort((a, b) => a.created_at - b.created_at || a.task_id.localeCompare(b.task_id));
        if (!candidates.length) return false;
        const item = candidates[cursor++ % candidates.length];
        const revision = item.intent_registered === true ? item.send_revision : 0;
        const body = { version: 1, reporting_session_id: binding.session,
          conversation_id: chat, task_id: item.task_id,
          ...(revision === 0 ? { prepared_at_client_ms: item.created_at } : {
            revision, phase: item.send_phase, observed_at_client_ms: item.send_observed_at_client_ms }) };
        if (revision && (!Number.isSafeInteger(body.observed_at_client_ms) || body.observed_at_client_ms <= 0)) return false;
        const token = {};
        pending = token; lastCheck = now();
        function finish(status) {
          if (pending !== token) return;
          pending = null;
          if (!valid()) return;
          const previous = retry.get(item.task_id);
          const failures = status === 'online' ? 0 : Math.min((previous?.failures || 0) + 1, 6);
          retry.set(item.task_id, { ...binding, status, failures,
            next: now() + (status === 'online' ? 0 : Math.min(60000, 3500 * 2 ** failures)) });
          if (retry.size > 512) retry.delete(retry.keys().next().value);
        }
        try {
          request({ method: 'POST',
            url: binding.origin + (revision === 0 ? '/api/task-intents' : '/api/task-send-state'),
            headers: { 'Content-Type': 'application/json', 'X-Fortis-Task-Intent-Key': binding.key },
            data: JSON.stringify(body), timeout: 4000,
            onload(response) {
              if (pending !== token) return;
              if (!valid()) { pending = null; return; }
              if (![200, 201].includes(response?.status)) {
                finish([401, 403].includes(response?.status) ? 'denied' :
                  response?.status === 409 ? 'conflict' : 'unavailable'); return;
              }
              try {
                const receipt = JSON.parse(response.responseText);
                finish(messages.acceptIntentSync(item.task_id, revision, receipt) ? 'online' : 'unavailable');
              } catch (_) { finish('unavailable'); }
            },
            onerror() { finish('unavailable'); }, ontimeout() { finish('unavailable'); }
          });
        } catch (_) { finish('unavailable'); }
        return true;
      } catch (_) { return false; }
    }
    return { check, dispose() { disposed = true; pending = null; },
      isChecking: () => pending !== null,
      getTaskStatus(task) {
        const pair = getPairing?.(), state = retry.get(task);
        return state && state.chat === getConversationId?.() && state.session === pair?.reporting_session_id &&
          state.key === pair?.task_intent_key && state.origin === pair?.origin ? state.status : 'checking';
      } };
  }
  return { createTaskIntentMonitor };
});
