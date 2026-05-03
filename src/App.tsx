// Default app entry: renders <LvApp/> on the mock catalog (src/dev/log-data-mock.ts).
// The headless layers (src/core, src/hooks, src/workers, src/worker-client) are
// retained as the contract for a future re-wiring to the real worker pipeline —
// see docs/adr/0009-mock-default-app.md.

import { useCallback, useMemo, useState } from 'react';
import { LvApp } from './ui/components/layout/LvApp.tsx';
import type { LvSourceKind } from './ui/contracts/lv-types.ts';
import {
  CATALOG,
  FILES_BY_ID,
  LOG_BY_FILE,
  SAVED,
  addFile,
  addRootFolder,
  removeRoot,
} from './dev/log-data-mock.ts';

const INITIAL_SELECTED = [
  'api-2026-04-23',
  'auth-2026-04-23',
  'billing-json',
  'access-log',
  'billing-trace',
];

const SAMPLES_BY_SOURCE: Record<string, ReadonlyArray<string>> = {
  'local-static': ['observability-prod', 'edge-eu-west', 'redis-cluster', 'monitoring-stack'],
  'local-live': ['~/code/payments/logs', '~/code/notifications/logs'],
  'remote-ssh': ['prod-edge-2', 'staging-app-1', 'db-replica-3'],
  stream: ['kubectl logs -f api-7d9…', 'docker logs checkout-svc'],
  cloud: ['Datadog · staging', 'CloudWatch · eu-west-1', 'GCP Logging · prod'],
  k8s: ['k8s · prod-us', 'k8s · staging-eu'],
  bus: ['kafka · orders', 'nats · events'],
  db: ['Loki · prod', 'ClickHouse · logs'],
  snapshot: ['incident-2026-04-22.tar.gz', 'support-bundle-3120.zip'],
};

const PATH_BY_SOURCE: Record<string, (n: string) => string> = {
  'local-static': (n) => `~/logs/${n}`,
  'local-live': (n) => n,
  'remote-ssh': (n) => `ssh://deploy@${n}/var/log`,
  stream: (n) => `pipe://${n}`,
  cloud: (n) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  k8s: (n) => `k8s://${n.replace(/^k8s · /, '')}`,
  bus: (n) => n.replace(' · ', '://'),
  db: (n) => n.toLowerCase().replace(/ · /, '://'),
  snapshot: (n) => `snapshot://${n}`,
  bookmark: (n) => `bookmark://${n}`,
};

const App = () => {
  const [version, setVersion] = useState(0);

  const snapshot = useMemo(
    () => ({
      catalog: [...CATALOG],
      filesById: { ...FILES_BY_ID },
      logsByFile: { ...LOG_BY_FILE },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version forces refresh after mock mutations
    [version],
  );

  const onAddRoot = useCallback((sourceType: LvSourceKind) => {
    const samples = SAMPLES_BY_SOURCE[sourceType] ?? SAMPLES_BY_SOURCE['local-static']!;
    const used = new Set(CATALOG.map((r) => r.name));
    const pick = samples.find((n) => !used.has(n)) ?? `${sourceType}-${CATALOG.length + 1}`;
    const pathFn = PATH_BY_SOURCE[sourceType] ?? PATH_BY_SOURCE['local-static']!;
    addRootFolder({ name: pick, path: pathFn(pick), source: sourceType });
    setVersion((v) => v + 1);
  }, []);

  const onRemoveRoot = useCallback((id: string) => {
    removeRoot(id);
    setVersion((v) => v + 1);
  }, []);

  const onOpenLocalFile = useCallback(async () => {
    try {
      let name: string | undefined;
      let text: string | undefined;
      const w = window as Window & {
        showOpenFilePicker?: (opts: unknown) => Promise<Array<{ getFile: () => Promise<File> }>>;
      };
      if (w.showOpenFilePicker) {
        const [handle] = await w.showOpenFilePicker({
          types: [
            {
              description: 'Log files',
              accept: {
                'text/plain': ['.log', '.txt', '.json', '.jsonl', '.ndjson', '.out', '.err'],
              },
            },
          ],
          multiple: false,
        });
        if (!handle) return;
        const file = await handle.getFile();
        name = file.name;
        text = await file.text();
      } else {
        await new Promise<void>((resolve, reject) => {
          const inp = document.createElement('input');
          inp.type = 'file';
          inp.accept = '.log,.txt,.json,.jsonl,.ndjson,.out,.err';
          inp.onchange = async () => {
            const file = inp.files?.[0];
            if (!file) return reject(new Error('no file'));
            name = file.name;
            text = await file.text();
            resolve();
          };
          inp.click();
        });
      }
      if (name && text != null) {
        addFile({ name, text });
        setVersion((v) => v + 1);
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') console.warn('openLocalFile failed', e);
    }
  }, []);

  return (
    <LvApp
      catalog={snapshot.catalog}
      filesById={snapshot.filesById}
      logsByFile={snapshot.logsByFile}
      savedSearches={SAVED}
      onAddRoot={onAddRoot}
      onRemoveRoot={onRemoveRoot}
      onOpenLocalFile={onOpenLocalFile}
      initialSelectedIds={INITIAL_SELECTED}
    />
  );
};

export default App;
