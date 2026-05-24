import { LvAppContainer } from './app/containers/LvAppContainer.tsx';
import { WorkerClientProvider } from './app/providers/WorkerClientProvider.tsx';
import { LvUpdateBanner } from './ui/components/pwa/LvUpdateBanner.tsx';

const App = () => (
  <WorkerClientProvider>
    <LvAppContainer />
    <LvUpdateBanner />
  </WorkerClientProvider>
);

export default App;
