import type { EntryId, SourceId } from '../types/log-entry.ts';

export const newEntryId = (): EntryId => crypto.randomUUID() as EntryId;
export const newSourceId = (): SourceId => crypto.randomUUID() as SourceId;
