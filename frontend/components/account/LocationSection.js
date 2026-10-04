'use client';

// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * LocationSection: the Location card in the citizen dashboard's
 * Account & settings (2026-10-03, Jeffrey: "Edit location in
 * settings").
 *
 * Demo accounts can change state, district and city. Verified accounts
 * keep the state their verification found and can correct the
 * district. Reads the citizen from the auth store (not the dashboard's
 * reshaped prop) so it sees state, congressional_district and verified
 * exactly as /me returns them, and the save updates every reader.
 *
 * Earlier likes, votes and comments keep the district they were made
 * in; only new ones use the new location. The card says so.
 */

import { useState } from 'react';

import LocationFields, { locationComplete } from '@/components/account/LocationFields';
import { Button } from '@/components/ui';
import { updateCitizenLocation, useCitizenAuth } from '@/lib/citizenAuth';
import { STATE_NAMES, districtPickerValue, formatDistrict } from '@/lib/usStates';

const cardStyle = {
  background: 'var(--cl-card)',
  border: '1px solid var(--cl-border)',
  borderRadius: 'var(--cl-radius-xl)',
  padding: 16,
};

const mutedText = {
  margin: '0 0 10px',
  fontSize: 'var(--cl-text-sm)',
  color: 'var(--cl-text-muted)',
  lineHeight: 1.5,
};

export default function LocationSection() {
  const { citizen } = useCitizenAuth();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState({ state: '', district: '', city: '' });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null); // { tone, text }

  if (!citizen) return null;

  const state = String(citizen.state || '').toUpperCase();
  const verified = !!citizen.verified;
  const hasLocation = !citizen.needs_location;
  const city = citizen.city && citizen.city !== 'Demo City' ? citizen.city : '';

  const startEdit = () => {
    setValue({ state, district: districtPickerValue(state, citizen.congressional_district), city });
    setNote(null);
    setEditing(true);
  };

  const lockedState = verified ? state || null : null;
  const canSave = locationComplete({ ...value, state: lockedState || value.state }) && !busy;

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    setNote(null);
    const res = await updateCitizenLocation({
      state: lockedState || value.state,
      district: value.district,
      city: value.city.trim(),
    });
    setBusy(false);
    if (!res.ok) {
      setNote({ tone: 'err', text: res.error });
      return;
    }
    setEditing(false);
    setNote({
      tone: 'ok',
      text: `Saved. New likes, votes and comments count in ${formatDistrict(res.citizen.congressional_district)}; earlier ones keep the district they were made in.`,
    });
  };

  return (
    <div style={cardStyle}>
      <div style={{ marginBottom: 8 }}>
        <span className="cl-eyebrow">Location</span>
      </div>
      <p style={mutedText}>
        Likes, votes and comments are counted by your state and congressional
        district, so representatives can see what their own constituents
        think.{' '}
        {verified
          ? 'Your state comes from your identity verification; you can correct your district.'
          : 'You can change these any time.'}
      </p>

      {!editing && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 'var(--cl-text-sm)', color: 'var(--cl-text)' }}>
            {hasLocation ? (
              <>
                <strong>{formatDistrict(citizen.congressional_district)}</strong>
                {' · '}
                {STATE_NAMES[state] || state}
                {city ? ` · ${city}` : ''}
              </>
            ) : (
              <strong>Not set yet. Add it to like, vote and comment.</strong>
            )}
          </div>
          <Button variant="secondary" size="sm" onClick={startEdit}>
            {hasLocation ? 'Change' : 'Add location'}
          </Button>
        </div>
      )}

      {editing && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <LocationFields
            value={value}
            onChange={setValue}
            lockedState={lockedState}
            disabled={busy}
            idPrefix="loc-settings"
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="primary" size="md" onClick={save} loading={busy} disabled={!canSave}>
              Save
            </Button>
            <Button variant="outline" size="md" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {note && (
        <p
          role="status"
          style={{
            margin: '8px 0 0',
            fontSize: 'var(--cl-text-xs)',
            color: note.tone === 'ok' ? 'var(--cl-success, #16a34a)' : 'var(--cl-danger, #dc2626)',
          }}
        >
          {note.text}
        </p>
      )}
    </div>
  );
}
