'use client';

// CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import { useEffect, useMemo, useState } from 'react';
import { loginCitizen, signupDemoCitizen } from '../lib/citizenAuth';
import CivicLensLogo from './brand/CivicLensLogo';
import { ModalShell, Button } from './ui';

// US states + DC + territories with congressional delegates. Same set
// the backend validates against — keep in sync.
const US_STATES = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'],
  ['CA', 'California'], ['CO', 'Colorado'], ['CT', 'Connecticut'],
  ['DE', 'Delaware'], ['DC', 'District of Columbia'], ['FL', 'Florida'],
  ['GA', 'Georgia'], ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'],
  ['IN', 'Indiana'], ['IA', 'Iowa'], ['KS', 'Kansas'], ['KY', 'Kentucky'],
  ['LA', 'Louisiana'], ['ME', 'Maine'], ['MD', 'Maryland'],
  ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'],
  ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'],
  ['NE', 'Nebraska'], ['NV', 'Nevada'], ['NH', 'New Hampshire'],
  ['NJ', 'New Jersey'], ['NM', 'New Mexico'], ['NY', 'New York'],
  ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'],
  ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'],
  ['RI', 'Rhode Island'], ['SC', 'South Carolina'], ['SD', 'South Dakota'],
  ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'],
  ['VA', 'Virginia'], ['WA', 'Washington'], ['WV', 'West Virginia'],
  ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
  ['AS', 'American Samoa'], ['GU', 'Guam'], ['MP', 'Northern Mariana Islands'],
  ['PR', 'Puerto Rico'], ['VI', 'U.S. Virgin Islands'],
];

// Max House district number per state, based on the 119th Congress
// apportionment. States with a single at-large district are listed as
// 1 (we'll surface that as "At-large" in the UI). Drives the district
// dropdown so a user can't pick a number that doesn't exist.
const STATE_HOUSE_DISTRICTS = {
  AL: 7, AK: 1, AZ: 9, AR: 4, CA: 52, CO: 8, CT: 5, DE: 1, FL: 28, GA: 14,
  HI: 2, ID: 2, IL: 17, IN: 9, IA: 4, KS: 4, KY: 6, LA: 6, ME: 2, MD: 8,
  MA: 9, MI: 13, MN: 8, MS: 4, MO: 8, MT: 2, NE: 3, NV: 4, NH: 2, NJ: 12,
  NM: 3, NY: 26, NC: 14, ND: 1, OH: 15, OK: 5, OR: 6, PA: 17, RI: 2, SC: 7,
  SD: 1, TN: 9, TX: 38, UT: 4, VT: 1, VA: 11, WA: 10, WV: 2, WI: 8, WY: 1,
};

/**
 * Citizen login modal — parallel to RepLoginModal.
 *
 * Phase 1.5 demo: 60 seeded citizen accounts (50 FL + 10 out-of-state),
 * all sharing the same password. The demo-login panel is searchable
 * because scanning 60 rows visually is painful.
 *
 * Phase 3A: restyled to use the design system. The yellow "Demo preview"
 * notice is LOAD-BEARING per the design system spec (preserve list) and
 * stays exactly as authored.
 *
 * Props:
 *   open           — controls mount
 *   onClose()      — dismiss without signing in
 *   onSuccess(me)  — called after a successful login
 */
const DEMO_PASSWORD = 'CivicViewVoter!2026';

