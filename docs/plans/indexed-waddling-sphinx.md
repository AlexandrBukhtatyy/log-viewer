# Центрирование omni-кнопки в шапке

## Контекст

На больших экранах поле «Search files, lines, or run a command…» в
[LvTitlebar.tsx](../../src/ui/components/topbar/LvTitlebar.tsx) визуально
смещено левее центра. Причина — текущая раскладка
[lv.css:121-153](../../src/ui/styles/lv.css#L121-L153) сделана через
`display:flex` с порядком `[left][omni flex:1 max-width:560 margin:0 auto][right margin-left:auto]`.

При непустом `.lv-tb-left` (дотсы + меню) и пустом `.lv-tb-right` margin-auto
у omni и автомаргин у right делят оставшееся пространство симметрично между
собой, но не относительно центра тайтлбара. Чем шире окно, тем заметнее
сдвиг от геометрического центра.

## Решение

Перевести `.lv-titlebar` на CSS Grid из трёх колонок
`1fr minmax(0, 560px) 1fr`. Это:

- даёт omni всегда сидеть в средней колонке, которая центрирована
  геометрически;
- ограничивает её ширину `560px` (как сейчас);
- сжимает её до 0 при очень узком экране (`minmax(0, …)`);
- сохраняет левый и правый блоки у соответствующих краёв через
  `justify-self`.

Параллельно убираем из `.lv-tb-omni` `flex:1`, `max-width`, `margin:0 auto`
(теперь это контракт grid-контейнера) и `margin-left:auto` у `.lv-tb-right`.

## Файл

[src/ui/styles/lv.css](../../src/ui/styles/lv.css) — правки в трёх правилах:

```css
.lv-titlebar{
  display:grid;
  grid-template-columns: 1fr minmax(0, 560px) 1fr;
  align-items:center;
  gap:12px;
  padding:0 10px;
  background:var(--lv-bg-titlebar);
  border-bottom:1px solid var(--lv-border);
  -webkit-app-region: drag;
  user-select:none;
}

.lv-tb-omni{
  -webkit-app-region: no-drag;
  width:100%;
  display:flex; align-items:center; gap:8px;
  height:24px; padding:0 8px 0 10px;
  background:var(--lv-bg-2); border:1px solid var(--lv-border);
  border-radius:6px; color:var(--lv-fg-2); font-size:12px;
  cursor:text;
}

.lv-tb-right{ justify-self:end; display:flex; gap:4px; -webkit-app-region: no-drag }
```

Изменения по сути:

- `.lv-titlebar`: `flex` → `grid` с `grid-template-columns`.
- `.lv-tb-omni`: удалить `flex:1`, `max-width:560px`, `margin:0 auto`,
  добавить `width:100%` (чтобы заполнить среднюю колонку).
- `.lv-tb-right`: убрать `margin-left:auto`, добавить `justify-self:end`.

JSX-структура [LvTitlebar.tsx](../../src/ui/components/topbar/LvTitlebar.tsx)
не меняется — три ребёнка точно ложатся на три grid-колонки.

## Проверка

1. `pnpm dev`, открыть на полноэкранном/широком окне — omni-кнопка
   ровно по центру тайтлбара (визуально и по DevTools: `(width − omniWidth)/2`
   слева и справа).
2. Сжать окно до ~600px — omni сжимается, не вылезает за левую/правую
   колонки, дотсы и меню остаются у левого края.
3. Hover, ⌘K, фокус — без изменений (стили `:hover` и `.lv-kbd` затронуты не были).
4. `pnpm build && pnpm preview` — раскладка идентична dev.
