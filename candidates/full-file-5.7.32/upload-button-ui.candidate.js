(function (root, factory) {
  const deps = typeof require === 'function'
    ? Object.assign({}, require('./config.js'), require('./chatgpt-dom.js'), root.ChatGPTTabNotifier || {})
    : (root.ChatGPTTabNotifier || {});
  const api = factory(deps);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ChatGPTTabNotifier = Object.assign(root.ChatGPTTabNotifier || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  'use strict';

  // The original three actions retain their click handlers and 34px targets; settings is a fourth button.
  // The always-visible textbox to their right shares one draggable host.
  const UI_WIDTH = 422;
  const UI_HEIGHT = 88;
  const VIEWPORT_MARGIN = 6;
  const DRAG_THRESHOLD_PX = 8;
  const LARGE_PASTE_THRESHOLD = 12000;
  // Bound the entire exact-original pipeline to 512 KiB. Notifier must
  // preserve the real raw original instead of sending data that cannot be archived.
  const MAX_QUICK_SEND_BYTES = 512 * 1024;
  const MAX_FILE_PROMPT_BYTES = 4 * 1024 * 1024;

  // Per-chat, consecutive SHA-256 of the *original text*, never the filename
  // or mutable ChatGPT DOM. A reservation is kept even after an uncertain
  // upload attempt: a second click cannot accidentally duplicate that file.
  // Only a DIFFERENT text hash advances the last-seen value for this chat.
  function createConsecutiveFileHashGuard({ getValue, setValue,
    cryptoSource = globalThis.crypto } = {}) {
    const PREFIX = 'fortis-file-last-sha256-v1-';
    const CHAT = /^[A-Za-z0-9-]{8,100}$/;
    const SHA = /^[0-9a-f]{64}$/;
    function read(key) {
      const raw = getValue(key, null);
      if (raw == null) return null;
      let record = raw;
      if (typeof raw === 'string') {
        try { record = JSON.parse(raw); } catch (_) { throw Error('BAD_HASH_STATE'); }
      }
      if (!record || record.version !== 1 || !SHA.test(record.sha256))
        throw Error('BAD_HASH_STATE');
      return record.sha256;
    }
    async function reserve(chatId, original) {
      if (!CHAT.test(chatId || '') ||
          typeof original !== 'string' || !original.trim() ||
          typeof getValue !== 'function' || typeof setValue !== 'function' ||
          typeof cryptoSource?.subtle?.digest !== 'function')
        return { ok: false, reason: 'Защита SHA-256 недоступна; файл не прикреплён.' };
      try {
        const bytes = new TextEncoder().encode(original);
        const result = await cryptoSource.subtle.digest('SHA-256', bytes);
        const digest = Array.from(new Uint8Array(result), item =>
          item.toString(16).padStart(2, '0')).join('');
        const key = PREFIX + chatId;
        if (read(key) === digest) {
          return { ok: false, duplicate: true,
            reason: 'Этот же исходник уже прикреплялся/проверялся подряд (SHA-256 совпал). ' +
              'Повтор не выполняю, независимо от текста или вложений в ChatGPT.' };
        }
        const record = { version: 1, sha256: digest };
        setValue(key, JSON.stringify(record));
        if (read(key) !== digest)
          return { ok: false, reason: 'SHA-256 не сохранился; повтор запрещён.' };
        return { ok: true, sha256: digest };
      } catch (_) {
        return { ok: false, reason: 'Не удалось проверить или сохранить SHA-256. Файл не прикреплён.' };
      }
    }
    return { reserve };
  }

  // Deliberately independent from Observatory's text-original writer. This
  // preserves the exact prompt as a text attachment when ChatGPT's rich editor
  // cannot safely accept a large direct insertion.
  function createPromptTextFile(originalText, name, FileClass = globalThis.File) {
    const text = String(originalText ?? '');
    if (!text.trim()) throw new Error('Введите текст промпта.');
    if (typeof FileClass !== 'function' || typeof TextEncoder !== 'function')
      throw new Error('Создание файлов недоступно в браузере.');
    const bytes = new TextEncoder().encode(text).length;
    if (bytes > MAX_FILE_PROMPT_BYTES)
      throw new Error('Файл больше 4 МиБ; автоматическое создание отменено.');
    const filename = typeof name === 'string' && /^fortis-prompt-[0-9a-z-]+\.txt$/.test(name)
      ? name : 'fortis-prompt.txt';
    const file = new FileClass([text], filename, { type: 'text/plain;charset=utf-8' });
    if (file.size !== bytes) throw new Error('Не удалось проверить размер файла.');
    return file;
  }

  function isEligiblePromptFileInput(input) {
    if (!input || input.disabled || input.type !== 'file' || input.isConnected === false)
      return false;
    // Refuse photo-only pickers rather than injecting a .txt into the wrong tool.
    const accept = String(input.accept || '').toLowerCase();
    return !accept || accept.split(',').some(piece =>
      !piece.trim() || piece.trim() === '.txt' || piece.trim() === 'text/plain' ||
      piece.trim() === 'text/*' || piece.trim() === '*/*');
  }

  function attachPromptTextFile(input, file, {
    DataTransferClass = globalThis.DataTransfer,
    EventClass = globalThis.Event
  } = {}) {
    if (!isEligiblePromptFileInput(input) ||
        typeof DataTransferClass !== 'function' ||
        typeof EventClass !== 'function') return false;
    try {
      const transfer = new DataTransferClass();
      transfer.items.add(file);
      // Native pickers normally REPLACE the previous selection on each
      // change. Do not re-add old input.files: that would re-upload old files.
      // Existing accepted attachment cards are owned by ChatGPT, not here.
      input.files = transfer.files;
      if (!Array.from(input.files || []).some(item =>
        item?.name === file.name && item?.size === file.size)) return false;
      input.dispatchEvent(new EventClass('change', { bubbles: true }));
      // An accepted file *selection* is not proof of completed upload.
      return true;
    } catch (_) { return false; }
  }

  // Distinguish NO COMPATIBLE INPUT from UNKNOWN RESULT AFTER ONE ATTEMPT.
  // A React event handler can throw after consuming the change event. Never
  // try another input or a drop in that case.
  function tryPromptFileInputOnce(file, inputs, attach = attachPromptTextFile) {
    const chosen = Array.from(inputs || []).find(isEligiblePromptFileInput);
    if (!chosen) return false;
    try { attach(chosen, file); } catch (_) { /* outcome unknown; do not retry */ }
    return true;
  }

  function dropPromptTextFile(target, file, {
    DataTransferClass = globalThis.DataTransfer,
    DragEventClass = globalThis.DragEvent,
    EventClass = globalThis.Event
  } = {}) {
    if (!target || target.isConnected === false ||
        typeof DataTransferClass !== 'function' || typeof EventClass !== 'function') return false;
    try {
      const transfer = new DataTransferClass();
      transfer.items.add(file);
      for (const name of ['dragenter', 'dragover', 'drop']) {
        let event;
        if (typeof DragEventClass === 'function') {
          event = new DragEventClass(name, {
            bubbles: true, cancelable: true, dataTransfer: transfer
          });
        } else {
          event = new EventClass(name, { bubbles: true, cancelable: true });
          Object.defineProperty(event, 'dataTransfer', { value: transfer });
        }
        target.dispatchEvent(event);
      }
      // The synthetic event is only an attempt. Wait for a real attachment UI.
      return true;
    } catch (_) { return false; }
  }

  // One UI click = at most ONE file upload trigger (change OR drop).
  // Once a native input accepted our file, lack of an attachment card is an
  // UNKNOWN outcome, never authorization to try drag/drop as a retry.
  async function attemptPromptFileOnce({
    tryDirectInput, findPlus, afterPlus, tryMenuInput,
    tryDrop, waitForCard
  } = {}) {
    let path = null;
    if (tryDirectInput?.()) {
      path = 'input';
    } else {
      const plus = findPlus?.();
      if (plus) {
        // Opening + is not evidence of successful attachment. It may
        // trigger an OS picker; do not fall through to a synthetic drop.
        plus.click();
        if (afterPlus) await afterPlus();
        if (!tryMenuInput?.())
          return { attempted: false, confirmed: false, reason: 'menu-no-input' };
        path = 'menu-input';
      } else if (tryDrop?.()) {
        path = 'drop';
      }
    }
    if (!path) return { attempted: false, confirmed: false, reason: 'no-path' };
    // The platform may already own the file even if DOM inspection throws.
    // An exception during confirmation is NOT permission to upload again.
    let confirmed=false;
    try {confirmed=Boolean(await waitForCard?.())} catch (_) {confirmed=false}
    return { attempted: true, confirmed, path };
  }

  // Only fixed, user-visible Notifier messages may cross into owner-local
  // event history. NEVER forward arbitrary error.message, source text,
  // filenames, browser DOM, secrets or a whole composer draft.
  const KNOWN_FILE_INSERT_FAILURES = Object.freeze([
    'Нет текста для добавления.',
    'Другая передача уже выполняется.',
    'Редактор ChatGPT недоступен.',
    'Штатный черновик изменился; текст не заменён.',
    'Беседа или редактор изменились. Send не нажимался.',
    'Редактор не принял дополнение. Send не нажимался.',
    'После добавления черновик отличается посимвольно. Send не нажимался.',
    'Не удалось добавить текст.',
    'Нет текста для вставки.',
    'Штатное поле ChatGPT недоступно.',
    'Штатное поле уже содержит текст. Ничего не заменено.',
    'Вкладка или редактор изменились. Вставка остановлена, Send не нажимался.',
    'Редактор изменил часть текста (пробелы, переносы или символы). Исходник сохранён; Send не нажимался.',
    'Редактор ChatGPT не принял часть текста. Send не нажимался.',
    'Вставка не совпала с исходником посимвольно. Исходник сохранён; Send не нажимался.',
    'Не удалось вставить текст.'
  ]);
  const STATIC_FILE_DETAILS = Object.freeze([
    'Файл прикреплён, модули и Fortis task context добавлены без замены существующего текста. SHA-256 записан, Send НЕ нажат.',
    'Файл прикреплён, но нативный редактор недоступен. Исходник сохранён, Send не нажат.',
    'Не удалось сохранить task_id. Файл прикреплён, Send не нажат.',
    'Модули/контекст слишком длинны для безопасного добавления. Файл прикреплён, но текст не вставлен. Send не нажат.',
    'Карточка файла обнаружена, но Fortis-контекст не подтверждён. Не отправляй сообщение и не прикрепляй файл повторно.',
    'Этот же исходник уже прикреплялся/проверялся подряд (SHA-256 совпал). Повтор не выполняю, независимо от текста или вложений в ChatGPT.'
  ]);
  const FILE_FAILURE_PREFIX = 'Файл прикреплён, но контекст не добавлен: ';
  const FILE_FAILURE_SUFFIX = ' Не отправляй до ручной проверки.';
  function safeNotifierFileDetail(message) {
    if (typeof message !== 'string' || message.length > 512) return null;
    if (STATIC_FILE_DETAILS.includes(message)) return message;
    if (KNOWN_FILE_INSERT_FAILURES.some(reason =>
      message === FILE_FAILURE_PREFIX + reason + FILE_FAILURE_SUFFIX)) return message;
    const attempted = /^Одна попытка прикрепления \((?:input|menu-input|drop)\) выполнена, но ChatGPT не подтвердил карточку\. Возможно, файл уже добавлен\. Второй попытки НЕ делаю; проверь вложения вручную\. Send не нажат\.$/;
    return attempted.test(message) ? message : null;
  }

  function fileAttachmentVisible(container, name) {
    if (!container || !name) return false;
    // Never treat the composer itself, typed prompt text, file input, or a
    // generic live status as proof of an attachment. Only a dedicated file
    // preview/card may confirm the platform accepted the selection.
    let targets = [];
    try {
      targets = Array.from(container.querySelectorAll(
        '[data-testid], [aria-label], [title]'
      ));
    } catch (_) { return false; }
    return targets.some(node => {
      if (!node || node === container ||
          node.matches?.('input[type="file"], textarea, [role="textbox"]') ||
          node.closest?.('[contenteditable="true"], textarea, [role="textbox"]') ||
          node.querySelector?.('[contenteditable="true"], textarea, [role="textbox"]'))
        return false;
      const testId = String(node.getAttribute?.('data-testid') || '');
      const accessible = String(node.getAttribute?.('aria-label') || '');
      const title = String(node.getAttribute?.('title') || '');
      // Actual ChatGPT attachment button (verified from the owner's DOM):
      // <button class="composer-attachment-surface ..." type="button"
      //         aria-label="fortis-prompt-....txt"></button>
      // The aria-label is JUST the filename, not "Attachment: filename".
      // Require this exact button selector, never a generic labelled button.
      const isComposerSurface = node.matches?.(
        'button.composer-attachment-surface[type="button"][aria-label]') === true;
      // These markers identify attachment UI, not arbitrary filenames
      // mentioned in a prompt or in surrounding container text.
      const identified = isComposerSurface ||
        /(?:attachment|file[-_](?:card|chip|upload|preview)|upload[-_](?:card|chip|preview|item))/i.test(testId) ||
        /^(?:attachment|attached file|file attachment)\b/i.test(accessible);
      if (!identified) return false;
      const state = [
        node.getAttribute?.('data-state'), node.getAttribute?.('aria-busy'),
        accessible
      ].filter(Boolean).join(' ');
      if (/(?:loading|uploading|pending|failed|error|retry|processing|progress|\btrue\b)/i.test(state))
        return false;
      // Exact match is important: names that share a prefix may refer to
      // different files already attached to the same native composer.
      if (isComposerSurface) return accessible === name;
      const content = String(node.textContent || '').slice(0, 2000);
      if ([content, accessible, title].some(value => value.includes(name)))return true;
      // ChatGPT sometimes puts the exact filename in a child's title or
      // accessibility label rather than the preview card's textContent.
      // Still require the enclosing element to be an identified file card.
      let children=[];
      try {children=Array.from(node.querySelectorAll?.('[title], [aria-label]')||[])}
      catch (_) {return false}
      return children.some(child=>!child.matches?.('input[type="file"], textarea, [role="textbox"]')&&
        !child.closest?.('[contenteditable="true"], textarea, [role="textbox"]')&&
        [child.getAttribute?.('title'),child.getAttribute?.('aria-label')].some(
          text=>typeof text==='string'&&text.includes(name)));

    });
  }

  function createLargePasteDraft(threshold = LARGE_PASTE_THRESHOLD) {
    let fullText = null;

    function capture(pastedText, existingText = '', selectionStart = 0, selectionEnd = 0) {
      if (fullText !== null || typeof pastedText !== 'string') return false;
      const before = String(existingText);
      const start = Number.isInteger(selectionStart)
        ? Math.min(Math.max(selectionStart, 0), before.length) : before.length;
      const end = Number.isInteger(selectionEnd)
        ? Math.min(Math.max(selectionEnd, start), before.length) : start;
      const next = before.slice(0, start) + pastedText + before.slice(end);
      if (next.length < threshold) return false;
      fullText = next;
      return true;
    }

    function preview() {
      if (fullText === null) return '';
      const excerpt = fullText.slice(0, 360);
      return 'Большой промпт (' + fullText.length.toLocaleString('ru-RU') +
        ' символов) хранится в памяти вкладки. Полный текст не показан, при отправке он берётся целиком (лимит оригинала 512 КиБ). ' +
        'Нажмите ↗, чтобы открыть и отредактировать весь текст, или ⧉, чтобы его скопировать.\n\nНачало:\n' +
        excerpt + (fullText.length > excerpt.length ? '…' : '');
    }

    return {
      capture, preview,
      active: () => fullText !== null,
      text: visible => fullText === null ? String(visible || '') : fullText,
      clear() { fullText = null; }
    };
  }

  function floatingWidth(viewportWidth) {
    return Math.min(UI_WIDTH, Math.max(1, viewportWidth - 2 * VIEWPORT_MARGIN));
  }

  function shouldSendQuickTextboxKey(event) {
    // Shift+Enter or Alt+Enter inserts a newline. Never submit during IME
    // composition (Cyrillic, Japanese, etc.) or from a repeated keydown.
    return event?.key === 'Enter' && !event.shiftKey && !event.altKey &&
      !event.isComposing && event.keyCode !== 229 && !event.repeat;
  }

  function canStartFloatingDrag(target) {
    // Only the old three buttons or the new dedicated drag grip.
    // A textarea and Send button must keep their normal text/click gestures.
    return target?.closest?.('.control, .quick-grip') != null;
  }

  function clampFloatingPosition(position, viewportWidth, viewportHeight) {
    const maxLeft = Math.max(VIEWPORT_MARGIN, viewportWidth - floatingWidth(viewportWidth) - VIEWPORT_MARGIN);
    const maxTop = Math.max(VIEWPORT_MARGIN, viewportHeight - UI_HEIGHT - VIEWPORT_MARGIN);
    return {
      left: Math.min(Math.max(VIEWPORT_MARGIN, Number(position?.left) || VIEWPORT_MARGIN), maxLeft),
      top: Math.min(Math.max(VIEWPORT_MARGIN, Number(position?.top) || VIEWPORT_MARGIN), maxTop)
    };
  }

  function pagePersistedHistory(records, visibleCount = 20) {
    const all = Array.isArray(records) ? records : [];
    const count = Number.isInteger(visibleCount) ? Math.max(0, visibleCount) : 20;
    const items = all.slice(0, count);
    return {
      items, total: all.length, visible: items.length,
      localPending: all.filter(item => item?.archive_status !== 'archived').length,
      remaining: all.length - items.length
    };
  }

  function createUploadButtonUi({ tabState, uploadController, queuedPromptController,
    delayedSendController, persistentMessageController, taskActivityMonitor,
    textboxProfileManager }) {
    let repositionTimer = null;
    let suppressClickUntil = 0;
    let dragState = null;
    let draggedItemId = null;
    let persistedVisibleCount = 20;
    let persistedVisibleChat = null;
    const largePaste = createLargePasteDraft();
    const fileHashGuard = createConsecutiveFileHashGuard({
      getValue: typeof GM_getValue === 'function' ? GM_getValue : null,
      setValue: typeof GM_setValue === 'function' ? GM_setValue : null
    });

    let resetLargePasteView = () => { largePaste.clear(); };
    let cancelFileTransfer = () => {};
    // The public owner dispatch function must have a stable identity: the
    // controller is returned before ensureUi() creates the DOM event handlers.
    // Do not export an uninitialised inner handler (startup ReferenceError),
    // or snapshot a noop before ensureUi() (silent owner dispatch failures).
    let handleQuickDispatch = null;
    async function dispatchQuickAction(mode,text,moduleIds=null,profileId=null) {
      if(!['file','insert','send','send_prepared'].includes(mode)||
         typeof text!=='string'||(mode!=='send_prepared'&&!text.trim())||
         (moduleIds!==null&&(!Array.isArray(moduleIds)||
            moduleIds.some(id=>typeof id!=='string'))))return {ok:false};
      ensureUi();
      if (typeof handleQuickDispatch !== 'function')return {ok:false};
      return handleQuickDispatch(mode,text,moduleIds,profileId);
    }

    function viewportSize() {
      return {
        width: Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1),
        height: Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1)
      };
    }

    function loadPosition() {
      try {
        const parsed = JSON.parse(localStorage.getItem(deps.FLOATING_UI_POSITION_KEY) || 'null');
        if (Number.isFinite(parsed?.left) && Number.isFinite(parsed?.top)) return parsed;
      } catch (_) {}
      return null;
    }

    function savePosition(position) {
      try { localStorage.setItem(deps.FLOATING_UI_POSITION_KEY, JSON.stringify(position)); }
      catch (_) {}
    }

    function setHostPosition(host, position, { persist = false } = {}) {
      const viewport = viewportSize();
      const next = clampFloatingPosition(position, viewport.width, viewport.height);
      host.style.width = floatingWidth(viewport.width) + 'px';
      host.style.left = `${Math.round(next.left)}px`;
      host.style.top = `${Math.round(next.top)}px`;
      if (persist) savePosition(next);
      return next;
    }

    function chooseInitialPosition() {
      const composer = deps.findComposer();
      const box = composer ? deps.findComposerBox(composer) : null;
      const viewport = viewportSize();
      if (box) {
        return clampFloatingPosition({ left: box.left + 10, top: box.bottom - UI_HEIGHT - 10 }, viewport.width, viewport.height);
      }
      return clampFloatingPosition({ left: 16, top: viewport.height - UI_HEIGHT - 72 }, viewport.width, viewport.height);
    }

    function clickWasDrag(event) {
      if (Date.now() >= suppressClickUntil) return false;
      event.preventDefault();
      event.stopPropagation();
      return true;
    }

    function positionPanel(host, panel) {
      if (!panel || panel.hidden) return;
      const viewport = viewportSize();
      const hostRect = host.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const panelWidth = Math.min(panelRect.width || 430, Math.max(240, viewport.width - 24));
      const panelHeight = panelRect.height || 330;

      let left = 0;
      if (hostRect.left + panelWidth > viewport.width - 12) {
        left = viewport.width - 12 - hostRect.left - panelWidth;
      }
      left = Math.max(12 - hostRect.left, left);
      panel.style.left = `${Math.round(left)}px`;

      if (hostRect.top >= panelHeight + 12) {
        panel.style.top = 'auto';
        panel.style.bottom = (UI_HEIGHT + 10) + 'px';
      } else {
        panel.style.bottom = 'auto';
        panel.style.top = (UI_HEIGHT + 10) + 'px';
      }
    }

    function renderQueueList(ui) {
      if (ui.panel.hidden) return;
      const controller = queuedPromptController;
      if (!controller) return;

      const items = controller.getItems();
      const pendingIds = new Set(controller.getPendingIds());
      const sending = controller.isWaitingToSend();
      ui.list.replaceChildren();

      items.forEach((item, index) => {
        const row = document.createElement('div');
        row.className = 'queue-item';
        row.dataset.pending = String(pendingIds.has(item.id));

        const drag = document.createElement('span');
        drag.className = 'drag-handle';
        drag.textContent = '☰';
        drag.title = 'Перетащить сообщение';
        drag.draggable = !sending;

        const number = document.createElement('span');
        number.className = 'number';
        number.textContent = String(index + 1);

        const text = document.createElement('span');
        text.className = 'queue-text';
        text.textContent = item.text;
        text.title = item.text;

        const up = document.createElement('button');
        up.type = 'button';
        up.className = 'item-action';
        up.textContent = '↑';
        up.title = 'Переместить выше';
        up.disabled = sending || index === 0;
        up.addEventListener('click', () => queuedPromptController.move(item.id, -1));

        const down = document.createElement('button');
        down.type = 'button';
        down.className = 'item-action';
        down.textContent = '↓';
        down.title = 'Переместить ниже';
        down.disabled = sending || index === items.length - 1;
        down.addEventListener('click', () => queuedPromptController.move(item.id, 1));

        const send = document.createElement('button');
        send.type = 'button';
        send.className = 'item-action send-one';
        send.textContent = pendingIds.has(item.id) ? '…' : '▶';
        send.title = 'Отправить это сообщение сейчас через обычное поле ChatGPT';
        send.disabled = sending;
        send.addEventListener('click', () => queuedPromptController.sendNow(item.id));

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'item-action remove';
        remove.textContent = '×';
        remove.title = 'Удалить из очереди';
        remove.disabled = pendingIds.has(item.id);
        remove.addEventListener('click', () => queuedPromptController.remove(item.id));

        drag.addEventListener('dragstart', event => {
          if (sending) { event.preventDefault(); return; }
          draggedItemId = item.id;
          row.dataset.dragging = 'true';
          try { event.dataTransfer.effectAllowed = 'move'; } catch (_) {}
        });
        drag.addEventListener('dragend', () => {
          draggedItemId = null;
          row.dataset.dragging = 'false';
          for (const element of ui.list.querySelectorAll('.queue-item')) delete element.dataset.drop;
        });
        row.addEventListener('dragover', event => {
          if (!draggedItemId || draggedItemId === item.id || sending) return;
          event.preventDefault();
          const rect = row.getBoundingClientRect();
          row.dataset.drop = event.clientY >= rect.top + rect.height / 2 ? 'after' : 'before';
          try { event.dataTransfer.dropEffect = 'move'; } catch (_) {}
        });
        row.addEventListener('dragleave', event => {
          if (!row.contains(event.relatedTarget)) delete row.dataset.drop;
        });
        row.addEventListener('drop', event => {
          if (!draggedItemId || draggedItemId === item.id || sending) return;
          event.preventDefault();
          const placeAfter = row.dataset.drop === 'after';
          queuedPromptController.moveRelative(draggedItemId, item.id, placeAfter);
          draggedItemId = null;
        });

        row.append(drag, number, text, up, down, send, remove);
        ui.list.appendChild(row);
      });

      ui.empty.style.display = items.length ? 'none' : 'block';
      ui.sendAll.style.display = items.length ? 'block' : 'none';
      ui.sendAll.disabled = sending;
      ui.add.disabled = sending;
      ui.fromChat.disabled = sending;
      ui.sendAll.textContent = items.length > 1
        ? `Отправить всё одним сообщением (${items.length})`
        : 'Отправить всё одним сообщением';

      const status = controller.getLastStatus();
      ui.status.textContent = status;
      ui.status.style.display = status ? 'block' : 'none';

      const count = controller.getCount();
      ui.badge.textContent = String(count);
      ui.badge.style.display = count ? 'flex' : 'none';
      ui.queueButton.dataset.active = String(count > 0);
      ui.queueButton.dataset.sending = String(sending);
      ui.queueButton.title = sending
        ? `ChatGPT notifier v${deps.SCRIPT_VERSION} · Очередь: ${count}. Сейчас выполняется отправка.`
        : count
          ? `ChatGPT notifier v${deps.SCRIPT_VERSION} · Очередь сообщений: ${count}`
          : `ChatGPT notifier v${deps.SCRIPT_VERSION} · Открыть очередь сообщений`;
    }

    function renderDelayedList(ui) {
      if (ui.panel.hidden) return;
      const items = delayedSendController?.getScheduledItems?.() || [];
      ui.delayedList.replaceChildren();

      items.forEach((item, index) => {
        const row = document.createElement('div');
        row.className = 'delayed-item';
        row.dataset.state = item.state || 'waiting';

        const number = document.createElement('span');
        number.className = 'number';
        number.textContent = String(index + 1);

        const text = document.createElement('span');
        text.className = 'queue-text';
        text.textContent = item.text;
        text.title = item.text;

        const time = document.createElement('span');
        time.className = 'delayed-time';
        time.textContent = item.state === 'uncertain' ? '?' : item.remainingLabel;
        time.title = item.state === 'uncertain'
          ? 'Отправка была начата, но результат не удалось надёжно подтвердить. Автоповтора нет.'
          : `Осталось: ${item.remainingLabel}`;

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'item-action remove';
        remove.textContent = '×';
        remove.title = 'Удалить из отложенных';
        remove.addEventListener('click', () => delayedSendController?.removeScheduled?.(item.id));

        row.append(number, text, time, remove);
        ui.delayedList.appendChild(row);
      });

      ui.delayedSection.style.display = items.length ? 'block' : 'none';
    }

    function renderPersistedList(ui) {
      // This list can synchronously read many full originals from GM storage.
      // Never do that on every ordinary UI refresh while the plus panel is closed.
      if (ui.panel.hidden || !ui.persistedList || !ui.persistedStatus) return;
      const controller = persistentMessageController;
      const activeChat = deps.currentChatId?.() || '';
      if (activeChat !== persistedVisibleChat) {
        persistedVisibleChat = activeChat;
        persistedVisibleCount = 20;
      }
      const storageHealthy = controller?.getStorageHealth?.() !== false;
      const allRecords = storageHealthy ? controller?.listForChat?.() || [] : [];
      const page = pagePersistedHistory(allRecords, persistedVisibleCount);
      const records = page.items;
      ui.persistedStatus.textContent = !storageHealthy
        ? 'Ошибка чтения локальной истории — записи не считаются удалёнными.'
        : (controller?.getLastStatus?.() || '');
      if (ui.persistedSummary) {
        ui.persistedSummary.textContent = storageHealthy
          ? 'В этом чате: ' + page.total + ' · ещё не архивировано: ' + page.localPending +
            ' · показано: ' + page.visible : 'Локальная история временно недоступна';
      }
      if (ui.persistedMore) {
        ui.persistedMore.hidden = !storageHealthy || page.remaining === 0;
      }
      ui.persistedList.replaceChildren();
      for (const record of records) {
        const row = document.createElement('div');
        row.className = 'persisted-row';
        const label = document.createElement('span');
        const status = {
          prepared: 'Подготовлено', send_queued: 'Отправка не подтверждена (проверьте чат)',
          send_failed: 'Не отправлено', send_unconfirmed: 'Отправка не подтверждена',
          sent: record.archive_status === 'archived' ? 'Архивировано Observatory'
            : record.activity_status === 'accepted'
              ? 'Сигнал принят; ожидает архивирования'
              : (deps.describeWaitingActivity?.({ record,
                  pairing: controller?.getPairingInfo?.(),
                  connection: taskActivityMonitor?.getTaskStatus?.(record.task_id) || 'checking'
                }) || 'Ожидает активности')
        }[record.send_status] || record.send_status;
        label.textContent = status + ' · ' + record.task_id + ' · '
          + record.original_text.slice(0, 85);
        row.appendChild(label);
        if (['prepared', 'send_failed'].includes(record.send_status)) {
          const retry = document.createElement('button');
          retry.type = 'button';
          retry.textContent = 'Повторить отправку';
          retry.addEventListener('click', () => {
            controller.sendExisting(record.task_id);
            schedule();
          });
          row.appendChild(retry);
        }
        ui.persistedList.appendChild(row);
      }
    }

    function ensureUi() {
      let host = document.getElementById(deps.UPLOAD_HOST_ID);
      // Rebuild the host if an older userscript left behind buttons without
      // the new textbox (e.g. an in-page update).
      if (host?.shadowRoot?.querySelector('[data-role="delay-send"]') &&
          host.shadowRoot.querySelector('.quick-input') &&
          host.shadowRoot.querySelector('.quick-clear') &&
          host.shadowRoot.querySelector('.quick-copy') &&
          host.shadowRoot.querySelector('.quick-expand') &&
          host.shadowRoot.querySelector('.quick-file') &&
          host.shadowRoot.querySelector('.quick-insert') &&
          host.shadowRoot.querySelector('.settings-button')) {
        return {
          host,
          row: host.shadowRoot.querySelector('.row'),
          quickInput: host.shadowRoot.querySelector('.quick-input'),
          quickSend: host.shadowRoot.querySelector('.quick-send'),
          quickClear: host.shadowRoot.querySelector('.quick-clear'),
          quickCopy: host.shadowRoot.querySelector('.quick-copy'),
          quickExpand: host.shadowRoot.querySelector('.quick-expand'),
          quickFile: host.shadowRoot.querySelector('.quick-file'),
          quickInsert: host.shadowRoot.querySelector('.quick-insert'),
          quickFeedback: host.shadowRoot.querySelector('.quick-feedback'),
          settingsUi: host.__fortisTextboxSettings || null,
          delayButton: host.shadowRoot.querySelector('[data-role="delay-send"]'),
          queueButton: host.shadowRoot.querySelector('[data-role="queue"]'),
          autoButton: host.shadowRoot.querySelector('[data-role="auto-send"]'),
          timerChip: host.shadowRoot.querySelector('.timer-chip'),
          badge: host.shadowRoot.querySelector('.badge'),
          panel: host.shadowRoot.querySelector('.panel'),
          list: host.shadowRoot.querySelector('.queue-list'),
          empty: host.shadowRoot.querySelector('.empty'),
          status: host.shadowRoot.querySelector('.status'),
          timerStatus: host.shadowRoot.querySelector('.timer-status'),
          delaySelect: host.shadowRoot.querySelector('.delay-select'),
          delayMinutes: host.shadowRoot.querySelector('.delay-minutes'),
          checkpointInput: host.shadowRoot.querySelector('.checkpoint-input'),
          delayedSection: host.shadowRoot.querySelector('.delayed-section'),
          delayedList: host.shadowRoot.querySelector('.delayed-list'),
          sendAll: host.shadowRoot.querySelector('.send-all'),
          textarea: host.shadowRoot.querySelector('.queue-input'),
          add: host.shadowRoot.querySelector('.add'),
          scheduleLater: host.shadowRoot.querySelector('.schedule-later'),
          fromChat: host.shadowRoot.querySelector('.from-chat'),
          persistSend: host.shadowRoot.querySelector('.persist-send'),
          persistedList: host.shadowRoot.querySelector('.persisted-list'),
          persistedStatus: host.shadowRoot.querySelector('.persisted-status'),
          persistedSummary: host.shadowRoot.querySelector('.persisted-summary'),
          persistedMore: host.shadowRoot.querySelector('.persisted-more'),
          versionChip: host.shadowRoot.querySelector('.version-chip'),
          panelVersion: host.shadowRoot.querySelector('.panel-version')
        };
      }

      host?.remove();
      host = document.createElement('div');
      host.id = deps.UPLOAD_HOST_ID;
      Object.assign(host.style, {
        position: 'fixed', left: '16px', top: '16px', width: `${UI_WIDTH}px`, height: `${UI_HEIGHT}px`,
        zIndex: '2147483646', pointerEvents: 'auto', display: 'block', overflow: 'visible'
      });
      document.documentElement.appendChild(host);

      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = `
        <style>
          :host { all: initial; }
          * { box-sizing: border-box; }
          .row {
            display:flex; gap:6px; align-items:center; width:100%; height:100%;
            pointer-events:auto; touch-action:auto; user-select:none; cursor:grab; position:relative;
          }
          .row[data-dragging="true"] { cursor:grabbing; }
          .control {
            flex:0 0 34px; width:34px; height:34px; padding:0; border-radius:999px;
            border:1px solid rgba(128,128,128,.24); background:rgba(32,32,32,.88);
            color:#fff; font:16px/1 system-ui,sans-serif; display:inline-flex;
            align-items:center; justify-content:center; cursor:inherit;
            pointer-events:auto; box-shadow:0 2px 10px rgba(0,0,0,.24);
            -webkit-user-select:none; user-select:none;
          }
          .quick-compose {
            flex:1 1 0; min-width:0; height:68px; padding:5px 6px 5px 3px;
            display:flex; align-items:stretch; gap:4px;
            border:1px solid rgba(128,128,128,.36); border-radius:12px;
            background:rgba(30,30,30,.96); cursor:default;
            box-shadow:0 3px 14px rgba(0,0,0,.30);
          }
          .control, .quick-grip { touch-action:none; }
          .quick-grip {
            width:14px; flex:0 0 14px; align-self:stretch; display:flex;
            align-items:center; justify-content:center; cursor:grab;
            color:rgba(255,255,255,.54); font:600 13px/1 system-ui,sans-serif;
            border-radius:6px;
          }
          .quick-grip:hover { background:rgba(255,255,255,.08); color:#fff; }
          .row[data-dragging="true"] .quick-grip { cursor:grabbing; }
          .quick-input {
            flex:1 1 0; min-width:0; width:100%; height:100%; padding:4px 2px;
            color:#fff; background:transparent; border:0; outline:none;
            font:13px/1.35 system-ui,sans-serif; resize:none; cursor:text;
            touch-action:auto; user-select:text; -webkit-user-select:text;
          }
          .quick-input::placeholder { color:rgba(255,255,255,.40); }
          .quick-input:focus-visible { outline:2px solid rgba(109,93,252,.70); border-radius:4px; }
          .quick-input[readonly] { color:#b7d3ee; cursor:default; }
          .quick-clear, .quick-copy, .quick-expand, .quick-file, .quick-insert {
            width:25px; flex:0 0 25px; height:25px; padding:0; align-self:center;
            border:1px solid rgba(180,155,104,.6);border-radius:7px;
            background:rgba(76,60,39,.94);color:#fff;cursor:pointer;
          }
          .quick-copy[hidden], .quick-clear[hidden], .quick-expand[hidden] { display:none; }
          .quick-actions {
            width:45px;flex:0 0 45px;display:flex;flex-direction:column;
            justify-content:space-between;align-items:stretch;gap:3px;
          }
          .quick-file, .quick-insert {width:45px;flex:0 0 26px;height:26px;font-size:10px;}
          .quick-send {
            flex:0 0 30px; width:45px; align-self:stretch; height:30px; padding:0;
            border:1px solid rgba(112,183,144,.58); border-radius:9px;
            background:rgba(40,77,59,.98); color:#fff; cursor:pointer;
            font:18px/1 system-ui,sans-serif; touch-action:auto;
          }
          .quick-send:hover:not(:disabled) { background:rgba(58,100,78,.98); }
          .quick-send:disabled { opacity:.45; cursor:default; }
          .quick-feedback {
            position:absolute; top:91px; right:0;
            max-width:min(330px, calc(100vw - 24px)); padding:5px 8px;
            border:1px solid rgba(128,128,128,.35); border-radius:8px;
            background:rgba(30,30,30,.96); color:#d9f0e0;
            font:11px/1.3 system-ui,sans-serif; user-select:text; cursor:default;
            pointer-events:none;
          }
          .quick-feedback[hidden] { display:none; }
          .control:hover { filter:brightness(1.12); }
          .control[data-active="true"] { opacity:1; }
          [data-role="auto-send"][data-active="true"] {
            background:#2563eb; border-color:#2563eb;
            box-shadow:0 0 0 2px rgba(37,99,235,.18),0 2px 10px rgba(0,0,0,.24);
          }
          [data-role="auto-send"][data-active="false"] { opacity:.72; }
          [data-role="delay-send"] { font-size:18px; }
          [data-role="delay-send"][data-active="true"] { background:#383838; border-color:rgba(255,255,255,.25); }
          [data-role="queue"] { font-size:24px; font-weight:300; position:relative; }
          [data-role="queue"][data-active="true"] { background:#383838; border-color:rgba(255,255,255,.25); }
          [data-role="queue"][data-sending="true"] { animation:pulse .8s ease-in-out infinite alternate; }
          @keyframes pulse { from { opacity:.62; } to { opacity:1; } }
          .badge {
            position:absolute; left:24px; top:-7px; min-width:17px; height:17px; padding:0 4px;
            display:none; align-items:center; justify-content:center; border-radius:10px;
            background:#6d5dfc; color:#fff; font:600 10px/1 system-ui,sans-serif;
            pointer-events:none; box-shadow:0 1px 4px rgba(0,0,0,.35);
          }
          .meta-chip {
            position:absolute; top:-22px; height:17px; padding:0 6px;
            display:inline-flex; align-items:center; justify-content:center; white-space:nowrap;
            border:1px solid rgba(128,128,128,.24); border-radius:999px;
            background:rgba(32,32,32,.88); color:rgba(255,255,255,.62);
            font:600 9px/1 system-ui,sans-serif; pointer-events:none;
            box-shadow:0 2px 8px rgba(0,0,0,.18);
          }
          .version-chip { left:44px; }
          .timer-chip { left:-4px; display:none; }
          .panel {
            position:absolute; left:0; bottom:44px; width:min(430px, calc(100vw - 24px));
            pointer-events:auto; font:13px/1.35 system-ui,sans-serif; color:#fff;
          }
          .panel[hidden] { display:none; }
          .panel-header {
            display:flex; align-items:center; justify-content:space-between; gap:8px;
            margin:0 0 7px; padding:7px 9px; border:1px solid rgba(128,128,128,.24);
            border-radius:10px; background:rgba(40,40,40,.98);
            color:rgba(255,255,255,.78); font:600 11px/1.2 system-ui,sans-serif;
          }
          .panel-version { color:rgba(255,255,255,.48); font-weight:700; }
          .queue-list { max-height:220px; overflow-y:auto; margin-bottom:7px; scrollbar-width:thin; }
          .queue-item {
            display:flex; align-items:center; gap:7px; min-height:42px;
            padding:7px 8px 7px 9px; margin-bottom:5px;
            border:1px solid rgba(128,128,128,.28); border-radius:11px;
            background:rgba(48,48,48,.98); box-shadow:0 4px 14px rgba(0,0,0,.22);
          }
          .queue-item[data-pending="true"] { border-color:rgba(109,93,252,.72); }
          .queue-item[data-drop="before"] { box-shadow:inset 0 2px 0 #6d5dfc,0 4px 14px rgba(0,0,0,.22); }
          .queue-item[data-drop="after"] { box-shadow:inset 0 -2px 0 #6d5dfc,0 4px 14px rgba(0,0,0,.22); }
          .queue-item[data-dragging="true"] { opacity:.42; }
          .drag-handle { width:18px; flex:0 0 18px; color:rgba(255,255,255,.34); cursor:grab; user-select:none; font:13px/1 system-ui,sans-serif; text-align:center; }
          .drag-handle:active { cursor:grabbing; }
          .number { width:18px; flex:0 0 18px; opacity:.46; font:11px/1 system-ui,sans-serif; text-align:center; }
          .queue-text { flex:1; min-width:0; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; font:13px/1.35 system-ui,sans-serif; }
          .item-action {
            width:27px; height:27px; flex:0 0 27px; padding:0; border:0; border-radius:7px;
            background:transparent; color:#aaa; font:14px/1 system-ui,sans-serif; cursor:pointer;
          }
          .item-action:hover:not(:disabled) { background:rgba(255,255,255,.10); color:#fff; }
          .item-action.send-one:hover:not(:disabled) { background:rgba(109,93,252,.52); }
          .item-action.remove:hover:not(:disabled) { background:rgba(127,45,45,.58); }
          .item-action:disabled { opacity:.45; cursor:default; }
          .empty { display:none; margin-bottom:7px; padding:9px; border:1px dashed rgba(128,128,128,.22); border-radius:10px; color:rgba(255,255,255,.38); text-align:center; }
          .send-all {
            display:none; width:100%; margin:0 0 7px; padding:8px 10px;
            border:1px solid rgba(128,128,128,.28); border-radius:10px;
            background:rgba(48,48,48,.98); color:#ddd; font:12px/1.2 system-ui,sans-serif;
            cursor:pointer; box-shadow:0 4px 14px rgba(0,0,0,.16);
          }
          .send-all:hover:not(:disabled) { background:rgba(58,58,58,.98); color:#fff; }
          .send-all:disabled { opacity:.5; cursor:default; }
          .delay-settings {
            margin:0 0 7px; padding:8px 9px; border:1px solid rgba(128,128,128,.24); border-radius:10px;
            background:rgba(40,40,40,.98); color:rgba(255,255,255,.72);
          }
          .delay-settings-row { display:flex; align-items:center; gap:8px; }
          .delay-settings-title { font:600 11px/1.2 system-ui,sans-serif; white-space:nowrap; }
          .delay-select {
            margin-left:auto; min-width:106px; padding:5px 7px; border:1px solid rgba(128,128,128,.28); border-radius:7px;
            background:rgba(30,30,30,.98); color:#eee; font:11px/1.2 system-ui,sans-serif; outline:none;
          }
          .delay-manual-row { display:flex; align-items:center; gap:7px; margin-top:7px; }
          .delay-manual-label { color:rgba(255,255,255,.50); font:10px/1.2 system-ui,sans-serif; }
          .delay-minutes {
            width:76px; margin-left:auto; padding:5px 7px; border:1px solid rgba(128,128,128,.28); border-radius:7px;
            background:rgba(30,30,30,.98); color:#eee; font:11px/1.2 system-ui,sans-serif; outline:none;
          }
          .delay-unit { color:rgba(255,255,255,.46); font:10px/1 system-ui,sans-serif; }
          .delay-note { margin-top:5px; color:rgba(255,255,255,.34); font:10px/1.25 system-ui,sans-serif; }
          .checkpoint-label { margin-top:8px; color:rgba(255,255,255,.62); font:600 10px/1.2 system-ui,sans-serif; }
          textarea { display:block; width:100%; min-height:66px; max-height:190px; resize:vertical; padding:4px 4px 7px; border:0; outline:none; background:transparent; color:#fff; font:13px/1.42 system-ui,sans-serif; }
          textarea::placeholder { color:rgba(255,255,255,.36); }
          .checkpoint-input {
            min-height:52px; max-height:120px; margin-top:5px; padding:7px 8px; border:1px solid rgba(128,128,128,.24);
            border-radius:8px; background:rgba(30,30,30,.72); font-size:11px;
          }
          .timer-status { display:none; margin-top:6px; color:rgba(255,255,255,.58); font:10px/1.3 system-ui,sans-serif; }
          .delayed-section { display:none; margin:0 0 7px; }
          .section-title { margin:0 0 5px; color:rgba(255,255,255,.54); font:600 10px/1.2 system-ui,sans-serif; }
          .delayed-list { max-height:150px; overflow-y:auto; scrollbar-width:thin; }
          .delayed-item {
            display:flex; align-items:center; gap:7px; min-height:38px; margin-bottom:5px; padding:6px 8px;
            border:1px solid rgba(128,128,128,.24); border-radius:10px; background:rgba(43,43,43,.98);
          }
          .delayed-item[data-state="uncertain"] { border-color:rgba(202,153,58,.62); }
          .delayed-time { flex:0 0 auto; color:rgba(255,255,255,.62); font:600 10px/1 system-ui,sans-serif; }
          .composer { padding:9px; border:1px solid rgba(128,128,128,.28); border-radius:14px; background:rgba(30,30,30,.98); box-shadow:0 12px 34px rgba(0,0,0,.34); }
          .composer-bottom { display:flex; align-items:center; gap:7px; flex-wrap:wrap; }
          .actions-left { display:flex; align-items:center; gap:7px; min-width:0; flex-wrap:wrap; }
          .hint { margin-left:auto; color:rgba(255,255,255,.32); font:10px/1 system-ui,sans-serif; white-space:nowrap; }
          .add,.schedule-later,.from-chat {
            border:1px solid rgba(128,128,128,.28); border-radius:8px; padding:7px 11px; cursor:pointer;
            background:rgba(48,48,48,.98); color:#eee; font:600 12px/1 system-ui,sans-serif; white-space:nowrap;
          }
          .add:hover,.schedule-later:hover,.from-chat:hover,.persist-send:hover { background:rgba(64,64,64,.98); color:#fff; }
          .persist-send { border:1px solid rgba(112,183,144,.55); border-radius:8px; padding:7px 11px; cursor:pointer; background:rgba(40,77,59,.98); color:#fff; font:600 12px/1 system-ui,sans-serif; }
          .persisted-section { margin-top:9px; border-top:1px solid rgba(128,128,128,.22); padding-top:8px; }
          .persisted-row { margin:4px 0; padding:6px 7px; background:rgba(40,40,40,.88); border-radius:8px; color:#ddd; font:11px/1.45 system-ui,sans-serif; overflow-wrap:anywhere; }
          .persisted-row button { margin-left:6px; font:11px system-ui,sans-serif; }
          .persisted-status { margin-top:6px; color:#a3d7b2; font:11px/1.35 system-ui,sans-serif; }
          .persisted-summary { margin:5px 0; color:rgba(255,255,255,.62); font:11px/1.4 system-ui,sans-serif; }
          .persisted-list { max-height:245px; overflow-y:auto; scrollbar-width:thin; }
          .persisted-more { display:block; width:100%; padding:6px; margin-top:5px;
            border:1px solid rgba(128,128,128,.32); border-radius:7px;
            background:rgba(48,48,48,.96); color:#ddd; cursor:pointer;
            font:11px/1.3 system-ui,sans-serif; }
          .persisted-more[hidden] { display:none; }
          .schedule-later { background:rgba(48,58,78,.98); border-color:rgba(100,149,237,.34); }
          .schedule-later:hover { background:rgba(59,73,101,.98); }
          .from-chat { background:rgba(53,51,74,.98); border-color:rgba(109,93,252,.38); }
          .from-chat:hover { background:rgba(72,68,101,.98); }
          .add:disabled,.schedule-later:disabled,.from-chat:disabled { opacity:.48; cursor:default; }
          .status { display:none; margin:0 0 7px; padding:7px 9px; border-radius:9px; background:rgba(127,45,45,.38); color:#ffd7d7; font:11px/1.35 system-ui,sans-serif; }
        </style>

        <div class="panel" hidden>
          <div class="panel-header"><span>Очередь сообщений</span><span class="panel-version"></span></div>
          <div class="status"></div>
          <div class="empty">Очередь пуста</div>
          <div class="queue-list"></div>
          <button type="button" class="send-all">Отправить всё одним сообщением</button>
          <div class="delay-settings">
            <div class="delay-settings-row">
              <span class="delay-settings-title">Задержка</span>
              <select class="delay-select" aria-label="Время отложенной отправки">
                <option value="30000">30 сек</option>
                <option value="60000">1 мин</option>
                <option value="120000">2 мин</option>
                <option value="300000">5 мин</option>
                <option value="600000">10 мин</option>
                <option value="900000">15 мин</option>
                <option value="1800000">30 мин</option>
                <option value="3600000">1 час</option>
                <option value="custom">Своё время</option>
              </select>
            </div>
            <div class="delay-manual-row">
              <span class="delay-manual-label">Свои минуты</span>
              <input class="delay-minutes" type="text" inputmode="decimal" autocomplete="off" aria-label="Своё количество минут">
              <span class="delay-unit">мин</span>
            </div>
            <div class="delay-note">Эта задержка используется и для чекпоинта ◷, и для кнопки «Отправить позже». Спящая вкладка догонит просроченное после пробуждения.</div>
            <div class="checkpoint-label">Фиксированный текст чекпоинта для ◷</div>
            <textarea class="checkpoint-input" placeholder="Например: Проверь текущий прогресс и продолжай с последнего чекпоинта..."></textarea>
            <div class="timer-status"></div>
          </div>
          <div class="delayed-section">
            <div class="section-title">Отправятся позже</div>
            <div class="delayed-list"></div>
          </div>
          <div class="composer">
            <textarea class="queue-input" placeholder="Добавить следующее сообщение..."></textarea>
            <div class="composer-bottom">
              <div class="actions-left">
                <button type="button" class="persist-send" title="Локально сохранить исходник и task_id, затем отправить через обычный ChatGPT">Сохранить и отправить</button>
                <button type="button" class="add">В очередь</button>
                <button type="button" class="schedule-later">Отправить позже</button>
                <button type="button" class="from-chat" title="Перенести весь текст из обычного поля ChatGPT в очередь">Из чата → очередь</button>
              </div>
              <span class="hint">Ctrl/⌘ + Enter</span>
            </div>
          </div>
          <div class="persisted-section">
            <div class="section-title">Локальная история запросов</div>
            <div class="persisted-status" role="status"></div>
            <div class="persisted-summary"></div>
            <div class="persisted-list"></div>
            <button type="button" class="persisted-more" hidden>Показать ещё 20</button>
          </div>
        </div>

        <div class="row" aria-label="ChatGPT notifier controls">
          <span class="meta-chip timer-chip"></span>
          <span class="meta-chip version-chip"></span>
          <button type="button" class="control" data-role="delay-send" aria-label="Чекпоинт по таймеру">◷</button>
          <button type="button" class="control" data-role="queue" aria-label="Очередь сообщений">+</button>
          <button type="button" class="control" data-role="auto-send" aria-label="Автоотправить после загрузки файлов">⇧</button>
          <div class="quick-compose" role="group" aria-label="Fortis Textbox — ввод сообщения">
            <span class="quick-grip" title="Перетащить четыре кнопки вместе с текстбоксом" aria-label="Переместить панель">⠿</span>
            <textarea class="quick-input" rows="2" aria-label="Новое сообщение Fortis Textbox" placeholder="Сообщение..."></textarea>
            <button type="button" class="quick-expand" hidden aria-label="Развернуть и редактировать большой промпт целиком" title="Показать весь текст для редактирования">↗</button>
            <button type="button" class="quick-copy" hidden aria-label="Скопировать полный большой промпт" title="Скопировать полный текст из памяти">⧉</button>
            <button type="button" class="quick-clear" hidden aria-label="Очистить большой промпт" title="Удалить большой промпт из памяти этой вкладки">×</button>
            <div class="quick-actions">
              <button type="button" class="quick-file" title="Весь промпт как .txt — без автоматического Send" aria-label="Передать промпт как текстовый файл">Файл</button>
              <button type="button" class="quick-insert" title="Вставить текст, активные модули и Fortis context без Send" aria-label="Вставить текст без отправки">Вставить</button>
              <button type="button" class="quick-send" aria-label="Сохранить и отправить текстбокс"
                title="Перенести в штатное поле ChatGPT и отправить через 1 секунду (Enter)">➤</button>
            </div>
          </div>
          <span class="quick-feedback" role="status" aria-live="polite" hidden></span>
          <span class="badge"></span>
        </div>`;

      const ui = {
        host,
        row: shadow.querySelector('.row'),
        quickInput: shadow.querySelector('.quick-input'),
        quickSend: shadow.querySelector('.quick-send'),
        quickClear: shadow.querySelector('.quick-clear'),
        quickCopy: shadow.querySelector('.quick-copy'),
        quickExpand: shadow.querySelector('.quick-expand'),
        quickFile: shadow.querySelector('.quick-file'),
        quickInsert: shadow.querySelector('.quick-insert'),
        quickFeedback: shadow.querySelector('.quick-feedback'),
        delayButton: shadow.querySelector('[data-role="delay-send"]'),
        queueButton: shadow.querySelector('[data-role="queue"]'),
        autoButton: shadow.querySelector('[data-role="auto-send"]'),
        timerChip: shadow.querySelector('.timer-chip'),
        badge: shadow.querySelector('.badge'),
        panel: shadow.querySelector('.panel'),
        list: shadow.querySelector('.queue-list'),
        empty: shadow.querySelector('.empty'),
        status: shadow.querySelector('.status'),
        timerStatus: shadow.querySelector('.timer-status'),
        delaySelect: shadow.querySelector('.delay-select'),
        delayMinutes: shadow.querySelector('.delay-minutes'),
        checkpointInput: shadow.querySelector('.checkpoint-input'),
        delayedSection: shadow.querySelector('.delayed-section'),
        delayedList: shadow.querySelector('.delayed-list'),
        sendAll: shadow.querySelector('.send-all'),
        textarea: shadow.querySelector('.queue-input'),
        add: shadow.querySelector('.add'),
        scheduleLater: shadow.querySelector('.schedule-later'),
        fromChat: shadow.querySelector('.from-chat'),
        persistSend: shadow.querySelector('.persist-send'),
        persistedList: shadow.querySelector('.persisted-list'),
        persistedStatus: shadow.querySelector('.persisted-status'),
        persistedSummary: shadow.querySelector('.persisted-summary'),
        persistedMore: shadow.querySelector('.persisted-more'),
        versionChip: shadow.querySelector('.version-chip'),
        panelVersion: shadow.querySelector('.panel-version')
      };

      ui.settingsUi=deps.mountTextboxSettings?.({
        shadow,manager:textboxProfileManager,
        positionPanel:panel=>positionPanel(host,panel)
      })||null;
      host.__fortisTextboxSettings=ui.settingsUi;
      ui.versionChip.textContent = `v${deps.SCRIPT_VERSION}`;
      ui.panelVersion.textContent = `v${deps.SCRIPT_VERSION}`;
      ui.persistedMore?.addEventListener('click', () => {
        persistedVisibleCount += 20;
        schedule();
      });

      function addCurrent() {
        if (!queuedPromptController) return;
        const id = queuedPromptController.add(ui.textarea.value);
        if (!id) return;
        ui.textarea.value = '';
        render();
        setTimeout(() => ui.textarea.focus(), 0);
      }

      function sendPersistedCurrent() {
        const id = persistentMessageController?.saveAndSend(ui.textarea.value);
        if (!id) { render(); return; }
        ui.textarea.value = '';
        render();
        setTimeout(() => ui.textarea.focus(), 0);
      }

      function scheduleCurrent() {
        const id = delayedSendController?.addScheduled?.(ui.textarea.value);
        if (!id) return;
        ui.textarea.value = '';
        render();
        setTimeout(() => ui.textarea.focus(), 0);
      }

      ui.row.addEventListener('pointerdown', event => {
        if (event.button !== 0 || !event.isPrimary ||
            !canStartFloatingDrag(event.target)) return;
        const rect = host.getBoundingClientRect();
        dragState = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          startLeft: rect.left,
          startTop: rect.top,
          moved: false
        };
      });

      ui.row.addEventListener('pointermove', event => {
        if (!dragState || dragState.pointerId !== event.pointerId) return;
        const dx = event.clientX - dragState.startX;
        const dy = event.clientY - dragState.startY;
        if (!dragState.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        dragState.moved = true;
        ui.row.dataset.dragging = 'true';
        ui.row.setPointerCapture?.(event.pointerId);
        event.preventDefault();
        setHostPosition(host, { left: dragState.startLeft + dx, top: dragState.startTop + dy });
        positionPanel(host, ui.panel);
        positionPanel(host, ui.settingsUi?.panel);
      });

      function finishDrag(event) {
        if (!dragState || dragState.pointerId !== event.pointerId) return;
        const moved = dragState.moved;
        dragState = null;
        ui.row.dataset.dragging = 'false';
        try { ui.row.releasePointerCapture?.(event.pointerId); } catch (_) {}
        if (!moved) return;
        event.preventDefault();
        suppressClickUntil = Date.now() + 350;
        const rect = host.getBoundingClientRect();
        setHostPosition(host, { left: rect.left, top: rect.top }, { persist: true });
        positionPanel(host, ui.panel);
      }

      ui.row.addEventListener('pointerup', finishDrag);
      ui.row.addEventListener('pointercancel', finishDrag);

      ui.queueButton.addEventListener('click', event => {
        if (clickWasDrag(event)) return;
        event.preventDefault();
        event.stopPropagation();
        ui.panel.hidden = !ui.panel.hidden;
        render();
        if (!ui.panel.hidden) {
          setTimeout(() => {
            positionPanel(host, ui.panel);
            ui.textarea.focus();
          }, 0);
        }
      });

      ui.delayButton.addEventListener('click', event => {
        if (clickWasDrag(event)) return;
        event.preventDefault();
        event.stopPropagation();
        delayedSendController?.toggleCheckpoint?.();
        // The general UI scheduler is intentionally debounced for DOM churn, but
        // this control needs immediate visual feedback. Without this render a fast
        // second click can cancel the timer before the active state/chip ever appears.
        render();
      });

      ui.autoButton.addEventListener('click', event => {
        if (clickWasDrag(event)) return;
        event.preventDefault();
        event.stopPropagation();
        uploadController.toggle();
      });

      ui.delaySelect.addEventListener('change', () => {
        if (ui.delaySelect.value === 'custom') {
          ui.delayMinutes.focus();
          ui.delayMinutes.select?.();
          return;
        }
        delayedSendController?.setDelayMs(Number(ui.delaySelect.value));
        render();
      });

      function applyManualDelay() {
        const result = delayedSendController?.setDelayMinutes?.(ui.delayMinutes.value);
        if (result !== false) render();
      }

      ui.delayMinutes.addEventListener('change', applyManualDelay);
      ui.delayMinutes.addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        applyManualDelay();
        ui.delayMinutes.blur();
      });

      ui.checkpointInput.value = delayedSendController?.getCheckpointText?.() || '';
      ui.checkpointInput.addEventListener('input', () => {
        delayedSendController?.setCheckpointText?.(ui.checkpointInput.value);
      });

      function clearLargePaste({ focus = true } = {}) {
        largePaste.clear();
        ui.quickInput.readOnly = false;
        ui.quickInput.value = '';
        ui.quickClear.hidden = true;
        ui.quickCopy.hidden = true;
        ui.quickExpand.hidden = true;
        ui.quickFeedback.textContent = '';
        ui.quickFeedback.hidden = true;
        if (focus) ui.quickInput.focus();
      }

      resetLargePasteView = () => clearLargePaste({ focus: false });
      ui.quickClear.addEventListener('click', () => clearLargePaste());
      ui.quickExpand.addEventListener('click', () => {
        if (!largePaste.active()) return;
        const fullText = largePaste.text('');
        largePaste.clear();
        ui.quickInput.readOnly = false;
        ui.quickInput.value = fullText;
        ui.quickExpand.hidden = true;
        ui.quickCopy.hidden = true;
        ui.quickClear.hidden = true;
        ui.quickFeedback.textContent = 'Показан полный исходник — можно редактировать перед отправкой.';
        ui.quickFeedback.hidden = false;
        ui.quickInput.focus();
      });
      ui.quickCopy.addEventListener('click', async () => {
        if (!largePaste.active()) return;
        try {
          await navigator.clipboard.writeText(largePaste.text(''));
          ui.quickFeedback.textContent = 'Полный большой промпт скопирован.';
        } catch (_) {
          ui.quickFeedback.textContent = 'Не удалось скопировать. Исходный текст остаётся в памяти вкладки.';
        }
        ui.quickFeedback.hidden = false;
      });
      ui.quickInput.addEventListener('paste', event => {
        if (event.clipboardData?.files?.length || largePaste.active()) return;
        const pasted = event.clipboardData?.getData?.('text/plain');
        if (!largePaste.capture(pasted, ui.quickInput.value,
          ui.quickInput.selectionStart, ui.quickInput.selectionEnd)) return;
        // Prevent a huge DOM textarea mutation/layout on the paste event.
        event.preventDefault();
        ui.quickInput.value = largePaste.preview();
        ui.quickInput.readOnly = true;
        ui.quickClear.hidden = false;
        ui.quickCopy.hidden = false;
        ui.quickExpand.hidden = false;
        ui.quickFeedback.textContent = 'Полный текст сохранён в памяти до отправки; при обновлении вкладки пропадёт.';
        ui.quickFeedback.hidden = false;
      });

      let fileTransferPending = false;
      let fileTransferEpoch = 0;
      cancelFileTransfer = () => {
        fileTransferEpoch += 1;
        fileTransferPending = false;
        ui.quickFile.disabled = false;
        ui.quickInsert.disabled = false;
        ui.quickSend.disabled = false;
      };
      const wait = ms => new Promise(resolve => window.setTimeout(resolve, ms));
      let lastFileStatus = '';
      const fileStatus = message => {
        lastFileStatus = String(message || '');
        ui.quickFeedback.textContent = lastFileStatus;
        ui.quickFeedback.hidden = false;
      };

      function currentFileContext(chatId) {
        if (!chatId || deps.currentChatId?.() !== chatId) return null;
        const context = deps.findComposerContext?.();
        if (!context?.composer?.isConnected) return null;
        return context;
      }

      function tryFileInputs(file, context) {
        const inputs = [];
        const primary = deps.findUploadFileInput?.(context.composer);
        if (primary) inputs.push(primary);
        // Current ChatGPT may mount its hidden input outside the composer form.
        for (const input of document.querySelectorAll('input[type="file"]'))
          if (!inputs.includes(input)) inputs.push(input);
        // Do not try a second file input if the first accepted candidate
        // dispatches change but its DOM handler throws or reports failure:
        // ChatGPT might have received the file despite that exception.
        return tryPromptFileInputOnce(file, inputs);

      }

      async function waitForFileCard(chatId, filename, duration, epoch) {
        const end = Date.now() + duration;
        while (Date.now() <= end) {
          if (epoch !== fileTransferEpoch) return false;
          const ctx = currentFileContext(chatId);
          if (!ctx) return false;
          const root=ctx.container||ctx.composer;
          // The modern preview may be a sibling mounted at the composer
          // wrapper level, but never search the entire conversation.
          const card=fileAttachmentVisible(root,filename)||
            fileAttachmentVisible(root?.parentElement,filename);
          if (card && !deps.composerHasUploadBusyEvidence?.(root,[filename]))return true;
          await wait(180);
        }
        return false;
      }

      function prepareActiveModules(originalText, moduleIds = null, profileId = null) {
        if (!textboxProfileManager?.prepare || !persistentMessageController?.prepareDraft ||
            !queuedPromptController?.insertOnly)
          throw Error('Модули / task_id / черновик Notifier недоступны.');
        const prepared = profileId !== null
          ? textboxProfileManager.prepareForProfile(originalText,profileId,moduleIds)
          : moduleIds === null
            ? textboxProfileManager.prepare(originalText)
            : textboxProfileManager.prepareForModules(originalText,moduleIds);
        if (!prepared || typeof prepared.extraText !== 'string' ||
            prepared.extraText.length > 100000)
          throw Error('Активный профиль не подготовлен.');
        return prepared;
      }

      async function completeFileDraft(record, file, chatId, epoch, nativeBefore) {
        if (epoch !== fileTransferEpoch || !currentFileContext(chatId)) {
          fileStatus('Чат изменился. Исходник остался в Textbox; Send не нажимался.');
          return {ok:false,reason:'context_mismatch'};
        }
        // task_id, exact original and ALL modules/context were prepared
        // BEFORE uploading. Do not generate a different task_id after attach.
        const nativeNow = queuedPromptController.readNativeDraft?.();
        if (typeof nativeNow !== 'string' || nativeNow !== nativeBefore ||
            !record || typeof record.submitted_text !== 'string' ||
            !(nativeBefore
              ? record.submitted_text.startsWith(nativeBefore + '\n\n')
              : record.submitted_text.length > 0)) {
          fileStatus('Редактор ChatGPT изменился при прикреплении файла. ' +
            'Контекст не вставлен и Send не нажат.');
          return {ok:false,reason:'context_mismatch'};
        }
        const addition = record.submitted_text.slice(nativeBefore.length);
        // Only the NEW short context is inserted into a busy native editor.
        // Never replace the complete native contents with the original file.
        if (addition.length >= LARGE_PASTE_THRESHOLD) {
          fileStatus('Модули/контекст слишком длинны для безопасного добавления. ' +
            'Файл прикреплён, но текст не вставлен. Send не нажат.');
          return false;
        }
        const result = nativeBefore
          ? await queuedPromptController.appendOnly(addition, nativeBefore,
              {fileContext:true})
          : await queuedPromptController.insertOnly(record.submitted_text,
              {fileContext:true});
        fileStatus(result.ok
          ? 'Полный исходник, модули и Fortis task context находятся в файле; ' +
            'в редакторе только ссылка с task_id. SHA-256 записан, Send НЕ нажат.'
          : 'Файл прикреплён, но ссылка с task_id не добавлена: ' + result.reason +
            ' Не отправляй до ручной проверки.');
        return result.ok ? {ok:true,taskId:record.task_id} : {ok:false,reason:'context_mismatch'};
      }

      async function handleQuickFile(originalText, moduleIds = null, profileId = null) {
        if (fileTransferPending) return {ok:false};
        originalText=String(originalText);

        if (!originalText.trim()) { fileStatus('Сначала вставьте текст.'); return; }
        if (queuedPromptController?.isWaitingToSend?.() ||
            uploadController?.isArmed?.() || uploadController?.isConfirmingSend?.()) {
          fileStatus('Завершите активную отправку или выключите ⇧ автоотправку файлов.');
          return;
        }
        const chatId = deps.currentChatId?.();
        const context = currentFileContext(chatId);
        if (!context) {
          fileStatus('Откройте конкретный чат ChatGPT. Промпт сохранён в текстбоксе.');
          return;
        }
        fileTransferPending = true;
        const epoch = ++fileTransferEpoch;
        ui.quickFile.disabled = true;
        ui.quickInsert.disabled = true;
        ui.quickSend.disabled = true;
        try {
          const profile = prepareActiveModules(originalText,moduleIds,profileId);
          if (new TextEncoder().encode(originalText).length > MAX_QUICK_SEND_BYTES)
            throw Error('Для архивации оригинала по task_id файл ограничен 512 КиБ.');
          // The duplicate check is based on SHA-256 of the complete original,
          // per Chat ID, NOT any occupied editor or existing attachment card.
          const reservation = await fileHashGuard.reserve(chatId, originalText);
          if (epoch !== fileTransferEpoch || !currentFileContext(chatId)) {
            fileStatus('Чат сменился во время SHA-проверки. Вложение отменено.');
            return;
          }
          if (!reservation.ok) {
            fileStatus(reservation.reason);
            // The Notifier UI already knows this is a SHA-256 duplicate.
            // Make the owner's event log equally precise. No file action.
            return {ok:false,reason:reservation.duplicate?'duplicate':'not_confirmed',
              detail:safeNotifierFileDetail(lastFileStatus)};
          }
          // Create a single task context and complete attachment BEFORE the
          // single upload attempt. Both owner Viewer and Notifier use this.
          const fileName='fortis-prompt-' + Date.now().toString(36) + '.txt';
          const nativeBefore=queuedPromptController.readNativeDraft?.();
          if (typeof nativeBefore !== 'string')
            throw Error('Нативный редактор недоступен. Файл не прикреплялся.');
          const record=persistentMessageController.prepareDraft(originalText,{
            mode:'file',fileName,extraText:profile.extraText,nativePrefix:nativeBefore
          });
          if (!record || typeof record.file_text !== 'string' ||
              !record.file_text.includes('task_id: ' + record.task_id))
            throw Error('Не удалось подготовить полный файл с task_id. Файл не прикреплялся.');
          const file = createPromptTextFile(record.file_text,fileName);
          fileStatus('Создал полный ' + file.name + '. Прикрепляю к текущему чату…');
          const transfer = await attemptPromptFileOnce({
            tryDirectInput: () => tryFileInputs(file, context),
            findPlus: () => {
              if (epoch !== fileTransferEpoch || !currentFileContext(chatId))
                return null;
              const plus = deps.findComposerPlusButton?.(context.composer);
              return plus?.isConnected ? plus : null;
            },
            afterPlus: () => wait(250),
            tryMenuInput: () => {
              const next = epoch === fileTransferEpoch ? currentFileContext(chatId) : null;
              return Boolean(next && tryFileInputs(file, next));
            },
            tryDrop: () => {
              const next = epoch === fileTransferEpoch ? currentFileContext(chatId) : null;
              if (!next) return false;
              const target = document.querySelector('[data-testid*="dropzone" i]') ||
                next.container || next.composer;
              return dropPromptTextFile(target, file);
            },
            waitForCard: () => waitForFileCard(chatId, file.name, 5000, epoch)
          });
          if (epoch !== fileTransferEpoch || !currentFileContext(chatId)) {
            fileStatus('Чат изменился. Прикрепление остановлено; повторов не было.');
            return;
          }
          if (transfer.confirmed) {
            let completed;
            try {completed=await completeFileDraft(record, file, chatId, epoch, nativeBefore)}
            catch (_) {
              fileStatus('Карточка файла обнаружена, но Fortis-контекст не подтверждён. ' +
                'Не отправляй сообщение и не прикрепляй файл повторно.');
              completed={ok:false,reason:'context_mismatch'}
            }
            return completed && typeof completed === 'object'
              ? {...completed, attachmentAttempted:true, attachmentConfirmed:true,
                 detail:safeNotifierFileDetail(lastFileStatus)}
              : {ok:false,reason:'prepared_missing',
                 attachmentAttempted:true,attachmentConfirmed:true,
                 detail:safeNotifierFileDetail(lastFileStatus)};
          }
          // CRITICAL: No retry or alternate upload path on an unknown result.
          // The ChatGPT UI may accept the file while our card detector times
          // out. Retrying here was the cause of duplicate attachments.
          if (transfer.attempted) {
            fileStatus('Одна попытка прикрепления (' + transfer.path +
              ') выполнена, но ChatGPT не подтвердил карточку. ' +
              'Возможно, файл уже добавлен. Второй попытки НЕ делаю; ' +
              'проверь вложения вручную. Send не нажат.');
            return {ok:false,reason:'upload_unconfirmed',
              attachmentAttempted:true,attachmentConfirmed:false,
              detail:safeNotifierFileDetail(lastFileStatus)};
          }
          fileStatus('Не удалось выбрать способ прикрепления файла (' +
            transfer.reason + '). Автоматического повтора и Send не было.');
        } catch (error) {
          fileStatus(error?.message || 'Не удалось прикрепить файл в ChatGPT.');
        } finally {
          if (epoch === fileTransferEpoch) {
            fileTransferPending = false;
            ui.quickFile.disabled = false;
            ui.quickInsert.disabled = false;
            ui.quickSend.disabled = false;
          }
        }
        return {ok:false};
      }
      ui.quickFile.addEventListener('click',()=>handleQuickFile(largePaste.text(ui.quickInput.value)));

      async function handleQuickInsert(original, moduleIds = null, profileId = null) {
        if (ui.quickInsert.disabled || fileTransferPending) return {ok:false};
        original=String(original);
        if (!original.trim()) {
          ui.quickFeedback.textContent = 'Сначала вставьте текст.';
          ui.quickFeedback.hidden = false;
          return;
        }
        if (original.length >= LARGE_PASTE_THRESHOLD) {
          // Native editor froze on 68k+ characters in real Edge.
          // Route large inserts through the file with the same active modules.
          // Large local text uses the exact same single-attempt File route.
          return handleQuickFile(original,moduleIds,profileId);
        }
        ui.quickInsert.disabled = true;
        ui.quickSend.disabled = true;
        ui.quickFile.disabled = true;
        ui.quickFeedback.textContent = 'Подготавливаю модули и Fortis task context без Send…';
        ui.quickFeedback.hidden = false;
        try {
          const profile = prepareActiveModules(original,moduleIds,profileId);
          const record = persistentMessageController.prepareDraft(original, {
            mode: 'insert', extraText: profile.extraText
          });
          if (!record) {
            ui.quickFeedback.textContent =
              persistentMessageController.getLastStatus?.() || 'Черновик не сохранён.';
            return {ok:false,reason:'prepared_missing'};
          }
          if (record.submitted_text.length >= LARGE_PASTE_THRESHOLD) {
            ui.quickFeedback.textContent =
              'Черновик с модулями слишком длинный. Исходник сохранён; ' +
              'Send не нажат. Используйте «Файл».';
            return;
          }
          const result = await queuedPromptController.insertOnly(record.submitted_text);
          const success=Boolean(result?.ok);
          ui.quickFeedback.textContent = result.ok
            ? 'Текст, модули и Fortis task context вставлены; task_id сохранён. ' +
              'Отправь ВРУЧНУЮ.'
            : result.reason;
          return success ? {ok:true,taskId:record.task_id} : {ok:false,reason:'context_mismatch'};
        } catch (error) {
          ui.quickFeedback.textContent = error?.message || 'Модули недоступны.';
        } finally {
          ui.quickInsert.disabled = false;
          ui.quickSend.disabled = false;
          ui.quickFile.disabled = false;
        }
        return {ok:false};
      }
      ui.quickInsert.addEventListener('click',()=>handleQuickInsert(largePaste.text(ui.quickInput.value)));

      function sendQuickCurrent(originalOverride = null, moduleIds = null, profileId = null) {
        if (ui.quickInsert.disabled) return;
        // Reuse the same controller as the plus-panel. No changes to existing
        // queue, delayed checkpoint or file-upload button handlers.
        const originalText = originalOverride === null
          ? largePaste.text(ui.quickInput.value) : String(originalOverride);
        if (new TextEncoder().encode(originalText).length > MAX_QUICK_SEND_BYTES) {
          ui.quickFeedback.textContent =
            'Этот текст превышает предел 512 КиБ для сохранения точного оригинала Observatory. ' +
            'Отправка отменена; промпт остался в поле/памяти.';
          ui.quickFeedback.hidden = false;
          return;
        }
        let options={minComposerDwellMs:1000,focusAfterSend:true};
        try{
          if(textboxProfileManager){
            const prepared=profileId!==null
              ?textboxProfileManager.prepareForProfile(originalText,profileId,moduleIds)
              :moduleIds===null
                ?textboxProfileManager.prepare(originalText)
                :textboxProfileManager.prepareForModules(originalText,moduleIds);
            options={minComposerDwellMs:prepared.minComposerDwellMs,
              extraText:prepared.extraText,focusAfterSend:prepared.focusAfterSend};
          }
        }catch(error){
          ui.quickFeedback.textContent=error?.message||'Модули недоступны';
          ui.quickFeedback.hidden=false;return;
        }
        // A short original may expand beyond safe rich-editor size after
        // Planning Helper modules. Auto-route the EXPLICIT quick Send through
        // the same full-File + verified single native click pipeline.
        if(originalOverride===null &&
           originalText.length + String(options.extraText||'').length >= LARGE_PASTE_THRESHOLD) {
          const existing=queuedPromptController?.readNativeDraft?.();
          if(typeof existing!=='string'||existing.trim()){
            ui.quickFeedback.textContent='Редактор уже содержит текст; отправка через файл отменена.';
            ui.quickFeedback.hidden=false;
            return {ok:false,reason:'native_draft_occupied'};
          }
          void (async()=>{
            const prepared=await handleQuickFile(originalText);
            if(!prepared?.ok)return;
            const result=sendPreparedNative(prepared.taskId);
            if(result?.ok){
              largePaste.clear();ui.quickInput.value='';
              ui.quickFeedback.textContent='Файл отправлен через штатную кнопку; приём ChatGPT не подтверждён.';
              ui.quickFeedback.hidden=false;
            }
          })();
          return;
        }
        const id = persistentMessageController?.saveAndSend(originalText,options);
        ui.quickFeedback.textContent = id
          ? 'Исходник сохранён; передаю в ChatGPT, Send примерно через 1 сек.'
          : (persistentMessageController?.getLastStatus?.() || 'Отправка не подготовлена.');
        ui.quickFeedback.hidden = false;
        window.setTimeout(() => { ui.quickFeedback.hidden = true; }, 4500);
        if (!id) return {ok:false};
        if (originalOverride !== null) return {ok:true,taskId:id};
        largePaste.clear();
        ui.quickInput.readOnly = false;
        ui.quickClear.hidden = true;
        ui.quickCopy.hidden = true;
        ui.quickExpand.hidden = true;
        ui.quickInput.value = '';
        render();
        if(options.focusAfterSend!==false)ui.quickInput.focus();
      }

      // Owner-only separate Send: never reprepare, replace editor text, or
      // reattach files. The exact saved draft, scoped task_id and file card
      // must already be present. A single synchronous click is attempted.
      function sendPreparedNative(expectedTaskId=null) {
        if(fileTransferPending || queuedPromptController?.isWaitingToSend?.() ||
           uploadController?.isArmed?.() || uploadController?.isConfirmingSend?.())
          return {ok:false,reason:'busy'};
        const chatId=deps.currentChatId?.();
        const ctx=currentFileContext(chatId);
        const context=deps.findComposerContext?.();
        const button=context?.sendButton;
        if(!chatId||!ctx||!context?.composer?.isConnected)
          return {ok:false,reason:'no_composer'};
        if(!button?.isConnected || !deps.isSendButtonReady?.(button))
          return {ok:false,reason:'send_button_not_ready'};
        const native=queuedPromptController?.readNativeDraft?.();
        if(typeof native!=='string'||!native.trim())
          return {ok:false,reason:'prepared_missing'};
        const root=ctx.container||ctx.composer;
        const fileVisible=name=>Boolean(
          (fileAttachmentVisible(root,name)||fileAttachmentVisible(root?.parentElement,name))&&
          !deps.composerHasUploadBusyEvidence?.(root,[name]));
        const drafts=persistentMessageController?.previewPreparedNativeDraft?.(native,
          {fileNameVisible:fileVisible});
        // Refuse ambiguous draft prefix chains or a raw attachment lacking
        // task context; this prevents accidental sending of an orphan file.
        if(!Array.isArray(drafts)||drafts.length!==1 ||
           !/^rs_[0-9a-f]{32}$/.test(drafts[0].reporting_session_id||'') ||
           !deps.fileContextTextMatches?.(native,drafts[0].submitted_text) ||
           !native.includes('task_id: '+drafts[0].task_id) ||
           !native.includes('[Fortis task context]'))
          return {ok:false,reason:'prepared_missing'};
        const taskId=drafts[0].task_id;
        // Owner Send must send ONLY the File it just prepared.
        if (expectedTaskId !== null && taskId !== expectedTaskId)
          return {ok:false,reason:'context_mismatch'};
        const committed=persistentMessageController.recordManualDraftSend(native,
          {fileNameVisible:fileVisible});
        if(committed!==taskId)return {ok:false,reason:'not_confirmed'};
        // No retry even on exceptions: the click may already have reached ChatGPT.
        try{button.click()}catch(_){return {ok:false,reason:'not_confirmed'}}
        return {ok:true,taskId};
      }

      // One-shot owner dispatch enters the EXACT same native File/Insert/Send
      // pipeline as the Notifier buttons. No second upload algorithm and
      // no side effects on the Notifier's editable quick textbox.
      handleQuickDispatch = async function executeQuickDispatch(mode,text,moduleIds=null,profileId=null) {
        if(!['file','insert','send','send_prepared'].includes(mode)||
           typeof text!=='string'||(mode!=='send_prepared'&&!text.trim())||
           (moduleIds!==null&&(!Array.isArray(moduleIds)||
              moduleIds.some(id=>typeof id!=='string'))))return {ok:false};
        if(mode==='send_prepared')return sendPreparedNative();
        if(mode==='file')return handleQuickFile(text,moduleIds,profileId);
        if(mode==='insert')return handleQuickInsert(text,moduleIds,profileId);
        // Explicit owner "Отправить": file contains the original, complete
        // Fortis guidance and selected modules. Click native Send once only
        // after the file card and exact short task pointer are verified.
        const existing=queuedPromptController?.readNativeDraft?.();
        if(typeof existing!=='string'||existing.trim())
          return {ok:false,reason:'native_draft_occupied'};
        const prepared=await handleQuickFile(text,moduleIds,profileId);
        if(!prepared?.ok)return prepared||{ok:false,reason:'not_confirmed'};
        return sendPreparedNative(prepared.taskId);
      }
      ui.quickSend.addEventListener('click', ()=>sendQuickCurrent());
      ui.quickInput.addEventListener('keydown', event => {
        if (shouldSendQuickTextboxKey(event)) {
          event.preventDefault();
          event.stopPropagation();
          sendQuickCurrent();
        }
      });
      ui.persistSend?.addEventListener('click', sendPersistedCurrent);
      ui.add.addEventListener('click', addCurrent);
      ui.scheduleLater.addEventListener('click', scheduleCurrent);
      ui.fromChat.addEventListener('click', () => queuedPromptController?.addFromComposer());
      ui.sendAll.addEventListener('click', () => queuedPromptController?.sendAllNow());
      ui.textarea.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          ui.panel.hidden = true;
          return;
        }
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          addCurrent();
        }
      });

      return ui;
    }

    function render() {
      const ui = ensureUi();
      const host = ui.host;
      host.style.display = 'block';

      let position = loadPosition();
      if (!position) {
        position = chooseInitialPosition();
        savePosition(position);
      }
      setHostPosition(host, position, { persist: true });

      const active = tabState.isUploadMarked();
      ui.autoButton.dataset.active = String(active);
      ui.autoButton.setAttribute('aria-pressed', String(active));
      ui.autoButton.title = active
        ? 'Жду окончания загрузки файлов и затем автоматически отправлю. Нажать ещё раз — отменить.'
        : 'Когда файлы загружаются: нажать, чтобы после завершения автоматически отправить сообщение';

      const delayActive = Boolean(delayedSendController?.isCheckpointActive?.());
      const remainingLabel = delayActive ? delayedSendController.getCheckpointRemainingLabel() : '';
      ui.delayButton.dataset.active = String(delayActive);
      ui.delayButton.setAttribute('aria-pressed', String(delayActive));
      ui.delayButton.title = delayActive
        ? `Чекпоинт через ${remainingLabel}. Нажать — снять таймер.`
        : 'Поставить таймер на фиксированный текст чекпоинта';
      ui.timerChip.textContent = remainingLabel;
      ui.timerChip.style.display = delayActive ? 'inline-flex' : 'none';
      const selectedDelay = String(delayedSendController?.getDelayMs?.() || 300000);
      const hasPreset = Array.from(ui.delaySelect.options).some(option => option.value === selectedDelay);
      const selectValue = hasPreset ? selectedDelay : 'custom';
      if (ui.delaySelect.value !== selectValue) ui.delaySelect.value = selectValue;
      const manualMinutes = delayedSendController?.getDelayMinutes?.() || '5';
      if (document.activeElement !== ui.delayMinutes && ui.delayMinutes.value !== String(manualMinutes)) {
        ui.delayMinutes.value = String(manualMinutes);
      }
      const checkpointText = delayedSendController?.getCheckpointText?.() || '';
      if (document.activeElement !== ui.checkpointInput && ui.checkpointInput.value !== checkpointText) {
        ui.checkpointInput.value = checkpointText;
      }
      const timerStatus = delayedSendController?.getLastStatus?.() || '';
      ui.timerStatus.textContent = timerStatus;
      ui.timerStatus.style.display = timerStatus ? 'block' : 'none';

      ui.versionChip.textContent = `v${deps.SCRIPT_VERSION}`;
      ui.panelVersion.textContent = `v${deps.SCRIPT_VERSION}`;
      renderQueueList(ui);
      renderDelayedList(ui);
      renderPersistedList(ui);
      positionPanel(host, ui.panel);
      positionPanel(host, ui.settingsUi?.panel);
      ui.settingsUi?.render();
    }

    function schedule() {
      if (repositionTimer !== null) return;
      repositionTimer = window.setTimeout(() => {
        repositionTimer = null;
        window.requestAnimationFrame(render);
      }, deps.SETTINGS.uiRepositionDelayMs);
    }

    function resetLargePasteDraft() {
      // Never allow an unsent in-memory prompt from another conversation
      // to be sent after ChatGPT client-side navigation.
      cancelFileTransfer();
      if (largePaste.active()) resetLargePasteView();
    }

    function closeQueuePanel() {
      const host = document.getElementById(deps.UPLOAD_HOST_ID);
      const panel = host?.shadowRoot?.querySelector('.panel');
      if (panel) panel.hidden = true;
    }

    return { render, schedule, closeQueuePanel, resetLargePasteDraft, dispatchQuickAction };
  }

  return { clampFloatingPosition, floatingWidth, canStartFloatingDrag,
    shouldSendQuickTextboxKey, pagePersistedHistory, createLargePasteDraft,
    LARGE_PASTE_THRESHOLD, MAX_QUICK_SEND_BYTES, MAX_FILE_PROMPT_BYTES,
    createPromptTextFile, isEligiblePromptFileInput, tryPromptFileInputOnce,
    attachPromptTextFile, dropPromptTextFile,
    fileAttachmentVisible, safeNotifierFileDetail, createConsecutiveFileHashGuard,
    attemptPromptFileOnce, createUploadButtonUi };
});
