// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/*
 * BranchChip — one chip in the additive multi-select chip row above
 * the /polls grid. Renders the chip's label, its live count for the
 * full result set, and (for the States chip when a state is selected)
 * a trailing "· FL" badge so the user can see at a glance which
 * state-narrowing is active without opening the dropdown.
 *
 * Props:
 *   filter           — { id, label, tier }   from BRANCH_FILTERS
 *   active           — bool                  is this chip currently selected
 *   count            — number                items the chip would match
 *   stateBadge       — string|null           e.g. 'FL' — shown only on the
 *                                            States chip when a state is
 *                                            chosen; falsy otherwise.
 *   onClick          — () => void            handler for the chip body
 *   onStateBadgeClick— () => void            handler for the inline
 *                                            "× state" affordance
 *                                            (clears the state filter
 *                                             without toggling the chip)
 */

export default function BranchChip({
  filter,
  active,
  count,
  stateBadge,
  onClick,
  onStateBadgeClick,
}) {
  return (
    <button
      type="button"
      className={`branch-chip branch-chip--${filter.tier} ${active ? 'is-active' : ''}`}
      aria-pressed={active}
      onClick={onClick}
    >
      <span className="branch-chip__label">{filter.label}</span>
      {stateBadge && (
        <span
          className="branch-chip__state"
          role="button"
          tabIndex={0}
          aria-label={`Clear ${stateBadge} state filter`}
          onClick={(e) => {
            // Don't fire the chip's main onClick — this is a separate
            // affordance that only clears the state badge while
            // leaving the chip itself active.
            e.stopPropagation();
            onStateBadgeClick?.();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              onStateBadgeClick?.();
            }
          }}
        >
          · {stateBadge}
        </span>
      )}
      {typeof count === 'number' && (
        <span className="branch-chip__count">{count}</span>
      )}
    </button>
  );
}
