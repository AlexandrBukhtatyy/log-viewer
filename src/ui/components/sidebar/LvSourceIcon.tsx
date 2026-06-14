import type { LvSourceKind } from '../../contracts/lv-types.ts';

export interface LvSourceIconProps {
  readonly source?: LvSourceKind | string;
}

export const LvSourceIcon = ({ source }: LvSourceIconProps) => {
  switch (source) {
    case 'local-live':
      return (
        <svg viewBox="0 0 14 12" width="14" height="12">
          <path
            d="M1 3 A1 1 0 0 1 2 2 H5 L6.4 3.4 H13 V10 A1 1 0 0 1 12 11 H2 A1 1 0 0 1 1 10 Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinejoin="round"
          />
          <circle cx="11.5" cy="3" r="1.6" fill="var(--lv-level-error)" />
        </svg>
      );
    case 'remote-ssh':
      return (
        <svg viewBox="0 0 14 12" width="14" height="12">
          <rect
            x="1.5"
            y="2"
            width="11"
            height="3"
            rx="0.6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.1"
          />
          <rect
            x="1.5"
            y="7"
            width="11"
            height="3"
            rx="0.6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.1"
          />
          <circle cx="3.6" cy="3.5" r="0.6" fill="currentColor" />
          <circle cx="3.6" cy="8.5" r="0.6" fill="currentColor" />
        </svg>
      );
    case 'stream':
      return (
        <svg viewBox="0 0 14 12" width="14" height="12">
          <path
            d="M2 2 L6 6 L2 10 M6 2 L10 6 L6 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'cloud':
      return (
        <svg viewBox="0 0 14 12" width="14" height="12">
          <path
            d="M3.5 9 A2.4 2.4 0 1 1 4.4 4.4 A2.6 2.6 0 0 1 9.5 4 A2 2 0 0 1 11.5 9 Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'k8s':
      return (
        <svg viewBox="0 0 14 12" width="14" height="12">
          <path
            d="M7 1.4 L12 4.2 V8.4 L7 11 L2 8.4 V4.2 Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinejoin="round"
          />
          <circle
            cx="7"
            cy="6.3"
            r="1.6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
          />
        </svg>
      );
    case 'bus':
      return (
        <svg viewBox="0 0 14 12" width="14" height="12">
          <circle
            cx="3"
            cy="6"
            r="1.6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.1"
          />
          <circle
            cx="11"
            cy="3"
            r="1.4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.1"
          />
          <circle
            cx="11"
            cy="9"
            r="1.4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.1"
          />
          <path
            d="M4.4 5.4 L9.6 3.4 M4.4 6.6 L9.6 8.6"
            stroke="currentColor"
            strokeWidth="1"
          />
        </svg>
      );
    case 'snapshot':
      return (
        <svg viewBox="0 0 14 12" width="14" height="12">
          <rect
            x="1.5"
            y="2"
            width="11"
            height="2.4"
            rx="0.4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.1"
          />
          <path
            d="M2.5 4.4 V10 A0.5 0.5 0 0 0 3 10.5 H11 A0.5 0.5 0 0 0 11.5 10 V4.4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.1"
          />
          <path
            d="M5.5 6.5 H8.5"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'db':
      return (
        <svg viewBox="0 0 14 12" width="14" height="12">
          <ellipse
            cx="7"
            cy="3"
            rx="4.5"
            ry="1.4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.1"
          />
          <path
            d="M2.5 3 V9 A4.5 1.4 0 0 0 11.5 9 V3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.1"
          />
          <path
            d="M2.5 6 A4.5 1.4 0 0 0 11.5 6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            opacity=".6"
          />
        </svg>
      );
    case 'bookmark':
      return (
        <svg viewBox="0 0 14 12" width="14" height="12">
          <path
            d="M3.5 1.5 H10.5 V10.5 L7 8 L3.5 10.5 Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'local-static':
    default:
      return (
        <svg viewBox="0 0 14 12" width="14" height="12">
          <path
            d="M1 3 A1 1 0 0 1 2 2 H5 L6.4 3.4 H13 V10 A1 1 0 0 1 12 11 H2 A1 1 0 0 1 1 10 Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinejoin="round"
          />
        </svg>
      );
  }
};
