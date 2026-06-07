
import type { DiffResult } from '../types';

interface DiffViewProps {
  signerName: string;
  docTitle: string;
  diff: DiffResult;
  onBack: () => void;
}

const SECTION_BORDER_COLORS: Record<string, string> = { added: '#1e8e3e', removed: '#d93025', modified: '#e37400' };

export function DiffView({ signerName, docTitle, diff, onBack }: DiffViewProps) {
  return (
    <div>
      <div style={{ padding: '16px 16px 12px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid #e8eaed' }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', backgroundColor: '#fef7e0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0, color: '#e37400' }}>⚠</div>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 500 }}>Changes since {signerName}&apos;s sign-off</h2>
          <p style={{ fontSize: 12, color: '#5f6368', marginTop: 1 }}>{docTitle}</p>
        </div>
      </div>

      <div style={{ padding: '12px 16px', borderBottom: '1px solid #f1f3f4' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1, padding: 10, borderRadius: 8, textAlign: 'center', backgroundColor: '#e6f4ea' }}>
            <div style={{ fontSize: 20, fontWeight: 500, color: '#1e8e3e' }}>{diff.stats.added}</div>
            <div style={{ fontSize: 10, color: '#5f6368', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.3px' }}>Added</div>
          </div>
          <div style={{ flex: 1, padding: 10, borderRadius: 8, textAlign: 'center', backgroundColor: '#fce8e6' }}>
            <div style={{ fontSize: 20, fontWeight: 500, color: '#d93025' }}>{diff.stats.removed}</div>
            <div style={{ fontSize: 10, color: '#5f6368', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.3px' }}>Removed</div>
          </div>
          <div style={{ flex: 1, padding: 10, borderRadius: 8, textAlign: 'center', backgroundColor: '#fef7e0' }}>
            <div style={{ fontSize: 20, fontWeight: 500, color: '#e37400' }}>{diff.stats.modified}</div>
            <div style={{ fontSize: 10, color: '#5f6368', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.3px' }}>Modified</div>
          </div>
        </div>
      </div>

      <div style={{ padding: '12px 16px' }}>
        <div style={{ fontSize: 11, fontWeight: 500, color: '#5f6368', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Changed sections</div>
        {diff.sections.map((sec, i) => (
          <div key={i} style={{ backgroundColor: '#f8f9fa', borderRadius: 8, padding: '10px 12px', marginBottom: 8, borderLeft: `3px solid ${SECTION_BORDER_COLORS[sec.type] ?? '#e8eaed'}` }}>
            <div style={{ fontSize: 12, fontWeight: 500 }}>{sec.title}</div>
            <div style={{ fontSize: 11, color: '#5f6368', marginTop: 3 }}>
              {sec.added > 0 && sec.removed > 0 ? `${sec.added} paragraph${sec.added > 1 ? 's' : ''} modified, ${sec.removed} paragraph${sec.removed > 1 ? 's' : ''} removed` : sec.added > 0 ? `New section added (${sec.added} paragraph${sec.added > 1 ? 's' : ''})` : sec.removed > 0 ? 'Section removed entirely' : 'Modified'}
            </div>
          </div>
        ))}
      </div>

      <div style={{ padding: '12px 16px', borderTop: '1px solid #e8eaed' }}>
        <button onClick={onBack} style={{ width: '100%', padding: '10px 16px', borderRadius: 20, fontSize: 14, fontWeight: 500, backgroundColor: '#6750a4', color: '#fff', border: 'none', cursor: 'pointer' }}>Back to status</button>
      </div>
    </div>
  );
}
