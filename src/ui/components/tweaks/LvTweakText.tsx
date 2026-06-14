import { LvTweakRow } from './LvTweakRow.tsx';

export interface LvTweakTextProps {
  readonly label: string;
  readonly value: string;
  readonly placeholder?: string;
  onChange: (value: string) => void;
}

export const LvTweakText = ({
  label,
  value,
  placeholder,
  onChange,
}: LvTweakTextProps) => (
  <LvTweakRow label={label}>
    <input
      className="twk-field"
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  </LvTweakRow>
);
