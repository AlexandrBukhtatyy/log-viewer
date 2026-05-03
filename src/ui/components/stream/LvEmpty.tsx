export const LvEmpty = () => (
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
      <div className="lv-empty-title">Pick files from the catalog</div>
      <div className="lv-empty-sub">
        Select one or more logs on the left to start searching and filtering. Hold{' '}
        <span className="lv-kbd">⌘</span> to pick several.
      </div>
      <div className="lv-empty-tip">Tip: select a whole folder to stream every file inside it.</div>
    </div>
  </div>
);
