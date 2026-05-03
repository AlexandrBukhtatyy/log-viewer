// Lazy Monaco loader + React wrapper.
// Monaco is ~3MB — we load it from CDN on first demand and cache the promise.

(function () {
  const MONACO_VERSION = '0.52.0';
  const MONACO_BASE = `https://cdn.jsdelivr.net/npm/monaco-editor@${MONACO_VERSION}/min`;

  let loaderPromise = null;

  function ensureLoader() {
    if (window.monaco) return Promise.resolve(window.monaco);
    if (loaderPromise) return loaderPromise;
    loaderPromise = new Promise((resolve, reject) => {
      // Step 1: AMD loader
      const s = document.createElement('script');
      s.src = `${MONACO_BASE}/vs/loader.js`;
      s.async = true;
      s.onerror = () => reject(new Error('monaco loader failed'));
      s.onload = () => {
        try {
          window.require.config({ paths: { vs: `${MONACO_BASE}/vs` } });
          // Cross-origin workers: wrap via blob
          window.MonacoEnvironment = {
            getWorkerUrl: () => {
              const script = `self.MonacoEnvironment = { baseUrl: '${MONACO_BASE}/' };
importScripts('${MONACO_BASE}/vs/base/worker/workerMain.js');`;
              return `data:text/javascript;charset=utf-8,${encodeURIComponent(script)}`;
            },
          };
          window.require(['vs/editor/editor.main'], () => {
            try {
              defineThemes(window.monaco);
              registerLogLanguage(window.monaco);
              resolve(window.monaco);
            } catch (e) { reject(e); }
          }, reject);
        } catch (e) { reject(e); }
      };
      document.head.appendChild(s);
    });
    return loaderPromise;
  }

  function defineThemes(monaco) {
    // Dark theme tokens match our viewer palette
    monaco.editor.defineTheme('lv-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: '', foreground: 'E4E7EF' },
        { token: 'log.error', foreground: 'EF5E71', fontStyle: 'bold' },
        { token: 'log.warn', foreground: 'E5A942' },
        { token: 'log.info', foreground: '7AA2F7' },
        { token: 'log.debug', foreground: '8A93A8' },
        { token: 'log.trace', foreground: '5E667C' },
        { token: 'log.ts', foreground: '8B93A8' },
        { token: 'log.path', foreground: '73DACA' },
        { token: 'log.num', foreground: 'BB9AF7' },
        { token: 'log.str', foreground: 'A8D083' },
        { token: 'log.key', foreground: '7AA2F7' },
        { token: 'string.key.json', foreground: '7AA2F7' },
        { token: 'string.value.json', foreground: 'A8D083' },
        { token: 'number.json', foreground: 'BB9AF7' },
        { token: 'keyword.json', foreground: 'E5A942' },
      ],
      colors: {
        'editor.background': '#0f1117',
        'editor.foreground': '#e4e7ef',
        'editor.lineHighlightBackground': '#1a1f2e',
        'editor.lineHighlightBorder': '#1a1f2e',
        'editorLineNumber.foreground': '#3a4052',
        'editorLineNumber.activeForeground': '#8b93a8',
        'editorGutter.background': '#0f1117',
        'editorCursor.foreground': '#7aa2f7',
        'editor.selectionBackground': '#26304a',
        'editor.inactiveSelectionBackground': '#1f2636',
        'editor.findMatchBackground': 'rgba(245, 210, 110, 0.34)',
        'editor.findMatchHighlightBackground': 'rgba(245, 210, 110, 0.18)',
        'editorWidget.background': '#141824',
        'editorWidget.border': '#242b3d',
        'editorWidget.foreground': '#e4e7ef',
        'input.background': '#1a1f2e',
        'input.border': '#242b3d',
        'input.foreground': '#e4e7ef',
        'scrollbarSlider.background': '#2e365088',
        'scrollbarSlider.hoverBackground': '#2e3650cc',
        'scrollbarSlider.activeBackground': '#7aa2f788',
      },
    });

    monaco.editor.defineTheme('lv-light', {
      base: 'vs',
      inherit: true,
      rules: [
        { token: '', foreground: '1F2430' },
        { token: 'log.error', foreground: 'C93A4A', fontStyle: 'bold' },
        { token: 'log.warn', foreground: 'B97B1E' },
        { token: 'log.info', foreground: '2F6BD1' },
        { token: 'log.debug', foreground: '5A6177' },
        { token: 'log.trace', foreground: '868D9F' },
        { token: 'log.ts', foreground: '5A6177' },
        { token: 'log.path', foreground: '0E7C7B' },
        { token: 'log.num', foreground: '7A44C7' },
        { token: 'log.str', foreground: '3F7A1B' },
        { token: 'log.key', foreground: '2F6BD1' },
      ],
      colors: {
        'editor.background': '#ffffff',
        'editor.foreground': '#1f2430',
        'editor.lineHighlightBackground': '#f1f3f7',
        'editor.lineHighlightBorder': '#f1f3f7',
        'editorLineNumber.foreground': '#b5bbc7',
        'editorLineNumber.activeForeground': '#5a6177',
        'editorGutter.background': '#ffffff',
        'editor.selectionBackground': '#dce5f6',
        'editor.findMatchBackground': 'rgba(245, 180, 70, 0.36)',
        'editor.findMatchHighlightBackground': 'rgba(245, 180, 70, 0.18)',
        'editorWidget.background': '#ffffff',
        'editorWidget.border': '#dfe3ea',
      },
    });
  }

  function registerLogLanguage(monaco) {
    const id = 'lv-log';
    if (monaco.languages.getLanguages().some((l) => l.id === id)) return;
    monaco.languages.register({ id });
    monaco.languages.setMonarchTokensProvider(id, {
      tokenizer: {
        root: [
          // ISO timestamps
          [/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/, 'log.ts'],
          // level labels — match with following space/bracket
          [/\b(?:ERROR|ERR|FATAL)\b/, 'log.error'],
          [/\b(?:WARN|WARNING)\b/, 'log.warn'],
          [/\b(?:INFO|NOTICE)\b/, 'log.info'],
          [/\b(?:DEBUG|DBG)\b/, 'log.debug'],
          [/\b(?:TRACE|TRC)\b/, 'log.trace'],
          // file paths like src/app/main.ts:42
          [/[\w./-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|kt|rb|cpp|cc|c|h)(?::\d+)?/, 'log.path'],
          // key=value
          [/[a-zA-Z_][\w.]*(?==)/, 'log.key'],
          // quoted strings
          [/"([^"\\]|\\.)*"/, 'log.str'],
          [/'([^'\\]|\\.)*'/, 'log.str'],
          // numbers
          [/\b\d+(?:\.\d+)?\b/, 'log.num'],
        ],
      },
    });
  }

  // React wrapper
  const { useEffect, useRef, useState } = React;

  function LvMonaco({ value, language = 'plaintext', theme = 'lv-dark', wordWrap = true, height = 220, readOnly = true, onMount }) {
    const hostRef = useRef(null);
    const editorRef = useRef(null);
    const [ready, setReady] = useState(!!window.monaco);
    const [err, setErr] = useState(null);

    // boot Monaco
    useEffect(() => {
      let cancelled = false;
      ensureLoader().then(() => { if (!cancelled) setReady(true); })
        .catch((e) => { if (!cancelled) setErr(e.message || String(e)); });
      return () => { cancelled = true; };
    }, []);

    // create editor
    useEffect(() => {
      if (!ready || !hostRef.current || editorRef.current) return;
      const ed = window.monaco.editor.create(hostRef.current, {
        value,
        language,
        theme,
        readOnly,
        automaticLayout: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        renderLineHighlight: 'none',
        fontFamily: 'JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: 12,
        lineHeight: 18,
        lineNumbers: 'on',
        lineNumbersMinChars: 3,
        glyphMargin: false,
        folding: language === 'json',
        padding: { top: 6, bottom: 6 },
        wordWrap: wordWrap ? 'on' : 'off',
        scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8, useShadows: false },
        contextmenu: false,
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        renderWhitespace: 'none',
        guides: { indentation: false },
        occurrencesHighlight: false,
        selectionHighlight: false,
        stickyScroll: { enabled: false },
      });
      editorRef.current = ed;
      if (onMount) onMount(ed);
      return () => { ed.dispose(); editorRef.current = null; };
    }, [ready]);

    // push updates
    useEffect(() => {
      const ed = editorRef.current;
      if (!ed) return;
      const m = ed.getModel();
      if (m && m.getValue() !== value) {
        ed.setValue(value);
      }
      window.monaco.editor.setModelLanguage(m, language);
    }, [value, language]);

    useEffect(() => {
      if (window.monaco && editorRef.current) window.monaco.editor.setTheme(theme);
    }, [theme]);

    useEffect(() => {
      if (editorRef.current) editorRef.current.updateOptions({ wordWrap: wordWrap ? 'on' : 'off' });
    }, [wordWrap]);

    if (err) return <div className="lv-mon-err">Monaco failed to load: {err}</div>;

    return (
      <div
        className="lv-mon-host"
        ref={hostRef}
        style={{ height: typeof height === 'number' ? `${height}px` : height }}
      >
        {!ready && (
          <div className="lv-mon-skel">
            <div className="lv-mon-skel-bar" style={{ width: '60%' }}/>
            <div className="lv-mon-skel-bar" style={{ width: '80%' }}/>
            <div className="lv-mon-skel-bar" style={{ width: '45%' }}/>
            <div className="lv-mon-skel-bar" style={{ width: '72%' }}/>
          </div>
        )}
      </div>
    );
  }

  window.LvMonaco = LvMonaco;
  window.lvMonacoLoad = ensureLoader;
})();
