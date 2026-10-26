'use client';

// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * Small pieces shared by the admin page and its tabs (2026-10-26):
 * dialog behavior, the reason box, and account kind labels. Moved out
 * of app/admin/page.js when the Accounts tab needed them too.
 */
import { useEffect, useId, useRef } from 'react';

import useFocusTrap from '@/lib/useFocusTrap';

export function kindToken(kind) {
  if (kind === 'rep') return 'rep';
  if (kind === 'candidate') return 'candidate';
  return 'citizen';
}

export function kindLabel(kind) {
  if (kind === 'rep') return 'Rep';
  if (kind === 'candidate') return 'Candidate';
  return 'Citizen';
}

// Dialog behavior for the admin modals (2026-10-26): role="dialog",
// labelled by its title, Escape closes it, Tab stays inside it.
export function useAdminDialog(onCancel) {
  const dialogRef = useRef(null);
  const titleId = useId();
  useFocusTrap(dialogRef, true);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return { dialogRef, titleId };
}

// Reason box shared by the action modals (2026-10-26). Required reasons
// need at least REASON_MIN characters; every reason is saved to the
// admin History, never shown to the author unless the label says so.
export const REASON_MIN = 3;

export function reasonOk(text) {
  return (text || '').trim().length >= REASON_MIN;
}

export function ReasonField({ value, onChange, required, label, hint, placeholder, autoFocus }) {
  const id = useId();
  return (
    <div className="ad-modal__row">
      <label className="ad-modal__label" htmlFor={id}>{label}</label>
      <textarea
        id={id}
        className="ad-modal__textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={1000}
        autoFocus={autoFocus}
      />
      <span className={`ad-modal__hint ${required && !reasonOk(value) ? 'ad-modal__hint--required' : ''}`}>
        {hint}
      </span>
    </div>
  );
}
