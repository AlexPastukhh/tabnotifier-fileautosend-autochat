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
    let delayedSendController = null;

    function scheduleUi() {
      uploadUi?.schedule();
    }

    const tabState = deps.createTabStateController({ scheduleUiUpdate: scheduleUi });
    const notifications = deps.createNotificationService(tabState);

    const responseMonitor = deps.createResponseMonitor({
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
      onFinished: () => {
        delayedSendController?.check();
        if (!delayedSendController?.isSending?.() && !delayedSendController?.hasDueWork?.()) {
          queuedPromptController?.handleResponseFinished();
        }
      }
    });

    uploadController = deps.createUploadAutoSendController({ tabState, isGenerationActive: deps.isGenerating });
    queuedPromptController = deps.createQueuedPromptController({ onChange: scheduleUi });
    delayedSendController = deps.createDelayedSendController({
      onChange: scheduleUi,
      isGenerationActive: deps.isGenerating,
      isSendPipelineBusy: () => Boolean(queuedPromptController?.isWaitingToSend() || uploadController?.isConfirmingSend())
    });
    uploadUi = deps.createUploadButtonUi({ tabState, uploadController, queuedPromptController, delayedSendController });
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

    document.addEventListener('click', event => {
      if (!deps.isComposerSendButton(event.target)) return;
      responseMonitor.armAnswer('send-button');
    }, true);

    document.addEventListener('keydown', event => {
      if (
        event.key === 'Enter' && !event.isComposing && !event.shiftKey && !event.ctrlKey &&
        !event.altKey && !event.metaKey && deps.isComposerTarget(event.target)
      ) {
        responseMonitor.armAnswer('enter-key');
      }
    }, true);

    document.addEventListener('submit', event => {
      if (typeof HTMLFormElement === 'undefined' || !(event.target instanceof HTMLFormElement)) return;
      if (!deps.COMPOSER_SELECTORS.some(selector => event.target.querySelector(selector))) return;
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
      uploadController.reset({ clearMark: true, render: false });
      uploadController.resetFileHistory();
      queuedPromptController.resetForNavigation();
      delayedSendController?.resetForNavigation();
      uploadUi.closeQueuePanel?.();
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
      if (!document.hidden && tickCount % 6 === 0) scheduleUi();
    }, deps.SETTINGS.checkIntervalMs);

    if (typeof GM_registerMenuCommand === 'function') {
      GM_registerMenuCommand(`ℹ Версия: v${deps.SCRIPT_VERSION}`, () => console.info(`[ChatGPT notifier] v${deps.SCRIPT_VERSION}`));
      GM_registerMenuCommand('◷ Чекпоинт по таймеру', delayedSendController.toggleCheckpoint);
      GM_registerMenuCommand('⇧ Автоотправка после загрузки файлов', uploadController.toggle);
      GM_registerMenuCommand('● Проверить уведомление', notifications.showDesktopNotification);
    }

    tabState.render();
    responseMonitor.check();
    scheduleUi();
    console.info(`[ChatGPT notifier] v${deps.SCRIPT_VERSION} запущен. Перетаскиваемые кнопки: ◷ — чекпоинт по таймеру, + — очередь/отложенные, ⇧ — автоотправка файлов.`);

    return {
      dispose() {
        clearInterval(interval);
        uiObserver.disconnect();
      },
      tabState,
      uploadController,
      queuedPromptController,
      delayedSendController,
      responseMonitor,
      uploadUi
    };
  }

  return { startTabNotifier };
});
