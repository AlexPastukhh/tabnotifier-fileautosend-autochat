(function (root, factory) {
  const api = factory(root.ChatGPTTabNotifier || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ChatGPTTabNotifier = Object.assign(root.ChatGPTTabNotifier || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  'use strict';

  function startTabNotifier() {
    let uploadUi = null;
    const tabState = deps.createTabStateController({ scheduleUiUpdate: () => uploadUi?.schedule() });
    const notifications = deps.createNotificationService(tabState);
    let uploadController = null;
    const responseMonitor = deps.createResponseMonitor({
      tabState,
      notifications,
      beforeArm: () => {
        if (tabState.isUploadMarked() || uploadController?.isArmed()) {
          uploadController?.reset({ clearMark: true, render: false });
        }
      }
    });

    uploadController = deps.createUploadAutoSendController({ tabState });
    uploadUi = deps.createUploadButtonUi({ tabState, uploadController });
    let lastUrl = location.href;

    document.addEventListener('change', event => {
      const input = event.target;
      if (typeof HTMLInputElement === 'undefined' || !(input instanceof HTMLInputElement) || input.type !== 'file') return;
      uploadController.rememberFileActivity(input.files);
      if (uploadController.isArmed()) uploadController.check();
    }, true);

    document.addEventListener('drop', event => {
      if (!event.dataTransfer?.files?.length) return;
      uploadController.rememberFileActivity(event.dataTransfer.files);
      if (uploadController.isArmed()) uploadController.check();
    }, true);

    document.addEventListener('paste', event => {
      if (!event.clipboardData?.files?.length) return;
      uploadController.rememberFileActivity(event.clipboardData.files);
      if (uploadController.isArmed()) uploadController.check();
    }, true);

    document.addEventListener('click', event => {
      if (deps.isComposerSendButton(event.target)) responseMonitor.armAnswer('send-button');
    }, true);

    document.addEventListener('keydown', event => {
      if (
        event.key === 'Enter' && !event.isComposing && !event.shiftKey && !event.ctrlKey &&
        !event.altKey && !event.metaKey && deps.isComposerTarget(event.target)
      ) responseMonitor.armAnswer('enter-key');
    }, true);

    document.addEventListener('submit', event => {
      if (typeof HTMLFormElement === 'undefined' || !(event.target instanceof HTMLFormElement)) return;
      if (deps.COMPOSER_SELECTORS.some(selector => event.target.querySelector(selector))) responseMonitor.armAnswer('form-submit');
    }, true);

    function markViewed() {
      tabState.markViewed();
      responseMonitor.check();
    }

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        markViewed();
        uploadUi.schedule();
      }
    });
    window.addEventListener('focus', markViewed);
    window.addEventListener('resize', uploadUi.schedule, { passive: true });
    window.addEventListener('scroll', uploadUi.schedule, { passive: true, capture: true });

    function resetForNavigation() {
      lastUrl = location.href;
      responseMonitor.resetForNavigation();
      uploadController.reset({ clearMark: true, render: false });
      uploadController.resetFileHistory();
      tabState.resetForNavigation();
      setTimeout(responseMonitor.check, 400);
    }

    const uiObserver = new MutationObserver(() => {
      if (!document.hidden) uploadUi.schedule();
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
      tickCount += 1;
      if (!document.hidden && tickCount % 6 === 0) uploadUi.schedule();
    }, deps.SETTINGS.checkIntervalMs);

    if (typeof GM_registerMenuCommand === 'function') {
      GM_registerMenuCommand('⇧ Автоотправка после загрузки файлов', uploadController.toggle);
      GM_registerMenuCommand('● Проверить уведомление', notifications.showDesktopNotification);
    }

    tabState.render();
    responseMonitor.check();
    console.info('[ChatGPT notifier] v5.0 запущен. Исходники модульные; userscript собран автоматически.');

    return {
      dispose() {
        clearInterval(interval);
        uiObserver.disconnect();
      },
      tabState,
      uploadController,
      responseMonitor,
      uploadUi
    };
  }

  return { startTabNotifier };
});
