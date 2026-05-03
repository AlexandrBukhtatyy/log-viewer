import { LvTweakRow } from './LvTweakRow.tsx';

export interface LvTweakSelectOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

export interface LvTweakSelectProps<T extends string> {
  readonly label: string;
  readonly value: T;
  readonly options: ReadonlyArray<T | LvTweakSelectOption<T>>;
  onChange: (value: T) => void;
}

export const LvTweakSelect = <T extends string>({
  label,
  value,
  options,
  onChange,
}: LvTweakSelectProps<T>) => (
  <LvTweakRow label={label}>
    <select
      className="twk-field"
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
    >
      {options.map((o) => {
        const v = (typeof o === 'string' ? o : o.value) as T;
        const l = typeof o === 'string' ? o : o.label;
        return (
          <option key={v} value={v}>
            {l}
          </option>
        );
      })}
    </select>
  </LvTweakRow>
);
