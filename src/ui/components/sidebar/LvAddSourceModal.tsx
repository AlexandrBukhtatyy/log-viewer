import { useEffect, useState } from 'react';

export interface LvAddSourceFormData {
  readonly handle: FileSystemDirectoryHandle;
  readonly name: string;
  readonly watch: boolean;
  readonly glob: string | null;
  /**
   * Parser override (Phase 2.B). `undefined` ⇒ auto-detect. Otherwise
   * `registry.pickById(parserId)` wins over the first-line sniff.
   */
  readonly parserId?: string;
}

export interface LvAddSourceModalProps {
  readonly open: boolean;
  /**
   * Pre-toggles the "Watch for changes" switch when the user opened the
   * modal via the "Watch folder…" entry rather than "Local folder…".
   */
  readonly initialWatch?: boolean;
  /**
   * Names of sources already in the workspace. Used to surface an inline
   * "name already in use" error and to suggest a free default
   * (`folder`, `folder (2)`, `folder (3)`, …) when the picked folder
   * collides with an existing source.
   */
  readonly existingNames?: ReadonlySet<string>;
  /**
   * Parsers known to the worker registry — populates the parser-override
   * dropdown (Phase 2.B). Provider feeds this from `coordinator.listParsers()`.
   */
  readonly parsers?: ReadonlyArray<{ readonly id: string }>;
  onClose: () => void;
  onSubmit: (data: LvAddSourceFormData) => void;
}

/** First free `name`, `name (2)`, `name (3)`… not in `taken`. */
const suggestFreeName = (base: string, taken: ReadonlySet<string>): string => {
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base} (${i})`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base} (${Date.now()})`;
};

/**
 * Single-step "Add log source" form. Currently supports the local-folder
 * kind (static + watched). Other kinds (snapshot/stream/ssh/cloud/k8s/bus/db)
 * still fall through to the legacy `prompt`-flow in `LvAppContainer.onAddRoot`
 * — the modal is structured so future kinds can be added behind a "Type"
 * select without a redesign.
 */
