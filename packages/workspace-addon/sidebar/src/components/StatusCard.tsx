
import { SignerRow } from './SignerRow';
import { ProgressBar } from './ProgressBar';
import { Chip } from './Chip';
import type { AppState, SignerStatus } from '../types';

interface StatusCardProps {
  state: AppState;
  onSignThisDoc: () => void;
  onViewHistory: () => void;
  onViewDiff: (signerId: string) => void;
  onSimulateDrift: () => void;
  onResetDemo: () => void;
}

function sortSignersByPriority(signers: AppState['signers']) {
  const priority: Record<SignerStatus, number> = { drifted: 0, pending: 1, signed: 2 };
  return [...signers].sort((a, b) => (priority[a.status] ?? 1) - (priority[b.status] ?? 1));
}

export function StatusCard({ state, onSignThisDoc, onViewHistory, onViewDiff, onSimulateDrift, onResetDemo }: StatusCardProps) {
  const signers = state.signers || [];
  const counts: Record<SignerStatus, number> = { signed: 0, drifted: 0, pending: 0 };
  for (const s of signers) { counts[s.status] = (counts[s.status] ?? 0) + 1; }
  const total = signers.length;
  const sorted = sortSignersByPriority(signers);

  return (
    <div>
      <div style={{ padding: '16px 16px 12px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid #e8eaed' }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', backgroundColor: '#e8def8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0, color: '#6750a4' }}>📄</div>
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: 16, fontWeight: 500 }}>{state.docTitle}</h2>
          <p style={{ fontSize: 12, color: '#5f6368', marginTop: 1 }}>{total} signer{total !== 1 ? 's' : ''}</p>
        </div>
        <div style={{ position: 'relative' }}>
          <button id="header-menu-btn" style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#5f6368', padding: '4px 8px' }} onClick={() => { const menu = document.getElementById('header-menu'); if (menu) menu.style.display = menu.style.display === 'none' ? 'block' : 'none'; }}>⋮</button>
          <div id="header-menu" style={{ display: 'none', position: 'absolute', right: 0, top: '100%', backgroundColor: '#fff', border: '1px solid #e8eaed', borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.12)', zIndex: 100, minWidth: 160 }}>
            <div onClick={() => { onSimulateDrift(); const menu = document.getElementById('header-menu'); if (menu) menu.style.display = 'none'; }} style={{ padding: '10px 16px', cursor: 'pointer', fontSize: 13 }}>Simulate drift</div>
            <div onClick={() => { onResetDemo(); const menu = document.getElementById('header-menu'); if (menu) menu.style.display = 'none'; }} style={{ padding: '10px 16px', cursor: 'pointer', fontSize: 13, color: '#d93025' }}>Reset demo</div>
          </div>
        </div>
      </div>

      <div style={{ padding: '12px 16px', borderBottom: '1px solid #f1f3f4' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>Sign-off progress</span>
          <span style={{ fontSize: 12, color: '#5f6368' }}>{counts.signed} of {total}</span>
        </div>
        <ProgressBar signed={counts.signed} drifted={counts.drifted} pending={counts.pending} total={total} />
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          {counts.signed > 0 && <Chip label={`${counts.signed} signed`} variant="signed" />}
          {counts.drifted > 0 && <Chip label={`${counts.drifted} drifted`} variant="drifted" />}
          {counts.pending > 0 && <Chip label={`${counts.pending} pending`} variant="pending" />}
        </div>
      </div>

      <div style={{ padding: '0 16px' }}>
        {sorted.map((signer, i) => (
          <SignerRow key={signer.id} signer={signer} onViewDiff={onViewDiff} isLast={i === sorted.length - 1} />
        ))}
      </div>

      <div style={{ padding: '12px 16px', borderTop: '1px solid #e8eaed', display: 'flex', gap: 8, marginTop: 12 }}>
        <button onClick={onSignThisDoc} style={{ flex: 1, padding: '10px 16px', borderRadius: 20, fontSize: 14, fontWeight: 500, backgroundColor: '#6750a4', color: '#fff', border: 'none', cursor: 'pointer' }}>Sign this doc</button>
        <button onClick={onViewHistory} style={{ flex: 1, padding: '10px 16px', borderRadius: 20, fontSize: 14, fontWeight: 500, backgroundColor: 'transparent', color: '#6750a4', border: '1px solid #e0e0e0', cursor: 'pointer' }}>History</button>
      </div>
    </div>
  );
}
