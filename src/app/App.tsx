import { ActionLockProvider } from '@/app/providers/ActionLockContext';
import { AppRouter } from '@/app/router';

export function App() {
  return (
    <ActionLockProvider>
      <AppRouter />
    </ActionLockProvider>
  );
}

export default App;
