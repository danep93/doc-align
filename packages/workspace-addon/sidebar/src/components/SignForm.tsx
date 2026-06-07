import { useState } from 'react';
import { Avatar } from './Avatar';
import type { AppState } from '../types';

interface SignFormProps {
  state: AppState;
  docTitle: string;
  onSign: (commitMessage: string) => void;
  onQuickSign: (message: string) => void;
  onCancel: () => void;
}

const QUICK_MESSAGES = ['LGTM', 'Approved', 'Looks good', 'Signed off'];

export function SignForm({ state, docTitle, onSign, onQuickSign, onCancel }: SignFormProps) {
  const [message, setMessage] = useState('');
  const signers = state.signers || [];
  const currentSigner = signers.find((s) => s.status === 'pending');

  const handleSubmit = () => { onSign(message.trim() || 'Signed off'); };

  return (
    <div>
      <div style={{ padding: '16px 16px 12px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid #e8eaed' }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', backgroundColor: '#d4edda', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0, color: '#1e8e3e' }}>✓</div>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 500 }}>Sign this doc</h2>
          <p style={{ fontSize: 12, color: '#5f6368', marginTop: 1 }}>{docTitle}</p>
        </div>
      </div>

      {currentSigner && (
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #f1f3f4' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', backgroundColor: '#f8f9fa', borderRadius: 8 }}>
            <Avatar name={currentSigner.name} status="signed" size={32} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{currentSigner.name}</div>
              <div style={{ fontSize: 11, color: '#5f6368' }}>{currentSigner.email}</div>
            </div>
          </div>
        </div>
      )}

      <div style={{ padding: '12px 16px', borderBottom: '1px solid #f1f3f4' }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: '#5f6368', marginBottom: 6 }}>Commit message</div>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="What are you approving?" style={{ width: '100%', padding: '8px 12px', border: '1px solid #dadce0', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', minHeight: 60, outline: 'none' }} />
      </div>

      <div style={{ padding: '12px 16px', borderBottom: '1px solid #f1f3f4' }}>
        <div style={{ fontSize: 11, fontWeight: 500, color: '#5f6368', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Quick messages</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {QUICK_MESSAGES.map((msg) => (
            <button key={msg} onClick={() => onQuickSign(msg)} style={{ padding: '5px 12px', borderRadius: 16, fontSize: 11, fontWeight: 500, backgroundColor: '#f1f3f4', color: '#3c4043', border: '1px solid #dadce0', cursor: 'pointer' }}>{msg}</button>
          ))}
        </div>
      </div>

      <div style={{ padding: '12px 16px', borderTop: '1px solid #e8eaed', display: 'flex', gap: 8 }}>
        <button onClick={handleSubmit} style={{ flex: 1, padding: '10px 16px', borderRadius: 20, fontSize: 14, fontWeight: 500, backgroundColor: '#6750a4', color: '#fff', border: 'none', cursor: 'pointer' }}>Sign</button>
        <button onClick={onCancel} style={{ flex: 1, padding: '10px 16px', borderRadius: 20, fontSize: 14, fontWeight: 500, backgroundColor: 'transparent', color: '#6750a4', border: '1px solid #e0e0e0', cursor: 'pointer' }}>Cancel</button>
      </div>
    </div>
  );
}
