import type { ReactNode } from 'react';

export interface LvTweakRowProps {
  readonly label: string;
  readonly value?: string | number | null;
  readonly inline?: boolean;
  readonly children?: ReactNode;
}

export const LvTweakRow = ({
  label,
  value,
  children,
  inline = false,
}: LvTweakRowProps) => (
  <div className={inline ? 'twk-row twk-row-h' : 'twk-row'}>
    <div className="twk-lbl">
      <span>{label}</span>
      {value != null && <span className="twk-val">{value}</span>}
    </div>
    {children}
  </div>
);
