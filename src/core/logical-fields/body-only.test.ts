import { describe, expect, it } from 'vitest';
import type { LogicalField } from '../types/index.ts';
import { EMPTY_FILTER } from '../types/log-filter.ts';
import type { LogFilter } from '../types/log-filter.ts';
import {
  bodyOnlyFieldFor,
  filterTouchesBodyOnly,
  splitFilterForBodyOnly,
} from './body-only.ts';

const field = (
  id: string,
  extractors: LogicalField['extractors'],
): LogicalField => ({
  id,
  type: 'string',
  label: id,
  origin: 'user',
  extractors,
});

// `~action` is body-only (regex on message); `~trace` is SQL-computable.
const action = field('action', [
  { type: 'regex', on: 'message', pattern: '^(\\w+ \\w+)' },
]);
const trace = field('trace', [{ type: 'field', path: 'trace_id' }]);
const ctx = { activeLogicalFields: [action, trace] };

const filter = (over: Partial<LogFilter>): LogFilter => ({
  ...EMPTY_FILTER,
  ...over,
});

describe('bodyOnlyFieldFor', () => {
  it('returns the field for a body-only ~key', () => {
    expect(bodyOnlyFieldFor('~action', ctx)).toBe(action);
  });
  it('null for a SQL-computable ~key', () => {
    expect(bodyOnlyFieldFor('~trace', ctx)).toBeNull();
  });
  it('null for non-~ keys and unknown ids', () => {
    expect(bodyOnlyFieldFor('@level', ctx)).toBeNull();
    expect(bodyOnlyFieldFor('service', ctx)).toBeNull();
    expect(bodyOnlyFieldFor('~nope', ctx)).toBeNull();
  });
});

describe('filterTouchesBodyOnly', () => {
  it('true when a fieldFilter targets a body-only field', () => {
    expect(
      filterTouchesBodyOnly(
        filter({ fieldFilters: [{ key: '~action', op: '=', value: 'x' }] }),
        ctx,
      ),
    ).toBe(true);
  });
  it('true when sortBy targets a body-only field (no fieldFilters)', () => {
    expect(
      filterTouchesBodyOnly(
        filter({ sortBy: { key: '~action', dir: 'asc' } }),
        ctx,
      ),
    ).toBe(true);
  });
  it('false when only SQL-computable keys are referenced', () => {
    expect(
      filterTouchesBodyOnly(
        filter({
          fieldFilters: [{ key: '~trace', op: '=', value: 'x' }],
          sortBy: { key: '@ts', dir: 'desc' },
        }),
        ctx,
      ),
    ).toBe(false);
  });
});

describe('splitFilterForBodyOnly', () => {
  it('peels body-only fieldFilters into bodyFieldFilters, keeps the rest in SQL', () => {
    const f = filter({
      fieldFilters: [
        { key: '~action', op: '=', value: 'login' },
        { key: '~trace', op: '=', value: 'tr1' },
        { key: 'service', op: '~', value: 'api' },
      ],
    });
    const split = splitFilterForBodyOnly(f, ctx);
    expect(split.bodyFieldFilters).toEqual([
      { key: '~action', op: '=', value: 'login' },
    ]);
    expect(split.sqlFilter.fieldFilters).toEqual([
      { key: '~trace', op: '=', value: 'tr1' },
      { key: 'service', op: '~', value: 'api' },
    ]);
    expect(split.bodySort).toBeNull();
  });

  it('strips a body-only sortBy off the SQL filter', () => {
    const split = splitFilterForBodyOnly(
      filter({ sortBy: { key: '~action', dir: 'desc' } }),
      ctx,
    );
    expect(split.bodySort).toEqual({ key: '~action', dir: 'desc' });
    expect(split.sqlFilter.sortBy).toBeUndefined();
  });

  it('keeps a SQL-computable sortBy on the SQL filter', () => {
    const split = splitFilterForBodyOnly(
      filter({ sortBy: { key: '~trace', dir: 'asc' } }),
      ctx,
    );
    expect(split.bodySort).toBeNull();
    expect(split.sqlFilter.sortBy).toEqual({ key: '~trace', dir: 'asc' });
  });
});
