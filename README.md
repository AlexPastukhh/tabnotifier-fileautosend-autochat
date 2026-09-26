# ChatGPT Tab Notifier / File Auto-Send / Prompt Queue

Tampermonkey userscript for ChatGPT. Version 5.4.0 merges the message queue back into the newer floating/draggable control UI.

## What changed in 5.4.0

- The floating `+` is again the **custom message queue** button. It no longer proxies ChatGPT's native file-attachment `+`.
- The `+` and `⇧` controls keep the newer **drag-to-any-position** behavior; their saved position is restored from localStorage.
- The queue panel moves together with the draggable controls because it is hosted by the same floating UI.
- Restored queue features:
  - multiple queued prompts;
  - automatic send of the first queued prompt after the current ChatGPT answer finishes;
  - `▶` manual send of any queued item without pressing Stop;
  - `Отправить всё одним сообщением`;
  - `В очередь`;
  - `Из чата → очередь` (moves all text from the normal ChatGPT composer into the queue, then clears the normal composer);
  - reorder with `↑` / `↓` and drag-and-drop by `☰`;
  - delete queued items with `×`.
- The native ChatGPT attachment button remains native and can still be used for file selection. `⇧` only controls the existing file auto-send logic.
- Version `v5.4.0` is visible above the floating controls and in the queue panel.

## Install

Install `chatgpt-tab-notifier.user.js` in Tampermonkey.

## Development

```bash
npm test
npm run build
npm run verify
```

The installable userscript is generated from `src/**` by `build-userscript.mjs`.
