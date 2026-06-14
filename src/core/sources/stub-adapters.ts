// Phase 1 stubs for source kinds whose adapters are not yet implemented
// (CORS / proxy / native-API constraints — see plan §1.5). The factories are
// registered in the default registry so the type system, hooks, ViewStore and
// coordinator stay aligned with the UI menu — but `open()` throws immediately
// with a clear "not implemented" error. Callers see this surface as a
// `SourceStatus.kind === 'error'` badge in the UI.

import type {
  BusLogSource,
  CloudLogSource,
  DbLogSource,
  K8sLogSource,
  LogSource,
  RemoteSshLogSource,
} from '../types/log-source.ts';
import type {
  LogSourceAdapter,
  LogSourceAdapterFactory,
} from './source-adapter.ts';

const stubAdapter = (
  expected: LogSource['kind'],
  source: LogSource,
  message: string,
): LogSourceAdapter => {
  if (source.kind !== expected) {
    throw new Error(
      `${expected}-adapter: expected source.kind='${expected}', got '${source.kind}'`,
    );
  }
  return {
    source,
    open: async () => {
      throw new Error(message);
    },
    close: async () => {},
  };
};

export const createRemoteSshAdapter: LogSourceAdapterFactory = (source) =>
  stubAdapter(
    'remote-ssh',
    source as RemoteSshLogSource,
    'remote-ssh source: adapter not implemented yet (needs SSH proxy server, see plan §1.5)',
  );

export const createCloudAdapter: LogSourceAdapterFactory = (source) =>
  stubAdapter(
    'cloud',
    source as CloudLogSource,
    'cloud source: adapter not implemented yet (Datadog/CloudWatch/GCP integrations are separate ADRs)',
  );

export const createK8sAdapter: LogSourceAdapterFactory = (source) =>
  stubAdapter(
    'k8s',
    source as K8sLogSource,
    'k8s source: adapter not implemented yet (needs cluster proxy, see plan §1.5)',
  );

export const createBusAdapter: LogSourceAdapterFactory = (source) =>
  stubAdapter(
    'bus',
    source as BusLogSource,
    'bus source: adapter not implemented yet (Kafka/NATS/Redis Streams need a WS proxy)',
  );

export const createDbAdapter: LogSourceAdapterFactory = (source) =>
  stubAdapter(
    'db',
    source as DbLogSource,
    'db source: adapter not implemented yet (Loki/ClickHouse/BigQuery query integrations are separate ADRs)',
  );
