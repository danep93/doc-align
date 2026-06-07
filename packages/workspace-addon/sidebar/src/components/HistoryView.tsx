
import type { AppState, HistoryEntry } from '../types';

interface HistoryViewProps {
  entries: AppState['history'];
  docTitle: string;
  onBack: () => void;
}

function getRelativeTime(isoString: string | null): string {
  if (!isoString) return '';
  const now = new Date();
  const then = new Date(isoString);
  const diffMs = now.getTime() - then.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

function getEntryIcon(entry: HistoryEntry): { bg: string; color: string; symbol: string } {
  if (entry.status === 'signed') return { bg: '#e6f4ea', color: '#1e8e3e', symbol: '✓' };
  if (entry.status === 'drifted') return { bg: '#fef7e0', color: '#e37400', symbol: '⚠' };
  if (entry.action === 'created') return { bg: '#d2e3fc', color: '#1a73e8', symbol: '📄' };
  return { bg: '#d2e3fc', color: '#1a73e8', symbol: '' };
}

function getActionLabel(entry: HistoryEntry): string {
  if (entry.action === 'created') return 'Baseline created';
  if (entry.action === 'signed' && entry.name) return `${entry.name} signed`;
  if (entry.action === 'drifted' && entry.name) return `${entry.name} drifted`;
  return entry.action || 'Updated';
}

export function HistoryView({ entries, docTitle, onBack }: HistoryViewProps) {
  return (
    <div>
      <div style={{ padding: '16px 16px 12px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid #e8eaed' }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', backgroundColor: '#d2e3fc', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0, color: '#1a73e8' }}>📋</div>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 500 }}>History</h2>
          <p style={{ fontSize: 12, color: '#5f6368', marginTop: 1 }}>{docTitle}</p>
        </div>
      </div>

      <div style={{ padding: '12px 16px' }}>
        {entries.length === 0 ? (
          <p style={{ fontSize: 13, color: '#5f6368' }}>No history yet. Create a baseline to get started.</p>
        ) : (
          <>
            <div style={{ fontSize: 11, fontWeight: 500, color: '#5f6368', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Today</div>
            {entries.map((entry, i) => {
              const icon = getEntryIcon(entry);
              const metaParts: string[] = [];
              if (entry.revisionId) metaParts.push(`Rev ${entry.revisionId}`);
              if (entry.timestamp) metaParts.push(getRelativeTime(entry.timestamp));
              if (entry.status === 'drifted' && !entry.revisionId) metaParts.unshift('Document edited');
              return (
                <div key={i} style={{ display: 'flex', gap: 10, padding: '10px 0', borderBottom: i < entries.length - 1 ? '1px solid #f1f3f4' : 'none' }}>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', backgroundColor: icon.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0, color: icon.color }}>{icon.symbol}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{getActionLabel(entry)}</div>
                    <div style={{ fontSize: 11, color: '#5f6368', marginTop: 2 }}>{metaParts.join(' · ')}</div>
                    {entry.commitMessage && <div style={{ fontSize: 12, color: '#3c4043', marginTop: 3, fontStyle: 'italic' }}>"{entry.commitMessage}"</div>}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

      <div style={{ padding: '12px 16px', borderTop: '1px solid #e8eaed' }}>
        <button onClick={onBack} style={{ width: '100%', padding: '10px 16px', borderRadius: 20, fontSize: 14, fontWeight: 500, backgroundColor: '#6750a4', color: '#fff', border: 'none', cursor: 'pointer' }}>Back to status</button>
      </div>
    </div>
  );
}
