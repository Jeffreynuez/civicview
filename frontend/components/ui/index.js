// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

// Barrel export for CivicLens UI primitives.
// Phase 2A: atomic primitives.
// Phase 2B: state primitives.
// Phase 2C will add the PhosphorIcon utility + glyph set.

// Atomic
export { default as Button } from './Button';
export { default as Card } from './Card';
export { default as Avatar } from './Avatar';
export { default as PartyChip } from './PartyChip';
export { default as Eyebrow } from './Eyebrow';

// State
export { default as Spinner } from './Spinner';
export { default as Skeleton } from './Skeleton';
export { default as EmptyState } from './EmptyState';
export { default as ErrorState } from './ErrorState';
export { default as ModalShell } from './ModalShell';

// Iconography
export {
  default as Icon,
  ICONS,
  ChatCircleDots,
  ChatText,
  Newspaper,
  MagnifyingGlass,
  BookmarkSimple,
  CalendarCheck,
  Calendar,
  CheckCircle,
  WarningCircle,
  Building,
  MapPin,
  ThumbsUp,
  ThumbsDown,
  ArrowLeft,
  ArrowRight,
  X,
  ScopeCountry,
  ScopeState,
  ScopeDistrict,
  ScopeCity,
} from './PhosphorIcon';
