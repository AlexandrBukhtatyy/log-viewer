import * as Comlink from 'comlink';
import { indexerApi } from './indexer-api.ts';

Comlink.expose(indexerApi);
