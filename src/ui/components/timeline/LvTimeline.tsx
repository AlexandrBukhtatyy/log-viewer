import { useEffect, useMemo, useRef, useState } from 'react';
import type { HistogramResponse } from '../../../core/rpc/coordinator.contract.ts';
import type { LogLevel, TimeRange } from '../../../core/types/index.ts';

export interface LvTimelineProps {
  readonly data: HistogramResponse;
  readonly range: TimeRange | null;
  onRangeChange: (range: TimeRange | null) => void;
  readonly height?: number;
}

const SEG_KEYS: ReadonlyArray<LogLevel> = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'unknown',
];

export const LvTimeline = ({
  data,
  range,
  onRangeChange,
  height = 64,
}: LvTimelineProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(800);

  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const ro = new ResizeObserver(() => setW(el.offsetWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { min, max, maxCount } = useMemo(() => {
    if (!data.buckets.length || !data.range) {
      return { min: 0, max: 0, maxCount: 0 };
    }
    let mc = 0;
    for (const b of data.buckets) if (b.count > mc) mc = b.count;
    return { min: data.range.from, max: data.range.to, maxCount: mc };
  }, [data]);

  const [drag, setDrag] = useState<{ x0: number; x1: number } | null>(null);
  const bucketW = w / Math.max(1, data.buckets.length);

  const rangeFrom = range?.from ?? null;
  const rangeTo = range?.to ?? null;
  const selStart =
    rangeFrom !== null && max !== min ? ((rangeFrom - min) / (max - min)) * w : null;
  const selEnd =
    rangeTo !== null && max !== min ? ((rangeTo - min) / (max - min)) * w : null;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!ref.current || max === min) return;
    const rect = ref.current.getBoundingClientRect();
    const x0 = e.clientX - rect.left;
    setDrag({ x0, x1: x0 });
    const move = (ev: PointerEvent) => {
      const x1 = Math.max(0, Math.min(w, ev.clientX - rect.left));
      setDrag({ x0, x1 });
    };
    const up = (ev: PointerEvent) => {
      const x1 = Math.max(0, Math.min(w, ev.clientX - rect.left));
      const a = Math.min(x0, x1);
      const b = Math.max(x0, x1);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (Math.abs(b - a) < 4) {
        setDrag(null);
        onRangeChange(null);
        return;
      }
      const t0 = min + (a / w) * (max - min);
      const t1 = min + (b / w) * (max - min);
      setDrag(null);
      onRangeChange({ from: t0, to: t1 });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  if (!data.buckets.length || !data.range) {
    return (
      <div className="lv-timeline lv-timeline-empty" style={{ height }}>
        <span>No events to chart.</span>
      </div>
    );
  }

  const fmt = (t: number) => new Date(t).toISOString().slice(11, 19);
  const segH = (n: number) => (n / Math.max(1, maxCount)) * 100 + '%';

  return (
    <div className="lv-timeline" style={{ height }}>
      <div className="lv-timeline-inner" ref={ref} onPointerDown={onPointerDown}>
        <svg
          className="lv-timeline-grid"
          viewBox={`0 0 ${w} ${height}`}
          preserveAspectRatio="none"
        >
          {[0.25, 0.5, 0.75].map((p, i) => (
            <line
              key={i}
              x1={w * p}
              x2={w * p}
              y1={0}
              y2={height}
              stroke="var(--lv-tl-grid)"
              strokeDasharray="2 3"
            />
          ))}
        </svg>
        <div className="lv-timeline-bars">
          {data.buckets.map((b, i) => (
            <div
              key={i}
              className="lv-tl-col"
              style={{ left: i * bucketW, width: Math.max(1, bucketW - 1), height: '100%' }}
            >
              {SEG_KEYS.map((k) => (
                <div
                  key={k}
                  className={`lv-tl-seg lv-tl-${k}`}
                  style={{ height: segH(b.levelCounts[k] ?? 0) }}
                />
              ))}
            </div>
          ))}
        </div>
        {range && selStart != null && selEnd != null && (
          <div
            className="lv-tl-sel"
            style={{ left: selStart, width: Math.max(2, selEnd - selStart) }}
          />
        )}
        {drag && (
          <div
            className="lv-tl-sel lv-tl-sel-drag"
            style={{
              left: Math.min(drag.x0, drag.x1),
              width: Math.abs(drag.x1 - drag.x0),
            }}
          />
        )}
      </div>
      <div className="lv-tl-axis">
        <span>{fmt(min)}</span>
        <span>{fmt((min + max) / 2)}</span>
        <span>{fmt(max)}</span>
      </div>
    </div>
  );
};
