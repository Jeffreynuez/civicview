'use client';

/**
 * Small circular icon button for adding/removing an official from the
 * Compare tray. Currently only Congress-member comparisons are supported,
 * so pass `disabled` for non-Congress roles to surface a greyed-out
 * preview of the affordance with an explanatory tooltip.
 *
 * Props:
 *   member           — the official dict
 *   isComparing      — boolean
 *   onCompareToggle  — handler(member) when clicked
 *   disabled         — if true, render greyed-out + tooltip; no click
 *   disabledReason   — tooltip to show when disabled
 *   size             — 'sm' (24) | 'md' (28, default)
 */
export default function CompareButton({
  member,
  isComparing = false,
  onCompareToggle,
  disabled = false,
  disabledReason = 'Comparison available for Congress members',
  size = 'md',
}) {
  if (!member) return null;
  const dim = size === 'sm' ? 24 : 28;
  const icon = dim - 10;

  const handleClick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (disabled || !onCompareToggle) return;
    onCompareToggle(member);
  };

  const title = disabled
    ? disabledReason
    : (isComparing ? 'Remove from compare' : 'Add to compare');

  return (
    <button
      type="button"
      onClick={handleClick}
      title={title}
      aria-label={title}
      aria-disabled={disabled}
      aria-pressed={isComparing}
      disabled={disabled}
      style={{
        width: `${dim}px`, height: `${dim}px`, borderRadius: '50%',
        border: isComparing ? '1.5px solid var(--cl-accent)' : '1px solid var(--cl-border)',
        background: isComparing ? 'var(--cl-accent)' : 'white',
        color: isComparing ? 'white' : (disabled ? 'var(--cl-border)' : 'var(--cl-accent)'),
        cursor: disabled ? 'not-allowed' : 'pointer',
        padding: 0, flexShrink: 0,
        opacity: disabled ? 0.55 : 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'background 0.15s, border-color 0.15s',
      }}
      onMouseOver={(e) => {
        if (!disabled && !isComparing) {
          e.currentTarget.style.background = 'var(--cl-bg)';
          e.currentTarget.style.borderColor = 'var(--cl-accent)';
        }
      }}
      onMouseOut={(e) => {
        if (!disabled && !isComparing) {
          e.currentTarget.style.background = 'white';
          e.currentTarget.style.borderColor = 'var(--cl-border)';
        }
      }}
    >
      {isComparing ? (
        // checkmark
        <svg
          width={icon} height={icon} viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="3"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        // two-bar "compare" icon (parallel columns)
        <svg
          width={icon} height={icon} viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2.2"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
        >
          <rect x="4"  y="6"  width="6" height="14" rx="1.3" />
          <rect x="14" y="3"  width="6" height="17" rx="1.3" />
        </svg>
      )}
    </button>
  );
}
