# Notifier 5.7.33 — DRY workflow candidate

**SOURCE-ONLY CANDIDATE. NOT INSTALLED, NOT LOADED BY EDGE.** Prepared 2026-10-24 from the locally committed, tested 5.7.32 source. Current main source and Tampermonkey Loader were not modified by this package.

## Included

- `chatgpt-tab-notifier.user.js`: complete generated v5.7.33 userscript.
- `notifier-unified-workflow.patch`: clean unified diff against the v5.7.32 source at local commit `d896b8fdc8f9f2fcec536058dbfbe297ddd256c6`.
- `src/`, `tests/`, `package.json` and `manifest.json`: exact candidate changes and SHA-256 checksums.

## Behavior

The always-visible right-hand Notifier Textbox now exposes **Файл**, **Вставить**, **Нажать Send**. File and Insert prepare the original/context with a verified task_id and do **not** click Send. Native Send checks the exact unchanged prepared draft; File additionally requires the visible, no-longer-busy attachment card. Send is one attempt, never a retry, and does not claim ChatGPT delivery. The old Enter shortcut in this textbox no longer submits. After a confirmed local click, the prepared quick original is cleared **only if the same text and chat are still present**; the Tampermonkey GM original remains saved. The existing '+' panel and delayed-send features are preserved.

The local GM history shows full original text through **Просмотреть**, **Восстановить** (no Send and never overwrites a non-empty quick editor), **Копировать**, and **TXT** export. A large restored original uses the existing memory-safe large-text preview rather than placing 500+KB into the textarea.

Owner dispatch `mode=send` uses the same File→context→one-shot native Send pipeline with a bounded delay after the file card is verified. The status UI displays a separate DOM marker when the archive reports `completed` but the browser still observes ChatGPT generation.

## Verification

- Node `npm run verify`: **288/288 PASS**, generated file matches 22 modules.
- `git apply --check candidates/unified-workflow-5.7.33-20261024/notifier-unified-workflow.patch`: **PASS** against committed 5.7.32.
- Live Edge, true ChatGPT Send, installer, long-file recovery after actual browser restart, cross-profile pairing: **NOT VERIFIED**.

## Application (source only, not yet advised for live Loader)

From the repository root, first inspect `manifest.json` and run `git apply --check candidates/unified-workflow-5.7.33-20261024/notifier-unified-workflow.patch`. The matching Observatory V1 candidate must be considered together; an uncoordinated change of only the Notifier can cause protocol refusal. To apply to source (only after owner acceptance and version check), use `git apply candidates/unified-workflow-5.7.33-20261024/notifier-unified-workflow.patch` and `npm run verify`; take a backup before changing the active Loader target. No install was run.

**Not yet included:** arbitrary user-selected Windows attachments, Explorer Ctrl+C/Ctrl+V binary bridge, full live Edge acceptance. Those require a protected file-capability protocol and independent negative-security tests. Do not claim them ready or silently substitute direct server path reads.