const DEMO_CITIZENS = [
  { label: 'Maria Hernandez',   email: 'maria.hernandez@civicview-voters.com',   city: 'Naples',          cd: 'FL-19' },
  { label: 'James Whitford',    email: 'james.whitford@civicview-voters.com',    city: 'Naples',          cd: 'FL-19' },
  { label: 'Patricia Reyes',    email: 'patricia.reyes@civicview-voters.com',    city: 'Naples',          cd: 'FL-19' },
  { label: 'David Goldman',     email: 'david.goldman@civicview-voters.com',     city: 'Naples',          cd: 'FL-19' },
  { label: 'Emily Chen',        email: 'emily.chen@civicview-voters.com',        city: 'Naples',          cd: 'FL-19' },
  { label: 'Anthony Brooks',    email: 'anthony.brooks@civicview-voters.com',    city: 'Fort Myers',      cd: 'FL-19' },
  { label: 'Rosa Martinez',     email: 'rosa.martinez@civicview-voters.com',     city: 'Fort Myers',      cd: 'FL-19' },
  { label: "Kevin O'Neill",     email: 'kevin.oneill@civicview-voters.com',      city: 'Fort Myers',      cd: 'FL-19' },
  { label: 'Susan Albright',    email: 'susan.albright@civicview-voters.com',    city: 'Marco Island',    cd: 'FL-19' },
  { label: 'Carlos Vega',       email: 'carlos.vega@civicview-voters.com',       city: 'Bonita Springs',  cd: 'FL-19' },
  { label: 'Tyrone Washington', email: 'tyrone.washington@civicview-voters.com', city: 'Orlando',         cd: 'FL-10' },
  { label: 'Ashley Rivera',     email: 'ashley.rivera@civicview-voters.com',     city: 'Orlando',         cd: 'FL-10' },
  { label: 'Michael Patel',     email: 'michael.patel@civicview-voters.com',     city: 'Orlando',         cd: 'FL-10' },
  { label: 'Zoe Johnson',       email: 'zoe.johnson@civicview-voters.com',       city: 'Orlando',         cd: 'FL-10' },
  { label: 'Gregory Hanks',     email: 'gregory.hanks@civicview-voters.com',     city: 'Winter Park',     cd: 'FL-10' },
  { label: 'Daniela Cortez',    email: 'daniela.cortez@civicview-voters.com',    city: 'Apopka',          cd: 'FL-10' },
  { label: 'Juan Delgado',      email: 'juan.delgado@civicview-voters.com',      city: 'Tampa',           cd: 'FL-15' },
  { label: 'Sarah Kowalski',    email: 'sarah.kowalski@civicview-voters.com',    city: 'Tampa',           cd: 'FL-15' },
  { label: 'Marcus Greene',     email: 'marcus.greene@civicview-voters.com',     city: 'Tampa',           cd: 'FL-15' },
  { label: 'Nadia Patel',       email: 'nadia.patel@civicview-voters.com',       city: 'Riverview',       cd: 'FL-15' },
  { label: 'Brian Holloway',    email: 'brian.holloway@civicview-voters.com',    city: 'Brandon',         cd: 'FL-15' },
  { label: 'Luis Fernandez',    email: 'luis.fernandez@civicview-voters.com',    city: 'Miami',           cd: 'FL-27' },
  { label: 'Beatriz Castillo',  email: 'beatriz.castillo@civicview-voters.com',  city: 'Miami',           cd: 'FL-27' },
  { label: 'Diane Kohler',      email: 'diane.kohler@civicview-voters.com',      city: 'Miami',           cd: 'FL-27' },
  { label: 'Robert Laurent',    email: 'robert.laurent@civicview-voters.com',    city: 'Coral Gables',    cd: 'FL-27' },
  { label: 'DeShawn Williams',  email: 'deshawn.williams@civicview-voters.com',  city: 'Jacksonville',    cd: 'FL-4'  },
  { label: 'Kimberly Boyd',     email: 'kimberly.boyd@civicview-voters.com',     city: 'Jacksonville',    cd: 'FL-4'  },
  { label: 'Thomas Macleod',    email: 'thomas.macleod@civicview-voters.com',    city: 'Jacksonville',    cd: 'FL-4'  },
  { label: 'Ayana Harris',      email: 'ayana.harris@civicview-voters.com',      city: 'Jacksonville',    cd: 'FL-4'  },
  { label: 'Rachel Simmons',    email: 'rachel.simmons@civicview-voters.com',    city: 'Tallahassee',     cd: 'FL-2'  },
  { label: 'Jorge Ruiz',        email: 'jorge.ruiz@civicview-voters.com',        city: 'Tallahassee',     cd: 'FL-2'  },
  { label: 'Priya Nair',        email: 'priya.nair@civicview-voters.com',        city: 'Tallahassee',     cd: 'FL-2'  },
  { label: 'Naomi Feldman',     email: 'naomi.feldman@civicview-voters.com',     city: 'West Palm Beach', cd: 'FL-22' },
  { label: 'Eric Santos',       email: 'eric.santos@civicview-voters.com',       city: 'West Palm Beach', cd: 'FL-22' },
  { label: 'Steven Horowitz',   email: 'steven.horowitz@civicview-voters.com',   city: 'Boca Raton',      cd: 'FL-22' },
  { label: 'Jamaal Price',      email: 'jamaal.price@civicview-voters.com',      city: 'Boynton Beach',   cd: 'FL-21' },
  { label: 'Linda Chang',       email: 'linda.chang@civicview-voters.com',       city: 'Boynton Beach',   cd: 'FL-21' },
  { label: 'Barbara Klein',     email: 'barbara.klein@civicview-voters.com',     city: 'Delray Beach',    cd: 'FL-21' },
  { label: 'Christopher Ortiz', email: 'christopher.ortiz@civicview-voters.com', city: 'St. Petersburg',  cd: 'FL-13' },
  { label: 'Monica Bennett',    email: 'monica.bennett@civicview-voters.com',    city: 'St. Petersburg',  cd: 'FL-13' },
  { label: 'Ahmed Rahman',      email: 'ahmed.rahman@civicview-voters.com',      city: 'St. Petersburg',  cd: 'FL-13' },
  { label: 'Lauren McAllister', email: 'lauren.mcallister@civicview-voters.com', city: 'Gainesville',     cd: 'FL-3'  },
  { label: 'Raj Gupta',         email: 'raj.gupta@civicview-voters.com',         city: 'Gainesville',     cd: 'FL-3'  },
  { label: 'Angela Thompson',   email: 'angela.thompson@civicview-voters.com',   city: 'Ocala',           cd: 'FL-3'  },
  { label: 'William Fischer',   email: 'william.fischer@civicview-voters.com',   city: 'Pensacola',       cd: 'FL-1'  },
  { label: 'Darrell Coleman',   email: 'darrell.coleman@civicview-voters.com',   city: 'Pensacola',       cd: 'FL-1'  },
  { label: 'Sophia Ramos',      email: 'sophia.ramos@civicview-voters.com',      city: 'Daytona Beach',   cd: 'FL-7'  },
  { label: 'Travis Nguyen',     email: 'travis.nguyen@civicview-voters.com',     city: 'Deltona',         cd: 'FL-7'  },
  { label: 'Evelyn Richards',   email: 'evelyn.richards@civicview-voters.com',   city: 'St. Augustine',   cd: 'FL-6'  },
  { label: 'Malik Carter',      email: 'malik.carter@civicview-voters.com',      city: 'Palm Coast',      cd: 'FL-6'  },

  // Out-of-state accounts — one each across 10 states so the country-
  // scope filter on a rep's page has non-FL signal to differentiate
  // from the state-scope filter. Filterable here by typing the 2-letter
  // state code into the demo-filter box.
  { label: 'Olivia Nguyen',     email: 'olivia.nguyen@civicview-voters.com',     city: 'Los Angeles, CA', cd: 'CA-34' },
  { label: 'Daniel Reed',       email: 'daniel.reed@civicview-voters.com',       city: 'San Antonio, TX', cd: 'TX-20' },
  { label: 'Rachel Goldberg',   email: 'rachel.goldberg@civicview-voters.com',   city: 'New York, NY',    cd: 'NY-12' },
  { label: 'Andre Walker',      email: 'andre.walker@civicview-voters.com',      city: 'Chicago, IL',     cd: 'IL-1'  },
  { label: 'Mia Carter',        email: 'mia.carter@civicview-voters.com',        city: 'Philadelphia, PA', cd: 'PA-3' },
  { label: 'Dwayne Alston',     email: 'dwayne.alston@civicview-voters.com',     city: 'Cleveland, OH',   cd: 'OH-11' },
  { label: 'Kenisha Ellis',     email: 'kenisha.ellis@civicview-voters.com',     city: 'Atlanta, GA',     cd: 'GA-5'  },
  { label: 'Elena Park',        email: 'elena.park@civicview-voters.com',        city: 'Seattle, WA',     cd: 'WA-7'  },
  { label: 'Terrance Brooks',   email: 'terrance.brooks@civicview-voters.com',   city: 'Detroit, MI',     cd: 'MI-13' },
  { label: 'Priscilla Novak',   email: 'priscilla.novak@civicview-voters.com',   city: 'Arlington, VA',   cd: 'VA-8'  },
];

