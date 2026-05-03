export interface LvChevronProps {
  readonly open: boolean;
}

export const LvChevron = ({ open }: LvChevronProps) => (
  <svg
    viewBox="0 0 10 10"
    width="10"
    height="10"
    aria-hidden="true"
    style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .12s' }}
  >
    <path
      d="M3.5 2 L7 5 L3.5 8"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
