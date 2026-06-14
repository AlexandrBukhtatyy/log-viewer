import { useEffect, useRef, useState } from 'react';
import { LvTweakRow } from './LvTweakRow.tsx';

export interface LvTweakRadioOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

export interface LvTweakRadioProps<T extends string> {
  readonly label: string;
  readonly value: T;
  readonly options: ReadonlyArray<T | LvTweakRadioOption<T>>;
  onChange: (value: T) => void;
}

export const LvTweakRadio = <T extends string>({
  label,
  value,
  options,
  onChange,
}: LvTweakRadioProps<T>) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const opts = options.map(
    (o): LvTweakRadioOption<T> =>
      typeof o === 'string' ? { value: o as T, label: o as string } : o,
  );
  const idx = Math.max(
    0,
    opts.findIndex((o) => o.value === value),
  );
  const n = opts.length;

  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const segAt = (clientX: number): T => {
    const r = trackRef.current!.getBoundingClientRect();
    const inner = r.width - 4;
    const i = Math.floor(((clientX - r.left - 2) / inner) * n);
    return opts[Math.max(0, Math.min(n - 1, i))]!.value;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    setDragging(true);
    const v0 = segAt(e.clientX);
    if (v0 !== valueRef.current) onChange(v0);
    const move = (ev: PointerEvent) => {
      if (!trackRef.current) return;
      const v = segAt(ev.clientX);
      if (v !== valueRef.current) onChange(v);
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <LvTweakRow label={label}>
      <div
        ref={trackRef}
        role="radiogroup"
        onPointerDown={onPointerDown}
        className={dragging ? 'twk-seg dragging' : 'twk-seg'}
      >
        <div
          className="twk-seg-thumb"
          style={{
            left: `calc(2px + ${idx} * (100% - 4px) / ${n})`,
            width: `calc((100% - 4px) / ${n})`,
          }}
        />
        {opts.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={o.value === value}
          >
            {o.label}
          </button>
        ))}
      </div>
    </LvTweakRow>
  );
};
