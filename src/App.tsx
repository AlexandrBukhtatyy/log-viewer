import { LvAppContainer } from './app/containers/LvAppContainer.tsx';
import { WorkerClientProvider } from './app/providers/WorkerClientProvider.tsx';

const App = () => (
  <WorkerClientProvider>
    <LvAppContainer />
  </WorkerClientProvider>
);

export default App;
