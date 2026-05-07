'use client';

// CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import { useEffect, useState } from 'react';
import { lookupAddress } from '@/lib/api';

const PARTY_COLORS = { R: '#e63946', D: '#457b9d', I: '#6c3ec1' };
const PARTY_NAMES = { R: 'Republican', D: 'Democrat', I: 'Independent' };

// Reverse-geocodes a (lat, lon) pair to a postal address using OpenStreetMap's
// free Nominatim service. We never log raw coordinates and never send the
// address to a third party afterwards — the address goes straight back into
// our own /api/address/lookup and never leaves the user's session.
//
// Why Nominatim:
//   - Free, no API key
//   - Decent US street-level coverage
//   - Polite rate limit (1 req/s) is fine for a "click the button once" flow
// Required attribution lives next to the button so we comply with their TOS.
async function reverseGeocode(lat, lon) {
  const url =
    'https://nominatim.openstreetmap.org/reverse' +
    `?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}` +
    '&zoom=18&addressdetails=1';
  const resp = await fetch(url, {
    headers: {
      // Nominatim asks for a non-default UA + a contact link
      'Accept-Language': 'en-US,en',
    },
  });
  if (!resp.ok) throw new Error(`Reverse geocode failed (${resp.status})`);
  const data = await resp.json();
  // Prefer the structured-address fields so we feed our backend a clean
  // "street, city, ST zip" string. Nominatim's display_name is comma-separated
  // and often includes things like neighborhood/county which our geocoder
  // doesn't need; we strip down to street + city + state + postcode.
  const a = data?.address || {};
  const street = [a.house_number, a.road].filter(Boolean).join(' ');
  const city = a.city || a.town || a.village || a.hamlet || a.suburb || '';
  const stateAbbr = STATE_ABBR[(a.state || '').toLowerCase()] || a.state || '';
  const postcode = a.postcode || '';
  const parts = [street, [city, stateAbbr, postcode].filter(Boolean).join(' ')]
    .map((s) => s && s.trim())
    .filter(Boolean);
  return parts.join(', ') || data?.display_name || '';
}

// Full-state-name → 2-letter abbreviation. Lowercased keys so the lookup
// is case-insensitive (Nominatim sometimes returns "Florida" sometimes
// "florida").
const STATE_ABBR = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC',
  florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL',
  indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
  maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI',
  minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT',
  nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC',
  'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR',
  pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT',
  vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV',
  wisconsin: 'WI', wyoming: 'WY',
};

