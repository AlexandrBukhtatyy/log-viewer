interface AlertRule {
  readonly id: string;
  readonly name: string;
  readonly level: 'error' | 'warn';
  readonly threshold: string;
  readonly enabled: boolean;
  readonly fires: number;
}

const RULES: AlertRule[] = [
  { id: 'r1', name: 'Prod 5xx spike', level: 'error', threshold: '> 5/min', enabled: true, fires: 2 },
  { id: 'r2', name: 'Slow query', level: 'warn', threshold: '> 1000ms', enabled: true, fires: 11 },
  { id: 'r3', name: 'Queue depth', level: 'warn', threshold: '> 2000 msgs', enabled: false, fires: 0 },
];

export const LvAlertsPanel = () => (
  <aside className="lv-sidebar">
    <div className="lv-sb-hd">
      <div className="lv-sb-title">
        <span className="lv-sb-title-text">Alerts</span>
        <span className="lv-sb-count">
          {RULES.filter((r) => r.enabled).length}/{RULES.length}
        </span>
      </div>
    </div>
    <div className="lv-alerts">
      {RULES.map((r) => (
        <div key={r.id} className={`lv-alert lv-level-${r.level}`}>
          <div className="lv-alert-row">
            <span className={`lv-alert-dot lv-level-tag-${r.level}`} />
            <span className="lv-alert-name">{r.name}</span>
            <span className={`lv-alert-state${r.enabled ? ' is-on' : ''}`}>
              {r.enabled ? 'on' : 'off'}
            </span>
          </div>
          <div className="lv-alert-meta">
            <span>{r.threshold}</span>
            {r.fires > 0 && <span className="lv-alert-fires">fired {r.fires}× today</span>}
          </div>
        </div>
      ))}
      <button type="button" className="lv-alert-add">
        ＋ New alert rule
      </button>
    </div>
  </aside>
);
