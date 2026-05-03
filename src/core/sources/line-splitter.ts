/**
 * TransformStream<string, string> — splits incoming chunks of text on '\n',
 * carrying a remainder buffer between chunks. Strips trailing '\r' (CRLF).
 * Empty trailing line (after final '\n') is NOT emitted.
 */
export const createLineSplitter = (): TransformStream<string, string> => {
  let buffer = '';

  return new TransformStream<string, string>({
    transform(chunk, controller) {
      buffer += chunk;
      let nl = buffer.indexOf('\n');
      while (nl !== -1) {
        let line = buffer.slice(0, nl);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        controller.enqueue(line);
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf('\n');
      }
    },
    flush(controller) {
      if (buffer.length > 0) {
        const tail = buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer;
        if (tail.length > 0) controller.enqueue(tail);
        buffer = '';
      }
    },
  });
};
