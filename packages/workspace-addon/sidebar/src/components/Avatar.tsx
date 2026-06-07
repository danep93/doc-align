interface AvatarProps {
  name: string;
  status: 'signed' | 'drifted' | 'pending';
  size?: number;
}

const STATUS_COLORS: Record<string, string> = {
  signed: '#1e8e3e',
  drifted: '#e37400',
  pending: '#9aa0a6',
};

function getInitials(name: string): string {
  const parts = name.split(' ').filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
}

export function Avatar({ name, status, size = 36 }: AvatarProps) {
  const bgColor = STATUS_COLORS[status] || STATUS_COLORS.pending;
  const initials = getInitials(name);

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        backgroundColor: bgColor,
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.39,
        fontWeight: 500,
        flexShrink: 0,
      }}
    >
      {initials}
    </div>
  );
}
