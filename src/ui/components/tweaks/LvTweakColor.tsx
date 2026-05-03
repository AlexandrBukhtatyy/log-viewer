export interface LvTweakColorProps {
  readonly label: string;
  readonly value: string;
  onChange: (value: string) => void;
}

export const LvTweakColor = ({ label, value, onChange }: LvTweakColorProps) => (
  <div className="twk-row twk-row-h">
    <div className="twk-lbl">
      <span>{label}</span>
    </div>
    <input
      type="color"
      className="twk-swatch"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  </div>
);
