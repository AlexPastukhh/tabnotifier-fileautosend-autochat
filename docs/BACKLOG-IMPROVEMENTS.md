# Backlog improvements — ChatGPT Tab Notifier

Единственный backlog репозитория. Здесь будущая работа; инструкции выпуска и
проверки остаются в [README](../README.md) и исходниках. Запись задачи не
разрешает установку userscript, отправку сообщения или изменение GM storage.
Общие правила документации —
[UC-CONT-017](https://github.com/AlexPastukhh/fortis-container/blob/main/docs/use-cases/orientation.md#uc-cont-017).

## Приоритеты

- **Windows / Tampermonkey acceptance 5.7.35.** Проверить текущий Windows SHA,
  существующий Loader и runtime badge в целевом профиле; сохранить identity,
  grants, GM-данные и черновик. Проверить удержание положения панели, drag,
  resize, reload и несколько вкладок. Source tests не доказывают установку;
  не включать второй Notifier и не повторять Send ради smoke без отдельной цели.
- **Воспроизводимые проверки из task worktree и CI.** Два теста Helper используют
  canonical checkout `obs-planning-docs`; для чистого независимого CI нужен
  явный pinned test dependency или изолированная fixture. Не делать вид, что
  `npm run verify` не зависит от соседнего checkout; не копировать runtime
  Helper в этот repo без определения владельца. GitHub Actions пока не запускался.
- **Короткий вход и карта исходников.** Сократить растущий README до навигации,
  source/runtime boundaries и инструкции обновления; историю релизов вынести
  в отдельный архив с сохранением ссылок. Это будущая редактура, не второй
  changelog или дублирующий backlog.

## Выполненный этап

Исторические изменения 5.7.35 перенесены из dirty primary в registered task
worktree, опубликованы через Gateway и приняты в PR #13. Docker primary снова
чистый `main`. Windows/browser deployment подтверждается отдельно.
