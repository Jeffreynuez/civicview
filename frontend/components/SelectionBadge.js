'use client';

/**
 * Shared "ELECTED" / "APPOINTED" / "APPT → ELECTED" badge.
 * Used on the State/Local officials tabs, on Congress member cards (PersonCard)
 * and detail views (ProfileView), and on the National officials tabs.
 *
 * Keep the style tokens in sync with the inline copies in
 * StatewideOfficialsTab.js / LocalOfficialsTab.js if you update them.
 */
const SELECTION_STYLES = {
  elected:                  { bg: '#e8f5ec', fg: '#1f7a3a', label: 'ELECTED' },
  appointed:                { bg: '#fff3e0', fg: '#a35a00', label: 'APPOINTED' },
  'appointed-then-elected': { bg: '#eef1ff', fg: '#3b44a6', label: 'APPT → ELECTED' },
};

export default function SelectionBadge({ method, detail, normallyElected, size = 'md' }) {
  if (!method) return null;
  const style =
    SELECTION_STYLES[method] ||
    { bg: 'var(--bg)', fg: 'var(--text-light)', label: String(method).toUpperCase() };
  const small = size === 'sm';
  return (
    <span
      title={
        detail ||
        (normallyElected ? 'Office is normally filled by election' : undefined)
      }
      style={{
        padding: small ? '1px 6px' : '2px 8px',
        borderRadius: '10px',
        background: style.bg,
        color: style.fg,
        fontSize: small ? '0.58rem' : '0.62rem',
        fontWeight: 800,
        letterSpacing: '0.4px',
        whiteSpace: 'nowrap',
        lineHeight: 1.4,
      }}
    >
      {style.label}
      {method === 'appointed' && normallyElected ? '*' : ''}
    </span>
  );
}
