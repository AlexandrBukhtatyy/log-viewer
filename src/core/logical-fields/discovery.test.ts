import { describe, expect, it } from 'vitest';
import type { LogicalField } from '../types/index.ts';
import { findSuggestedLogicalFields } from './discovery.ts';

const template = (
  id: string,
  paths: string[],
): LogicalField => ({
  id,
  type: 'string',
  label: id,
  origin: 'builtin',
  extractors: paths.map((p) => ({ type: 'field', path: p })),
});

describe('findSuggestedLogicalFields', () => {
  it('suggests templates whose extractor paths match discovered keys', () => {
    const out = findSuggestedLogicalFields(
      [template('trace_id', ['trace_id', 'traceId', 'tid'])],
      ['traceId', 'level', 'service'],
      [],
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.field.id).toBe('trace_id');
    expect(out[0]?.matchedKeys).toEqual(['traceId']);
  });

  it('uses the first segment of dotted paths', () => {
    // user_id has `usr.id` path; if a source has a top-level `usr`
    // key, the template should be suggested.
    const out = findSuggestedLogicalFields(
      [template('user_id', ['usr.id'])],
      ['usr', 'something_else'],
      [],
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.matchedKeys).toEqual(['usr']);
  });

  it('skips templates that are already active', () => {
    const out = findSuggestedLogicalFields(
      [template('trace_id', ['traceId'])],
      ['traceId'],
      ['trace_id'],
    );
    expect(out).toEqual([]);
  });

  it('returns empty when nothing matches', () => {
    const out = findSuggestedLogicalFields(
      [template('trace_id', ['traceId', 'tid'])],
      ['some_other_key'],
      [],
    );
    expect(out).toEqual([]);
  });

  it('also picks up paths from regex-on-json extractors', () => {
    const t: LogicalField = {
      id: 'trace_id',
      type: 'string',
      label: 'trace_id',
      origin: 'builtin',
      extractors: [
        { type: 'regex-on-json', path: 'context', pattern: 'tr=(\\w+)' },
      ],
    };
    const out = findSuggestedLogicalFields([t], ['context'], []);
    expect(out).toHaveLength(1);
    expect(out[0]?.matchedKeys).toEqual(['context']);
  });
});
