'use client';

// CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import { useEffect, useMemo, useState } from 'react';
import {
  fetchLocalCities,
  fetchLocalOfficials,
  fetchStateOfficials,
} from '@/lib/api';
import FollowButton from './FollowButton';
import CompareButton from './CompareButton';

/**
 * Local officials tab with a three-way sub-nav:
 *   Cities    — searchable dropdown → mayor (open) + council (dropdown)
 *   Counties  — list counties derived from the seeded city index; drill in
 *               to see cities in county + state legislators representing it
 *   Districts — state senate + state house + congressional districts with
 *               the member for each district as the primary detail
 *
 * When `initialCitySlug` is set (from address lookup), auto-opens the
 * Cities view on that city.
 */
export default function LocalOfficialsTab({ stateCode, stateName, initialCitySlug, onNotify, onCompareToggle, compareIds }) {
  const [view, setView] = useState('cities'); // 'cities' | 'counties' | 'districts'

  // Shared data
  const [cities, setCities] = useState([]);
  const [loadingCities, setLoadingCities] = useState(false);
  const [stateOfficials, setStateOfficials] = useState(null);
  const [loadingOfficials, setLoadingOfficials] = useState(false);

  // City detail
  const [citySlug, setCitySlug] = useState(initialCitySlug || null);
  const [cityData, setCityData] = useState(null);
  const [loadingCity, setLoadingCity] = useState(false);
  const [cityNotFound, setCityNotFound] = useState(false);

  // County and district selection
  const [selectedCounty, setSelectedCounty] = useState(null);
  const [selectedDistrict, setSelectedDistrict] = useState(null); // { chamber, district }

  // Load the city index
  useEffect(() => {
    if (!stateCode) return;
    let cancelled = false;
    setLoadingCities(true);
    (async () => {
      const { data } = await fetchLocalCities(stateCode);
      if (!cancelled) {
        setCities(data || []);
        setLoadingCities(false);
      }
    })();
    return () => { cancelled = true; };
  }, [stateCode]);

  // Load state officials once — used for counties / districts derivation
  useEffect(() => {
    if (!stateCode) return;
    let cancelled = false;
    setLoadingOfficials(true);
    (async () => {
      const res = await fetchStateOfficials(stateCode);
      if (!cancelled) {
        setStateOfficials(res?.notSeeded ? null : res.data);
        setLoadingOfficials(false);
      }
    })();
    return () => { cancelled = true; };
  }, [stateCode]);

  // Auto-open the city picked via address lookup
  useEffect(() => {
    setCitySlug(initialCitySlug || null);
    setSelectedCounty(null);
    setSelectedDistrict(null);
    if (initialCitySlug) setView('cities');
  }, [stateCode, initialCitySlug]);

  // Load a city's detail when picked
  useEffect(() => {
    if (!stateCode || !citySlug) { setCityData(null); setCityNotFound(false); return; }
    let cancelled = false;
    setLoadingCity(true);
    setCityNotFound(false);
    (async () => {
      const res = await fetchLocalOfficials(stateCode, citySlug);
      if (cancelled) return;
      if (res.notSeeded) {
        setCityNotFound(true);
        setCityData(null);
      } else {
        setCityData(res.data);
      }
      setLoadingCity(false);
    })();
    return () => { cancelled = true; };
  }, [stateCode, citySlug]);

  // Counties derived from the seeded city index
  const counties = useMemo(() => {
    const map = new Map();
    for (const c of cities) {
      const key = c.county || 'Unknown';
      if (!map.has(key)) map.set(key, { county: key, cities: [], population: 0 });
      const row = map.get(key);
      row.cities.push(c);
      row.population += c.population || 0;
    }
    return Array.from(map.values()).sort((a, b) => b.population - a.population);
  }, [cities]);

  // Districts derived from state officials — one entry per member
  const districts = useMemo(() => {
    if (!stateOfficials) return { senate: [], house: [] };
    const flatten = (group) => [...(group?.leadership || []), ...(group?.members || [])];
    const senate = flatten(stateOfficials.state_senate)
      .map((m) => ({ ...m, chamber: 'State Senate' }))
      .sort((a, b) => Number(a.district) - Number(b.district));
    const house = flatten(stateOfficials.state_house)
      .map((m) => ({ ...m, chamber: 'State House' }))
      .sort((a, b) => Number(a.district) - Number(b.district));
    return { senate, house };
  }, [stateOfficials]);

  // Early: no data at all
  if (loadingCities && !cities.length) return <Loading>Loading cities…</Loading>;
  if (!cities.length && !loadingCities) {
    return (
      <EmptyState>
        <div style={{ fontWeight: 600, marginBottom: '6px', color: 'var(--cl-text)' }}>
          Local data not yet available for {stateName || stateCode}
        </div>
        <div>We&apos;re curating mayors and city councils in the largest metros first. Florida&apos;s top 6 are live.</div>
      </EmptyState>
    );
  }

  return (
    <div>
      {/* Sub-nav */}
      <SubNav
        view={view}
        onChange={(v) => {
          setView(v);
          if (v !== 'cities') setCitySlug(null);
          if (v !== 'counties') setSelectedCounty(null);
          if (v !== 'districts') setSelectedDistrict(null);
        }}
      />

      {view === 'cities' && (
        <CitiesView
          cities={cities}
          citySlug={citySlug}
          onPick={setCitySlug}
          cityData={cityData}
          cityNotFound={cityNotFound}
          loading={loadingCity}
          stateCode={stateCode}
          onNotify={onNotify}
          onCompareToggle={onCompareToggle}
          compareIds={compareIds}
        />
      )}

      {view === 'counties' && (
        <CountiesView
          counties={counties}
          selectedCounty={selectedCounty}
          onPick={setSelectedCounty}
          districts={districts}
          judiciary={stateOfficials?.judiciary || null}
          loading={loadingOfficials}
          stateCode={stateCode}
          onNotify={onNotify}
          onCompareToggle={onCompareToggle}
          compareIds={compareIds}
        />
      )}

      {view === 'districts' && (
        <DistrictsView
          districts={districts}
          selected={selectedDistrict}
          onPick={setSelectedDistrict}
          cities={cities}
          loading={loadingOfficials}
          stateCode={stateCode}
          onNotify={onNotify}
          onCompareToggle={onCompareToggle}
          compareIds={compareIds}
        />
      )}
    </div>
  );
}

