import { useState } from 'react';
import { MentionInput } from './MentionInput';

interface MockSigner {
  id: string;
  name: string;
  email: string;
}

interface AddSignersProps {
  docTitle: string;
  mockSigners: MockSigner[];
  demoUserEmail: string;
  onDone: (selectedIds: string[], customEmail: string) => void;
}

export function AddSigners({ docTitle, mockSigners, demoUserEmail, onDone }: AddSignersProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>(
    mockSigners.map((s) => s.id)
  );
  const [customEmail, setCustomEmail] = useState('');

  const handleToggle = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleDone = () => {
    onDone(selectedIds, customEmail.trim());
  };

  const availableForMention = mockSigners.filter((s) => !selectedIds.includes(s.id));

  return (
    <div>
      <div style={{ padding: '16px 16px 12px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid #e8eaed' }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', backgroundColor: '#e8def8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>✓</div>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 500 }}>Add signers</h2>
          <p style={{ fontSize: 12, color: '#5f6368', marginTop: 1 }}>{docTitle}</p>
        </div>
      </div>

      <div style={{ padding: '12px 16px', borderBottom: '1px solid #f1f3f4' }}>
        <div style={{ fontSize: 11, fontWeight: 500, color: '#5f6368', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Who needs to sign off?</div>
        {selectedIds.map((id) => {
          const signer = mockSigners.find((s) => s.id === id);
          if (!signer) return null;
          const isYou = signer.email === demoUserEmail;
          return (
            <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #f1f3f4' }}>
              <div style={{ width: 18, height: 18, borderRadius: 4, backgroundColor: '#6750a4', border: '2px solid #6750a4', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12, flexShrink: 0, cursor: 'pointer' }} onClick={() => handleToggle(id)}>✓</div>
              <span style={{ fontSize: 13, flex: 1 }}>{signer.email}</span>
              {isYou && <span style={{ fontSize: 10, backgroundColor: '#e8def8', color: '#6750a4', padding: '1px 6px', borderRadius: 8, fontWeight: 500 }}>you</span>}
            </div>
          );
        })}
      </div>

      {availableForMention.length > 0 && (
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #f1f3f4' }}>
          <div style={{ fontSize: 11, fontWeight: 500, color: '#5f6368', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Add more</div>
          <MentionInput options={availableForMention} selectedIds={selectedIds} onToggle={handleToggle} placeholder="Type @ to search..." />
        </div>
      )}

      <div style={{ padding: '12px 16px', borderBottom: '1px solid #f1f3f4' }}>
        <div style={{ fontSize: 11, fontWeight: 500, color: '#5f6368', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Add another signer</div>
        <input type="email" value={customEmail} onChange={(e) => setCustomEmail(e.target.value)} placeholder="someone@example.com" style={{ width: '100%', padding: '8px 12px', border: '1px solid #dadce0', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
      </div>

      <div style={{ padding: '12px 16px', borderTop: '1px solid #e8eaed', display: 'flex', gap: 8 }}>
        <button onClick={handleDone} style={{ flex: 1, padding: '10px 16px', borderRadius: 20, fontSize: 14, fontWeight: 500, backgroundColor: '#6750a4', color: '#fff', border: 'none', cursor: 'pointer' }}>Done</button>
      </div>
    </div>
  );
}
