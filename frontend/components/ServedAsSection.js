'use client';

// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import { useEffect, useState } from 'react';
import { fetchMyServedAs, removeMyServedAs } from '@/lib/formerApi';

/**
 * The citizen's own view of their Served as line (2026-10-15). It
 * appears only when a former official linked this citizen account and
 * turned the line on. Removable any time, from here as well as from
 * the former account (which may since have been closed).
 */
export default function ServedAsSection() {
  const [line, setLine] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetchMyServedAs().then(({ data }) => setLine(data?.served_as || null));
  }, []);
  if (!line) return null;
  return (
    <section style={{
      border: '1px solid var(--cl-border)', borderRadius: 12, background: 'white',
      padding: 16, marginBottom: 18,
    }}>
      <h3 style={{ margin: '0 0 6px', fontSize: '1rem' }}>Served as line</h3>
      <p style={{ margin: '0 0 10px', fontSize: '0.85rem', lineHeight: 1.45 }}>
        Your citizen card shows: <em>{line}</em>. It is plain text from CivicView&apos;s records.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const { error } = await removeMyServedAs();
          setBusy(false);
          if (!error) setLine(null);
        }}
        style={{
          padding: '6px 12px', borderRadius: 8, border: '1px solid var(--cl-border)',
          background: 'white', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer',
        }}
      >
        Remove it
      </button>
    </section>
  );
}
