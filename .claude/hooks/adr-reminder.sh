#!/usr/bin/env bash
# Stop-hook: напоминает создать ADR, если в последнем ответе модели похоже было
# принято архитектурное решение, но docs/adr/ в этой сессии не обновлялся.
#
# Контракт Stop-hook'а:
#   - читаем JSON из stdin: { session_id, transcript_path, stop_hook_active, ... }
#   - exit 0 — позволить остановку
#   - exit 2 + текст в stderr — заблокировать остановку, текст уйдёт обратно модели
#
# Эвристика намеренно дешёвая (grep по ключевым словам). Брittle by design —
# лучше иногда срабатывать ложно, чем пропустить решение.

set -euo pipefail

# Мягкая деградация: без jq хук просто молчит.
command -v jq >/dev/null 2>&1 || exit 0

INPUT="$(cat)"
STOP_HOOK_ACTIVE="$(printf '%s' "$INPUT" | jq -r '.stop_hook_active // false')"
TRANSCRIPT="$(printf '%s' "$INPUT" | jq -r '.transcript_path // empty')"

# Защита от рекурсии: если хук уже сработал в этом турне — больше не блокируем.
[[ "$STOP_HOOK_ACTIVE" == "true" ]] && exit 0

# Без транскрипта работать не с чем.
[[ -n "$TRANSCRIPT" && -f "$TRANSCRIPT" ]] || exit 0

# Если в этой сессии уже был Edit/Write на путь docs/adr/ — ADR создан, выходим.
if jq -r 'select(.message.content?) | .message.content[]? | select(.type=="tool_use") | .input.file_path? // empty' "$TRANSCRIPT" 2>/dev/null \
    | grep -q 'docs/adr/'; then
  exit 0
fi

# Текст последнего сообщения ассистента из JSONL-транскрипта.
LAST="$(jq -rs '
  map(select(.type=="assistant"))
  | last
  | .message.content // []
  | map(select(.type=="text") | .text)
  | join("\n")
' "$TRANSCRIPT" 2>/dev/null || true)"

[[ -n "$LAST" ]] || exit 0

# Маркеры архитектурного решения (RU + EN).
PATTERN='архитектур|выбираем|выбрал|остановились на|решили использовать|вместо .* (использу|возьм)|стек технолог|migrat(e|ion) to|switch(ed)? to|adopt(ed)?|trade.?off|decided to (use|adopt|migrate|switch|go with)|chose .* over|going with'

if printf '%s' "$LAST" | grep -qiE "$PATTERN"; then
  cat <<'EOF' >&2
ADR check: в последнем ответе похоже принято архитектурное решение, но docs/adr/ в этой сессии не обновлялся.

Зафиксируй его одним из способов:
  - вызови команду /adr <короткое описание>;
  - либо создай файл docs/adr/NNNN-<slug>.md вручную по шаблону docs/adr/0000-template.md;
  - либо ответь явно «не ADR», и завершай турн.
EOF
  exit 2
fi

exit 0
