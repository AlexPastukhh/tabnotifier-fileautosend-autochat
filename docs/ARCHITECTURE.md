# Architecture

The project separates **authoritative source modules** from the **generated userscript artifact**.

```text
src/**
  ↓ build-userscript.mjs
chatgpt-tab-notifier.user.js
  ↓ Tampermonkey
browser runtime
```

Each source file uses a small UMD-style wrapper. In Node it exports through `module.exports`, which allows focused tests. In the browser it contributes its API to `globalThis.ChatGPTTabNotifier`. The build script concatenates modules in dependency order and appends one bootstrap call.

## Responsibilities

- `config.js`: all tunables and ChatGPT selectors in one place.
- `chatgpt-dom.js`: unstable ChatGPT DOM knowledge is isolated here so selector changes do not spread through behavior modules.
- `tab-state.js`: title/favicon/session persistence.
- `response-monitor.js`: answer lifecycle only.
- `upload-auto-send.js`: upload arm/readiness/send lifecycle only.
- `upload-button-ui.js`: rendering and positioning only.
- `runtime.js`: wiring and browser event ownership.

## Change rule

Behavior changes should be made in `src/**`, tested, then built. The generated userscript should never become a second source of truth.
