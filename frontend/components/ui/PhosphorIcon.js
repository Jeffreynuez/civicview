'use client';

// CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import React from 'react';

/**
 * CivicLens iconography — Phosphor Duotone, hand-inlined as SVG.
 *
 * Per design system spec (README §Iconography):
 *   - 24×24 viewBox
 *   - 2px stroke (occasionally 2.4-2.5 against the navy navbar so
 *     the outline reads at 14-16px sizes)
 *   - Linecaps `butt`, miter joins. NEVER rounded — the icon family
 *     stays angular to match the civic-document feel.
 *   - Resting state: navy stroke + accent fill at 28% opacity
 *     (duotone underlayer)
 *   - Active state: fully-filled accent (no underlayer)
 *
 * Lucide is the proposed FALLBACK when Phosphor's duotone variant
 * doesn't ship a glyph for a given concept. We don't mix them in
 * one component — pick one and finish that surface.
 *
 * This file ships an initial set of 16 glyphs covering the empty/
 * loading/error states, navigation, and reactions. Add more here
 * as new surfaces need them.
 *
 * Usage:
 *   import { ChatCircleDots, ThumbsUp } from '@/components/ui/PhosphorIcon';
 *   <ChatCircleDots size={24} />
 *   <ThumbsUp size={20} active color="up" />
 *
 *   // Or via the generic Icon:
 *   import Icon, { ICONS } from '@/components/ui/PhosphorIcon';
 *   <Icon name="chat-circle-dots" size={24} />
 */

// ─────────────────────────────────────────────────────────────────
// Color tokens for the icon. Defaults to navy stroke + accent fill,
// the canonical resting state. Pass `active` to flip to fully-filled.
// ─────────────────────────────────────────────────────────────────
const COLOR_PRESETS = {
  default: { stroke: 'var(--cl-text)',     fill: 'var(--cl-accent)' },
  accent:  { stroke: 'var(--cl-accent)',   fill: 'var(--cl-accent)' },
  up:      { stroke: 'var(--cl-up)',        fill: 'var(--cl-up)' },
  down:    { stroke: 'var(--cl-down)',      fill: 'var(--cl-down)' },
  warning: { stroke: 'var(--cl-warning-text)', fill: 'var(--cl-warning)' },
  danger:  { stroke: 'var(--cl-danger-text)',  fill: 'var(--cl-danger)' },
  muted:   { stroke: 'var(--cl-text-light)', fill: 'var(--cl-text-light)' },
  onDark:  { stroke: 'var(--cl-text-on-dark)', fill: 'var(--cl-text-on-dark)' },
};

/**
 * Base SVG wrapper. Internal — most callers should use the named
 * components below. Children should be the duotone underlayer
 * (optional, given as a path/shape with no stroke) followed by
 * the stroke outline (no fill).
 */
