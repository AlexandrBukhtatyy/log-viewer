import type { ReactNode } from 'react';

export function lvHighlight(
  text: string,
  q: string,
  useRegex: boolean,
  caseSensitive: boolean,
  wholeWord: boolean,
): ReactNode {
  if (!q) return text;
  let re: RegExp;
  try {
    let pattern = useRegex ? q : q.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    if (wholeWord) pattern = `\\b(?:${pattern})\\b`;
    re = new RegExp(pattern, caseSensitive ? 'g' : 'gi');
  } catch {
    return text;
  }
  const parts: ReactNode[] = [];
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index === re.lastIndex) {
      re.lastIndex++;
      continue;
    }
    if (m.index > lastIdx) parts.push(text.slice(lastIdx, m.index));
    parts.push(
      <mark key={m.index} className="lv-hl">
        {m[0]}
      </mark>,
    );
    lastIdx = re.lastIndex;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return parts.length ? parts : text;
}
