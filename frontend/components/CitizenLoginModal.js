'use client';

import { useEffect, useMemo, useState } from 'react';
import { loginCitizen } from '../lib/citizenAuth';

/**
 * Citizen login modal — parallel to RepLoginModal.
 *
 * Phase 1.5 demo: 50 seeded FL citizen accounts, all sharing the same
 * password. The demo-login panel is searchable (by name or city) because
 * scanning 50 rows visually is painful.
 *
 * Props:
 *   open           — controls mount
 *   onClose()      — dismiss without signing in
 *   onSuccess(me)  — called after a successful login
 */
const DEMO_PASSWORD = '***REDACTED-DURING-PUBLIC-FLIP-AUDIT***';

// Kept in-sync with backend/demo_citizen_accounts.json. Hard-coded here
// rather than fetched because (a) the list is tiny, (b) we want the
// modal to work offline, and (c) the password is public in the seed
// anyway. If you edit the seed file, edit this list too — a test below
// will catch drift in the count but not in the contents.
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

export default function CitizenLoginModal({ open, onClose, onSuccess }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [showDemo, setShowDemo] = useState(false);
  const [demoFilter, setDemoFilter] = useState('');

  useEffect(() => {
    if (open) {
      setEmail('');
      setPassword('');
      setErr(null);
      setBusy(false);
      setShowDemo(false);
      setDemoFilter('');
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose && onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

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
      setErr(error || 'Invalid email or password');
      return;
    }
    if (onSuccess) onSuccess();
  };

  const fillDemo = (account) => {
    setEmail(account.email);
    setPassword(DEMO_PASSWORD);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Citizen login"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(20,30,60,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1400,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'white', borderRadius: '14px',
          width: 'min(460px, calc(100vw - 32px))',
          maxHeight: 'calc(100vh - 32px)',
          overflowY: 'auto',
          padding: '22px 22px 16px', boxShadow: '0 20px 60px rgba(0,0,0,0.28)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)' }}>
            Citizen sign in
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              fontSize: '1.3rem', lineHeight: 1, color: 'var(--text-light)',
            }}
          >
            ×
          </button>
        </div>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-light)', marginBottom: '10px', lineHeight: 1.45 }}>
          Verified US citizens can like, dislike, comment, and vote in polls.
          Engagement is scoped by state and district so reps can filter what
          their own constituents are saying.
        </p>
        <div
          role="note"
          style={{
            marginBottom: '14px', padding: '8px 10px',
            background: '#fff7e6', color: '#8a6100',
            border: '1px solid #ffe1a3',
            borderRadius: '8px', fontSize: '0.74rem', lineHeight: 1.5,
          }}
        >
          <strong>Demo preview.</strong> These 50 Florida accounts are
          self-attested — real identity verification (address check, one-
          person-one-account) ships in the next phase. Every engagement
          surface labels this data &ldquo;Unverified.&rdquo;
        </div>

        <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text)', marginBottom: '4px' }}>
          Email
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus
          placeholder="you@example.com"
          style={{
            width: '100%', padding: '9px 11px', borderRadius: '8px',
            border: '1px solid var(--border)', fontSize: '0.9rem',
            marginBottom: '10px', boxSizing: 'border-box', color: 'var(--text)',
            background: 'white',
          }}
        />

        <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text)', marginBottom: '4px' }}>
          Password
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          placeholder="••••••••"
          style={{
            width: '100%', padding: '9px 11px', borderRadius: '8px',
            border: '1px solid var(--border)', fontSize: '0.9rem',
            marginBottom: '10px', boxSizing: 'border-box', color: 'var(--text)',
            background: 'white',
          }}
        />

        {err && (
          <div
            role="alert"
            style={{
              marginBottom: '10px', padding: '8px 10px',
              background: '#fde8e8', color: '#b13b3b',
              borderRadius: '8px', fontSize: '0.8rem',
              border: '1px solid #f4c7c7',
            }}
          >
            {err}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={{
              border: '1px solid var(--border)', background: 'white',
              color: 'var(--text-light)', padding: '8px 14px',
              borderRadius: '8px', fontSize: '0.85rem', fontWeight: 600,
              cursor: busy ? 'wait' : 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            style={{
              border: '1px solid var(--accent)',
              background: canSubmit ? 'var(--accent)' : 'var(--bg)',
              color: canSubmit ? 'white' : 'var(--text-light)',
              padding: '8px 18px', borderRadius: '8px',
              fontSize: '0.88rem', fontWeight: 700,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
            }}
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </div>

        {/* Collapsible demo-accounts panel. Searchable because 50 is
            too many to scan by eye — users can type "Naples" or "FL-19"
            to narrow to the cluster they want to demo. */}
        <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px dashed var(--border)' }}>
          <button
            type="button"
            onClick={() => setShowDemo((s) => !s)}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--accent)', fontSize: '0.78rem', fontWeight: 600,
              padding: '0',
            }}
          >
            {showDemo
              ? `▾ Hide demo logins (${DEMO_CITIZENS.length} Florida accounts)`
              : `▸ Show demo logins (${DEMO_CITIZENS.length} Florida accounts)`}
          </button>
          {showDemo && (
            <div style={{ marginTop: '8px' }}>
              <input
                type="text"
                value={demoFilter}
                onChange={(e) => setDemoFilter(e.target.value)}
                placeholder="Filter by name, city, or district (e.g. FL-19)"
                style={{
                  width: '100%', padding: '7px 10px', borderRadius: '6px',
                  border: '1px solid var(--border)', fontSize: '0.8rem',
                  marginBottom: '8px', boxSizing: 'border-box', color: 'var(--text)',
                  background: 'white',
                }}
              />
              <div
                style={{
                  display: 'flex', flexDirection: 'column', gap: '4px',
                  maxHeight: '260px', overflowY: 'auto',
                  paddingRight: '2px',
                }}
              >
                {filteredDemos.length === 0 ? (
                  <div style={{ fontSize: '0.76rem', color: 'var(--text-light)', padding: '8px 4px' }}>
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
                        padding: '6px 10px',
                        border: '1px solid var(--border)',
                        borderRadius: '6px',
                        background: 'var(--bg)', color: 'var(--text)',
                        fontSize: '0.78rem', cursor: 'pointer',
                      }}
                      onMouseOver={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
                      onMouseOut={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                        <span style={{ fontWeight: 700 }}>{a.label}</span>
                        <span style={{
                          fontSize: '0.68rem', fontWeight: 700,
                          padding: '1px 6px', borderRadius: '10px',
                          background: 'white', border: '1px solid var(--border)',
                          color: 'var(--text-light)',
                        }}>
                          {a.cd}
                        </span>
                      </div>
                      <div style={{ color: 'var(--text-light)', fontSize: '0.7rem', marginTop: '1px' }}>
                        {a.city} · {a.email}
                      </div>
                    </button>
                  ))
                )}
              </div>
              <div style={{ color: 'var(--text-light)', fontSize: '0.7rem', marginTop: '8px', fontStyle: 'italic' }}>
                Shared demo password: <code style={{ fontSize: '0.7rem' }}>{DEMO_PASSWORD}</code>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
