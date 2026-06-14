import type { LogEntry } from '../../../core/types/index.ts';
import type { LvFileNode } from '../../contracts/lv-types.ts';
import { lvFmtTime } from '../../utils/lv-format.ts';

export interface LvBookmarksPanelProps {
  readonly bookmarks: ReadonlySet<string>;
  readonly allEntries: Readonly<Record<string, LogEntry>>;
  /** Lookup for source metadata (file name) keyed by sourceId. */
  readonly filesById: Readonly<Record<string, LvFileNode>>;
  onJump: (entry: LogEntry) => void;
  onRemove: (id: string) => void;
}

export const LvBookmarksPanel = ({
  bookmarks,
  allEntries,
  filesById,
  onJump,
  onRemove,
}: LvBookmarksPanelProps) => {
  const list = Array.from(bookmarks)
    .map((id) => allEntries[id])
    .filter((e): e is LogEntry => !!e);
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
          <div className="lv-bm-empty-sub">
            Click the flag on any log line to pin it here.
          </div>
        </div>
      ) : (
        <div className="lv-bm-list">
          {list.map((e) => {
            const file = filesById[e.sourceId];
            return (
              <div
                key={e.id}
                className={`lv-bm-item lv-level-${e.level}`}
                onClick={() => onJump(e)}
              >
                <span className={`lv-bm-dot lv-level-tag-${e.level}`} />
                <div className="lv-bm-body">
                  <div className="lv-bm-msg">{e.message}</div>
                  <div className="lv-bm-meta">
                    <span>{file?.name ?? e.sourceId}</span>
                    <span className="lv-bm-sep">·</span>
                    <span>:{e.seq}</span>
                    <span className="lv-bm-sep">·</span>
                    <span>{lvFmtTime(e.timestamp, false)}</span>
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
            );
          })}
        </div>
      )}
    </aside>
  );
};
