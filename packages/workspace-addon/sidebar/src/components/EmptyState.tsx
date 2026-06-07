

interface EmptyStateProps {
  onCreateBaseline: () => void;
}

export function EmptyState({ onCreateBaseline }: EmptyStateProps) {
  return (
    <div style={{ padding: '32px 24px', textAlign: 'center' }}>
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: '50%',
          backgroundColor: '#e8def8',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 16px',
          fontSize: 28,
          color: '#6750a4',
        }}
      >
        ✓
      </div>
      <h3 style={{ fontSize: 16, fontWeight: 500, marginBottom: 6 }}>Track sign-offs</h3>
      <p style={{ fontSize: 13, color: '#5f6368', lineHeight: 1.5, marginBottom: 20 }}>
        Lock in approvals with commit messages.
        <br />
        See what changed since sign-off.
      </p>
      <button
        onClick={onCreateBaseline}
        style={{
          padding: '10px 24px',
          borderRadius: 20,
          fontSize: 14,
          fontWeight: 500,
          backgroundColor: '#6750a4',
          color: '#fff',
          border: 'none',
          cursor: 'pointer',
        }}
      >
        Create baseline
      </button>
    </div>
  );
}
