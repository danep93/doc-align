import { useState, useEffect, useCallback } from 'react';
import { bridge } from './bridge';
import type { AppState, CardView, DiffResult } from './types';
import { EmptyState } from './components/EmptyState';
import { AddSigners } from './components/AddSigners';
import { StatusCard } from './components/StatusCard';
import { SignForm } from './components/SignForm';
import { DiffView } from './components/DiffView';
import { HistoryView } from './components/HistoryView';

const MOCK_SIGNERS = [
  { id: 'alice', name: 'Alice M.', email: 'alice@acme.com' },
  { id: 'john', name: 'John D.', email: 'john@acme.com' },
  { id: 'rahul', name: 'Rahul K.', email: 'rahul@acme.com' },
];

const DEMO_USER_EMAIL = 'rahul@acme.com';

export function App() {
  const [view, setView] = useState<CardView>({ type: 'empty' });
  const [state, setState] = useState<AppState | null>(null);
  const [diffData, setDiffData] = useState<DiffResult | null>(null);
  const [diffSignerName, setDiffSignerName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    bridge
      .getInitialState()
      .then((result) => {
        setView(mapView(result.view));
        setState(result.state);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || 'Failed to load');
        setLoading(false);
      });
  }, []);

  const handleCreateBaseline = useCallback(async () => {
    try {
      const result = await bridge.createBaseline();
      setView(mapView(result.view));
      setState(result.state);
    } catch (err: unknown) {
      setError((err as Error).message);
    }
  }, []);

  const handleAddSignersDone = useCallback(
    async (selectedIds: string[], customEmail: string) => {
      try {
        const result = await bridge.addSigners({ selectedIds, customEmail });
        setView(mapView(result.view));
        setState(result.state);
      } catch (err: unknown) {
        setError((err as Error).message);
      }
    },
    []
  );

  const handleSignOff = useCallback(
    async (commitMessage: string) => {
      try {
        const result = await bridge.signOff({ commitMessage });
        setView(mapView(result.view));
        setState(result.state);
      } catch (err: unknown) {
        setError((err as Error).message);
      }
    },
    []
  );

  const handleQuickSign = useCallback(
    async (message: string) => {
      try {
        const result = await bridge.quickSign({ message });
        setView(mapView(result.view));
        setState(result.state);
      } catch (err: unknown) {
        setError((err as Error).message);
      }
    },
    []
  );

  const handleCancelSign = useCallback(async () => {
    try {
      const result = await bridge.cancelSign();
      setView(mapView(result.view));
      setState(result.state);
    } catch (err: unknown) {
      setError((err as Error).message);
    }
  }, []);

  const handleViewDiff = useCallback(
    async (signerId: string) => {
      try {
        const diff = await bridge.getDiff(signerId);
        const signer = state?.signers?.find((s) => s.id === signerId);
        setDiffSignerName(signer?.name?.split(' ')[0] ?? 'signer');
        setDiffData(diff);
        setView({ type: 'diff', signerId });
      } catch (err: unknown) {
        setError((err as Error).message);
      }
    },
    [state]
  );

  const handleViewHistory = useCallback(async () => {
    try {
      const result = await bridge.getHistory();
      setView({ type: 'history' });
      setState((prev) => (prev ? { ...prev, history: result.entries, docTitle: result.docTitle } : prev));
    } catch (err: unknown) {
      setError((err as Error).message);
    }
  }, []);

  const handleSimulateDrift = useCallback(async () => {
    try {
      const result = await bridge.simulateDrift();
      setView(mapView(result.view));
      setState(result.state);
    } catch (err: unknown) {
      setError((err as Error).message);
    }
  }, []);

  const handleResetDemo = useCallback(async () => {
    try {
      const result = await bridge.resetDemo();
      setView(mapView(result.view));
      setState(result.state);
    } catch (err: unknown) {
      setError((err as Error).message);
    }
  }, []);

  const handleGoHome = useCallback(async () => {
    try {
      const result = await bridge.goHome();
      setView(mapView(result.view));
      setState(result.state);
    } catch (err: unknown) {
      setError((err as Error).message);
    }
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
        <div className="spinner" />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 16 }}>
        <p style={{ color: '#d93025', fontSize: 13 }}>{error}</p>
        <button onClick={handleGoHome} style={{ marginTop: 12, padding: '8px 16px', borderRadius: 16, backgroundColor: '#6750a4', color: '#fff', border: 'none', cursor: 'pointer' }}>
          Retry
        </button>
      </div>
    );
  }

  switch (view.type) {
    case 'empty':
      return <EmptyState onCreateBaseline={handleCreateBaseline} />;

    case 'addSigners':
      return (
        <AddSigners
          docTitle={state?.docTitle ?? 'Untitled Document'}
          mockSigners={MOCK_SIGNERS}
          demoUserEmail={DEMO_USER_EMAIL}
          onDone={handleAddSignersDone}
        />
      );

    case 'status':
      if (!state) return <EmptyState onCreateBaseline={handleCreateBaseline} />;
      return (
        <StatusCard
          state={state}
          onSignThisDoc={() => setView({ type: 'signForm' })}
          onViewHistory={handleViewHistory}
          onViewDiff={handleViewDiff}
          onSimulateDrift={handleSimulateDrift}
          onResetDemo={handleResetDemo}
        />
      );

    case 'signForm':
      if (!state) return <EmptyState onCreateBaseline={handleCreateBaseline} />;
      return (
        <SignForm
          state={state}
          docTitle={state.docTitle}
          onSign={handleSignOff}
          onQuickSign={handleQuickSign}
          onCancel={handleCancelSign}
        />
      );

    case 'diff':
      if (!diffData || !state) return <EmptyState onCreateBaseline={handleCreateBaseline} />;
      return (
        <DiffView
          signerName={diffSignerName}
          docTitle={state.docTitle}
          diff={diffData}
          onBack={handleGoHome}
        />
      );

    case 'history':
      if (!state) return <EmptyState onCreateBaseline={handleCreateBaseline} />;
      return (
        <HistoryView
          entries={state.history}
          docTitle={state.docTitle}
          onBack={handleGoHome}
        />
      );

    default:
      return <EmptyState onCreateBaseline={handleCreateBaseline} />;
  }
}

function mapView(viewStr: string): CardView {
  switch (viewStr) {
    case 'empty': return { type: 'empty' };
    case 'addSigners': return { type: 'addSigners' };
    case 'status': return { type: 'status' };
    default: return { type: 'empty' };
  }
}
