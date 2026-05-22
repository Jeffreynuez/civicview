'use client';


import { Check, BarChart3 } from 'lucide-react';
// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

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
        <Check size={14} strokeWidth={2.4} />
      ) : (
        // two-bar "compare" icon (parallel columns)
        <BarChart3 size={14} strokeWidth={2} />
      )}
    </button>
  );
}