export default function AddressLookup({ onResult, onMemberSelect }) {
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  // Separate from `loading` so the input/submit disabled state isn't toggled
  // by the geolocation phase — when the user clicks "Use my location" the
  // address field actually fills in, then we submit, and during that submit
  // the regular `loading` flag takes over.
  const [locating, setLocating] = useState(false);

  // Auto-dismiss any error banner after 10 seconds. Errors here are
  // transient ("Could not find that address.", "Location access denied.",
  // etc.) — once the user has read it once, leaving it parked indefinitely
  // wastes vertical space in the panel. The cleanup cancels the timer if
  // the error changes (or clears) before it fires.
  useEffect(() => {
    if (!error) return undefined;
    const t = setTimeout(() => setError(null), 10000);
    return () => clearTimeout(t);
  }, [error]);

  // Submits an address string. Used both by the form-submit handler and by
  // the geolocation flow (which fills the input then submits programmatically
  // so the user sees the address that was looked up).
  const submitAddress = async (addr) => {
    if (!addr || !addr.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);

    const data = await lookupAddress(addr.trim());

    if (data.success) {
      setResult(data);
      if (onResult) onResult(data);
    } else {
      setError(data.error);
    }

    setLoading(false);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    submitAddress(address);
  };

  // Geolocation handler — wired to the "Use my location" pill.
  // Gracefully degrades:
  //   1. Browser unsupported  → show "Geolocation not supported"
  //   2. User denies permission → "Location access denied. Type your address."
  //   3. Reverse-geocode fails  → "Couldn't read your location. Type your address."
  //   4. Success                → fill input + submit
  const handleUseMyLocation = () => {
    setError(null);
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError('Your browser doesn\'t support location lookup. Type your address instead.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const addr = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
          if (!addr) {
            setLocating(false);
            setError('We couldn\'t read your location. Type your address instead.');
            return;
          }
          setAddress(addr);
          setLocating(false);
          // Fire-and-forget submit so the input visibly populates first, then
          // the loading spinner takes over from there.
          submitAddress(addr);
        } catch (err) {
          setLocating(false);
          setError('We couldn\'t read your location. Type your address instead.');
        }
      },
      (err) => {
        setLocating(false);
        if (err && err.code === 1) {
          // PERMISSION_DENIED
          setError('Location access denied. Type your address instead.');
        } else if (err && err.code === 3) {
          // TIMEOUT
          setError('Location lookup timed out. Type your address instead.');
        } else {
          setError('We couldn\'t read your location. Type your address instead.');
        }
      },
      // 10s timeout, accept a 5-min cached fix (good enough for district lookup)
      { timeout: 10000, maximumAge: 5 * 60 * 1000, enableHighAccuracy: false },
    );
  };

  const MemberCard = ({ member, label }) => {
    if (!member) return null;
    const party = member.party || 'I';
    return (
      <div
        onClick={() => onMemberSelect && onMemberSelect(member)}
        style={{
          display: 'flex', alignItems: 'center', gap: '12px', padding: '12px',
          borderRadius: '10px', cursor: 'pointer', border: '1px solid var(--cl-border)',
          marginBottom: '6px', background: 'white', transition: 'all 0.15s',
        }}
        onMouseOver={(e) => { e.currentTarget.style.background = 'var(--cl-bg)'; e.currentTarget.style.borderColor = 'var(--cl-accent)'; }}
        onMouseOut={(e) => { e.currentTarget.style.background = 'white'; e.currentTarget.style.borderColor = 'var(--cl-border)'; }}
      >
        {member.photoUrl ? (
          <img
            src={member.photoUrl}
            alt={member.name}
            style={{ width: '48px', height: '48px', borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--cl-border)', flexShrink: 0 }}
            onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
          />
        ) : null}
        <div style={{
          width: '48px', height: '48px', borderRadius: '50%', background: '#e9ecef',
          display: member.photoUrl ? 'none' : 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '1rem', fontWeight: 700, color: '#999', flexShrink: 0,
        }}>
          {member.name.split(' ').map((n) => n[0]).join('')}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--cl-accent)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '2px' }}>
            {label}
          </div>
          <div style={{ fontSize: '0.92rem', fontWeight: 600 }}>{member.name}</div>
          <div style={{ fontSize: '0.78rem', color: 'var(--cl-text-light)' }}>{member.title || member.role}</div>
        </div>
        <span style={{
          padding: '2px 8px', borderRadius: '12px', fontSize: '0.7rem', fontWeight: 700,
          background: party === 'R' ? '#fde8e8' : party === 'D' ? '#e3f0f7' : '#f0eaff',
          color: PARTY_COLORS[party],
        }}>
          {PARTY_NAMES[party]}
        </span>
      </div>
    );
  };

  return (
    // Bottom padding is 0 (instead of 16) so the NOP Hero that renders
    // immediately below sits closer to the lookup. Hero brings its own
    // top padding for breathing room — stacking 16 + 16 + 40 was
    // burning ~70px of empty space between the form and the NOP eyebrow.
    <div style={{ padding: '16px 16px 0' }}>
      {/* Search Form. marginBottom 12 (down from 16) keeps a small gap
          between the form and any error/result block below it but
          doesn't pad the no-results case unnecessarily — that case is
          handled by the container padding + NOP's own top padding. */}
      <form onSubmit={handleSubmit} style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--cl-primary)', marginBottom: '8px' }}>
          Find Your Representatives
        </div>
        <p style={{ fontSize: '0.78rem', color: 'var(--cl-text-light)', marginBottom: '10px' }}>
          Enter your home address to see exactly who represents you in Congress.
        </p>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="e.g. 123 Main St, Orlando, FL 32801"
            style={{
              flex: 1, padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--cl-border)',
              fontSize: '0.88rem', outline: 'none', transition: 'border-color 0.2s',
            }}
            onFocus={(e) => (e.target.style.borderColor = 'var(--cl-accent)')}
            onBlur={(e) => (e.target.style.borderColor = 'var(--cl-border)')}
          />
          <button
            type="submit"
            disabled={loading || !address.trim()}
            style={{
              padding: '10px 18px', background: 'var(--cl-accent)', color: 'white', border: 'none',
              borderRadius: '8px', fontWeight: 600, fontSize: '0.85rem', cursor: loading ? 'wait' : 'pointer',
              opacity: loading || !address.trim() ? 0.6 : 1, whiteSpace: 'nowrap', transition: 'opacity 0.2s',
            }}
          >
            {loading ? 'Looking up...' : 'Look Up'}
          </button>
        </div>

        {/* "Use my location" affordance — sits below the input row so it
            doesn't compete with the primary Look Up CTA but is still
            within easy thumb reach. The pin icon + minimal styling
            keeps it visually quieter than the accent-blue submit button.
            Nominatim attribution is rendered next to it (their TOS
            requirement) in 11px muted text. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 8,
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            onClick={handleUseMyLocation}
            disabled={locating || loading}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 10px',
              background: 'transparent',
              color: 'var(--cl-accent)',
              border: '1px solid var(--cl-border)',
              borderRadius: 999,
              fontSize: '0.78rem',
              fontWeight: 600,
              cursor: locating || loading ? 'wait' : 'pointer',
              opacity: locating || loading ? 0.6 : 1,
              transition: 'border-color 0.15s, color 0.15s, background 0.15s',
              fontFamily: 'var(--cl-font-sans)',
            }}
            onMouseOver={(e) => {
              if (locating || loading) return;
              e.currentTarget.style.borderColor = 'var(--cl-accent)';
              e.currentTarget.style.background = 'var(--cl-accent-soft, rgba(69,123,157,0.08))';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.borderColor = 'var(--cl-border)';
              e.currentTarget.style.background = 'transparent';
            }}
            aria-label="Use my current location to find my reps"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M8 1.5C5.24 1.5 3 3.74 3 6.5c0 3.5 5 8 5 8s5-4.5 5-8c0-2.76-2.24-5-5-5zm0 7a2 2 0 110-4 2 2 0 010 4z"
                fill="currentColor"
              />
            </svg>
            {locating ? 'Locating…' : 'Use my location'}
          </button>
          <span
            style={{
              fontSize: '0.66rem',
              color: 'var(--cl-text-muted)',
              lineHeight: 1.3,
            }}
          >
            Lookup by{' '}
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--cl-text-muted)', textDecoration: 'underline' }}
            >
              OpenStreetMap
            </a>
          </span>
        </div>
      </form>

      {/* Error */}
      {error && (
        <div style={{
          padding: '12px', background: '#fde8e8', borderRadius: '8px', fontSize: '0.85rem',
          color: '#721c24', marginBottom: '12px',
        }}>
          {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <div>
          {/* District Badge */}
          <div style={{
            padding: '12px 16px', background: 'var(--cl-bg)', borderRadius: '10px',
            marginBottom: '12px', border: '1px solid var(--cl-border)',
          }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--cl-text-light)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Your District
            </div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--cl-primary)', marginTop: '2px' }}>
              {result.districtLabel || `${result.stateCode} — ${result.district || 'Unknown'}`}
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--cl-text-light)', marginTop: '2px' }}>
              {result.address}
            </div>
          </div>

          {/* Your Rep */}
          {result.yourRepresentative && (
            <MemberCard member={result.yourRepresentative} label="Your Representative" />
          )}

          {/* Your Senators */}
          {result.yourSenators.map((s) => (
            <MemberCard key={s.id} member={s} label="Your Senator" />
          ))}
        </div>
      )}
    </div>
  );
}
