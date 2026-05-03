export interface LvTweakButtonProps {
  readonly label: string;
  readonly secondary?: boolean;
  onClick: () => void;
}

export const LvTweakButton = ({ label, onClick, secondary = false }: LvTweakButtonProps) => (
  <button
    type="button"
    className={secondary ? 'twk-btn secondary' : 'twk-btn'}
    onClick={onClick}
  >
    {label}
  </button>
);