export const LvAddSourceModal = ({
  open,
  initialWatch = false,
  existingNames,
  parsers,
  onClose,
  onSubmit,
}: LvAddSourceModalProps) => {
  const taken = existingNames ?? new Set<string>();
  const [handle, setHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [watch, setWatch] = useState(initialWatch);
  const [glob, setGlob] = useState('');
  const [pickerError, setPickerError] = useState<string | null>(null);
  // 'auto' means "let the worker pick" (legacy behaviour); any other
  // value is a parser id from `parsers`. Stored as plain string so the
  // <select> stays uncontroversial; we translate 'auto' → undefined on
  // submit so the orchestrator's auto-detect path kicks in.
  const [parserChoice, setParserChoice] = useState<string>('auto');

  // Derived-state reset: when the modal transitions from closed → open
  // (or initialWatch flips between calls), wipe the form. Done as a
  // signature-compare during render to avoid the cascading-render lint
  // on a setState-in-effect.
  const [prevOpenSig, setPrevOpenSig] = useState('closed');
  const openSig = open ? `open|${initialWatch ? '1' : '0'}` : 'closed';
  if (openSig !== prevOpenSig) {
    setPrevOpenSig(openSig);
    if (open) {
      setHandle(null);
      setName('');
      setNameTouched(false);
      setWatch(initialWatch);
      setGlob('');
      setPickerError(null);
      setParserChoice('auto');
    }
  }

  const trimmedName = name.trim();
  const effectiveName = trimmedName.length > 0 ? trimmedName : (handle?.name ?? '');
  const nameTaken = effectiveName.length > 0 && taken.has(effectiveName);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const chooseFolder = async () => {
    setPickerError(null);
    if (typeof window === 'undefined' || !window.showDirectoryPicker) {
      setPickerError('File System Access API not supported in this browser.');
      return;
    }
    try {
      const picked = await window.showDirectoryPicker({ mode: 'read' });
      setHandle(picked);
      // Auto-fill name once; preserve user edits afterwards. If the picked
      // folder name collides with an existing source, suggest the next free
      // `name (2)`/`(3)` so the user starts from a valid default.
      if (!nameTouched) setName(suggestFreeName(picked.name, taken));
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setPickerError(err instanceof Error ? err.message : String(err));
    }
  };

  const submit = () => {
    if (handle === null) return;
    if (nameTaken) return;
    const finalName = effectiveName;
    const finalGlob = glob.trim();
    onSubmit({
      handle,
      name: finalName,
      watch,
      glob: finalGlob.length > 0 ? finalGlob : null,
      parserId: parserChoice === 'auto' ? undefined : parserChoice,
    });
  };

  if (!open) return null;

  return (
    <>
      <div className="lv-modal-scrim" onClick={onClose} />
      <div
        className="lv-modal lv-add-src-modal"
        role="dialog"
        aria-label="Add source"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="lv-modal-hd">
          <span>Add log source</span>
          <button type="button" className="lv-modal-x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="lv-modal-body">
          <div className="lv-form-row">
            <label className="lv-form-label" htmlFor="lv-add-src-name">
              Source name
            </label>
            <div className="lv-form-field">
              <input
                id="lv-add-src-name"
                type="text"
                className={`lv-form-input${nameTaken ? ' lv-form-input-error' : ''}`}
                placeholder={handle?.name ?? 'Folder display name'}
                value={name}
                aria-invalid={nameTaken}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameTouched(true);
                }}
              />
              {nameTaken && (
                <span className="lv-form-error">
                  A source named “{effectiveName}” already exists.
                </span>
              )}
            </div>
          </div>

          <div className="lv-form-row">
            <label className="lv-form-label">Type</label>
            <select className="lv-form-input" value="local-folder" disabled>
              <option value="local-folder">Local folder</option>
            </select>
          </div>

          <div className="lv-form-row">
            <label className="lv-form-label">Watch</label>
            <label className="lv-form-toggle">
              <input
                type="checkbox"
                checked={watch}
                onChange={(e) => setWatch(e.target.checked)}
              />
              <span className="lv-switch" aria-hidden="true">
                <span className="lv-switch-thumb" />
              </span>
              <span>Watch for changes</span>
              <span className="lv-form-toggle-hint">
                tail new entries as files grow
              </span>
            </label>
          </div>

          <div className="lv-form-row">
            <label className="lv-form-label">Folder</label>
            <div className="lv-form-folder">
              <button
                type="button"
                className="lv-btn lv-btn-secondary"
                onClick={() => void chooseFolder()}
              >
                {handle ? 'Change folder…' : 'Choose folder…'}
              </button>
              <span
                className={`lv-form-folder-name${handle ? '' : ' is-empty'}`}
                title={handle?.name}
              >
                {handle?.name ?? 'No folder selected'}
              </span>
            </div>
            {pickerError && <span className="lv-form-error">{pickerError}</span>}
          </div>

          <div className="lv-form-row">
            <label className="lv-form-label" htmlFor="lv-add-src-glob">
              Glob
            </label>
            <input
              id="lv-add-src-glob"
              type="text"
              className="lv-form-input"
              placeholder="*.log (optional)"
              value={glob}
              onChange={(e) => setGlob(e.target.value)}
            />
          </div>

          <div className="lv-form-row">
            <label className="lv-form-label" htmlFor="lv-add-src-parser">
              Parser
            </label>
            <select
              id="lv-add-src-parser"
              className="lv-form-input"
              value={parserChoice}
              onChange={(e) => setParserChoice(e.target.value)}
            >
              <option value="auto">Auto-detect</option>
              {(parsers ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="lv-modal-ft lv-modal-ft-actions">
          <button type="button" className="lv-btn lv-btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="lv-btn lv-btn-primary"
            onClick={submit}
            disabled={handle === null || nameTaken}
          >
            Add
          </button>
        </div>
      </div>
    </>
  );
};