// ─── Sub-nav ────────────────────────────────────────────────────────
function SubNav({ view, onChange }) {
  const items = [
    { key: 'cities', label: 'Cities' },
    { key: 'counties', label: 'Counties' },
    { key: 'districts', label: 'Districts' },
  ];
  return (
    <div style={{
      display: 'flex', gap: '6px', padding: '6px', marginBottom: '12px',
      background: 'var(--cl-bg)', border: '1px solid var(--cl-border)', borderRadius: '12px',
    }}>
      {items.map((it) => (
        <button
          key={it.key}
          onClick={() => onChange(it.key)}
          style={{
            flex: 1, padding: '6px 10px', fontSize: '0.78rem', fontWeight: 700,
            background: view === it.key ? 'white' : 'transparent',
            color: view === it.key ? 'var(--cl-primary)' : 'var(--cl-text-light)',
            border: view === it.key ? '1px solid var(--cl-border)' : '1px solid transparent',
            borderRadius: '8px', cursor: 'pointer',
          }}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

// Helper: build a followTarget snapshot for a local/state official.
// Injects role_type, state, and a chamber fallback so the trackedOfficials
// store carries enough context to identify the person later.
function buildFollowTarget(person, roleType, extras = {}) {
  if (!person) return null;
  return {
    ...person,
    id: person.id,
    bioguide_id: person.bioguide_id || null,
    name: person.name,
    party: person.party || null,
    title: person.role || person.title || '',
    role_type: roleType,
    photoUrl: person.image || person.photoUrl || null,
    ...extras,
  };
}

// ─── Cities view ────────────────────────────────────────────────────
function CitiesView({ cities, citySlug, onPick, cityData, cityNotFound, loading, stateCode, onNotify, onCompareToggle, compareIds }) {
  const [query, setQuery] = useState('');

  // Split by tier — "major" is the curated top metros, everything else is "city".
  const { majors, others } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (c) => {
      if (!q) return true;
      return c.city.toLowerCase().includes(q) || (c.county || '').toLowerCase().includes(q);
    };
    const majors = [];
    const others = [];
    for (const c of cities) {
      if (!matches(c)) continue;
      if (c.tier === 'major') majors.push(c);
      else others.push(c);
    }
    return { majors, others };
  }, [cities, query]);

  if (!citySlug) {
    // If the user is searching and exactly one group is empty, still show both
    // sections for consistency — matched list will render; empty section shows 0.
    const expandOthersByQuery = Boolean(query) && majors.length === 0 && others.length > 0;

    return (
      <div>
        <SearchInput
          placeholder={`Search ${cities.length} ${cities.length === 1 ? 'city' : 'cities'}…`}
          value={query}
          onChange={setQuery}
        />

        <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          <Collapsible title="Major Cities" count={majors.length} defaultOpen>
            {majors.length > 0 ? (
              majors.map((c) => (
                <CityRow key={c.slug} city={c} onClick={() => onPick(c.slug)} />
              ))
            ) : (
              <div style={{ padding: '8px 12px', color: 'var(--cl-text-light)', fontSize: '0.8rem' }}>
                {query
                  ? <>No major cities matched &ldquo;{query}&rdquo;.</>
                  : 'No major cities seeded.'}
              </div>
            )}
          </Collapsible>

          <Collapsible title="Cities" count={others.length} defaultOpen={expandOthersByQuery}>
            {others.length > 0 ? (
              others.map((c) => (
                <CityRow key={c.slug} city={c} onClick={() => onPick(c.slug)} />
              ))
            ) : (
              <div style={{ padding: '8px 12px', color: 'var(--cl-text-light)', fontSize: '0.8rem' }}>
                {query
                  ? <>No cities matched &ldquo;{query}&rdquo;.</>
                  : 'No additional cities seeded.'}
              </div>
            )}
          </Collapsible>
        </div>
      </div>
    );
  }

  return (
    <div>
      <BackButton onClick={() => onPick(null)}>← All cities</BackButton>
      {loading && <Loading>Loading…</Loading>}
      {cityNotFound && <EmptyState>No local-officials data seeded for this city yet.</EmptyState>}
      {cityData && (
        <CityDetail
          city={cityData}
          stateCode={stateCode}
          onNotify={onNotify}
          onCompareToggle={onCompareToggle}
          compareIds={compareIds}
        />
      )}
    </div>
  );
}

function CityRow({ city, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '12px',
        padding: '10px 12px', background: 'white', border: '1px solid var(--cl-border)',
        borderRadius: '10px', marginBottom: '6px', cursor: 'pointer',
      }}
      onMouseOver={(e) => { e.currentTarget.style.borderColor = 'var(--cl-accent)'; e.currentTarget.style.background = 'var(--cl-bg)'; }}
      onMouseOut={(e) => { e.currentTarget.style.borderColor = 'var(--cl-border)'; e.currentTarget.style.background = 'white'; }}
    >
      <div style={{
        width: '34px', height: '34px', borderRadius: '10px', background: 'var(--cl-bg)',
        color: 'var(--cl-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '1.05rem', flexShrink: 0,
      }}>
        🏛
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.9rem', fontWeight: 700 }}>{city.city}</div>
        <div style={{ fontSize: '0.72rem', color: 'var(--cl-text-light)' }}>
          {city.county} County · pop. {city.population?.toLocaleString() || '—'}
        </div>
      </div>
      <span style={{ fontSize: '0.72rem', color: 'var(--cl-accent)', fontWeight: 700 }}>→</span>
    </button>
  );
}

function CityDetail({ city, stateCode, onNotify, onCompareToggle, compareIds }) {
  const mayor = city.officials?.mayor;
  const body = city.officials?.body_members || [];
  const bodyName = city.officials?.body_name || 'Council';
  const stateUp = stateCode ? stateCode.toUpperCase() : null;

  return (
    <div>
      <CityBanner city={city} />

      {/* Mayor — remains open */}
      {mayor && (
        <div style={{ marginBottom: '12px' }}>
          <SectionLabel>Mayor</SectionLabel>
          <OfficialCard
            name={mayor.name}
            party={mayor.party}
            subtitle={mayor.role}
            meta={[
              mayor.serving_since ? `Serving since ${new Date(mayor.serving_since).getFullYear()}` : null,
              mayor.term_end ? `Term ends ${new Date(mayor.term_end).getFullYear()}` : null,
            ].filter(Boolean)}
            website={mayor.website}
            big
            followTarget={buildFollowTarget(mayor, 'local_mayor', {
              chamber: city.city ? `${city.city} City Hall` : 'City Hall',
              state: stateUp,
              city: city.city,
              county: city.county,
            })}
            onNotify={onNotify}
            onCompareToggle={onCompareToggle}
            compareIds={compareIds}
          />
        </div>
      )}

      {/* Council / Commission — collapsed by default */}
      {body.length > 0 && (
        <Collapsible title={bodyName} count={body.length}>
          {body.map((m) => (
            <OfficialCard
              key={m.id}
              name={m.name}
              party={m.party}
              subtitle={`${m.district ? `District ${m.district} · ` : ''}${m.role}`}
              followTarget={buildFollowTarget(m, 'local_council', {
                chamber: bodyName,
                state: stateUp,
                city: city.city,
                county: city.county,
                district: m.district || null,
              })}
              onNotify={onNotify}
              onCompareToggle={onCompareToggle}
              compareIds={compareIds}
            />
          ))}
        </Collapsible>
      )}
    </div>
  );
}

function CityBanner({ city }) {
  return (
    <div style={{
      padding: '14px 16px', background: 'var(--cl-bg)', border: '1px solid var(--cl-border)',
      borderRadius: '12px', marginBottom: '12px',
    }}>
      <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>{city.city}</div>
      <div style={{ fontSize: '0.78rem', color: 'var(--cl-text-light)', marginTop: '2px' }}>
        {city.county} County · {city.government_type || 'Municipal government'}
      </div>
      {city.website && (
        <a
          href={city.website} target="_blank" rel="noopener noreferrer"
          style={{ fontSize: '0.76rem', color: 'var(--cl-accent)', textDecoration: 'none', fontWeight: 600, marginTop: '4px', display: 'inline-block' }}
        >
          {city.website.replace(/^https?:\/\//, '')} ↗
        </a>
      )}
    </div>
  );
}

// ─── Counties view ──────────────────────────────────────────────────
function CountiesView({ counties, selectedCounty, onPick, districts, judiciary, loading, stateCode, onNotify, onCompareToggle, compareIds }) {
  const [query, setQuery] = useState('');

  if (!selectedCounty) {
    const filtered = counties.filter((c) =>
      !query || c.county.toLowerCase().includes(query.toLowerCase())
    );
    return (
      <div>
        <SearchInput
          placeholder={`Search ${counties.length} counties…`}
          value={query}
          onChange={setQuery}
        />
        <div style={{
          fontSize: '0.72rem', color: 'var(--cl-text-light)', fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: '0.5px', padding: '8px 10px',
        }}>
          Counties ({filtered.length})
        </div>
        <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          {filtered.map((row) => (
            <button
              key={row.county}
              onClick={() => onPick(row.county)}
              style={{
                width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '12px',
                padding: '10px 12px', background: 'white', border: '1px solid var(--cl-border)',
                borderRadius: '10px', marginBottom: '6px', cursor: 'pointer',
              }}
              onMouseOver={(e) => { e.currentTarget.style.borderColor = 'var(--cl-accent)'; e.currentTarget.style.background = 'var(--cl-bg)'; }}
              onMouseOut={(e) => { e.currentTarget.style.borderColor = 'var(--cl-border)'; e.currentTarget.style.background = 'white'; }}
            >
              <div style={{
                width: '34px', height: '34px', borderRadius: '10px', background: 'var(--cl-bg)',
                color: 'var(--cl-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '1.05rem', flexShrink: 0,
              }}>
                🗺
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.9rem', fontWeight: 700 }}>{row.county} County</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--cl-text-light)' }}>
                  {row.cities.length} {row.cities.length === 1 ? 'city' : 'cities'} seeded · pop. {row.population.toLocaleString()}
                </div>
              </div>
              <span style={{ fontSize: '0.72rem', color: 'var(--cl-accent)', fontWeight: 700 }}>→</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const row = counties.find((c) => c.county === selectedCounty);
  if (!row) return null;

  return (
    <div>
      <BackButton onClick={() => onPick(null)}>← All counties</BackButton>

      <div style={{
        padding: '14px 16px', background: 'var(--cl-bg)', border: '1px solid var(--cl-border)',
        borderRadius: '12px', marginBottom: '12px',
      }}>
        <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>{row.county} County</div>
        <div style={{ fontSize: '0.78rem', color: 'var(--cl-text-light)', marginTop: '2px' }}>
          {row.cities.length} {row.cities.length === 1 ? 'city seeded' : 'cities seeded'} · pop. {row.population.toLocaleString()}
        </div>
      </div>

      <div style={{ marginBottom: '10px', padding: '10px 14px', border: '1px dashed var(--cl-border)', borderRadius: '10px', fontSize: '0.8rem', color: 'var(--cl-text-light)', background: 'white' }}>
        County-level officials (county exec, sheriff, prosecutor) are not yet seeded. Showing derived data below.
      </div>

      {/* Cities in county — collapsible */}
      <Collapsible title="Cities in this county" count={row.cities.length} defaultOpen>
        {row.cities.map((c) => (
          <div key={c.slug} style={{
            padding: '8px 12px', background: 'white',
            border: '1px solid var(--cl-border)', borderRadius: '10px', marginBottom: '6px',
          }}>
            <div style={{ fontSize: '0.86rem', fontWeight: 700 }}>{c.city}</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--cl-text-light)' }}>
              pop. {c.population?.toLocaleString() || '—'}
            </div>
          </div>
        ))}
      </Collapsible>

      {/* State legislators whose jurisdiction overlaps this county (best-effort) */}
      {!loading && districts && (
        <CountyLegislators
          county={row.county}
          districts={districts}
          stateCode={stateCode}
          onNotify={onNotify}
          onCompareToggle={onCompareToggle}
          compareIds={compareIds}
        />
      )}

      {/* Judiciary — circuit + State Attorney + DCA + chief county judge */}
      {judiciary && (
        <CountyJudiciary
          county={row.county}
          judiciary={judiciary}
          stateCode={stateCode}
          onNotify={onNotify}
          onCompareToggle={onCompareToggle}
          compareIds={compareIds}
        />
      )}
    </div>
  );
}

// ─── Judicial block for a selected county ───────────────────────────
function CountyJudiciary({ county, judiciary, stateCode, onNotify, onCompareToggle, compareIds }) {
  const stateUp = stateCode ? stateCode.toUpperCase() : null;
  // Find the circuit that includes this county
  const norm = (s) => (s || '').toLowerCase().replace(/\s+county$/, '').trim();
  const target = norm(county);
  const circuit = (judiciary.circuits || []).find((c) =>
    (c.counties || []).some((n) => norm(n) === target)
  );
  const countyCourt = (judiciary.county_courts || []).find((c) =>
    norm(c.county) === target
  );
  // DCA is looked up by the circuit's covering_dca
  const dca = circuit
    ? (judiciary.district_courts_of_appeal || []).find(
        (d) => String(d.district) === String(circuit.covering_dca)
      )
    : null;

  if (!circuit && !countyCourt && !dca) return null;

  const sa = circuit?.state_attorney;
  const chiefCircuit = circuit?.chief_judge;
  const chiefCounty = countyCourt?.chief_judge;
  const chiefDca = dca?.chief_judge;

  return (
    <Collapsible
      title="Judiciary"
      count={[sa, chiefCircuit, chiefCounty, chiefDca].filter(Boolean).length}
      defaultOpen
    >
      <div style={{
        fontSize: '0.72rem', color: 'var(--cl-text-light)', padding: '2px 8px 10px',
        lineHeight: 1.4,
      }}>
        Florida judges serve a layered system: County Court → Circuit Court →
        District Court of Appeal → Supreme Court. State Attorneys prosecute
        criminal cases at the circuit level.
      </div>

      {/* Chief County Judge */}
      {chiefCounty && (
        <>
          <SectionLabel>Chief County Judge</SectionLabel>
          <OfficialCard
            name={chiefCounty.name}
            subtitle={`${chiefCounty.role || 'Chief County Judge'} · ${countyCourt?.county} County Court`}
            selectionMethod={chiefCounty.selection_method}
            selectionDetail={chiefCounty.selection_detail}
            followTarget={buildFollowTarget(chiefCounty, 'state_county_judge', {
              chamber: `${countyCourt?.county || county} County Court`,
              state: stateUp,
              county: countyCourt?.county || county,
            })}
            onNotify={onNotify}
            onCompareToggle={onCompareToggle}
            compareIds={compareIds}
          />
        </>
      )}

      {/* Circuit Court — chief + State Attorney */}
      {circuit && (chiefCircuit || sa) && (
        <>
          <SectionLabel>
            {circuit.name} (Circuit {circuit.circuit})
          </SectionLabel>
          {chiefCircuit && (
            <OfficialCard
              name={chiefCircuit.name}
              subtitle={`${chiefCircuit.role || 'Chief Judge'} · Circuit ${circuit.circuit} (seat: ${circuit.seat_city || '—'})`}
              meta={circuit.counties && circuit.counties.length > 1
                ? [`Serves ${circuit.counties.length} counties: ${circuit.counties.join(', ')}`]
                : null}
              selectionMethod={chiefCircuit.selection_method}
              selectionDetail={chiefCircuit.selection_detail}
              website={circuit.website}
              followTarget={buildFollowTarget(chiefCircuit, 'state_circuit_judge', {
                chamber: `Circuit ${circuit.circuit} Court`,
                state: stateUp,
                circuit: circuit.circuit,
              })}
              onNotify={onNotify}
              onCompareToggle={onCompareToggle}
              compareIds={compareIds}
            />
          )}
          {sa && (
            <OfficialCard
              name={sa.name}
              party={sa.party}
              subtitle={`${sa.role || 'State Attorney'} · Circuit ${circuit.circuit}`}
              meta={[
                sa.serving_since ? `Serving since ${new Date(sa.serving_since).getFullYear()}` : null,
                sa.term_end ? `Term ends ${new Date(sa.term_end).getFullYear()}` : null,
              ].filter(Boolean)}
              selectionMethod={sa.selection_method}
              selectionDetail={sa.selection_detail}
              normallyElected={sa.normally_elected}
              website={sa.website}
              followTarget={buildFollowTarget(sa, 'state_attorney', {
                chamber: `Circuit ${circuit.circuit} State Attorney's Office`,
                state: stateUp,
                circuit: circuit.circuit,
              })}
              onNotify={onNotify}
              onCompareToggle={onCompareToggle}
              compareIds={compareIds}
            />
          )}
        </>
      )}

      {/* Covering DCA */}
      {dca && (
        <>
          <SectionLabel>
            Covering DCA — {dca.seat_city ? `District ${dca.district} (${dca.seat_city})` : `District ${dca.district}`}
          </SectionLabel>
          {chiefDca && (
            <OfficialCard
              name={chiefDca.name}
              subtitle={`${chiefDca.role || 'Chief Judge'} · DCA ${dca.district}`}
              meta={[
                chiefDca.appointed_by ? `Appointed by ${chiefDca.appointed_by}` : null,
                chiefDca.appointed_on ? String(new Date(chiefDca.appointed_on).getFullYear()) : null,
              ].filter(Boolean)}
              selectionMethod={chiefDca.selection_method || dca.selection_method}
              selectionDetail={chiefDca.selection_detail || dca.selection_detail}
              website={dca.website}
              followTarget={buildFollowTarget(chiefDca, 'state_dca', {
                chamber: dca.seat_city
                  ? `DCA ${dca.district} (${dca.seat_city})`
                  : `District Court of Appeal ${dca.district}`,
                state: stateUp,
                district: dca.district,
              })}
              onNotify={onNotify}
              onCompareToggle={onCompareToggle}
              compareIds={compareIds}
            />
          )}
          {!chiefDca && dca.website && (
            <div style={{ fontSize: '0.74rem', padding: '6px 10px', color: 'var(--cl-text-light)' }}>
              Chief judge not seeded yet — roster at{' '}
              <a href={dca.website} target="_blank" rel="noopener noreferrer"
                style={{ color: 'var(--cl-accent)', textDecoration: 'none', fontWeight: 600 }}>
                {dca.website.replace(/^https?:\/\//, '')}
              </a>
            </div>
          )}
        </>
      )}

      {/* County court isn't seeded */}
      {!countyCourt && (
        <div style={{
          fontSize: '0.72rem', color: 'var(--cl-text-light)', padding: '6px 10px',
          fontStyle: 'italic',
        }}>
          Chief county judge not yet seeded for {county} County.
        </div>
      )}
    </Collapsible>
  );
}

function CountyLegislators({ county, districts, stateCode, onNotify, onCompareToggle, compareIds }) {
  // Best-effort match: members whose `jurisdiction` or `counties` field
  // includes this county's name. The seeded schema varies, so we filter
  // defensively across a few fields.
  const stateUp = stateCode ? stateCode.toUpperCase() : null;
  const isInCounty = (m) => {
    const haystack = [
      m.county,
      m.jurisdiction,
      ...(Array.isArray(m.counties) ? m.counties : []),
    ].join(' ').toLowerCase();
    return haystack.includes(county.toLowerCase());
  };
  const senSeats = districts.senate.filter(isInCounty);
  const houseSeats = districts.house.filter(isInCounty);
  if (!senSeats.length && !houseSeats.length) return null;

  return (
    <>
      {senSeats.length > 0 && (
        <Collapsible title="State Senators representing this county" count={senSeats.length}>
          {senSeats.map((m) => (
            <OfficialCard
              key={m.id}
              name={m.name}
              party={m.party}
              subtitle={`District ${m.district} · ${m.role}`}
              website={m.website}
              followTarget={buildFollowTarget(m, 'state_legislator', {
                chamber: 'State Senate',
                state: stateUp,
                district: m.district || null,
              })}
              onNotify={onNotify}
              onCompareToggle={onCompareToggle}
              compareIds={compareIds}
            />
          ))}
        </Collapsible>
      )}
      {houseSeats.length > 0 && (
        <Collapsible title="State Representatives representing this county" count={houseSeats.length}>
          {houseSeats.map((m) => (
            <OfficialCard
              key={m.id}
              name={m.name}
              party={m.party}
              subtitle={`District ${m.district} · ${m.role}`}
              website={m.website}
              followTarget={buildFollowTarget(m, 'state_legislator', {
                chamber: 'State House',
                state: stateUp,
                district: m.district || null,
              })}
              onNotify={onNotify}
              onCompareToggle={onCompareToggle}
              compareIds={compareIds}
            />
          ))}
        </Collapsible>
      )}
    </>
  );
}

// ─── Districts view ─────────────────────────────────────────────────
function DistrictsView({ districts, selected, onPick, cities, loading, stateCode, onNotify, onCompareToggle, compareIds }) {
  const stateUp = stateCode ? stateCode.toUpperCase() : null;
  const [chamber, setChamber] = useState('senate'); // 'senate' | 'house'
  const [query, setQuery] = useState('');

  if (loading && !districts.senate.length && !districts.house.length) {
    return <Loading>Loading districts…</Loading>;
  }

  // Detail view for a selected district
  if (selected) {
    const list = selected.chamber === 'State Senate' ? districts.senate : districts.house;
    const member = list.find((m) => String(m.district) === String(selected.district));
    if (!member) {
      return (
        <div>
          <BackButton onClick={() => onPick(null)}>← All districts</BackButton>
          <EmptyState>District not found.</EmptyState>
        </div>
      );
    }
    return (
      <div>
        <BackButton onClick={() => onPick(null)}>← All districts</BackButton>

        <div style={{
          padding: '14px 16px', background: 'var(--cl-bg)', border: '1px solid var(--cl-border)',
          borderRadius: '12px', marginBottom: '12px',
        }}>
          <div style={{ fontSize: '0.76rem', color: 'var(--cl-text-light)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.4px' }}>
            {selected.chamber}
          </div>
          <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>District {selected.district}</div>
        </div>

        {/* Primary official — stays open */}
        <div style={{ marginBottom: '12px' }}>
          <SectionLabel>Representative</SectionLabel>
          <OfficialCard
            name={member.name}
            party={member.party}
            subtitle={member.role}
            meta={[
              member.serving_since ? `Serving since ${new Date(member.serving_since).getFullYear()}` : null,
              member.term_end ? `Term ends ${new Date(member.term_end).getFullYear()}` : null,
            ].filter(Boolean)}
            website={member.website}
            big
            followTarget={buildFollowTarget(member, 'state_legislator', {
              chamber: selected.chamber,
              state: stateUp,
              district: selected.district,
            })}
            onNotify={onNotify}
            onCompareToggle={onCompareToggle}
            compareIds={compareIds}
          />
        </div>

        {/* Cities likely in the district — best-effort from city→county mapping */}
        <Collapsible title="Cities likely in this district" count={cities.length}>
          <div style={{ fontSize: '0.78rem', color: 'var(--cl-text-light)', padding: '6px 10px' }}>
            District boundary data isn&apos;t seeded yet — the full list is shown for reference.
          </div>
          {cities.slice(0, 20).map((c) => (
            <div key={c.slug} style={{
              padding: '6px 12px', background: 'white', border: '1px solid var(--cl-border)',
              borderRadius: '8px', marginBottom: '4px', fontSize: '0.82rem',
            }}>
              {c.city} <span style={{ color: 'var(--cl-text-light)', fontSize: '0.74rem' }}>· {c.county} Co.</span>
            </div>
          ))}
        </Collapsible>
      </div>
    );
  }

  const list = chamber === 'senate' ? districts.senate : districts.house;
  const filtered = list.filter((m) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      String(m.district).includes(q) ||
      (m.name || '').toLowerCase().includes(q) ||
      (m.party || '').toLowerCase().includes(q)
    );
  });

  return (
    <div>
      {/* Chamber toggle */}
      <div style={{
        display: 'flex', gap: '6px', padding: '4px', marginBottom: '10px',
        background: 'white', border: '1px solid var(--cl-border)', borderRadius: '10px',
      }}>
        {['senate', 'house'].map((k) => (
          <button
            key={k}
            onClick={() => setChamber(k)}
            style={{
              flex: 1, padding: '6px 10px', fontSize: '0.76rem', fontWeight: 700,
              background: chamber === k ? 'var(--cl-bg)' : 'transparent',
              color: chamber === k ? 'var(--cl-primary)' : 'var(--cl-text-light)',
              border: 'none', borderRadius: '6px', cursor: 'pointer',
            }}
          >
            {k === 'senate' ? `State Senate (${districts.senate.length})` : `State House (${districts.house.length})`}
          </button>
        ))}
      </div>

      <SearchInput
        placeholder="Search by district number, name, or party…"
        value={query}
        onChange={setQuery}
      />

      <div style={{
        fontSize: '0.72rem', color: 'var(--cl-text-light)', fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: '0.5px', padding: '8px 10px',
      }}>
        Districts ({filtered.length})
      </div>
      <div style={{ maxHeight: '55vh', overflowY: 'auto' }}>
        {filtered.map((m) => (
          <button
            key={m.id}
            onClick={() => onPick({ chamber: chamber === 'senate' ? 'State Senate' : 'State House', district: m.district })}
            style={{
              width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '10px',
              padding: '8px 10px', background: 'white', border: '1px solid var(--cl-border)',
              borderRadius: '10px', marginBottom: '4px', cursor: 'pointer',
            }}
            onMouseOver={(e) => { e.currentTarget.style.borderColor = 'var(--cl-accent)'; e.currentTarget.style.background = 'var(--cl-bg)'; }}
            onMouseOut={(e) => { e.currentTarget.style.borderColor = 'var(--cl-border)'; e.currentTarget.style.background = 'white'; }}
          >
            <div style={{
              minWidth: '44px', padding: '4px 8px', borderRadius: '8px',
              background: 'var(--cl-bg)', color: 'var(--cl-primary)',
              fontWeight: 800, fontSize: '0.8rem', textAlign: 'center',
            }}>
              #{m.district}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.86rem', fontWeight: 700 }}>{m.name}</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--cl-text-light)' }}>{m.role}</div>
            </div>
            {m.party && <PartyPill party={m.party} />}
          </button>
        ))}
        {!filtered.length && (
          <div style={{ padding: '10px 14px', color: 'var(--cl-text-light)', fontSize: '0.82rem' }}>
            No districts matched.
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Shared primitives ──────────────────────────────────────────────
function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: '0.72rem', color: 'var(--cl-text-light)', fontWeight: 700,
      textTransform: 'uppercase', letterSpacing: '0.5px', padding: '2px 10px 6px',
    }}>
      {children}
    </div>
  );
}

function BackButton({ children, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 12px', fontSize: '0.78rem', fontWeight: 600,
        background: 'var(--cl-bg)', border: '1px solid var(--cl-border)', borderRadius: '8px',
        cursor: 'pointer', color: 'var(--cl-text-light)', marginBottom: '10px',
      }}
    >
      {children}
    </button>
  );
}

function SearchInput({ value, onChange, placeholder }) {
  return (
    <div style={{ position: 'relative', marginBottom: '8px' }}>
      <svg
        aria-hidden
        width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
        style={{ position: 'absolute', top: '10px', left: '12px', color: 'var(--cl-text-light)' }}
      >
        <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
      </svg>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%', padding: '8px 10px 8px 32px', fontSize: '0.84rem',
          background: 'white', border: '1px solid var(--cl-border)', borderRadius: '10px',
          outline: 'none', color: 'var(--cl-text)',
        }}
      />
    </div>
  );
}

function Collapsible({ title, count, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: '10px', border: '1px solid var(--cl-border)', borderRadius: '10px', background: 'white', overflow: 'hidden' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: '10px', padding: '10px 14px', background: open ? 'var(--cl-bg)' : 'white',
          border: 'none', borderBottom: open ? '1px solid var(--cl-border)' : 'none',
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{
            fontSize: '0.78rem', color: 'var(--cl-primary)', fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.5px',
          }}>
            {title}
          </span>
          {typeof count === 'number' && (
            <span style={{
              fontSize: '0.68rem', fontWeight: 700, padding: '2px 8px',
              background: 'var(--cl-bg)', color: 'var(--cl-text-light)', borderRadius: '10px',
            }}>
              {count}
            </span>
          )}
        </div>
        <span aria-hidden style={{ fontSize: '0.9rem', color: 'var(--cl-text-light)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
          ›
        </span>
      </button>
      {open && <div style={{ padding: '10px 10px 8px' }}>{children}</div>}
    </div>
  );
}

function PartyPill({ party }) {
  const color = party === 'R' ? '#e63946' : party === 'D' ? '#457b9d' : '#6c3ec1';
  const bg = party === 'R' ? '#fde8e8' : party === 'D' ? '#e3f0f7' : '#f0eaff';
  return (
    <span style={{
      padding: '1px 8px', borderRadius: '10px',
      background: bg, color, fontSize: '0.68rem', fontWeight: 800,
    }}>
      {party}
    </span>
  );
}

// Shared with StatewideOfficialsTab — kept in sync manually.
const SELECTION_STYLES = {
  elected:               { bg: '#e8f5ec', fg: '#1f7a3a', label: 'ELECTED' },
  appointed:             { bg: '#fff3e0', fg: '#a35a00', label: 'APPOINTED' },
  'appointed-then-elected': { bg: '#eef1ff', fg: '#3b44a6', label: 'APPT → ELECTED' },
};

function SelectionBadge({ method, detail, normallyElected }) {
  if (!method) return null;
  const style = SELECTION_STYLES[method] || { bg: 'var(--cl-bg)', fg: 'var(--cl-text-light)', label: method.toUpperCase() };
  return (
    <span
      title={detail || (normallyElected ? 'Office is normally filled by election' : undefined)}
      style={{
        padding: '2px 8px', borderRadius: '10px',
        background: style.bg, color: style.fg,
        fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.4px',
        whiteSpace: 'nowrap',
      }}
    >
      {style.label}
      {method === 'appointed' && normallyElected ? '*' : ''}
    </span>
  );
}

function OfficialCard({
  name, party, subtitle, meta, website, big,
  selectionMethod, selectionDetail, normallyElected,
  followTarget, onNotify, onCompareToggle, compareIds,
}) {
  const PARTY_COLORS = { R: '#e63946', D: '#457b9d', I: '#6c3ec1' };
  const partyColor = party ? (PARTY_COLORS[party] || '#666') : null;
  const partyBg = party === 'R' ? '#fde8e8' : party === 'D' ? '#e3f0f7' : party === 'I' ? '#f0eaff' : '#eef';
  const memberCmpId = followTarget && (followTarget.bioguide_id || followTarget.id);
  const isComparing = Boolean(compareIds && memberCmpId && compareIds.has(memberCmpId));
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '10px 12px',
      background: 'white', border: '1px solid var(--cl-border)', borderRadius: '10px',
      marginBottom: '6px',
    }}>
      <div style={{
        width: big ? '48px' : '36px', height: big ? '48px' : '36px', borderRadius: '50%',
        background: partyBg || 'var(--cl-bg)', color: partyColor || 'var(--cl-text-light)',
        fontSize: big ? '1rem' : '0.82rem', fontWeight: 700,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        {name.split(' ').map((p) => p[0]).slice(0, 2).join('')}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: big ? '0.98rem' : '0.88rem', fontWeight: 700, lineHeight: 1.2 }}>{name}</div>
        {subtitle && (
          <div style={{ fontSize: '0.76rem', color: 'var(--cl-text-light)', marginTop: '2px' }}>
            {subtitle}
          </div>
        )}
        {meta && meta.length > 0 && (
          <div style={{ fontSize: '0.72rem', color: 'var(--cl-text-light)', marginTop: '3px' }}>
            {meta.join(' · ')}
          </div>
        )}
        {selectionDetail && (
          <div style={{
            fontSize: '0.7rem', color: 'var(--cl-text-light)', marginTop: '3px',
            fontStyle: 'italic', lineHeight: 1.4,
          }}>
            {selectionDetail}
          </div>
        )}
        {website && (
          <a href={website} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: '0.74rem', color: 'var(--cl-accent)', textDecoration: 'none', fontWeight: 600, marginTop: '4px', display: 'inline-block' }}>
            Official page ↗
          </a>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
        {party && <PartyPill party={party} />}
        <SelectionBadge
          method={selectionMethod}
          detail={selectionDetail}
          normallyElected={normallyElected}
        />
        {followTarget && (
          <div
            style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '2px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <FollowButton member={followTarget} size="sm" onNotify={onNotify} />
            <CompareButton
              member={followTarget}
              size="sm"
              isComparing={isComparing}
              onCompareToggle={onCompareToggle}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function Loading({ children }) {
  // Centered text loading affordance — used inside dense tabs where a
  // full skeleton card would feel out of scale. Tokenized in Phase 4A.
  return (
    <div
      style={{
        textAlign: 'center',
        padding: '40px 20px',
        color: 'var(--cl-text-light)',
        fontFamily: 'var(--cl-font-sans)',
        fontSize: 'var(--cl-text-sm)',
      }}
    >
      {children}
    </div>
  );
}

function EmptyState({ children }) {
  // Tab-internal "no data seeded yet" placeholder. The dashed border is
  // intentional — communicates "intentional empty state, not error."
  return (
    <div
      style={{
        margin: '20px 10px',
        padding: '18px 16px',
        textAlign: 'center',
        background: 'var(--cl-bg)',
        border: '1px dashed var(--cl-border)',
        borderRadius: 'var(--cl-radius-xl)',
        color: 'var(--cl-text-light)',
        fontSize: 'var(--cl-text-sm)',
        fontFamily: 'var(--cl-font-sans)',
        lineHeight: 'var(--cl-leading-normal)',
      }}
    >
      {children}
    </div>
  );
}
