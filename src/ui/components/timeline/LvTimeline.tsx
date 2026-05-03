import { useEffect, useMemo, useRef, useState } from 'react';
import type { LvLogEntry, LvLogLevel } from '../../contracts/lv-types.ts';

interface Bucket {
  error: number;
  warn: number;
  info: number;
  debug: number;
  trace: number;
  total: number;
}

const emptyBucket = (): Bucket => ({ error: 0, warn: 0, info: 0, debug: 0, trace: 0, total: 0 });

export interface LvTimelineProps {
  readonly entries: ReadonlyArray<LvLogEntry>;
  readonly range: [number, number] | null;
  onRangeChange: (range: [number, number] | null) => void;
  readonly height?: number;
}

export const LvTimeline = ({ entries, range, onRangeChange, height = 64 }: LvTimelineProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(800);

  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const ro = new ResizeObserver(() => setW(el.offsetWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { buckets, min, max, maxCount } = useMemo(() => {
    if (!entries.length)
      return { buckets: [] as Bucket[], min: 0, max: 0, maxCount: 0 };
    let lo = Infinity;
    let hi = -Infinity;
    for (const e of entries) {
      const t = new Date(e.ts).getTime();
      if (t < lo) lo = t;
      if (t > hi) hi = t;
    }
    const B = 80;
    const step = Math.max(1, (hi - lo) / B);
    const out: Bucket[] = Array.from({ length: B }, emptyBucket);
    for (const e of entries) {
      const t = new Date(e.ts).getTime();
      const i = Math.min(B - 1, Math.floor((t - lo) / step));
      const lvl = e.level as keyof Omit<Bucket, 'total'>;
      out[i]![lvl] = (out[i]![lvl] ?? 0) + 1;
      out[i]!.total++;
    }
    let mc = 0;
    for (const b of out) if (b.total > mc) mc = b.total;
    return { buckets: out, min: lo, max: hi, maxCount: mc };
  }, [entries]);

  const [drag, setDrag] = useState<{ x0: number; x1: number } | null>(null);
  const bucketW = w / Math.max(1, buckets.length);

  const selStart = range && max !== min ? ((range[0] - min) / (max - min)) * w : null;
  const selEnd = range && max !== min ? ((range[1] - min) / (max - min)) * w : null;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!ref.current) return;
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
      onRangeChange([t0, t1]);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  if (!entries.length) {
    return (
      <div className="lv-timeline lv-timeline-empty" style={{ height }}>
        <span>No events to chart.</span>
      </div>
    );
  }

  const fmt = (t: number) => new Date(t).toISOString().slice(11, 19);
  const segH = (n: number) => (n / Math.max(1, maxCount)) * 100 + '%';
  const SEG_KEYS: ReadonlyArray<LvLogLevel> = ['error', 'warn', 'info', 'debug', 'trace'];

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
          {buckets.map((b, i) => (
            <div
              key={i}
              className="lv-tl-col"
              style={{ left: i * bucketW, width: Math.max(1, bucketW - 1), height: '100%' }}
            >
              {SEG_KEYS.map((k) => (
                <div
                  key={k}
                  className={`lv-tl-seg lv-tl-${k}`}
                  style={{ height: segH(b[k as keyof Omit<Bucket, 'total'>]) }}
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
