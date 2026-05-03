import type { ReactNode } from 'react';

export interface LvTweakSectionProps {
  readonly label: string;
  readonly children?: ReactNode;
}

export const LvTweakSection = ({ label, children }: LvTweakSectionProps) => (
  <>
    <div className="twk-sect">{label}</div>
    {children}
  </>
);
