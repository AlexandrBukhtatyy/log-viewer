export interface ChunkerOptions {
  /** Flush a batch when it reaches this many lines. */
  readonly maxLines: number;
  /** Or when this many ms have passed since first line of the current batch. */
  readonly maxMs: number;
}

/**
 * TransformStream<string, string[]> — accumulates lines into batches and emits
 * a batch whenever (a) batch reaches maxLines, or (b) maxMs elapsed since the
 * first line of the current batch, whichever comes first.
 *
 * Empty lines are dropped here — parsers also skip them, but dropping at this
 * layer keeps batches dense and avoids wasted RPC.
 */
export const createChunker = (
  options: ChunkerOptions,
): TransformStream<string, string[]> => {
  const { maxLines, maxMs } = options;
  let batch: string[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastController: TransformStreamDefaultController<string[]> | null = null;

  const emit = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (batch.length > 0 && lastController !== null) {
      lastController.enqueue(batch);
      batch = [];
    }
  };

  return new TransformStream<string, string[]>({
    transform(line, controller) {
      lastController = controller;
      if (line === '') return;
      batch.push(line);
      if (batch.length >= maxLines) {
        emit();
      } else if (timer === null) {
        timer = setTimeout(emit, maxMs);
      }
    },
    flush(controller) {
      lastController = controller;
      emit();
    },
  });
};
