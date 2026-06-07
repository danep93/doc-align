import { Avatar } from './Avatar';
import { Chip } from './Chip';
import type { Signer } from '../types';

interface SignerRowProps {
  signer: Signer;
  onViewDiff?: (signerId: string) => void;
  isLast?: boolean;
}

function getStatusMessage(signer: Signer): { text: string; color: string } {
  if (signer.status === 'signed' && signer.commitMessage) {
    return { text: `"${signer.commitMessage}"`, color: '#5f6368' };
  }
  if (signer.status === 'drifted') {
    return { text: 'Doc changed since sign-off', color: '#e37400' };
  }
  return { text: 'Awaiting sign-off', color: '#9aa0a6' };
}

export function SignerRow({ signer, onViewDiff, isLast }: SignerRowProps) {
  const statusMsg = getStatusMessage(signer);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 0',
        borderBottom: isLast ? 'none' : '1px solid #f1f3f4',
      }}
    >
      <Avatar name={signer.name} status={signer.status} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: '#1f1f1f' }}>{signer.name}</span>
          {(signer.status === 'signed' || signer.status === 'drifted') && (
            <Chip
              label={signer.status === 'signed' ? 'Signed' : 'Drifted'}
              variant={signer.status}
              size="small"
            />
          )}
        </div>
        <div style={{ fontSize: 11, color: '#5f6368', marginTop: 1 }}>{signer.email}</div>
        <div
          style={{
            fontSize: 11,
            marginTop: 2,
            color: statusMsg.color,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              backgroundColor: statusMsg.color,
              flexShrink: 0,
            }}
          />
          {signer.status === 'signed' && signer.commitMessage ? (
            <em>{statusMsg.text}</em>
          ) : (
            statusMsg.text
          )}
        </div>
      </div>
      {signer.status === 'drifted' && onViewDiff && (
        <button
          onClick={() => onViewDiff(signer.id)}
          style={{
            padding: '4px 10px',
            borderRadius: 12,
            fontSize: 11,
            fontWeight: 500,
            backgroundColor: '#fff3e0',
            color: '#e37400',
            border: '1px solid #ffe0b2',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          View changes
        </button>
      )}
    </div>
  );
}
