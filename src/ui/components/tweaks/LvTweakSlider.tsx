import { LvTweakRow } from './LvTweakRow.tsx';

export interface LvTweakSliderProps {
  readonly label: string;
  readonly value: number;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly unit?: string;
  onChange: (value: number) => void;
}

export const LvTweakSlider = ({
  label,
  value,
  min = 0,
  max = 100,
  step = 1,
  unit = '',
  onChange,
}: LvTweakSliderProps) => (
  <LvTweakRow label={label} value={`${value}${unit}`}>
    <input
      type="range"
      className="twk-slider"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  </LvTweakRow>
);
