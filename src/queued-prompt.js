(function (root, factory) {
  const deps = typeof require === 'function'
    ? Object.assign({}, require('./config.js'), require('./chatgpt-dom.js'), root.ChatGPTTabNotifier || {})
    : (root.ChatGPTTabNotifier || {});
  const api = factory(deps);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ChatGPTTabNotifier = Object.assign(root.ChatGPTTabNotifier || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  'use strict';

  const FROM_COMPOSER_RETRY_MS = 90;
  const FROM_COMPOSER_MAX_ATTEMPTS = 5;
  const FROM_COMPOSER_CLEAR_MAX_ATTEMPTS = 4;
  const QUEUE_SEND_CONFIRM_TIMEOUT_MS = 2200;

  function readComposerText(composer) {
    if (!composer) return '';
    if (typeof HTMLTextAreaElement !== 'undefined' && composer instanceof HTMLTextAreaElement) return composer.value || '';
    if (typeof HTMLInputElement !== 'undefined' && composer instanceof HTMLInputElement) return composer.value || '';
    return String(composer.innerText || composer.textContent || '').replace(/\u00a0/g, ' ');
  }

  function setNativeValue(element, value) {
    const proto = typeof HTMLTextAreaElement !== 'undefined' && element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : (typeof HTMLInputElement !== 'undefined' && element instanceof HTMLInputElement ? HTMLInputElement.prototype : null);
    const setter = proto && Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(element, value);
    else element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function dispatchComposerInput(element, value) {
    try {
      element.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        composed: true,
        inputType: 'insertText',
        data: value
      }));
    } catch (_) {
      element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    }
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setContentEditableValue(element, value) {
    element.focus();
    let inserted = false;
    try {
      const selection = window.getSelection?.();
      if (selection) {
        const range = document.createRange();
        range.selectNodeContents(element);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      if (typeof document.execCommand === 'function') {
        inserted = Boolean(document.execCommand('insertText', false, value));
      }
    } catch (_) {}

    if (!inserted) {
      element.replaceChildren();
      const lines = String(value).split('\n');
      lines.forEach((line, index) => {
        const paragraph = document.createElement('p');
        if (line) paragraph.textContent = line;
        else paragraph.appendChild(document.createElement('br'));
        element.appendChild(paragraph);
        if (index === lines.length - 1 && lines.length === 1 && !line) paragraph.appendChild(document.createElement('br'));
      });
    }

    // Даже execCommand не всегда синхронизирует внутреннее состояние редактора ChatGPT.
    // Явно уведомляем интерфейс, чтобы штатный Send успел активироваться.
    dispatchComposerInput(element, value);
    return true;
  }

  function setComposerText(composer, value) {
    if (!composer) return false;
    if (
      (typeof HTMLTextAreaElement !== 'undefined' && composer instanceof HTMLTextAreaElement) ||
      (typeof HTMLInputElement !== 'undefined' && composer instanceof HTMLInputElement)
    ) return setNativeValue(composer, value);
    if (composer.isContentEditable || composer.getAttribute?.('contenteditable') === 'true') return setContentEditableValue(composer, value);
    return false;
  }

  // contenteditable ChatGPT может менять представление переносов строк после вставки.
  // Для проверки принадлежности текста сравниваем не сырой innerText, а каноническую форму.
  function normalizeComposerTextForOwnership(value) {
    return String(value || '')
      .replace(/\r\n?/g, '\n')
      .replace(/\u00a0/g, ' ')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n+/g, '\n')
      .trim();
  }

  function composerTextBelongsToJob(currentText, job) {
    if (!job?.insertedByScript) return false;
    const current = normalizeComposerTextForOwnership(currentText);
    if (!current) return false;
    if (current === job.expectedNormalized) return true;
    return Boolean(job.insertedSnapshotNormalized && current === job.insertedSnapshotNormalized);
  }

  function shouldClearComposerTransfer(currentText, expectedNormalized) {
    const current = normalizeComposerTextForOwnership(currentText);
    const expected = normalizeComposerTextForOwnership(expectedNormalized);
    return Boolean(current && expected && current === expected);
  }

  function evaluateQueueSendConfirmation({
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

  function createQueuedPromptController({ onChange = () => {} } = {}) {
    let items = [];
    let nextId = 1;
    let pending = null;
    let retryTimer = null;
    let statusTimer = null;
    let composerTransferTimer = null;
    let composerTransfer = null;
    let transferSerial = 0;
    let jobSerial = 0;
    let lastStatus = '';

    function emitChange() {
      try { onChange(); } catch (error) { console.warn('[ChatGPT notifier] Ошибка обновления UI очереди:', error); }
    }

    function clearRetry() {
      if (retryTimer !== null) clearTimeout(retryTimer);
      retryTimer = null;
    }

    function clearStatusTimer() {
      if (statusTimer !== null) clearTimeout(statusTimer);
      statusTimer = null;
    }

    function setStatus(message, autoClearMs = 4500) {
      clearStatusTimer();
      lastStatus = String(message || '');
      emitChange();
      if (lastStatus && autoClearMs > 0) {
        statusTimer = setTimeout(() => {
          statusTimer = null;
          lastStatus = '';
          emitChange();
        }, autoClearMs);
      }
    }

    function makeId() {
      if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
      return `q-${Date.now().toString(36)}-${(nextId++).toString(36)}`;
    }

    function getItems() {
      return items.map(item => ({ ...item }));
    }

    function getItem(id) {
      return items.find(item => item.id === id) || null;
    }

    function add(text) {
      const value = String(text || '').trim();
      if (!value) return null;
      const item = { id: makeId(), text: value, createdAt: Date.now() };
      items.push(item);
      clearStatusTimer();
      lastStatus = '';
      emitChange();
      console.info(`[ChatGPT notifier] Добавлено в очередь. Элементов: ${items.length}`);
      return item.id;
    }

    function currentComposerContext() {
      if (typeof deps.findComposerContext === 'function') {
        const context = deps.findComposerContext();
        if (context?.composer) return context;
      }
      const composer = deps.findComposer?.();
      if (!composer) return null;
      const container = composer.closest?.('form') || deps.findComposerForm?.() || null;
      const sendButton = container ? deps.findSendButton?.(container) : null;
      return { composer, container, form: container, sendButton };
    }

    function clearComposerTransferTimer() {
      if (composerTransferTimer !== null) clearTimeout(composerTransferTimer);
      composerTransferTimer = null;
    }

    function finishComposerTransfer(message, autoClearMs = 2200) {
      clearComposerTransferTimer();
      composerTransfer = null;
      if (message) setStatus(message, autoClearMs);
    }

    function scheduleComposerTransfer(callback, transferId, delay = FROM_COMPOSER_RETRY_MS) {
      clearComposerTransferTimer();
      composerTransferTimer = setTimeout(() => {
        composerTransferTimer = null;
        if (!composerTransfer || composerTransfer.id !== transferId) return;
        callback();
      }, delay);
    }

    function attemptClearTransferredComposer(transferId, attempt = 0) {
      const transfer = composerTransfer;
      if (!transfer || transfer.id !== transferId || transfer.phase !== 'clear') return false;

      const preferred = transfer.originalComposer;
      let target = null;
      if (preferred?.isConnected !== false && shouldClearComposerTransfer(readComposerText(preferred), transfer.expectedNormalized)) {
        target = preferred;
      } else {
        const context = currentComposerContext();
        const current = context?.composer;
        if (current && shouldClearComposerTransfer(readComposerText(current), transfer.expectedNormalized)) target = current;
      }

      if (!target) {
        if (attempt + 1 < FROM_COMPOSER_CLEAR_MAX_ATTEMPTS) {
          scheduleComposerTransfer(() => attemptClearTransferredComposer(transferId, attempt + 1), transferId);
          return false;
        }
        finishComposerTransfer('Текст добавлен в очередь. Поле ChatGPT успело измениться — я его не очищал.', 5500);
        return false;
      }

      if (!setComposerText(target, '')) {
        if (attempt + 1 < FROM_COMPOSER_CLEAR_MAX_ATTEMPTS) {
          scheduleComposerTransfer(() => attemptClearTransferredComposer(transferId, attempt + 1), transferId);
          return false;
        }
        finishComposerTransfer('Текст добавлен в очередь, но обычное поле ChatGPT не удалось очистить.', 5500);
        return false;
      }

      const after = normalizeComposerTextForOwnership(readComposerText(target));
      if (!after) {
        finishComposerTransfer('Текст из ChatGPT добавлен в очередь.');
        return true;
      }

      // Повторяем очистку только пока в поле всё ещё находится ровно тот текст,
      // который уже скопирован в очередь. Новый пользовательский текст не трогаем.
      if (after === transfer.expectedNormalized && attempt + 1 < FROM_COMPOSER_CLEAR_MAX_ATTEMPTS) {
        scheduleComposerTransfer(() => attemptClearTransferredComposer(transferId, attempt + 1), transferId);
        return false;
      }

      finishComposerTransfer('Текст добавлен в очередь. Поле ChatGPT изменилось во время очистки — новый текст оставлен.', 5500);
      return false;
    }

    function attemptAddFromComposer(transferId, attempt = 0) {
      const transfer = composerTransfer;
      if (!transfer || transfer.id !== transferId || transfer.phase !== 'find') return false;

      const context = currentComposerContext();
      const composer = context?.composer;
      const rawText = composer ? readComposerText(composer) : '';
      const normalized = normalizeComposerTextForOwnership(rawText);

      if (!composer || !normalized) {
        if (attempt + 1 < FROM_COMPOSER_MAX_ATTEMPTS) {
          scheduleComposerTransfer(() => attemptAddFromComposer(transferId, attempt + 1), transferId);
          return false;
        }
        finishComposerTransfer(composer ? 'Обычное поле ChatGPT пустое.' : 'Не найдено обычное поле ChatGPT.', 4500);
        return false;
      }

      const id = add(rawText);
      if (!id) {
        finishComposerTransfer('Не удалось добавить текст из ChatGPT в очередь.', 4500);
        return false;
      }

      transfer.phase = 'clear';
      transfer.itemId = id;
      transfer.originalComposer = composer;
      transfer.expectedNormalized = normalized;
      attemptClearTransferredComposer(transferId, 0);
      return true;
    }

    function addFromComposer() {
      if (composerTransfer) {
        setStatus('Перенос из поля ChatGPT уже выполняется.', 1800);
        return false;
      }
      const transferId = ++transferSerial;
      composerTransfer = { id: transferId, phase: 'find' };
      return attemptAddFromComposer(transferId, 0);
    }

    function move(id, direction) {
      if (pending) return false;
      const index = items.findIndex(item => item.id === id);
      if (index < 0) return false;
      const target = index + Number(direction || 0);
      if (target < 0 || target >= items.length || target === index) return false;
      [items[index], items[target]] = [items[target], items[index]];
      clearStatusTimer();
      lastStatus = '';
      emitChange();
      return true;
    }

    function moveRelative(sourceId, targetId, placeAfter = false) {
      if (pending || sourceId === targetId) return false;
      const sourceIndex = items.findIndex(item => item.id === sourceId);
      if (sourceIndex < 0 || !items.some(item => item.id === targetId)) return false;

      const [moved] = items.splice(sourceIndex, 1);
      const targetIndex = items.findIndex(item => item.id === targetId);
      if (targetIndex < 0) {
        items.splice(Math.min(sourceIndex, items.length), 0, moved);
        return false;
      }

      items.splice(targetIndex + (placeAfter ? 1 : 0), 0, moved);
      clearStatusTimer();
      lastStatus = '';
      emitChange();
      return true;
    }

    function cancelPending() {
      clearRetry();
      pending = null;
      jobSerial += 1; // Инвалидирует уже запланированные callback старой операции.
    }

    function remove(id) {
      const index = items.findIndex(item => item.id === id);
      if (index < 0) return false;
      if (pending?.itemIds?.includes(id)) cancelPending();
      items.splice(index, 1);
      clearStatusTimer();
      lastStatus = '';
      emitChange();
      return true;
    }

    function cancelComposerTransfer() {
      clearComposerTransferTimer();
      composerTransfer = null;
      transferSerial += 1;
    }

    function clear() {
      cancelPending();
      cancelComposerTransfer();
      clearStatusTimer();
      items = [];
      lastStatus = '';
      emitChange();
    }

    function scheduleRetry(delay = 160) {
      if (retryTimer !== null || !pending) return;
      const jobId = pending.jobId;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (!pending || pending.jobId !== jobId) return;
        attemptSend(jobId);
      }, delay);
    }

    function failPending(message, expectedJobId = null) {
      if (expectedJobId !== null && (!pending || pending.jobId !== expectedJobId)) return false;
      clearRetry();
      pending = null;
      jobSerial += 1;
      setStatus(message, 4500);
      console.warn(`[ChatGPT notifier] ${message}`);
      return false;
    }

    function finishPendingSuccess(job) {
      if (!pending || pending.jobId !== job.jobId) return false;
      const sentIds = new Set(job.itemIds);
      clearRetry();
      pending = null;
      items = items.filter(item => !sentIds.has(item.id));
      clearStatusTimer();
      lastStatus = '';
      emitChange();
      console.info(`[ChatGPT notifier] Отправка из очереди (${job.source}) подтверждена:`, job.text);
      return true;
    }

    function beginSend({ itemIds, text, allowWhileGenerating, source, timeoutMs }) {
      const ids = Array.from(itemIds || []).filter(id => getItem(id));
      const value = String(text || '').trim();
      if (!ids.length || !value) return false;

      cancelPending();
      clearStatusTimer();
      const jobId = ++jobSerial;
      pending = {
        jobId,
        itemIds: ids,
        text: value,
        allowWhileGenerating: Boolean(allowWhileGenerating),
        source: source || 'queue',
        deadline: Date.now() + Math.max(1000, Number(timeoutMs) || 7000),
        phase: 'prepare',
        clickedAt: 0,
        insertedByScript: false,
        insertedAt: 0,
        expectedNormalized: normalizeComposerTextForOwnership(value),
        insertedSnapshotNormalized: '',
        clickedSnapshotNormalized: '',
        clickedComposer: null,
        clickedContainer: null,
        clickedButton: null
      };
      lastStatus = '';
      emitChange();
      return attemptSend(jobId);
    }

    function attemptSend(expectedJobId = null) {
      if (!pending) return false;
      const job = pending;
      if (expectedJobId !== null && job.jobId !== expectedJobId) return false;

      const now = Date.now();
      if (now > job.deadline) {
        return failPending('Не удалось отправить: штатное поле или кнопка Send не стали готовы. Сообщение осталось в очереди.', job.jobId);
      }

      const context = currentComposerContext();
      const composer = context?.composer;
      const form = context?.container || context?.form || null;

      if (job.phase === 'confirm') {
        let generationActive = false;
        try { generationActive = Boolean(typeof deps.isGenerating === 'function' && deps.isGenerating()); } catch (_) {}

        const clickedComposer = job.clickedComposer;
        const clickedComposerConnected = Boolean(clickedComposer && clickedComposer.isConnected !== false);
        const clickedComposerHasText = clickedComposerConnected
          ? Boolean(normalizeComposerTextForOwnership(readComposerText(clickedComposer)))
          : true;
        const confirmation = evaluateQueueSendConfirmation({
          generationActive,
          clickedComposerConnected,
          clickedComposerHasText
        });
        if (confirmation.confirmed) return finishPendingSuccess(job);

        if (now - job.clickedAt > QUEUE_SEND_CONFIRM_TIMEOUT_MS) {
          return failPending('Send не удалось надёжно подтвердить. Сообщение сохранено в очереди.', job.jobId);
        }
        scheduleRetry(90);
        return false;
      }

      if (!composer || !form) {
        scheduleRetry(180);
        return false;
      }

      const currentText = readComposerText(composer).trim();

      if (!job.allowWhileGenerating && typeof deps.isGenerating === 'function' && deps.isGenerating()) {
        scheduleRetry(220);
        return false;
      }

      const ownsCurrentText = composerTextBelongsToJob(currentText, job);

      if (currentText && !ownsCurrentText && normalizeComposerTextForOwnership(currentText) !== job.expectedNormalized) {
        // Только текст, который НЕ принадлежит текущей операции, считаем пользовательским.
        if (job.source.startsWith('manual-')) {
          return failPending('Не отправлено: обычное поле ChatGPT уже содержит другой текст. Сообщение осталось в очереди.', job.jobId);
        }
        scheduleRetry(250);
        return false;
      }

      if (!currentText || (!ownsCurrentText && normalizeComposerTextForOwnership(currentText) !== job.expectedNormalized)) {
        if (!setComposerText(composer, job.text)) {
          scheduleRetry(140);
          return false;
        }
        job.insertedByScript = true;
        job.insertedAt = Date.now();
        job.insertedSnapshotNormalized = normalizeComposerTextForOwnership(readComposerText(composer));
        scheduleRetry(90);
        return false;
      }

      // Если редактор преобразовал два переноса в один и т.п., но это всё ещё наш текст,
      // не трактуем его как чужой и продолжаем к штатной кнопке Send.
      if (!job.insertedByScript && normalizeComposerTextForOwnership(currentText) === job.expectedNormalized) {
        job.insertedByScript = true;
        job.insertedAt = Date.now();
        job.insertedSnapshotNormalized = normalizeComposerTextForOwnership(currentText);
      }

      // Ищем Send заново уже ПОСЛЕ того, как ChatGPT получил input-событие.
      const sendButton = context?.sendButton || deps.findSendButton(form);
      if (!deps.isSendButtonReady(sendButton)) {
        scheduleRetry(100);
        return false;
      }

      console.info(`[ChatGPT notifier] Нажимаю штатный Send (${job.source}):`, job.text);
      job.phase = 'confirm';
      job.clickedAt = Date.now();
      job.clickedSnapshotNormalized = normalizeComposerTextForOwnership(currentText);
      job.clickedComposer = composer;
      job.clickedContainer = form;
      job.clickedButton = sendButton;
      sendButton.click();
      scheduleRetry(90);
      return true;
    }

    function handleResponseFinished() {
      if (pending || !items.length) return false;
      const first = items[0];
      return beginSend({
        itemIds: [first.id],
        text: first.text,
        allowWhileGenerating: false,
        source: 'auto-after-response',
        timeoutMs: 10000
      });
    }

    function sendNow(id) {
      const item = getItem(id);
      if (!item) return false;
      return beginSend({
        itemIds: [item.id],
        text: item.text,
        allowWhileGenerating: true,
        source: 'manual-item',
        timeoutMs: 3500
      });
    }

    function sendAllNow() {
      if (!items.length) return false;
      const snapshot = items.map(item => ({ ...item }));
      return beginSend({
        itemIds: snapshot.map(item => item.id),
        text: snapshot.map(item => item.text).join('\n\n'),
        allowWhileGenerating: true,
        source: 'manual-all',
        timeoutMs: 3500
      });
    }

    function resetForNavigation() {
      clear();
    }

    return {
      add,
      addFromComposer,
      move,
      moveRelative,
      remove,
      clear,
      attemptSend,
      handleResponseFinished,
      sendNow,
      sendAllNow,
      resetForNavigation,
      getItems,
      getCount: () => items.length,
      hasQueued: () => items.length > 0,
      isWaitingToSend: () => Boolean(pending),
      getPendingIds: () => pending ? [...pending.itemIds] : [],
      getLastStatus: () => lastStatus
    };
  }

  return {
    readComposerText,
    setComposerText,
    normalizeComposerTextForOwnership,
    shouldClearComposerTransfer,
    evaluateQueueSendConfirmation,
    createQueuedPromptController
  };
});
