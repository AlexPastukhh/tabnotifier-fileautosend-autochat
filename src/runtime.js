(function (root, factory) {
  const api = factory(root.ChatGPTTabNotifier || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ChatGPTTabNotifier = Object.assign(root.ChatGPTTabNotifier || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  'use strict';

  function startTabNotifier() {
    let uploadUi = null;
    let uploadController = null;
    let queuedPromptController = null;
    let persistentMessageController = null;
    let taskActivityMonitor = null;
    let taskIntentMonitor = null;
    let userMessageArchiveMonitor = null;
    let delayedSendController = null;
    let observerBridge = null;

    function scheduleUi() {
      uploadUi?.schedule();
    }

    const completionModes = deps.createCompletionModeSettings?.() || null;
    const tabState = deps.createTabStateController({ scheduleUiUpdate: scheduleUi,
      isGenerating: () => (completionModes?.domEnabled() ?? true) && Boolean(deps.isGenerating?.()) });
    const notifications = deps.createNotificationService(tabState);

    const responseMonitor = deps.createResponseMonitor({
      isDomEnabled: () => completionModes?.domEnabled() ?? true,
      tabState,
      notifications,
      beforeArm: () => {
        // A synthetic click from file auto-send reaches the same document click
        // listener as a manual Send. While that transaction is waiting for
        // confirmation it must stay armed; other sends still cancel file auto-send.
        if (uploadController?.isConfirmingSend()) return;
        if (tabState.isUploadMarked() || uploadController?.isArmed()) {
          uploadController?.reset({ clearMark: true, render: false, clearFileHistory: true });
        }
      },
      onArmed: () => observerBridge?.noteArmed(),
      onFinished: () => {
        delayedSendController?.check();
        if (!delayedSendController?.isSending?.() && !delayedSendController?.hasDueWork?.()) {
          queuedPromptController?.handleResponseFinished();
        }
      }
    });

    observerBridge = deps.createObservatoryCompletionBridge?.({
      tabState, responseMonitor,
      isEnabled: () => completionModes?.observatoryEnabled() ?? true
    }) || null;

    uploadController = deps.createUploadAutoSendController({ tabState, isGenerationActive: deps.isGenerating });
    queuedPromptController = deps.createQueuedPromptController({
      onChange: scheduleUi,
      beforeSendClick: info => persistentMessageController?.beforeSendClick(info) ?? true,
      onSendResult: info => persistentMessageController?.handleSendResult(info)
    });
    persistentMessageController = deps.createPersistentMessageController?.({
      queue: queuedPromptController, onChange: scheduleUi,
      onSaved: () => { Promise.resolve().then(() => taskIntentMonitor?.check()); },
      getConversationId: () => deps.currentChatId?.() || '',
      getPairing: () => observerBridge?.getPairing?.() || null,
      storage: deps.createGMRecordStorage?.({
        getValue: typeof GM_getValue === 'function' ? GM_getValue : null,
        setValue: typeof GM_setValue === 'function' ? GM_setValue : null,
        listValues: typeof GM_listValues === 'function' ? GM_listValues : null
      })
    }) || null;
    taskIntentMonitor = deps.createTaskIntentMonitor?.({
      messages: persistentMessageController,
      getPairing: () => observerBridge?.getPairing?.() || null,
      getConversationId: () => deps.currentChatId?.() || '',
      request: typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest : null
    }) || null;
    taskActivityMonitor = deps.createTaskActivityMonitor?.({
      messages: persistentMessageController,
      getPairing: () => observerBridge?.getPairing?.() || null,
      getConversationId: () => deps.currentChatId?.() || '',
      request: typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest : null,
      onStatus: scheduleUi
    }) || null;
    userMessageArchiveMonitor = deps.createUserMessageArchiveMonitor?.({
      messages: persistentMessageController,
      getPairing: () => observerBridge?.getPairing?.() || null,
      getConversationId: () => deps.currentChatId?.() || '',
      request: typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest : null
    }) || null;
    delayedSendController = deps.createDelayedSendController({
      onChange: scheduleUi,
      isGenerationActive: deps.isGenerating,
      isSendPipelineBusy: () => Boolean(queuedPromptController?.isWaitingToSend() || uploadController?.isConfirmingSend()),
      getAssistantSnapshot: deps.assistantSnapshot
    });
    const textboxProfileManager = deps.createTextboxProfileManager?.({
      getValue: typeof GM_getValue === 'function' ? GM_getValue : null,
      setValue: typeof GM_setValue === 'function' ? GM_setValue : null,
      onChange: scheduleUi
    }) || null;

    const sessionDispatchMonitor = deps.createSessionDispatchMonitor?.({
      getPairing: () => observerBridge?.getPairing?.() || null,
      getConversationId: () => deps.currentChatId?.() || '',
      request: typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest : null,
      queue: queuedPromptController, messages: persistentMessageController,
      profiles: textboxProfileManager,
      quickAction: ({mode,text,moduleIds,profileId,delayMs})=>
        uploadUi?.dispatchQuickAction?.(mode,text,moduleIds,profileId,delayMs) || {ok:false},
      findComposerContext: deps.findComposerContext,
      isGenerating: deps.isGenerating,
      canExecute: context => !uploadController.isArmed() &&
        !uploadController.isConfirmingSend() &&
        !delayedSendController?.isSending?.() &&
        !delayedSendController?.isCheckpointActive?.() &&
        !queuedPromptController?.hasQueued?.() &&
        !deps.composerHasUploadBusyEvidence?.(context.container || context.composer),
      report: () => scheduleUi()
    }) || null;
    textboxProfileManager?.requestCatalog();
    uploadUi = deps.createUploadButtonUi({ tabState, uploadController,
      queuedPromptController, delayedSendController, persistentMessageController,
      taskActivityMonitor, textboxProfileManager });
    let lastUrl = location.href;

    function recheckUploadSoon() {
      if (!uploadController?.isArmed()) return;
      uploadController.check();
      window.setTimeout(() => {
        if (uploadController?.isArmed()) uploadController.check();
      }, 250);
      window.setTimeout(() => {
        if (uploadController?.isArmed()) uploadController.check();
      }, 1200);
    }

    function handleFileInputEvent(event) {
      const input = event.target;
      if (typeof HTMLInputElement === 'undefined' || !(input instanceof HTMLInputElement) || input.type !== 'file') return;
      uploadController.rememberFileActivity(input.files);
      recheckUploadSoon();
    }

    document.addEventListener('input', handleFileInputEvent, true);
    document.addEventListener('change', handleFileInputEvent, true);

    document.addEventListener('drop', event => {
      if (!event.dataTransfer?.files?.length) return;
      uploadController.rememberFileActivity(event.dataTransfer.files);
      recheckUploadSoon();
    }, true);

    document.addEventListener('paste', event => {
      if (!event.clipboardData?.files?.length) return;
      uploadController.rememberFileActivity(event.clipboardData.files);
      recheckUploadSoon();
    }, true);

    function observeManualDraftSend() {
      const context = deps.findComposerContext?.();
      if (!context?.composer?.isConnected ||
          !deps.isSendButtonReady?.(context.sendButton)) return;
      const editor = context.composer;
      const text = typeof HTMLTextAreaElement !== 'undefined' &&
        editor instanceof HTMLTextAreaElement ? editor.value :
        (typeof HTMLInputElement !== 'undefined' &&
         editor instanceof HTMLInputElement ? editor.value :
         (typeof editor.innerText === 'string' ? editor.innerText : editor.textContent));
      if (typeof text !== 'string') return;
      persistentMessageController?.recordManualDraftSend?.(text, {
        fileNameVisible: name => Boolean(
          deps.fileAttachmentVisible?.(context.container || editor, name) &&
          !deps.composerHasUploadBusyEvidence?.(context.container || editor, [name]))
      });
    }

    document.addEventListener('click', event => {
      if (!deps.isComposerSendButton(event.target)) return;
      if (event.isTrusted) observeManualDraftSend();
      responseMonitor.armAnswer('send-button');
    }, true);

    document.addEventListener('keydown', event => {
      if (
        event.key === 'Enter' && !event.isComposing && !event.shiftKey && !event.ctrlKey &&
        !event.altKey && !event.metaKey && deps.isComposerTarget(event.target)
      ) {
        if (event.isTrusted) observeManualDraftSend();
        responseMonitor.armAnswer('enter-key');
      }
    }, true);

    document.addEventListener('submit', event => {
      if (typeof HTMLFormElement === 'undefined' || !(event.target instanceof HTMLFormElement)) return;
      if (!deps.COMPOSER_SELECTORS.some(selector => event.target.querySelector(selector))) return;
      if (event.isTrusted) observeManualDraftSend();
      responseMonitor.armAnswer('form-submit');
    }, true);

    function markViewed() {
      tabState.markViewed();
      responseMonitor.check();
    }

    function handleForeground() {
      markViewed();
      recheckUploadSoon();
      delayedSendController?.check();
      scheduleUi();
    }

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) handleForeground();
    });
    window.addEventListener('focus', handleForeground);
    window.addEventListener('pageshow', handleForeground);
    window.addEventListener('resize', scheduleUi, { passive: true });
    window.addEventListener('scroll', scheduleUi, { passive: true, capture: true });

    function resetForNavigation() {
      lastUrl = location.href;
      responseMonitor.resetForNavigation();
      observerBridge?.resetForNavigation();
      uploadController.reset({ clearMark: true, render: false });
      uploadController.resetFileHistory();
      queuedPromptController.resetForNavigation();
      delayedSendController?.resetForNavigation();
      uploadUi.closeQueuePanel?.();
      uploadUi.resetLargePasteDraft?.();
      tabState.resetForNavigation();
      setTimeout(responseMonitor.check, 400);
    }

    const uiObserver = new MutationObserver(() => {
      if (!document.hidden) scheduleUi();
      if (uploadController.isArmed()) uploadController.check();
    });
    uiObserver.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        'data-testid', 'data-is-streaming', 'data-state', 'data-uploading', 'data-loading',
        'aria-busy', 'aria-disabled', 'disabled', 'aria-label'
      ]
    });

    const titleNode = document.querySelector('title');
    if (titleNode) {
      new MutationObserver(() => tabState.handleExternalTitle(document.title))
        .observe(titleNode, { childList: true, characterData: true, subtree: true });
    }

    let tickCount = 0;
    const interval = setInterval(() => {
      if (location.href !== lastUrl) resetForNavigation();
      responseMonitor.check();
      uploadController.check();
      delayedSendController?.check();
      queuedPromptController.attemptSend();
      tickCount += 1;
      if (tickCount % 8 === 0) {
        observerBridge?.check(); taskIntentMonitor?.check(); taskActivityMonitor?.check(); userMessageArchiveMonitor?.check();
        sessionDispatchMonitor?.check();
      }
      if (!document.hidden && tickCount % 6 === 0) scheduleUi();
    }, deps.SETTINGS.checkIntervalMs);

    if (typeof GM_registerMenuCommand === 'function') {
      GM_registerMenuCommand(`ℹ Версия: v${deps.SCRIPT_VERSION}`, () => console.info(`[ChatGPT notifier] v${deps.SCRIPT_VERSION}`));
      GM_registerMenuCommand('◷ Чекпоинт по таймеру', delayedSendController.toggleCheckpoint);
      GM_registerMenuCommand('⇧ Автоотправка после загрузки файлов', uploadController.toggle);
      GM_registerMenuCommand('● Проверить уведомление', notifications.showDesktopNotification);
      if (observerBridge) {
        GM_registerMenuCommand('Fortis: привязать текущий чат', observerBridge.pairCurrent);
        GM_registerMenuCommand('Fortis: отключить текущий чат', observerBridge.unpairCurrent);
      }
      if (completionModes) {
        GM_registerMenuCommand('Fortis: переключить DOM (начало и конец)', completionModes.toggleDom);
        GM_registerMenuCommand('Fortis: переключить Observatory (начало и конец)', completionModes.toggleObservatory);
        GM_registerMenuCommand('Fortis: показать источники состояния', completionModes.showStatus);
      }
    }

    tabState.render();
    responseMonitor.check();
    observerBridge?.check();
    taskIntentMonitor?.check();
    taskActivityMonitor?.check();
    userMessageArchiveMonitor?.check();
    sessionDispatchMonitor?.check();
    scheduleUi();
    console.info(`[ChatGPT notifier] v${deps.SCRIPT_VERSION} запущен. Перетаскиваемые кнопки: ◷ — чекпоинт по таймеру, + — очередь/отложенные, ⇧ — автоотправка файлов.`);

    return {
      dispose() {
        clearInterval(interval);
        uiObserver.disconnect();
        taskIntentMonitor?.dispose();
      },
      tabState,
      uploadController,
      queuedPromptController,
      persistentMessageController,
      taskActivityMonitor,
      taskIntentMonitor,
      userMessageArchiveMonitor,
      sessionDispatchMonitor,
      delayedSendController,
      responseMonitor,
      uploadUi
    };
  }

  return { startTabNotifier };
});
