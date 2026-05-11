export interface LvEmptyProps {
  /**
   * `true` when there is at least one source in the sidebar (the
   * user just hasn't picked any). `false` when the catalog itself
   * is empty — drives the CTA copy.
   */
  readonly hasAnySource: boolean;
  /**
   * Called when the user clicks "+ Add source" in the empty-state
   * card (only rendered when the catalog is empty).
   */
  onAddSource?: () => void;
}

export const LvEmpty = ({ hasAnySource, onAddSource }: LvEmptyProps) => (
  <div className="lv-empty">
    <div className="lv-empty-card">
      <div className="lv-empty-ico">
        <svg viewBox="0 0 40 40" width="40" height="40">
          <rect
            x="4"
            y="6"
            width="32"
            height="28"
            rx="2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
          />
          <path
            d="M10 12 H30 M10 17 H26 M10 22 H30 M10 27 H22"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
      </div>
      {hasAnySource ? (
        <>
          <div className="lv-empty-title">Select a source to view logs</div>
          <div className="lv-empty-sub">
            Pick a file or folder on the left. Hold{' '}
            <span className="lv-kbd">⌘</span> to select several at once.
          </div>
        </>
      ) : (
        <>
          <div className="lv-empty-title">No sources yet</div>
          <div className="lv-empty-sub">
            Add a log file, folder, or stream to get started.
          </div>
          {onAddSource && (
            <button
              type="button"
              className="lv-btn lv-btn-primary lv-empty-cta"
              onClick={onAddSource}
            >
              + Add source
            </button>
          )}
        </>
      )}
    </div>
  </div>
);