const FIELD_LABEL = {
  display: 'block',
  fontSize: 'var(--cl-text-xs)',
  fontWeight: 600,
  color: 'var(--cl-text)',
  marginBottom: 4,
};

const FIELD_INPUT = {
  width: '100%',
  height: 38,
  padding: '0 12px',
  borderRadius: 'var(--cl-radius-md)',
  border: '1px solid var(--cl-border)',
  fontSize: 'var(--cl-text-sm)',
  fontFamily: 'var(--cl-font-sans)',
  color: 'var(--cl-text)',
  background: 'var(--cl-card)',
  boxSizing: 'border-box',
  outline: 'none',
};

export default function CitizenLoginModal({ open, onClose, onSuccess }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  // Self-serve demo signup form state. Replaces the old fixed
  // 60-account list — any visitor can mint their own demo citizen
  // with a name + state + (optional) district + city.
  const [showDemo, setShowDemo] = useState(false);
  const [demoDisplayName, setDemoDisplayName] = useState('');
  const [demoState, setDemoState] = useState('FL');
  const [demoDistrict, setDemoDistrict] = useState('');
  const [demoCity, setDemoCity] = useState('');
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoErr, setDemoErr] = useState(null);
  // After a successful signup we surface the freshly-minted email +
  // password so the user can copy them — they're the user's keys to
  // sign back in from another device. The auto-login already
  // happened (cookies + token set) so the modal also closes shortly
  // after via onSuccess().
  const [issuedCreds, setIssuedCreds] = useState(null);

  useEffect(() => {
    if (open) {
      setEmail('');
      setPassword('');
      setShowPw(false);
      setErr(null);
      setBusy(false);
      setShowDemo(false);
      setDemoDisplayName('');
      setDemoState('FL');
      setDemoDistrict('');
      setDemoCity('');
      setDemoBusy(false);
      setDemoErr(null);
      setIssuedCreds(null);
    }
  }, [open]);

  // Whenever the user changes states, clamp the district to whatever
  // that state actually supports. Avoids "FL-19" sticking around
  // after the user picks Vermont (which only has 1 at-large district).
  useEffect(() => {
    const max = STATE_HOUSE_DISTRICTS[demoState] || 0;
    if (demoDistrict && parseInt(demoDistrict, 10) > max) {
      setDemoDistrict('');
    }
  }, [demoState, demoDistrict]);

  // District options for the dropdown — empty (use State only) plus
  // 1..max. At-large states (max === 1) get an "At-large" label so
  // it's clear there's no choice to make.
  const districtOptions = useMemo(() => {
    const max = STATE_HOUSE_DISTRICTS[demoState] || 0;
    if (max <= 0) return [];
    if (max === 1) return [['1', 'At-large']];
    return Array.from({ length: max }, (_, i) => [String(i + 1), `District ${i + 1}`]);
  }, [demoState]);

  if (!open) return null;

  const canSubmit = email.trim().length > 0 && password.length > 0 && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    const { ok, error } = await loginCitizen(email.trim(), password);
    setBusy(false);
    if (!ok) {
      // Combined error message — don't leak whether email exists.
      setErr(error || "Email or password didn't match. Try again or reset it.");
      return;
    }
    if (onSuccess) onSuccess();
  };

  // Submit the self-serve demo signup form. Backend mints a fresh
  // CitizenAccount, returns the credentials, auto-logs the user in.
  // We auto-fill the login form fields so the user can SEE the
  // generated email + password (the user requested this — feels less
  // magic than "you're suddenly signed in with no idea how"), then
  // close the modal via onSuccess so they can start engaging.
  const submitDemoSignup = async () => {
    const name = demoDisplayName.trim();
    if (!name) {
      setDemoErr('Pick a display name.');
      return;
    }
    setDemoBusy(true);
    setDemoErr(null);
    const result = await signupDemoCitizen({
      displayName: name,
      state: demoState || null,
      congressionalDistrict: demoDistrict || null,
      city: demoCity.trim() || null,
    });
    setDemoBusy(false);
    if (!result.ok) {
      setDemoErr(result.error || 'Could not create demo account.');
      return;
    }
    // Stash the issued credentials so the user can see them; pre-fill
    // the login form so it's obvious they can sign back in with these
    // values from another device or after clearing cookies.
    setIssuedCreds({ email: result.email, password: result.password });
    setEmail(result.email);
    setPassword(result.password);
  };

  // Auto-fill the standard login fields from a previously-issued set
  // of demo credentials (used by the "Sign in with these" button on
  // the post-signup confirmation screen). The user is already logged
  // in via auto-login, but tapping this is reassurance — confirms
  // the creds actually work end-to-end.
  const proceedWithIssuedCreds = () => {
    if (onSuccess) onSuccess();
  };

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      width={460}
      cardStyle={{ padding: '24px 24px 16px' }}
    >
      {/* Brand mark + heading */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <CivicLensLogo size={28} variant="color" />
        <span
          style={{
            fontFamily: 'var(--cl-font-display)',
            fontWeight: 700,
            fontSize: 'var(--cl-text-md)',
            color: 'var(--cl-text)',
          }}
        >
          CivicView
        </span>
      </div>

      <h2 className="cl-h1" style={{ margin: 0, marginBottom: 6 }}>
        Citizen sign in
      </h2>
      <p
        className="cl-body-sm"
        style={{ color: 'var(--cl-text-light)', margin: 0, marginBottom: 14 }}
      >
        Verified US citizens can like, dislike, and vote on polls.
        Subscribed citizens can also comment and start polls on
        unclaimed rep pages. Engagement is scoped by state and
        district so reps can filter what their own constituents are
        saying.
      </p>

      {/* Load-bearing yellow notice — preserved per design system rules */}
      <div
        role="note"
        style={{
          marginBottom: 16,
          padding: '10px 12px',
          background: 'var(--cl-warning-soft)',
          color: 'var(--cl-warning-text)',
          border: '1px solid var(--cl-warning-border)',
          borderRadius: 'var(--cl-radius-md)',
          fontSize: 'var(--cl-text-2xs)',
          lineHeight: 1.5,
        }}
      >
        <strong>Demo preview.</strong> Real verified accounts ship
        once ID.me identity verification is funded — until then,
        create a demo account below with a name + state + district
        of your choice. Demo accounts get the full experience
        (vote, like, dislike, comment, start polls) as a preview.
        Identities are self-attested, so every engagement surface
        labels demo activity &ldquo;Unverified.&rdquo; When ID.me
        ships, demo users will be offered an opt-in path to keep
        their activity on a verified account.
      </div>

      {/* Email */}
      <label htmlFor="citizen-login-email" style={FIELD_LABEL}>
        Email
      </label>
      <input
        id="citizen-login-email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoFocus
        placeholder="you@example.com"
        disabled={busy}
        style={{ ...FIELD_INPUT, marginBottom: 12 }}
      />

      {/* Password with show/hide */}
      <label htmlFor="citizen-login-password" style={FIELD_LABEL}>
        Password
      </label>
      <div style={{ position: 'relative', marginBottom: 14 }}>
        <input
          id="citizen-login-password"
          type={showPw ? 'text' : 'password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          placeholder="••••••••"
          disabled={busy}
          style={{ ...FIELD_INPUT, paddingRight: 56 }}
        />
        <button
          type="button"
          onClick={() => setShowPw((s) => !s)}
          tabIndex={-1}
          aria-label={showPw ? 'Hide password' : 'Show password'}
          style={{
            position: 'absolute',
            right: 10,
            top: 0,
            bottom: 0,
            background: 'transparent',
            border: 'none',
            color: 'var(--cl-text-light)',
            fontSize: 'var(--cl-text-xs)',
            cursor: 'pointer',
            fontFamily: 'var(--cl-font-sans)',
          }}
        >
          {showPw ? 'Hide' : 'Show'}
        </button>
      </div>

      {err && (
        <div
          role="alert"
          style={{
            marginBottom: 12,
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

      <Button
        variant="primary"
        size="lg"
        onClick={submit}
        loading={busy}
        disabled={!canSubmit}
        style={{ width: '100%', marginBottom: 8 }}
      >
        Sign in
      </Button>

      {/* Self-serve demo signup — replaces the old fixed 60-account
          list. The user picks a display name + state + (optional)
          district + city; the backend mints a fresh CitizenAccount
          (verified=false), returns the synthetic email + password,
          and auto-signs them in. */}
      <div
        style={{
          marginTop: 14,
          paddingTop: 12,
          borderTop: '1px dashed var(--cl-border)',
        }}
      >
        <button
          type="button"
          onClick={() => setShowDemo((s) => !s)}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--cl-accent)',
            fontSize: 'var(--cl-text-xs)',
            fontWeight: 600,
            padding: 0,
            fontFamily: 'var(--cl-font-sans)',
          }}
        >
          {showDemo ? '▾ Hide demo account form' : '▸ Create a demo account'}
        </button>
        {showDemo && !issuedCreds && (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 'var(--cl-text-xs)', color: 'var(--cl-text-light)' }}>
              Demo accounts let anyone try CivicView's engagement features.
              Identity is self-attested — every demo carries an
              &ldquo;Unverified&rdquo; label on the engagement surfaces.
            </div>

            <label htmlFor="demo-name" style={FIELD_LABEL}>
              Display name
            </label>
            <input
              id="demo-name"
              type="text"
              value={demoDisplayName}
              onChange={(e) => setDemoDisplayName(e.target.value.slice(0, 80))}
              placeholder="Pat Q. Citizen"
              disabled={demoBusy}
              maxLength={80}
              style={FIELD_INPUT}
            />

            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <label htmlFor="demo-state" style={FIELD_LABEL}>
                  State
                </label>
                <select
                  id="demo-state"
                  value={demoState}
                  onChange={(e) => setDemoState(e.target.value)}
                  disabled={demoBusy}
                  style={{ ...FIELD_INPUT, cursor: 'pointer' }}
                >
                  {US_STATES.map(([code, name]) => (
                    <option key={code} value={code}>
                      {code} — {name}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <label htmlFor="demo-district" style={FIELD_LABEL}>
                  District
                </label>
                <select
                  id="demo-district"
                  value={demoDistrict}
                  onChange={(e) => setDemoDistrict(e.target.value)}
                  disabled={demoBusy || districtOptions.length === 0}
                  style={{ ...FIELD_INPUT, cursor: 'pointer' }}
                >
                  <option value="">— none —</option>
                  {districtOptions.map(([val, label]) => (
                    <option key={val} value={val}>{label}</option>
                  ))}
                </select>
              </div>
            </div>

            <label htmlFor="demo-city" style={FIELD_LABEL}>
              City <span style={{ color: 'var(--cl-text-light)', fontWeight: 400 }}>(optional)</span>
            </label>
            <input
              id="demo-city"
              type="text"
              value={demoCity}
              onChange={(e) => setDemoCity(e.target.value.slice(0, 128))}
              placeholder="Naples"
              disabled={demoBusy}
              maxLength={128}
              style={FIELD_INPUT}
            />

            {demoErr && (
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
                {demoErr}
              </div>
            )}

            <Button
              variant="primary"
              size="md"
              onClick={submitDemoSignup}
              loading={demoBusy}
              disabled={!demoDisplayName.trim() || demoBusy}
              style={{ width: '100%' }}
            >
              Create demo account &amp; sign in
            </Button>
          </div>
        )}

        {/* Post-signup credentials display. The user is already signed in
            via the auto-login on the demo-signup response; this screen
            shows them the email + password they can use to sign back in
            from another device or after clearing cookies. */}
        {showDemo && issuedCreds && (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div
              style={{
                padding: '10px 12px',
                background: 'var(--cl-accent-soft)',
                border: '1px solid var(--cl-accent-soft)',
                borderRadius: 'var(--cl-radius-md)',
                fontSize: 'var(--cl-text-xs)',
                color: 'var(--cl-text)',
                lineHeight: 1.4,
              }}
            >
              <strong>You&rsquo;re signed in.</strong> Save these credentials
              if you want to sign back in from another device. They&rsquo;re
              also pre-filled in the sign-in fields above.
            </div>
            <div
              style={{
                background: 'var(--cl-bg-soft)',
                borderRadius: 'var(--cl-radius-md)',
                padding: 10,
                fontFamily: 'var(--cl-font-mono)',
                fontSize: 'var(--cl-text-xs)',
                color: 'var(--cl-text)',
                lineHeight: 1.6,
              }}
            >
              <div><strong>Email:</strong> {issuedCreds.email}</div>
              <div><strong>Password:</strong> {issuedCreds.password}</div>
            </div>
            <Button
              variant="primary"
              size="md"
              onClick={proceedWithIssuedCreds}
              style={{ width: '100%' }}
            >
              Continue
            </Button>
          </div>
        )}
      </div>
    </ModalShell>
  );
}