function IconBase({
  size = 24,
  color = 'default',
  active = false,
  strokeWidth = 2,
  underlayer = null,
  children,
  className = '',
  style = {},
  title,
  ...rest
}) {
  const palette =
    typeof color === 'object'
      ? color
      : COLOR_PRESETS[color] || COLOR_PRESETS.default;

  const dutoneOpacity = active ? 1 : 0.28;
  const strokeColor = active ? palette.fill : palette.stroke;
  const fillColor = palette.fill;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={strokeColor}
      strokeWidth={strokeWidth}
      strokeLinecap="butt"
      strokeLinejoin="miter"
      role={title ? 'img' : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : 'true'}
      className={className}
      style={style}
      {...rest}
    >
      {underlayer && (
        <g fill={fillColor} fillOpacity={dutoneOpacity} stroke="none">
          {underlayer}
        </g>
      )}
      <g>{active ? <g fill={fillColor} stroke="none">{children}</g> : children}</g>
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────
// Glyph set — 16 icons, hand-coded.
//
// Each glyph defines:
//   underlayer : the inner duotone shape (no stroke; renders at
//                28% opacity by default)
//   path       : the outline / stroke representation
//
// Geometry references the Phosphor Duotone visual language but
// is not a verbatim copy; paths are simplified for inline weight.
// ─────────────────────────────────────────────────────────────────

// chat-circle-dots — a circle with 3 dots, used for "no recent activity"
export const ChatCircleDots = (props) => (
  <IconBase
    {...props}
    underlayer={
      <path d="M12 4a8 8 0 0 0-7 11.9L4 20l4.1-1A8 8 0 1 0 12 4Z" />
    }
  >
    <path d="M12 4a8 8 0 0 0-7 11.9L4 20l4.1-1A8 8 0 1 0 12 4Z" />
    <circle cx="8" cy="12" r="1" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    <circle cx="16" cy="12" r="1" fill="currentColor" stroke="none" />
  </IconBase>
);

// chat-text — speech bubble with internal lines (comments)
export const ChatText = (props) => (
  <IconBase
    {...props}
    underlayer={
      <path d="M12 4a8 8 0 0 0-7 11.9L4 20l4.1-1A8 8 0 1 0 12 4Z" />
    }
  >
    <path d="M12 4a8 8 0 0 0-7 11.9L4 20l4.1-1A8 8 0 1 0 12 4Z" />
    <line x1="8" y1="11" x2="16" y2="11" />
    <line x1="8" y1="14" x2="14" y2="14" />
  </IconBase>
);

// newspaper — folded paper for "no posts yet"
export const Newspaper = (props) => (
  <IconBase
    {...props}
    underlayer={<rect x="3" y="5" width="18" height="14" />}
  >
    <rect x="3" y="5" width="18" height="14" />
    <line x1="6" y1="9" x2="14" y2="9" />
    <line x1="6" y1="12" x2="14" y2="12" />
    <line x1="6" y1="15" x2="11" y2="15" />
    <rect x="15" y="9" width="3" height="3" fill="currentColor" stroke="none" />
  </IconBase>
);

// magnifying-glass — for search
export const MagnifyingGlass = (props) => (
  <IconBase
    {...props}
    underlayer={<circle cx="11" cy="11" r="6" />}
  >
    <circle cx="11" cy="11" r="6" />
    <line x1="15.5" y1="15.5" x2="20" y2="20" />
  </IconBase>
);

// bookmark-simple — for tracking / "you're not tracking anyone yet"
export const BookmarkSimple = (props) => (
  <IconBase
    {...props}
    underlayer={<path d="M6 4h12v17l-6-4-6 4z" />}
  >
    <path d="M6 4h12v17l-6-4-6 4z" />
  </IconBase>
);

// calendar-check — for upcoming elections / "no elections" empty
export const CalendarCheck = (props) => (
  <IconBase
    {...props}
    underlayer={<rect x="3" y="5" width="18" height="16" />}
  >
    <rect x="3" y="5" width="18" height="16" />
    <line x1="3" y1="10" x2="21" y2="10" />
    <line x1="8" y1="3" x2="8" y2="6" />
    <line x1="16" y1="3" x2="16" y2="6" />
    <polyline points="9 15 11 17 15 13" fill="none" />
  </IconBase>
);

// calendar — generic
export const Calendar = (props) => (
  <IconBase
    {...props}
    underlayer={<rect x="3" y="5" width="18" height="16" />}
  >
    <rect x="3" y="5" width="18" height="16" />
    <line x1="3" y1="10" x2="21" y2="10" />
    <line x1="8" y1="3" x2="8" y2="6" />
    <line x1="16" y1="3" x2="16" y2="6" />
  </IconBase>
);

// check-circle — verified, success, "you're registered"
export const CheckCircle = (props) => (
  <IconBase
    {...props}
    underlayer={<circle cx="12" cy="12" r="9" />}
  >
    <circle cx="12" cy="12" r="9" />
    <polyline points="8 12.5 11 15 16 10" fill="none" />
  </IconBase>
);

// warning-circle — error / informational
export const WarningCircle = (props) => (
  <IconBase
    {...props}
    underlayer={<circle cx="12" cy="12" r="9" />}
  >
    <circle cx="12" cy="12" r="9" />
    <line x1="12" y1="8" x2="12" y2="13" />
    <circle cx="12" cy="16.5" r="0.6" fill="currentColor" stroke="none" />
  </IconBase>
);

// building — office marker on the map / "office held" field
export const Building = (props) => (
  <IconBase
    {...props}
    underlayer={<rect x="5" y="3" width="14" height="18" />}
  >
    <rect x="5" y="3" width="14" height="18" />
    <line x1="9" y1="7" x2="11" y2="7" />
    <line x1="13" y1="7" x2="15" y2="7" />
    <line x1="9" y1="11" x2="11" y2="11" />
    <line x1="13" y1="11" x2="15" y2="11" />
    <rect x="10.5" y="15" width="3" height="6" fill="none" />
  </IconBase>
);

// map-pin — polling place / address
export const MapPin = (props) => (
  <IconBase
    {...props}
    underlayer={<path d="M12 2a7 7 0 0 0-7 7c0 5.5 7 13 7 13s7-7.5 7-13a7 7 0 0 0-7-7z" />}
  >
    <path d="M12 2a7 7 0 0 0-7 7c0 5.5 7 13 7 13s7-7.5 7-13a7 7 0 0 0-7-7z" />
    <circle cx="12" cy="9" r="2.5" />
  </IconBase>
);

// thumbs-up — UP REACT (Facebook-style like)
export const ThumbsUp = (props) => (
  <IconBase
    {...props}
    underlayer={
      <path d="M7 10l4-7c1.6 0 2.5 1 2.5 2.5V9h5.5c1 0 1.7.9 1.5 1.9l-1.4 7.4A2 2 0 0 1 17 20H7z" />
    }
  >
    <path d="M7 10l4-7c1.6 0 2.5 1 2.5 2.5V9h5.5c1 0 1.7.9 1.5 1.9l-1.4 7.4A2 2 0 0 1 17 20H7z" />
    <rect x="2" y="10" width="5" height="10" />
  </IconBase>
);

// thumbs-down — DOWN REACT (burgundy disagreement)
export const ThumbsDown = (props) => (
  <IconBase
    {...props}
    underlayer={
      <path d="M7 14l4 7c1.6 0 2.5-1 2.5-2.5V15h5.5c1 0 1.7-.9 1.5-1.9l-1.4-7.4A2 2 0 0 0 17 4H7z" />
    }
  >
    <path d="M7 14l4 7c1.6 0 2.5-1 2.5-2.5V15h5.5c1 0 1.7-.9 1.5-1.9l-1.4-7.4A2 2 0 0 0 17 4H7z" />
    <rect x="2" y="4" width="5" height="10" />
  </IconBase>
);

// arrow-left — back affordances
export const ArrowLeft = (props) => (
  <IconBase {...props}>
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="11 6 5 12 11 18" fill="none" />
  </IconBase>
);

// arrow-right — forward / CTA arrows
export const ArrowRight = (props) => (
  <IconBase {...props}>
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="13 6 19 12 13 18" fill="none" />
  </IconBase>
);

// x — close / dismiss
export const X = (props) => (
  <IconBase {...props}>
    <line x1="6" y1="6" x2="18" y2="18" />
    <line x1="18" y1="6" x2="6" y2="18" />
  </IconBase>
);

// ─────────────────────────────────────────────────────────────────
// Scope chip glyphs — custom navy glyphs (per design system spec,
// NOT emoji). Used in OwnerScopeFilter / ViewerScopeFilter and the
// poll scope picker on PollCard.
//
// All four match the same duotone treatment as the rest of the
// icon family. Active scope flips white-on-accent-green; the
// IconBase active state handles the inverted fill.
// ─────────────────────────────────────────────────────────────────

// Country — five-star constellation (3 + 2 in a small grid)
export const ScopeCountry = (props) => (
  <IconBase
    {...props}
    underlayer={<rect x="3" y="5" width="18" height="14" rx="1" />}
  >
    <rect x="3" y="5" width="18" height="14" rx="1" />
    {[
      [7, 9],
      [12, 9],
      [17, 9],
      [9.5, 14],
      [14.5, 14],
    ].map(([cx, cy]) => (
      <polygon
        key={`${cx}-${cy}`}
        points={[
          `${cx},${cy - 1.5}`,
          `${cx + 0.45},${cy - 0.45}`,
          `${cx + 1.5},${cy - 0.45}`,
          `${cx + 0.6},${cy + 0.2}`,
          `${cx + 1},${cy + 1.3}`,
          `${cx},${cy + 0.6}`,
          `${cx - 1},${cy + 1.3}`,
          `${cx - 0.6},${cy + 0.2}`,
          `${cx - 1.5},${cy - 0.45}`,
          `${cx - 0.45},${cy - 0.45}`,
        ].join(' ')}
        fill="currentColor"
        stroke="none"
      />
    ))}
  </IconBase>
);

// State — fluttering flag on a pole
export const ScopeState = (props) => (
  <IconBase
    {...props}
    underlayer={<path d="M5 4 v16 M5 5 h13 l-2.5 4 2.5 4 H5" />}
  >
    <line x1="5" y1="3" x2="5" y2="21" />
    <path d="M5 5 h13 l-2.5 4 2.5 4 H5" />
  </IconBase>
);

// District — sharp seven-sided polygon outline
export const ScopeDistrict = (props) => {
  const cx = 12;
  const cy = 12;
  const r = 8;
  const sides = 7;
  const points = Array.from({ length: sides }, (_, i) => {
    const angle = (Math.PI * 2 * i) / sides - Math.PI / 2; // top vertex
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
  return (
    <IconBase {...props} underlayer={<polygon points={points} />}>
      <polygon points={points} />
    </IconBase>
  );
};

// City — three building silhouettes
export const ScopeCity = (props) => (
  <IconBase
    {...props}
    underlayer={
      <>
        <rect x="3" y="11" width="6" height="9" />
        <rect x="9" y="6" width="6" height="14" />
        <rect x="15" y="13" width="6" height="7" />
      </>
    }
  >
    <rect x="3" y="11" width="6" height="9" />
    <rect x="9" y="6" width="6" height="14" />
    <rect x="15" y="13" width="6" height="7" />
    {/* windows */}
    <line x1="11" y1="10" x2="13" y2="10" />
    <line x1="11" y1="13" x2="13" y2="13" />
    <line x1="5" y1="14" x2="7" y2="14" />
    <line x1="17" y1="16" x2="19" y2="16" />
  </IconBase>
);

// ─────────────────────────────────────────────────────────────────
// Generic dispatch — `<Icon name="chat-circle-dots" />`. Useful when
// the icon name is data-driven (e.g., from a config object).
// ─────────────────────────────────────────────────────────────────
export const ICONS = {
  'chat-circle-dots': ChatCircleDots,
  'chat-text': ChatText,
  'newspaper': Newspaper,
  'magnifying-glass': MagnifyingGlass,
  'bookmark-simple': BookmarkSimple,
  'calendar-check': CalendarCheck,
  'calendar': Calendar,
  'check-circle': CheckCircle,
  'warning-circle': WarningCircle,
  'building': Building,
  'map-pin': MapPin,
  'thumbs-up': ThumbsUp,
  'thumbs-down': ThumbsDown,
  'arrow-left': ArrowLeft,
  'arrow-right': ArrowRight,
  'x': X,
  'scope-country': ScopeCountry,
  'scope-state': ScopeState,
  'scope-district': ScopeDistrict,
  'scope-city': ScopeCity,
};

export default function Icon({ name, ...props }) {
  const Cmp = ICONS[name];
  if (!Cmp) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`<PhosphorIcon> unknown name: "${name}"`);
    }
    return null;
  }
  return <Cmp {...props} />;
}
