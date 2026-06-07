interface ProgressBarProps {
  signed: number;
  drifted: number;
  pending: number;
  total: number;
}

export function ProgressBar({ signed, drifted, pending, total }: ProgressBarProps) {
  if (total === 0) return null;

  const signedPct = (signed / total) * 100;
  const driftedPct = (drifted / total) * 100;
  const pendingPct = (pending / total) * 100;

  return (
    <div
      style={{
        height: 6,
        backgroundColor: '#e8eaed',
        borderRadius: 3,
        overflow: 'hidden',
        display: 'flex',
      }}
    >
      {signed > 0 && (
        <div style={{ width: `${signedPct}%`, backgroundColor: '#1e8e3e', height: '100%' }} />
      )}
      {drifted > 0 && (
        <div style={{ width: `${driftedPct}%`, backgroundColor: '#e37400', height: '100%' }} />
      )}
      {pending > 0 && (
        <div style={{ width: `${pendingPct}%`, backgroundColor: '#dadce0', height: '100%' }} />
      )}
    </div>
  );
}
