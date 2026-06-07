interface ChipProps {
  label: string;
  variant: 'signed' | 'drifted' | 'pending';
  size?: 'small' | 'normal';
}

const CHIP_STYLES: Record<string, { bg: string; color: string }> = {
  signed: { bg: '#e6f4ea', color: '#1e8e3e' },
  drifted: { bg: '#fef7e0', color: '#e37400' },
  pending: { bg: '#f1f3f4', color: '#5f6368' },
};

export function Chip({ label, variant, size = 'normal' }: ChipProps) {
  const style = CHIP_STYLES[variant] ?? CHIP_STYLES.pending!;
  const isSmall = size === 'small';

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: isSmall ? '1px 6px' : '3px 10px',
        borderRadius: 12,
        fontSize: isSmall ? 10 : 11,
        fontWeight: 500,
        backgroundColor: style.bg,
        color: style.color,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          backgroundColor: style.color,
        }}
      />
      {label}
    </span>
  );
}
