import type { LvLogEntry } from '../../contracts/lv-types.ts';
import { lvFmtTime } from '../../utils/lv-format.ts';

export interface LvBookmarksPanelProps {
  readonly bookmarks: ReadonlySet<string>;
  readonly allEntries: Readonly<Record<string, LvLogEntry>>;
  onJump: (entry: LvLogEntry) => void;
  onRemove: (id: string) => void;
}

export const LvBookmarksPanel = ({
  bookmarks,
  allEntries,
  onJump,
  onRemove,
}: LvBookmarksPanelProps) => {
  const list = Array.from(bookmarks)
    .map((id) => allEntries[id])
    .filter((e): e is LvLogEntry => !!e);
  return (
    <aside className="lv-sidebar">
      <div className="lv-sb-hd">
        <div className="lv-sb-title">
          <span className="lv-sb-title-text">Bookmarks</span>
          <span className="lv-sb-count">{list.length}</span>
        </div>
      </div>
      {list.length === 0 ? (
        <div className="lv-bm-empty">
          <div className="lv-bm-empty-title">No bookmarks yet.</div>
          <div className="lv-bm-empty-sub">Click the flag on any log line to pin it here.</div>
        </div>
      ) : (
        <div className="lv-bm-list">
          {list.map((e) => (
            <div
              key={e.id}
              className={`lv-bm-item lv-level-${e.level}`}
              onClick={() => onJump(e)}
            >
              <span className={`lv-bm-dot lv-level-tag-${e.level}`} />
              <div className="lv-bm-body">
                <div className="lv-bm-msg">{e.msg}</div>
                <div className="lv-bm-meta">
                  <span>{e.file}</span>
                  <span className="lv-bm-sep">·</span>
                  <span>:{e.line}</span>
                  <span className="lv-bm-sep">·</span>
                  <span>{lvFmtTime(e.ts, false)}</span>
                </div>
              </div>
              <button
                type="button"
                className="lv-bm-x"
                onClick={(ev) => {
                  ev.stopPropagation();
                  onRemove(e.id);
                }}
                aria-label="Remove"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
};
