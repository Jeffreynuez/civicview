'use client';

import { useEffect, useMemo, useState } from 'react';
import { loginCitizen } from '../lib/citizenAuth';
import CivicLensLogo from './brand/CivicLensLogo';
import { ModalShell, Button } from './ui';

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
const DEMO_PASSWORD = 'CivicLensVoter!2026';

const DEMO_CITIZENS = [
  { label: 'Maria Hernandez',   email: 'maria.hernandez@civiclens-voters.com',   city: 'Naples',          cd: 'FL-19' },
  { label: 'James Whitford',    email: 'james.whitford@civiclens-voters.com',    city: 'Naples',          cd: 'FL-19' },
  { label: 'Patricia Reyes',    email: 'patricia.reyes@civiclens-voters.com',    city: 'Naples',          cd: 'FL-19' },
  { label: 'David Goldman',     email: 'david.goldman@civiclens-voters.com',     city: 'Naples',          cd: 'FL-19' },
  { label: 'Emily Chen',        email: 'emily.chen@civiclens-voters.com',        city: 'Naples',          cd: 'FL-19' },
  { label: 'Anthony Brooks',    email: 'anthony.brooks@civiclens-voters.com',    city: 'Fort Myers',      cd: 'FL-19' },
  { label: 'Rosa Martinez',     email: 'rosa.martinez@civiclens-voters.com',     city: 'Fort Myers',      cd: 'FL-19' },
  { label: "Kevin O'Neill",     email: 'kevin.oneill@civiclens-voters.com',      city: 'Fort Myers',      cd: 'FL-19' },
  { label: 'Susan Albright',    email: 'susan.albright@civiclens-voters.com',    city: 'Marco Island',    cd: 'FL-19' },
  { label: 'Carlos Vega',       email: 'carlos.vega@civiclens-voters.com',       city: 'Bonita Springs',  cd: 'FL-19' },
  { label: 'Tyrone Washington', email: 'tyrone.washington@civiclens-voters.com', city: 'Orlando',         cd: 'FL-10' },
  { label: 'Ashley Rivera',     email: 'ashley.rivera@civiclens-voters.com',     city: 'Orlando',         cd: 'FL-10' },
  { label: 'Michael Patel',     email: 'michael.patel@civiclens-voters.com',     city: 'Orlando',         cd: 'FL-10' },
  { label: 'Zoe Johnson',       email: 'zoe.johnson@civiclens-voters.com',       city: 'Orlando',         cd: 'FL-10' },
  { label: 'Gregory Hanks',     email: 'gregory.hanks@civiclens-voters.com',     city: 'Winter Park',     cd: 'FL-10' },
  { label: 'Daniela Cortez',    email: 'daniela.cortez@civiclens-voters.com',    city: 'Apopka',          cd: 'FL-10' },
  { label: 'Juan Delgado',      email: 'juan.delgado@civiclens-voters.com',      city: 'Tampa',           cd: 'FL-15' },
  { label: 'Sarah Kowalski',    email: 'sarah.kowalski@civiclens-voters.com',    city: 'Tampa',           cd: 'FL-15' },
  { label: 'Marcus Greene',     email: 'marcus.greene@civiclens-voters.com',     city: 'Tampa',           cd: 'FL-15' },
  { label: 'Nadia Patel',       email: 'nadia.patel@civiclens-voters.com',       city: 'Riverview',       cd: 'FL-15' },
  { label: 'Brian Holloway',    email: 'brian.holloway@civiclens-voters.com',    city: 'Brandon',         cd: 'FL-15' },
  { label: 'Luis Fernandez',    email: 'luis.fernandez@civiclens-voters.com',    city: 'Miami',           cd: 'FL-27' },
  { label: 'Beatriz Castillo',  email: 'beatriz.castillo@civiclens-voters.com',  city: 'Miami',           cd: 'FL-27' },
  { label: 'Diane Kohler',      email: 'diane.kohler@civiclens-voters.com',      city: 'Miami',           cd: 'FL-27' },
  { label: 'Robert Laurent',    email: 'robert.laurent@civiclens-voters.com',    city: 'Coral Gables',    cd: 'FL-27' },
  { label: 'DeShawn Williams',  email: 'deshawn.williams@civiclens-voters.com',  city: 'Jacksonville',    cd: 'FL-4'  },
  { label: 'Kimberly Boyd',     email: 'kimberly.boyd@civiclens-voters.com',     city: 'Jacksonville',    cd: 'FL-4'  },
  { label: 'Thomas Macleod',    email: 'thomas.macleod@civiclens-voters.com',    city: 'Jacksonville',    cd: 'FL-4'  },
  { label: 'Ayana Harris',      email: 'ayana.harris@civiclens-voters.com',      city: 'Jacksonville',    cd: 'FL-4'  },
  { label: 'Rachel Simmons',    email: 'rachel.simmons@civiclens-voters.com',    city: 'Tallahassee',     cd: 'FL-2'  },
  { label: 'Jorge Ruiz',        email: 'jorge.ruiz@civiclens-voters.com',        city: 'Tallahassee',     cd: 'FL-2'  },
  { label: 'Priya Nair',        email: 'priya.nair@civiclens-voters.com',        city: 'Tallahassee',     cd: 'FL-2'  },
  { label: 'Naomi Feldman',     email: 'naomi.feldman@civiclens-voters.com',     city: 'West Palm Beach', cd: 'FL-22' },
  { label: 'Eric Santos',       email: 'eric.santos@civiclens-voters.com',       city: 'West Palm Beach', cd: 'FL-22' },
  { label: 'Steven Horowitz',   email: 'steven.horowitz@civiclens-voters.com',   city: 'Boca Raton',      cd: 'FL-22' },
  { label: 'Jamaal Price',      email: 'jamaal.price@civiclens-voters.com',      city: 'Boynton Beach',   cd: 'FL-21' },
  { label: 'Linda Chang',       email: 'linda.chang@civiclens-voters.com',       city: 'Boynton Beach',   cd: 'FL-21' },
  { label: 'Barbara Klein',     email: 'barbara.klein@civiclens-voters.com',     city: 'Delray Beach',    cd: 'FL-21' },
  { label: 'Christopher Ortiz', email: 'christopher.ortiz@civiclens-voters.com', city: 'St. Petersburg',  cd: 'FL-13' },
  { label: 'Monica Bennett',    email: 'monica.bennett@civiclens-voters.com',    city: 'St. Petersburg',  cd: 'FL-13' },
  { label: 'Ahmed Rahman',      email: 'ahmed.rahman@civiclens-voters.com',      city: 'St. Petersburg',  cd: 'FL-13' },
  { label: 'Lauren McAllister', email: 'lauren.mcallister@civiclens-voters.com', city: 'Gainesville',     cd: 'FL-3'  },
  { label: 'Raj Gupta',         email: 'raj.gupta@civiclens-voters.com',         city: 'Gainesville',     cd: 'FL-3'  },
  { label: 'Angela Thompson',   email: 'angela.thompson@civiclens-voters.com',   city: 'Ocala',           cd: 'FL-3'  },
  { label: 'William Fischer',   email: 'william.fischer@civiclens-voters.com',   city: 'Pensacola',       cd: 'FL-1'  },
  { label: 'Darrell Coleman',   email: 'darrell.coleman@civiclens-voters.com',   city: 'Pensacola',       cd: 'FL-1'  },
  { label: 'Sophia Ramos',      email: 'sophia.ramos@civiclens-voters.com',      city: 'Daytona Beach',   cd: 'FL-7'  },
  { label: 'Travis Nguyen',     email: 'travis.nguyen@civiclens-voters.com',     city: 'Deltona',         cd: 'FL-7'  },
  { label: 'Evelyn Richards',   email: 'evelyn.richards@civiclens-voters.com',   city: 'St. Augustine',   cd: 'FL-6'  },
  { label: 'Malik Carter',      email: 'malik.carter@civiclens-voters.com',      city: 'Palm Coast',      cd: 'FL-6'  },

  // Out-of-state accounts — one each across 10 states so the country-
  // scope filter on a rep's page has non-FL signal to differentiate
  // from the state-scope filter. Filterable here by typing the 2-letter
  // state code into the demo-filter box.
  { label: 'Olivia Nguyen',     email: 'olivia.nguyen@civiclens-voters.com',     city: 'Los Angeles, CA', cd: 'CA-34' },
  { label: 'Daniel Reed',       email: 'daniel.reed@civiclens-voters.com',       city: 'San Antonio, TX', cd: 'TX-20' },
  { label: 'Rachel Goldberg',   email: 'rachel.goldberg@civiclens-voters.com',   city: 'New York, NY',    cd: 'NY-12' },
  { label: 'Andre Walker',      email: 'andre.walker@civiclens-voters.com',      city: 'Chicago, IL',     cd: 'IL-1'  },
  { label: 'Mia Carter',        email: 'mia.carter@civiclens-voters.com',        city: 'Philadelphia, PA', cd: 'PA-3' },
  { label: 'Dwayne Alston',     email: 'dwayne.alston@civiclens-voters.com',     city: 'Cleveland, OH',   cd: 'OH-11' },
  { label: 'Kenisha Ellis',     email: 'kenisha.ellis@civiclens-voters.com',     city: 'Atlanta, GA',     cd: 'GA-5'  },
  { label: 'Elena Park',        email: 'elena.park@civiclens-voters.com',        city: 'Seattle, WA',     cd: 'WA-7'  },
  { label: 'Terrance Brooks',   email: 'terrance.brooks@civiclens-voters.com',   city: 'Detroit, MI',     cd: 'MI-13' },
  { label: 'Priscilla Novak',   email: 'priscilla.novak@civiclens-voters.com',   city: 'Arlington, VA',   cd: 'VA-8'  },
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
  const [showDemo, setShowDemo] = useState(false);
  const [demoFilter, setDemoFilter] = useState('');

  useEffect(() => {
    if (open) {
      setEmail('');
      setPassword('');
      setShowPw(false);
      setErr(null);
      setBusy(false);
      setShowDemo(false);
      setDemoFilter('');
    }
  }, [open]);

  const filteredDemos = useMemo(() => {
    const q = demoFilter.trim().toLowerCase();
    if (!q) return DEMO_CITIZENS;
    return DEMO_CITIZENS.filter((c) =>
      c.label.toLowerCase().includes(q) ||
      c.city.toLowerCase().includes(q) ||
      c.cd.toLowerCase().includes(q)
    );
  }, [demoFilter]);

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

  const fillDemo = (account) => {
    setEmail(account.email);
    setPassword(DEMO_PASSWORD);
    setErr(null);
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
          CivicLens
        </span>
      </div>

      <h2 className="cl-h1" style={{ margin: 0, marginBottom: 6 }}>
        Citizen sign in
      </h2>
      <p
        className="cl-body-sm"
        style={{ color: 'var(--cl-text-light)', margin: 0, marginBottom: 14 }}
      >
        Verified US citizens can like, dislike, comment, and vote in polls.
        Engagement is scoped by state and district so reps can filter what
        their own constituents are saying.
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
        <strong>Demo preview.</strong> These 60 accounts are self-attested —
        real identity verification (address check, one-person-one-account)
        ships in the next phase. Every engagement surface labels this data
        &ldquo;Unverified.&rdquo;
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

      {/* Searchable demo accounts */}
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
          {showDemo
            ? `▾ Hide demo logins (${DEMO_CITIZENS.length} accounts)`
            : `▸ Show demo logins (${DEMO_CITIZENS.length} accounts)`}
        </button>
        {showDemo && (
          <div style={{ marginTop: 10 }}>
            <input
              type="text"
              value={demoFilter}
              onChange={(e) => setDemoFilter(e.target.value)}
              placeholder="Filter by name, city, or district (e.g. FL-19)"
              style={{
                width: '100%',
                height: 34,
                padding: '0 10px',
                borderRadius: 'var(--cl-radius-sm)',
                border: '1px solid var(--cl-border)',
                fontSize: 'var(--cl-text-xs)',
                fontFamily: 'var(--cl-font-sans)',
                marginBottom: 8,
                boxSizing: 'border-box',
                color: 'var(--cl-text)',
                background: 'var(--cl-card)',
                outline: 'none',
              }}
            />
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                maxHeight: 260,
                overflowY: 'auto',
                paddingRight: 2,
              }}
            >
              {filteredDemos.length === 0 ? (
                <div
                  style={{
                    fontSize: 'var(--cl-text-xs)',
                    color: 'var(--cl-text-light)',
                    padding: '8px 4px',
                  }}
                >
                  No matches.
                </div>
              ) : (
                filteredDemos.map((a) => (
                  <button
                    key={a.email}
                    type="button"
                    onClick={() => fillDemo(a)}
                    style={{
                      textAlign: 'left',
                      padding: '8px 10px',
                      border: '1px solid var(--cl-border)',
                      borderRadius: 'var(--cl-radius-sm)',
                      background: 'var(--cl-bg)',
                      color: 'var(--cl-text)',
                      fontSize: 'var(--cl-text-xs)',
                      cursor: 'pointer',
                      fontFamily: 'var(--cl-font-sans)',
                      transition: 'border-color var(--cl-duration-fast) var(--cl-ease-standard)',
                    }}
                    onMouseOver={(e) => {
                      e.currentTarget.style.borderColor = 'var(--cl-accent)';
                    }}
                    onMouseOut={(e) => {
                      e.currentTarget.style.borderColor = 'var(--cl-border)';
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                      }}
                    >
                      <span style={{ fontWeight: 700 }}>{a.label}</span>
                      <span
                        style={{
                          fontSize: 'var(--cl-text-2xs)',
                          fontWeight: 700,
                          padding: '1px 6px',
                          borderRadius: 'var(--cl-radius-pill)',
                          background: 'var(--cl-card)',
                          border: '1px solid var(--cl-border)',
                          color: 'var(--cl-text-light)',
                          fontFamily: 'var(--cl-font-mono)',
                        }}
                      >
                        {a.cd}
                      </span>
                    </div>
                    <div
                      style={{
                        color: 'var(--cl-text-light)',
                        fontSize: 'var(--cl-text-2xs)',
                        marginTop: 2,
                      }}
                    >
                      {a.city} · {a.email}
                    </div>
                  </button>
                ))
              )}
            </div>
            <div
              style={{
                color: 'var(--cl-text-muted)',
                fontSize: 'var(--cl-text-2xs)',
                marginTop: 8,
                fontStyle: 'italic',
              }}
            >
              Shared demo password:{' '}
              <code
                style={{
                  fontSize: 'var(--cl-text-2xs)',
                  fontFamily: 'var(--cl-font-mono)',
                  background: 'var(--cl-bg-soft)',
                  padding: '1px 5px',
                  borderRadius: 'var(--cl-radius-xs)',
                }}
              >
                {DEMO_PASSWORD}
              </code>
            </div>
          </div>
        )}
      </div>
    </ModalShell>
  );
}
