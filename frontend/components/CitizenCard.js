'use client';

// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import { useEffect, useRef, useState } from 'react';
import './CitizenCard.css';
import { fetchCitizenCard } from '@/lib/formerApi';

/**
 * A citizen's name that opens their card (2026-10-15). The card shows
 * nothing that is not already public: the display name, and the
 * "Served as" line when a former official chose to carry it to their
 * citizen account. The comment itself already shows the district it
 * was written from; the card does not add the account's current state
 * or district. Plain text, no badge, no official styling (Jeffrey:
 * former officials "are considered just citizens").
 */
export default function CitizenName({ citizenId, name, className }) {
  const [open, setOpen] = useState(false);
  const [card, setCard] = useState(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open || card || !citizenId) return;
    let alive = true;
    fetchCitizenCard(citizenId).then(({ data }) => {
      if (alive) setCard(data || { display_name: name, served_as: null });
    });
    return () => { alive = false; };
  }, [open, card, citizenId, name]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!citizenId) return <span className={className}>{name}</span>;
  return (
    <span className="citizen-card__wrap" ref={wrapRef}>
      <button type="button" className={`citizen-card__name ${className || ''}`}
        aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {name}
      </button>
      {open && (
        <span className="citizen-card" role="dialog" aria-label={`About ${name}`}>
          <span className="citizen-card__title">{card?.display_name || name}</span>
          <span className="citizen-card__kind">Citizen</span>
          {card?.served_as && <span className="citizen-card__line">{card.served_as}</span>}
        </span>
      )}
    </span>
  );
}
