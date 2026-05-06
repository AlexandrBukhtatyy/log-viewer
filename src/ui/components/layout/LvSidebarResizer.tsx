import { useCallback, useEffect, useRef } from 'react';

const MIN_WIDTH = 180;
const MAX_WIDTH = 600;

export interface LvSidebarResizerProps {
  readonly width: number;
  /** Fired continuously while dragging — feed the live width to your layout. */
  onResize: (width: number) => void;
  /** Fired once on mouseup — persist the final width here. */
  onResizeEnd?: (width: number) => void;
}

/**
 * Vertical drag handle that lets the user resize the middle column
 * (sidebar / search / bookmarks / AI). The handle is rendered as a thin
 * grid track between the sidebar and the viewer.
 *
 * During drag the handle owns document-level mousemove/mouseup listeners
 * so the cursor doesn't fall off the 4-pixel hitbox; we also pin the
 * cursor and disable text selection on `<body>` for the drag duration.
 */
export const LvSidebarResizer = ({
  width,
  onResize,
  onResizeEnd,
}: LvSidebarResizerProps) => {
  const startRef = useRef<{ x: number; w: number } | null>(null);
  const latestRef = useRef(width);
  useEffect(() => {
    latestRef.current = width;
  }, [width]);

  const onMouseMove = useCallback(
    (e: MouseEvent) => {
      const start = startRef.current;
      if (!start) return;
      const dx = e.clientX - start.x;
      const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, start.w + dx));
      latestRef.current = next;
      onResize(next);
    },
    [onResize],
  );

  const onMouseUp = useCallback(() => {
    if (!startRef.current) return;
    startRef.current = null;
    document.body.style.removeProperty('cursor');
    document.body.style.removeProperty('user-select');
    onResizeEnd?.(latestRef.current);
  }, [onResizeEnd]);

  useEffect(() => {
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    startRef.current = { x: e.clientX, w: width };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const onDoubleClick = () => {
    // Double-click resets to the design default.
    onResize(260);
    onResizeEnd?.(260);
  };

  return (
    <div
      className="lv-sidebar-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      aria-valuenow={width}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      title="Drag to resize · double-click to reset"
    />
  );
};
