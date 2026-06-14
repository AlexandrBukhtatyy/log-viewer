import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import './tweaks.css';

const PAD = 16;

export interface LvTweaksPanelProps {
  readonly isOpen: boolean;
  readonly title?: string;
  onClose: () => void;
  readonly children?: ReactNode;
}

export const LvTweaksPanel = ({
  isOpen,
  title = 'Tweaks',
  onClose,
  children,
}: LvTweaksPanelProps) => {
  const dragRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState({ x: PAD, y: PAD });

  const clampToViewport = useCallback(() => {
    const panel = dragRef.current;
    if (!panel) return;
    const w = panel.offsetWidth;
    const h = panel.offsetHeight;
    setOffset((prev) => {
      const maxRight = Math.max(PAD, window.innerWidth - w - PAD);
      const maxBottom = Math.max(PAD, window.innerHeight - h - PAD);
      const next = {
        x: Math.min(maxRight, Math.max(PAD, prev.x)),
        y: Math.min(maxBottom, Math.max(PAD, prev.y)),
      };
      return next.x === prev.x && next.y === prev.y ? prev : next;
    });
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    clampToViewport();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', clampToViewport);
      return () => window.removeEventListener('resize', clampToViewport);
    }
    const ro = new ResizeObserver(clampToViewport);
    ro.observe(document.documentElement);
    return () => ro.disconnect();
  }, [isOpen, clampToViewport]);

  const onDragStart = (e: React.MouseEvent<HTMLDivElement>) => {
    const panel = dragRef.current;
    if (!panel) return;
    const r = panel.getBoundingClientRect();
    const sx = e.clientX;
    const sy = e.clientY;
    const startRight = window.innerWidth - r.right;
    const startBottom = window.innerHeight - r.bottom;
    const move = (ev: MouseEvent) => {
      const w = panel.offsetWidth;
      const h = panel.offsetHeight;
      const maxRight = Math.max(PAD, window.innerWidth - w - PAD);
      const maxBottom = Math.max(PAD, window.innerHeight - h - PAD);
      setOffset({
        x: Math.min(maxRight, Math.max(PAD, startRight - (ev.clientX - sx))),
        y: Math.min(maxBottom, Math.max(PAD, startBottom - (ev.clientY - sy))),
      });
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  if (!isOpen) return null;
  return (
    <div
      ref={dragRef}
      className="twk-panel"
      style={{ right: offset.x, bottom: offset.y }}
    >
      <div className="twk-hd" onMouseDown={onDragStart}>
        <b>{title}</b>
        <button
          type="button"
          className="twk-x"
          aria-label="Close tweaks"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      <div className="twk-body">{children}</div>
    </div>
  );
};
