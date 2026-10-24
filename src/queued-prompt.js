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
  const LARGE_NATIVE_INSERT_THRESHOLD = 12000;
  const NATIVE_INSERT_CHUNK = 4096;

  function nextInsertBoundary(text, offset) {
    let end = Math.min(text.length, offset + NATIVE_INSERT_CHUNK);
    // Never cut a Unicode surrogate pair at the chunk boundary.
    if (end < text.length && end > offset &&
        text.charCodeAt(end - 1) >= 0xD800 && text.charCodeAt(end - 1) <= 0xDBFF) end--;
    return end;
  }

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

  function appendComposerChunk(composer, chunk, first) {
    if (first) return setComposerText(composer, chunk);
    const native = (
      (typeof HTMLTextAreaElement !== 'undefined' && composer instanceof HTMLTextAreaElement) ||
      (typeof HTMLInputElement !== 'undefined' && composer instanceof HTMLInputElement)
    );
    if (native) return setNativeValue(composer, composer.value + chunk);
    if (!(composer?.isContentEditable || composer?.getAttribute?.('contenteditable') === 'true')) return false;
    // Apply a bounded edit to the native rich editor, yielding to the browser
    // between chunks. Never replace the entire growing contenteditable tree.
    try {
      composer.focus();
      const selection = window.getSelection?.();
      if (!selection || typeof document.createRange !== 'function' ||
          typeof document.execCommand !== 'function') return false;
      const range = document.createRange();
      range.selectNodeContents(composer);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
      if (!document.execCommand('insertText', false, chunk)) return false;
      dispatchComposerInput(composer, chunk);
      return true;
    } catch (_) { return false; }
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

  // File-mode rich-editor readback only: browsers may add or remove
  // EMPTY paragraph separators when execCommand('insertText') builds <p>
  // nodes. Do not use the queue ownership normalizer here: that would also
  // discard repeated spaces, tabs and invisible characters from instructions.
  // Non-empty lines and their order MUST remain byte-for-byte equal (except
  // CRLF vs LF and browser NBSP vs a plain space). This checks the entire
  // prepared file instruction/context, NOT the uploaded file's contents.
  function fileContextTextMatches(received, expected) {
    if (typeof received !== 'string' || typeof expected !== 'string' ||
        !received.trim() || !expected.trim()) return false;
    const meaningfulLines = text => text.replace(/\r\n?/g, '\n')
      .replace(/\u00a0/g, ' ')
      .split('\n')
      .filter(line => line !== '');
    const actual = meaningfulLines(received);
    const wanted = meaningfulLines(expected);
    return actual.length === wanted.length &&
      actual.every((line, index) => line === wanted[index]);
  }

  // File uses a deliberately narrow tolerance for rendered blank lines;
  // ordinary Insert and other queue actions remain exact.
  function insertOnlyTextMatches(composer, expected, { fileContext = false } = {}) {
    if (!composer) return false;
    const native = (typeof HTMLTextAreaElement !== 'undefined' &&
      composer instanceof HTMLTextAreaElement) ||
      (typeof HTMLInputElement !== 'undefined' &&
      composer instanceof HTMLInputElement);
    // Unlike readComposerText (used for tolerant queue ownership), no NBSP,
    // newline or Unicode substitution is allowed when claiming exact transfer.
    const received = native ? composer.value :
      (typeof composer.innerText === 'string' ? composer.innerText :
        composer.textContent);
    if (typeof received !== 'string') return false;
    if (received === expected) return true;
    return fileContext && !native && fileContextTextMatches(received, expected);
  }

  // Empty ProseMirror/contenteditable usually renders a structural <p><br>
  // placeholder: its innerText can be "\n" even though no text is entered.
  // This check is ONLY for the untouched initial state. It must never be
  // used for verifying an inserted prefix or the complete prompt.
  function isComposerVisiblyEmpty(composer) {
    if (!composer) return false;
    if (readComposerText(composer).trim()) return false;
    // A hidden text node would otherwise be masked by a structural newline
    // returned from innerText; do not overwrite an occupied rich composer.
    if (typeof composer.textContent === 'string' && composer.textContent.trim()) return false;
    return true;
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

  function createQueuedPromptController({ onChange = () => {}, onSendResult = () => {}, beforeSendClick = () => true } = {}) {
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
      return items.filter(item => !item.persistent).map(item => ({ ...item }));
    }

    function getItem(id) {
      return items.find(item => item.id === id) || null;
    }

    function add(text, options = {}) {
      const value = String(text || '').trim();
      if (!value) return null;
      const item = { id: makeId(), text: value, createdAt: Date.now(), persistent: options.persistent === true };
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
      const abandoned = pending;
      clearRetry();
      pending = null;
      if (abandoned?.source === 'manual-persisted') {
        try { onSendResult({ source: abandoned.source, itemIds: [...abandoned.itemIds],
          status: abandoned.clickedAt ? 'unconfirmed' : 'failed' }); } catch (_) {}
      }
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
      const failedJob = pending;
      clearRetry();
      pending = null;
      jobSerial += 1;
      if (failedJob) {
        try { onSendResult({ source: failedJob.source, itemIds: [...failedJob.itemIds],
          status: failedJob.clickedAt ? 'unconfirmed' : 'failed' }); } catch (_) {}
      }
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
      try { onSendResult({ source: job.source, itemIds: [...job.itemIds], status: 'sent' }); } catch (_) {}
      console.info(`[ChatGPT notifier] Отправка из очереди (${job.source}) подтверждена.`);
      return true;
    }

    function beginSend({ itemIds, text, allowWhileGenerating, source, timeoutMs,
      minComposerDwellMs = 0 }) {
      const ids = Array.from(itemIds || []).filter(id => getItem(id));
      if (insertingOnly || pending?.source === 'manual-persisted') return false;
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
        // Opt-in only: quick textbox leaves the text visible in the native
        // composer for ~1 second before clicking the real Send button.
        // Old queue, file auto-send and delayed actions continue unchanged.
        minComposerDwellMs: source === 'manual-persisted'
          ? Math.min(1500, Math.max(0, Number(minComposerDwellMs) || 0)) : 0,
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
        clickedButton: null,
        largeInsert: source === 'manual-persisted' && value.length >= LARGE_NATIVE_INSERT_THRESHOLD
          ? { cursor: 0, accumulated: '', composer: null } : null
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

      if (job.largeInsert && job.largeInsert.cursor < job.text.length) {
        const progress = job.largeInsert;
        if (progress.composer && progress.composer !== composer)
          return failPending('Редактор сменился при переносе большого промпта; отправка отменена.', job.jobId);
        if (progress.cursor === 0 && currentText &&
            normalizeComposerTextForOwnership(currentText) === job.expectedNormalized) {
          progress.cursor = job.text.length;
          progress.accumulated = job.text;
          progress.composer = composer;
        } else {
          if (normalizeComposerTextForOwnership(currentText) !==
              normalizeComposerTextForOwnership(progress.accumulated)) {
            return failPending('Редактор занят или изменён при переносе большого текста. Автоотправки не было.', job.jobId);
          }
          const until = nextInsertBoundary(job.text, progress.cursor);
          const chunk = job.text.slice(progress.cursor, until);
          if (!appendComposerChunk(composer, chunk, progress.cursor === 0)) {
            return failPending('Не удалось вставить часть большого текста в ChatGPT. Оригинал сохранён локально.', job.jobId);
          }
          progress.cursor = until;
          progress.accumulated += chunk;
          progress.composer = composer;
        }
        if (progress.cursor >= job.text.length) {
          const inserted = normalizeComposerTextForOwnership(readComposerText(composer));
          if (inserted !== job.expectedNormalized) {
            return failPending('Большой промпт вставлен не полностью; Send отменён.', job.jobId);
          }
          job.insertedByScript = true;
          job.insertedAt = Date.now();
          job.insertedSnapshotNormalized = inserted;
        }
        scheduleRetry(25);
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

      // Wait AFTER native insertion, not before it. During this interval,
      // React can finish processing input and the user can see/edit text.
      // Ownership is checked again on every retry; an edited composer is
      // never silently clicked by a delayed operation.
      if (job.minComposerDwellMs > 0) {
        const remaining = job.minComposerDwellMs - (now - job.insertedAt);
        if (remaining > 0) {
          scheduleRetry(Math.min(remaining, 160));
          return false;
        }
      }

      // Ищем Send заново уже ПОСЛЕ того, как ChatGPT получил input-событие.
      const sendButton = context?.sendButton || deps.findSendButton(form);
      if (!deps.isSendButtonReady(sendButton)) {
        scheduleRetry(100);
        return false;
      }

      try {
        if (beforeSendClick({ source: job.source, itemIds: [...job.itemIds] }) === false) {
          return failPending('Отправка отменена: не удалось сохранить статус перед Send.', job.jobId);
        }
      } catch (_) {
        return failPending('Отправка отменена: не удалось сохранить статус перед Send.', job.jobId);
      }
      console.info(`[ChatGPT notifier] Нажимаю штатный Send (${job.source}).`);
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
      const first = items.find(item => !item.persistent);
      if (!first) return false;
      return beginSend({
        itemIds: [first.id],
        text: first.text,
        allowWhileGenerating: false,
        source: 'auto-after-response',
        timeoutMs: 10000
      });
    }

    function sendNow(id, options = {}) {
      const item = getItem(id);
      if (!item || (options.source === 'manual-persisted' && pending) ||
          Boolean(item.persistent) !== (options.source === 'manual-persisted')) return false;
      return beginSend({
        itemIds: [item.id],
        text: item.text,
        allowWhileGenerating: options.allowWhileGenerating ?? true,
        source: options.source || 'manual-item',
        minComposerDwellMs: options.minComposerDwellMs || 0,
        timeoutMs: options.source === 'manual-persisted' &&
          String(item.text).length >= LARGE_NATIVE_INSERT_THRESHOLD ? 90000 :
          (options.source === 'manual-persisted' && options.minComposerDwellMs > 0
            ? 6500 : 3500)
      });
    }

    function sendAllNow() {
      const snapshot = getItems();
      if (!snapshot.length) return false;
      return beginSend({
        itemIds: snapshot.map(item => item.id),
        text: snapshot.map(item => item.text).join('\n\n'),
        allowWhileGenerating: true,
        source: 'manual-all',
        timeoutMs: 3500
      });
    }

    // Exact live native draft reader: no newline / whitespace normalization.
    function readNativeDraft() {
      const editor = currentComposerContext()?.composer;
      if (!editor || editor.isConnected === false || editor.disabled || editor.readOnly)
        return null;
      // ChatGPT's empty rich editor can render a structural newline:
      // 5.7.11 already treated this as blank for insert-only.
      if (isComposerVisiblyEmpty(editor)) return '';
      const native = (typeof HTMLTextAreaElement !== 'undefined' &&
        editor instanceof HTMLTextAreaElement) ||
        (typeof HTMLInputElement !== 'undefined' && editor instanceof HTMLInputElement);
      return native ? editor.value :
        (typeof editor.innerText === 'string' ? editor.innerText : editor.textContent);
    }

    // Only APPEND to a populated composer, never replace it. Used by the file
    // route to preserve an existing draft while adding the next task context.
    async function appendOnly(suffix, expectedPrefix, { fileContext = false } = {}) {
      const addition = String(suffix ?? '');
      if (!addition.trim()) return { ok: false, reason: 'Нет текста для добавления.' };
      if (insertingOnly || pending)
        return { ok: false, reason: 'Другая передача уже выполняется.' };
      const editor = currentComposerContext()?.composer;
      if (!editor || editor.isConnected === false || editor.disabled || editor.readOnly)
        return { ok: false, reason: 'Редактор ChatGPT недоступен.' };
      const nativeBefore = readNativeDraft();
      if (typeof expectedPrefix !== 'string' || nativeBefore !== expectedPrefix)
        return { ok: false, reason: 'Штатный черновик изменился; текст не заменён.' };
      if (!expectedPrefix) return insertOnly(addition, {fileContext});
      const initialUrl = typeof location === 'undefined' ? '' : location.href;
      insertingOnly = true;
      try {
        const expected = expectedPrefix + addition;
        if (pending || editor.isConnected === false ||
            currentComposerContext()?.composer !== editor ||
            (initialUrl && typeof location !== 'undefined' && location.href !== initialUrl))
          throw Error('Беседа или редактор изменились. Send не нажимался.');
        if (!appendComposerChunk(editor, addition, false))
          throw Error('Редактор не принял дополнение. Send не нажимался.');
        if (!insertOnlyTextMatches(editor, expected, {fileContext}))
          throw Error('После добавления черновик отличается посимвольно. Send не нажимался.');
        return { ok: true, reason: 'Текст добавлен к штатному черновику без Send.' };
      } catch (error) {
        return { ok: false, reason: error?.message || 'Не удалось добавить текст.' };
      } finally {
        insertingOnly = false;
      }
    }

    let insertingOnly = false;
    function canInsertOnly() {
      if (insertingOnly || pending) return false;
      const editor = currentComposerContext()?.composer;
      return Boolean(editor && editor.isConnected !== false &&
        !editor.disabled && !editor.readOnly && isComposerVisiblyEmpty(editor));
    }
    async function insertOnly(text, { fileContext = false } = {}) {
      const value = String(text ?? '');
      if (!value.trim()) return {ok: false, reason: 'Нет текста для вставки.'};
      if (insertingOnly || pending) return {ok: false, reason: 'Другая передача уже выполняется.'};
      const current = currentComposerContext();
      const editor = current?.composer;
      if (!editor || editor.isConnected === false || editor.disabled || editor.readOnly)
        return {ok: false, reason: 'Штатное поле ChatGPT недоступно.'};
      if (!isComposerVisiblyEmpty(editor))
        return {ok: false, reason: 'Штатное поле уже содержит текст. Ничего не заменено.'};
      const initialUrl = typeof location === 'undefined' ? '' : location.href;
      insertingOnly = true;
      let accumulated = '';
      try {
        for (let offset = 0; offset < value.length;) {
          if (pending || editor.isConnected === false ||
              currentComposerContext()?.composer !== editor ||
              (initialUrl && typeof location !== 'undefined' && location.href !== initialUrl))
            throw Error('Вкладка или редактор изменились. Вставка остановлена, Send не нажимался.');
          if (accumulated === '' ? !isComposerVisiblyEmpty(editor) :
              !insertOnlyTextMatches(editor, accumulated, {fileContext}))
            throw Error('Редактор изменил часть текста (пробелы, переносы или символы). Исходник сохранён; Send не нажимался.');
          const end = nextInsertBoundary(value, offset);
          if (!appendComposerChunk(editor, value.slice(offset, end), offset === 0))
            throw Error('Редактор ChatGPT не принял часть текста. Send не нажимался.');
          accumulated += value.slice(offset, end);
          offset = end;
          if (offset < value.length) await new Promise(resolve => setTimeout(resolve, 16));
        }
        if (!insertOnlyTextMatches(editor, value, {fileContext}))
          throw Error('Вставка не совпала с исходником посимвольно. Исходник сохранён; Send не нажимался.');
        return {ok: true, reason: 'Текст вставлен в ChatGPT без отправки. Проверяйте и редактируйте перед Send.'};
      } catch (error) {
        return {ok: false, reason: error?.message || 'Не удалось вставить текст.'};
      } finally {
        insertingOnly = false;
      }
    }

    function resetForNavigation() {
      clear();
    }

    return {
      add,
      addFromComposer,
      insertOnly,
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
      getCount: () => getItems().length,
      hasQueued: () => getItems().length > 0,
      isWaitingToSend: () => Boolean(pending),
      isInsertingOnly: () => insertingOnly,
      canInsertOnly, readNativeDraft, appendOnly,
      getPendingIds: () => pending ? [...pending.itemIds] : [],
      getLastStatus: () => lastStatus
    };
  }

  return {
    readComposerText,
    setComposerText,
    normalizeComposerTextForOwnership, fileContextTextMatches, nextInsertBoundary,
    LARGE_NATIVE_INSERT_THRESHOLD, NATIVE_INSERT_CHUNK,
    shouldClearComposerTransfer,
    evaluateQueueSendConfirmation,
    createQueuedPromptController
  };
});
