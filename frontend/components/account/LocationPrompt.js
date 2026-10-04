'use client';

// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * LocationPrompt: asks a signed-in citizen for their state and
 * congressional district when the account has none (2026-10-03).
 *
 * Jeffrey chose "Ask, and hold engagement": an account without a
 * district (created before sign-up required one, or a verified address
 * the Census lookup couldn't place) can browse, but likes, votes,
 * comments and new polls answer 409 location_required until it picks
 * one. This window opens
 *   - once per visit, when /me says needs_location, and
 *   - whenever an engagement request comes back location_required
 *     (lib/http.js announces it with LOCATION_REQUIRED_EVENT), so every
 *     surface gets the same ask without handling the error itself.
 *
 * Verified accounts keep the state their verification found; they only
 * choose the district. Mounted once in app/layout.js (inside EmbedGate,
 * so it never appears on someone else's page).
 */

import { useEffect, useState } from 'react';

import LocationFields, { locationComplete } from '@/components/account/LocationFields';
import { Button, ModalShell } from '@/components/ui';
import { updateCitizenLocation, useCitizenAuth } from '@/lib/citizenAuth';
import { LOCATION_REQUIRED_EVENT } from '@/lib/http';
import { districtPickerValue, formatDistrict } from '@/lib/usStates';

// Once per page load: "Not now" holds until the next visit.
let askedThisVisit = false;

function initialValue(citizen) {
  const state = String(citizen?.state || '').toUpperCase();
  const city = citizen?.city && citizen.city !== 'Demo City' ? citizen.city : '';
  return { state, district: districtPickerValue(state, citizen?.congressional_district), city };
}

export default function LocationPrompt() {
  const { citizen } = useCitizenAuth();
  const [open, setOpen] = useState(false);
  const [fromAction, setFromAction] = useState(false);
  const [value, setValue] = useState(() => initialValue(null));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [saved, setSaved] = useState(null);

  const show = (action) => {
    setValue(initialValue(citizen));
    setErr(null);
    setSaved(null);
    setFromAction(action);
    setOpen(true);
  };

  // Ask once per visit when the account has no location.
  useEffect(() => {
    if (!citizen || !citizen.needs_location || citizen.self_deleted_at || askedThisVisit) return;
    askedThisVisit = true;
    show(false);
  }, [citizen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ask again whenever an engagement request is held for it.
  useEffect(() => {
    const onRequired = () => { askedThisVisit = true; show(true); };
    window.addEventListener(LOCATION_REQUIRED_EVENT, onRequired);
    return () => window.removeEventListener(LOCATION_REQUIRED_EVENT, onRequired);
  }, [citizen]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const lockedState = citizen?.verified ? String(citizen.state || '').toUpperCase() || null : null;
  const canSave = locationComplete({ ...value, state: lockedState || value.state }) && !busy;

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    setErr(null);
    const res = await updateCitizenLocation({
      state: lockedState || value.state,
      district: value.district,
      city: value.city.trim(),
    });
    setBusy(false);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    if (fromAction) {
      setSaved(formatDistrict(res.citizen.congressional_district));
      return;
    }
    setOpen(false);
  };

  return (
    <ModalShell open={open} onClose={() => setOpen(false)} width={460} cardStyle={{ padding: '24px 24px 16px' }}>
      {saved ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2 className="cl-h1" style={{ margin: 0, paddingRight: 40 }}>You&rsquo;re set</h2>
          <p className="cl-body-sm" style={{ margin: 0, color: 'var(--cl-text-light)' }}>
            Your likes, votes and comments now count in {saved}. Try that again.
          </p>
          <Button variant="primary" size="md" onClick={() => setOpen(false)} style={{ width: '100%' }}>
            Done
          </Button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* paddingRight keeps the title clear of the close button,
              which sits over the top-right corner on phones. */}
          <h2 className="cl-h1" style={{ margin: 0, paddingRight: 40 }}>Add your state and district</h2>
          <p className="cl-body-sm" style={{ margin: 0, color: 'var(--cl-text-light)', lineHeight: 1.5 }}>
            {fromAction ? 'One step before that counts. ' : ''}
            CivicView counts likes, votes and comments by state and
            congressional district, so representatives can see what their
            own constituents think. Choose yours to keep taking part. You
            can change it later in Account &amp; settings.
          </p>

          <LocationFields
            value={value}
            onChange={setValue}
            lockedState={lockedState}
            disabled={busy}
            idPrefix="loc-prompt"
          />

          {err && (
            <div
              role="alert"
              style={{
                padding: '8px 10px',
                background: 'var(--cl-danger-soft)',
                color: 'var(--cl-danger-text)',
                borderRadius: 'var(--cl-radius-md)',
                fontSize: 'var(--cl-text-xs)',
                border: '1px solid var(--cl-danger-border)',
              }}
            >
              {err}
            </div>
          )}

          <Button variant="primary" size="md" onClick={save} loading={busy} disabled={!canSave} style={{ width: '100%' }}>
            Save
          </Button>
          <Button variant="outline" size="md" onClick={() => setOpen(false)} disabled={busy} style={{ width: '100%' }}>
            Not now
          </Button>
        </div>
      )}
    </ModalShell>
  );
}
