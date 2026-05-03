import { useCallback } from 'react';
import { useViewStore } from '../app/providers/view-store-context.ts';
import type { SourceId } from '../core/types/index.ts';

export interface UseSourceController {
  addFile: (file: File) => Promise<SourceId>;
  addDirectory: () => Promise<SourceId | null>;
  addText: (name: string, text: string) => Promise<SourceId>;
  addUrl: (
    url: string,
    headers?: Readonly<Record<string, string>>,
  ) => Promise<SourceId>;
  addStream: (url: string, transport?: 'ws' | 'sse') => Promise<SourceId>;
  removeSource: (id: SourceId) => Promise<void>;
  clearAll: () => Promise<void>;
}

export const useSourceController = (): UseSourceController => {
  const store = useViewStore();

  const addFile = useCallback(
    (file: File) => store.getState().addFile(file),
    [store],
  );

  const addDirectory = useCallback(
    () => store.getState().addDirectory(),
    [store],
  );

  const addText = useCallback(
    (name: string, text: string) => store.getState().addText(name, text),
    [store],
  );

  const addUrl = useCallback(
    (url: string, headers?: Readonly<Record<string, string>>) =>
      store.getState().addUrl(url, headers),
    [store],
  );

  const addStream = useCallback(
    (url: string, transport?: 'ws' | 'sse') =>
      store.getState().addStream(url, transport),
    [store],
  );

  const removeSource = useCallback(
    (id: SourceId) => store.getState().removeSource(id),
    [store],
  );

  const clearAll = useCallback(
    () => store.getState().clearAll(),
    [store],
  );

  return {
    addFile,
    addDirectory,
    addText,
    addUrl,
    addStream,
    removeSource,
    clearAll,
  };
};
