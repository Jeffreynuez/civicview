// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * CivicLens API Client
 * Fetches data from the FastAPI backend, with fallback to sample data.
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const IMAGE_BASE = 'https://unitedstates.github.io/images/congress/225x275';

// ─── Transform backend member to frontend format ─────────────────────
function transformMember(m) {
  return {
    id: m.bioguide_id || m.id,
    bioguide_id: m.bioguide_id,
    name: m.name,
    party: m.party,
    chamber: m.chamber,
    district: m.district,
    title: m.role || m.title || '',
    photoUrl: m.image || m.photoUrl || (m.bioguide_id ? `${IMAGE_BASE}/${m.bioguide_id}.jpg` : null),
    state: m.state || null,
    serving_since: m.serving_since || null,
    office: m.office || '',
    phone: m.phone || '',
    bio: m.bio || '',
    committees: m.committees || [],
    // Profile enrichment fields merged in by the backend from the candidate
    // sidecar — carry them through so ProfileView's Issues/Experience tabs
    // and the "View Candidate" cross-nav button actually render.
    top_issues: m.top_issues || [],
    experience: m.experience || [],
    active_candidacy: m.active_candidacy || null,
    recentBills: (m.bills || m.recentBills || []).map((b) => ({
      title: b.title,
      status: b.status || 'Introduced',
      date: b.date || '',
    })),
    recentVotes: (m.votes || m.recentVotes || []).map((v) => ({
      title: v.desc || v.title || '',
      vote: v.vote || '',
      date: v.date || '',
    })),
  };
}

// ─── Fetch all data for a state (congress + state leg + elections) ────
export async function fetchAllStateData(stateCode) {
  // Try fetching congress members and state info in parallel
  const [congressResult, stateResult] = await Promise.allSettled([
    fetchCongressMembers(stateCode),
    fetchStateInfo(stateCode),
  ]);

  const congress = congressResult.status === 'fulfilled' ? congressResult.value.data : { senators: [], representatives: [] };
  const stateInfo = stateResult.status === 'fulfilled' ? stateResult.value.data : { stateLeg: { senate: [], house: [] }, elections: [] };
  const isLive = (congressResult.status === 'fulfilled' && congressResult.value.isLive) ||
                 (stateResult.status === 'fulfilled' && stateResult.value.isLive);

  return {
    data: {
      congress,
      stateLeg: stateInfo.stateLeg || { senate: [], house: [] },
      elections: stateInfo.elections || [],
    },
    isLive,
  };
}

// ─── Congressional district geometry (Census TIGERweb) ───────────────
// Returns a GeoJSON FeatureCollection for the given state FIPS + district.
// Free, no API key. CORS-enabled. Cached in-memory for the session.
const TIGERWEB_CD_URL =
  'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0/query';
const _districtCache = new Map();

export async function fetchDistrictGeometry(stateFips, district) {
  if (!stateFips || !district) return null;
  const key = `${stateFips}-${district}`;
  if (_districtCache.has(key)) return _districtCache.get(key);

  // TIGERweb's CD119 field is always 2 chars, zero-padded:
  //   District "5"        → CD119 = "05"
  //   District "10"       → CD119 = "10"
  //   At-Large states     → CD119 = "00"   (e.g. WY, ND, SD, VT, DE, AK)
  //   DC / PR delegates   → CD119 = "98"
  // (BASENAME is human-readable text like "Congressional District (at Large)" — not useful for a lookup.)
  let cdCandidates;
  if (district === 'At-Large') {
    cdCandidates = ['00', '98'];
  } else {
    const padded = String(district).padStart(2, '0');
    cdCandidates = [padded];
  }

  for (const cd of cdCandidates) {
    const params = new URLSearchParams({
      where: `STATE='${stateFips}' AND CD119='${cd}'`,
      outFields: 'STATE,BASENAME,NAME,GEOID,CD119',
      returnGeometry: 'true',
      f: 'geojson',
      outSR: '4326',
      geometryPrecision: '4',
    });
    try {
      const resp = await fetch(`${TIGERWEB_CD_URL}?${params}`);
      if (!resp.ok) continue;
      const gj = await resp.json();
      if (gj?.features?.length) {
        _districtCache.set(key, gj);
        return gj;
      }
    } catch (e) {
      console.warn('District geometry fetch failed:', e);
    }
  }
  return null;
}

// Returns GeoJSON of ALL districts in the given state, as a simplified overview
// suitable for displaying many polygons at once. Cached per-state.
const _stateDistrictsCache = new Map();

export async function fetchDistrictsForState(stateFips) {
  if (!stateFips) return null;
  if (_stateDistrictsCache.has(stateFips)) return _stateDistrictsCache.get(stateFips);

  const params = new URLSearchParams({
    where: `STATE='${stateFips}'`,
    outFields: 'STATE,CD119,NAME,BASENAME,GEOID',
    returnGeometry: 'true',
    f: 'geojson',
    outSR: '4326',
    geometryPrecision: '2',
    // Simplification threshold in degrees — ~0.005° ≈ 500m, small enough that
    // boundaries look right at state zoom but keeps CA under ~130KB over the wire.
    maxAllowableOffset: '0.005',
  });
  try {
    const resp = await fetch(`${TIGERWEB_CD_URL}?${params}`);
    if (!resp.ok) return null;
    const gj = await resp.json();
    if (gj?.features?.length) {
      _stateDistrictsCache.set(stateFips, gj);
      return gj;
    }
  } catch (e) {
    console.warn('fetchDistrictsForState failed:', e);
  }
  return null;
}

// ─── Address lookup ──────────────────────────────────────────────────
export async function lookupAddress(address) {
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/address/lookup?address=${encodeURIComponent(address)}`
    );
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || `API Error ${response.status}`);
    }
    const data = await response.json();

    // Transform members to frontend format
    const yourRep = data.yourRepresentative ? transformMember(data.yourRepresentative) : null;
    const yourSenators = (data.yourSenators || []).map(transformMember);
    const allMembers = (data.allMembers || []).map(transformMember);

    return {
      success: true,
      address: data.address,
      coordinates: data.coordinates,
      stateCode: data.stateCode,
      stateFips: data.stateFips,
      district: data.district,
      districtLabel: data.districtLabel,
      // Broader civic geography (for Ballot + local officials lookup)
      countyFips: data.countyFips,
      countyName: data.countyName,
      city: data.city,
      citySlug: data.citySlug,
      stateSenateDistrict: data.stateSenateDistrict,
      stateHouseDistrict: data.stateHouseDistrict,
      yourRepresentative: yourRep,
      yourSenators,
      allMembers,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message || 'Could not look up that address. Make sure the backend is running.',
    };
  }
}

// ─── Congress members ────────────────────────────────────────────────
export async function fetchCongressMembers(stateCode) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/congress/members?state=${stateCode}`);
    if (!response.ok) throw new Error(`API Error ${response.status}`);
    const data = await response.json();

    // Backend returns {state, count, members: [...]}
    // Transform into {senators, representatives}
    const members = (data.members || []).map(transformMember);
    const senators = members.filter((m) => m.chamber === 'Senate');
    const representatives = members.filter((m) => m.chamber === 'House');

    return { data: { senators, representatives }, isLive: true };
  } catch (error) {
    console.warn('Congress API unavailable, using sample data:', error.message);
    const fallback = SAMPLE_DATA[stateCode];
    return {
      data: fallback ? fallback.congress : { senators: [], representatives: [] },
      isLive: false,
    };
  }
}

// ─── All Congress members (global search index) ─────────────────────
// Cached in-memory so the navbar search doesn't re-hit the backend.
let _allMembersCache = null;
let _allMembersPromise = null;

export async function fetchAllMembers() {
  if (_allMembersCache) return { data: _allMembersCache, isLive: true };
  if (_allMembersPromise) return _allMembersPromise;

  _allMembersPromise = (async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/congress/members/all`);
      if (!response.ok) throw new Error(`API Error ${response.status}`);
      const data = await response.json();
      const members = (data.members || []).map(transformMember);
      // Enrich transformed output with raw-level fields not in transformMember
      for (let i = 0; i < members.length; i++) {
        const raw = data.members[i] || {};
        members[i].state = raw.state || null;
        members[i].serving_since = raw.serving_since || null;
      }
      _allMembersCache = members;
      return { data: members, isLive: true };
    } catch (error) {
      console.warn('All-members index unavailable:', error.message);
      return { data: [], isLive: false };
    } finally {
      _allMembersPromise = null;
    }
  })();

  return _allMembersPromise;
}

// ─── Member detail ───────────────────────────────────────────────────
export async function fetchMemberDetail(bioguideId) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/congress/members/${bioguideId}`);
    if (!response.ok) throw new Error(`API Error ${response.status}`);
    const data = await response.json();
    return { data: transformMember(data), isLive: true };
  } catch (error) {
    console.warn('Member detail API unavailable:', error.message);
    // Search sample data
    for (const state of Object.values(SAMPLE_DATA)) {
      const allMembers = [...state.congress.senators, ...state.congress.representatives];
      const found = allMembers.find((m) => m.bioguide_id === bioguideId);
      if (found) return { data: found, isLive: false };
    }
    return { data: null, isLive: false };
  }
}

// ─── Sponsored + cosponsored bills ───────────────────────────────────
// Returns { sponsored: [], cosponsored: [] }. Each bill has:
//   { title, citation, congress, type, number, introduced_date,
//     latest_action, latest_action_date, url }
export async function fetchMemberBills(bioguideId, limit = 10) {
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/congress/members/${bioguideId}/bills?limit=${limit}`
    );
    if (!response.ok) throw new Error(`API Error ${response.status}`);
    const data = await response.json();
    return {
      data: {
        sponsored: data.sponsored || [],
        cosponsored: data.cosponsored || [],
      },
      isLive: true,
    };
  } catch (error) {
    console.warn('Member bills API unavailable:', error.message);
    return { data: { sponsored: [], cosponsored: [] }, isLive: false };
  }
}

// ─── Contact info (DC + district offices, socials) ───────────────────
// Returns { dc_office, dc_phone, official_website, district_offices, socials }
export async function fetchMemberContact(bioguideId) {
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/congress/members/${bioguideId}/contact`
    );
    if (!response.ok) throw new Error(`API Error ${response.status}`);
    const data = await response.json();
    return {
      data: {
        dc_office: data.dc_office || null,
        dc_phone: data.dc_phone || null,
        official_website: data.official_website || null,
        district_offices: data.district_offices || [],
        socials: data.socials || {},
      },
      isLive: true,
    };
  } catch (error) {
    console.warn('Member contact API unavailable:', error.message);
    return {
      data: {
        dc_office: null,
        dc_phone: null,
        official_website: null,
        district_offices: [],
        socials: {},
      },
      isLive: false,
    };
  }
}

// ─── Roll-call votes ──────────────────────────────────────────────────
// Each vote: { vote_id, question, chamber, result, category, date,
//              position, url, bill: {number, type, title, display_number,
//                                    congress, link} | null }
//
// Modes:
//   fetchMemberVotes(bioguideId)                   → 10 most recent
//   fetchMemberVotes(bioguideId, { limit: 25 })    → N most recent
//   fetchMemberVotes(bioguideId, { year: 2024 })   → full year
//   fetchMemberVotes(bioguideId, { year, month })  → single month
//
// Per-year results are cached in-module so switching months in the UI
// doesn't re-hit the backend (and the backend caches the year too).
const _memberVoteCache = new Map(); // key: `${bioguide}:${year}` → array

export async function fetchMemberVotes(bioguideId, opts = {}) {
  // Back-compat: older callers invoked fetchMemberVotes(id, 10).
  if (typeof opts === 'number') opts = { limit: opts };

  const { year = null, month = null, limit = 10 } = opts;

  // Year mode → use (or populate) the per-year cache and filter locally.
  //
  // Cache discipline: we ONLY cache non-empty responses. An empty
  // array here is indistinguishable from "fetch succeeded but
  // GovTrack returned nothing" — could be a transient upstream
  // failure, a rate-limit hiccup, or a real empty year. Caching
  // empty means the next call serves the same empty result even if
  // GovTrack is now answering normally. We'd rather pay the network
  // round-trip on every retry than persist a bad cache state.
  if (year != null) {
    const cacheKey = `${bioguideId}:${year}`;
    let yearVotes = _memberVoteCache.get(cacheKey);
    if (!yearVotes || yearVotes.length === 0) {
      try {
        const qs = new URLSearchParams({ year: String(year) }).toString();
        const response = await fetch(
          `${API_BASE_URL}/api/congress/members/${bioguideId}/votes?${qs}`
        );
        if (!response.ok) throw new Error(`API Error ${response.status}`);
        const data = await response.json();
        yearVotes = data.votes || [];
        // Only cache when we got real data; empty results retry on
        // next call rather than getting stuck.
        if (yearVotes.length > 0) {
          _memberVoteCache.set(cacheKey, yearVotes);
        }
      } catch (error) {
        console.warn('Member votes API unavailable:', error.message);
        return { data: [], isLive: false };
      }
    }
    const filtered = month == null
      ? yearVotes
      : yearVotes.filter((v) => {
          const mm = (v.date || '').slice(5, 7);
          return mm === String(month).padStart(2, '0');
        });
    return { data: filtered, isLive: true };
  }

  // Recent-votes mode (unchanged behavior).
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/congress/members/${bioguideId}/votes?limit=${limit}`
    );
    if (!response.ok) throw new Error(`API Error ${response.status}`);
    const data = await response.json();
    return { data: data.votes || [], isLive: true };
  } catch (error) {
    console.warn('Member votes API unavailable:', error.message);
    return { data: [], isLive: false };
  }
}

// ─── Member stats (party-line % + top issue areas) ──────────────────
// Returns { party_line_pct: int|null, votes_analyzed: int, top_issues: [{name, count}] }
export async function fetchMemberStats(bioguideId, party = null) {
  try {
    const qs = party ? `?party=${encodeURIComponent(party)}` : '';
    const response = await fetch(
      `${API_BASE_URL}/api/congress/members/${bioguideId}/stats${qs}`
    );
    if (!response.ok) throw new Error(`API Error ${response.status}`);
    const data = await response.json();
    return {
      data: {
        party_line_pct: data.party_line_pct ?? null,
        votes_analyzed: data.votes_analyzed || 0,
        top_issues: data.top_issues || [],
      },
      isLive: true,
    };
  } catch (error) {
    console.warn('Member stats API unavailable:', error.message);
    return {
      data: { party_line_pct: null, votes_analyzed: 0, top_issues: [] },
      isLive: false,
    };
  }
}

// ─── Committees (browse-by-committee) ───────────────────────────────
// Returns the full list of parent committees once, then caches in memory.
let _committeesCache = null;
let _committeesPromise = null;

export async function fetchCommittees() {
  if (_committeesCache) return { data: _committeesCache, isLive: true };
  if (_committeesPromise) return _committeesPromise;
  _committeesPromise = (async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/congress/committees`);
      if (!response.ok) throw new Error(`API Error ${response.status}`);
      const data = await response.json();
      _committeesCache = data.committees || [];
      return { data: _committeesCache, isLive: true };
    } catch (error) {
      console.warn('Committees API unavailable:', error.message);
      return { data: [], isLive: false };
    } finally {
      _committeesPromise = null;
    }
  })();
  return _committeesPromise;
}

// Per-committee detail (with member roster). Cached by thomas_id.
const _committeeDetailCache = new Map();

export async function fetchCommitteeDetail(thomasId) {
  if (!thomasId) return { data: null, isLive: false };
  const id = thomasId.toUpperCase();
  if (_committeeDetailCache.has(id)) {
    return { data: _committeeDetailCache.get(id), isLive: true };
  }
  try {
    const response = await fetch(`${API_BASE_URL}/api/congress/committees/${id}`);
    if (!response.ok) throw new Error(`API Error ${response.status}`);
    const data = await response.json();
    // Promote roster member fields into the same shape used elsewhere
    data.members = (data.members || []).map((m) => ({
      ...m,
      photoUrl: m.image || (m.bioguide_id ? `${IMAGE_BASE}/${m.bioguide_id}.jpg` : null),
    }));
    _committeeDetailCache.set(id, data);
    return { data, isLive: true };
  } catch (error) {
    console.warn('Committee detail API unavailable:', error.message);
    return { data: null, isLive: false };
  }
}

// ─── Official events (curated town halls / public events) ───────────
// Returns array of: { id, title, type, date (ISO), location, virtual,
// rsvp_url, description, official_id }
//
// Task #71: callers can pass EITHER a bioguide_id (Congress) OR a
// federal-official ID (us-pres-trump, us-vp-vance, us-cabinet-rubio,
// us-scotus-roberts). Backend treats every key in events.json as an
// opaque "official_id" — see backend/app/services/events_service.py.
export async function fetchOfficialEvents(officialId) {
  if (!officialId) return { data: [], isLive: false };
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/events/upcoming?official_id=${encodeURIComponent(officialId)}`
    );
    if (!response.ok) throw new Error(`API Error ${response.status}`);
    const data = await response.json();
    return { data: data.events || [], isLive: true };
  } catch (error) {
    console.warn('Official events API unavailable:', error.message);
    return { data: [], isLive: false };
  }
}

// Legacy alias — preserved so existing call sites that still think in
// bioguide_id terms keep working without edits. Routes through the
// same endpoint.
export async function fetchMemberEvents(bioguideId) {
  return fetchOfficialEvents(bioguideId);
}

// All upcoming events across the curated set, soonest first.
// Each item also includes a `bioguide_id` field.
export async function fetchAllEvents() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/events/all`);
    if (!response.ok) throw new Error(`API Error ${response.status}`);
    const data = await response.json();
    return { data: data.events || [], isLive: true };
  } catch (error) {
    console.warn('All-events API unavailable:', error.message);
    return { data: [], isLive: false };
  }
}

// ─── Bill snapshot (for the bill-tracker) ────────────────────────────
// Returns the current state of a single bill so the client can compare
// against a stored snapshot and surface "this bill changed" alerts.
//   { congress, type, number, citation, title, latest_action,
//     latest_action_date, introduced_date, policy_area, url }
export async function fetchBillSnapshot(congress, billType, number) {
  if (!congress || !billType || !number) return { data: null, isLive: false };
  const bt = String(billType).toLowerCase();
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/congress/bills/${congress}/${bt}/${encodeURIComponent(number)}`
    );
    if (!response.ok) throw new Error(`API Error ${response.status}`);
    const data = await response.json();
    return { data, isLive: true };
  } catch (error) {
    console.warn('Bill snapshot API unavailable:', error.message);
    return { data: null, isLive: false };
  }
}

// ─── Bill summaries (CRS + Haiku translation) ────────────────────────
// Two-stage cache:
//  • GET  /api/bills/{congress}/{type}/{number}/summary
//      Returns the cached BillSummary row (fetches CRS on first call).
//  • POST /api/bills/{congress}/{type}/{number}/summary/translate
//      Triggers the Haiku plain-English translation of the CRS body.
//      Cached forever after first translation.
//
// Both pass through the bill's title + latest_action so the backend
// can store them denormalized — saves the translate path a Congress.gov
// round-trip when the user clicks Translate before expanding the row.
export async function fetchBillSummary(
  congress, billType, number, { title, latestAction } = {}
) {
  if (!congress || !billType || !number) {
    return { data: null, error: 'missing_id' };
  }
  const bt = String(billType).toUpperCase();
  const num = String(number);
  const params = new URLSearchParams();
  if (title) params.set('title', title);
  if (latestAction) params.set('latest_action', latestAction);
  const qs = params.toString() ? `?${params.toString()}` : '';
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/bills/${congress}/${bt}/${encodeURIComponent(num)}/summary${qs}`,
    );
    if (!response.ok) {
      const detail = await response.json().catch(() => ({ detail: '' }));
      return { data: null, error: detail.detail || `HTTP ${response.status}` };
    }
    const data = await response.json();
    return { data, error: null };
  } catch (error) {
    console.warn('Bill summary fetch failed:', error.message);
    return { data: null, error: error.message || 'network' };
  }
}

// ─── Vote explainer ──────────────────────────────────────────────────
// Two endpoints, mirroring the Bills CRS/AI pattern:
//
//   explainVote(payload)         → template body + any cached AI body
//   generateVoteExplanation(p)   → triggers Haiku, caches per vote_id
//
// The template body is always returned; the AI body is filled in when
// a cached Haiku explanation exists for the same vote_id. The frontend
// flips between them via a toggle once both are present.
export async function explainVote(votePayload) {
  if (!votePayload) return { data: null, error: 'missing_vote' };
  try {
    const response = await fetch(`${API_BASE_URL}/api/votes/explain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(votePayload),
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({ detail: '' }));
      return { data: null, error: detail.detail || `HTTP ${response.status}` };
    }
    const data = await response.json();
    return { data, error: null };
  } catch (error) {
    console.warn('Vote explainer failed:', error.message);
    return { data: null, error: error.message || 'network' };
  }
}

export async function generateVoteExplanation(votePayload) {
  if (!votePayload || !votePayload.vote_id) {
    return { data: null, error: 'missing_vote_id' };
  }
  try {
    const response = await fetch(`${API_BASE_URL}/api/votes/explain/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(votePayload),
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({ detail: '' }));
      return { data: null, error: detail.detail || `HTTP ${response.status}` };
    }
    const data = await response.json();
    return { data, error: null };
  } catch (error) {
    console.warn('Vote AI explanation failed:', error.message);
    return { data: null, error: error.message || 'network' };
  }
}

export async function translateBillSummary(congress, billType, number) {
  if (!congress || !billType || !number) {
    return { data: null, error: 'missing_id' };
  }
  const bt = String(billType).toUpperCase();
  const num = String(number);
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/bills/${congress}/${bt}/${encodeURIComponent(num)}/summary/translate`,
      { method: 'POST' },
    );
    if (!response.ok) {
      const detail = await response.json().catch(() => ({ detail: '' }));
      return { data: null, error: detail.detail || `HTTP ${response.status}` };
    }
    const data = await response.json();
    return { data, error: null };
  } catch (error) {
    console.warn('Bill summary translate failed:', error.message);
    return { data: null, error: error.message || 'network' };
  }
}

// ─── Federal officials (President, VP, Cabinet, SCOTUS, Congress lead) ─
// Cached once for the session — the snapshot doesn't change per-state.
let _federalOfficialsCache = null;
let _federalOfficialsPromise = null;

export async function fetchFederalOfficials() {
  if (_federalOfficialsCache) {
    return { data: _federalOfficialsCache, isLive: true };
  }
  if (_federalOfficialsPromise) return _federalOfficialsPromise;

  _federalOfficialsPromise = (async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/federal-officials`);
      if (response.status === 404) {
        return { data: null, isLive: true, notSeeded: true };
      }
      if (!response.ok) throw new Error(`API Error ${response.status}`);
      const data = await response.json();
      _federalOfficialsCache = data;
      return { data, isLive: true };
    } catch (error) {
      console.warn('Federal officials API unavailable:', error.message);
      return { data: null, isLive: false };
    } finally {
      _federalOfficialsPromise = null;
    }
  })();

  return _federalOfficialsPromise;
}

// ─── Federal person lookup (profile for any exec/judicial/cong leader) ─
// Returns the person dict plus injected `role_type`, `chamber`, and — for
// presidents we have slugs for — `federal_register_slug`.
const _federalPersonCache = new Map();

export async function fetchFederalPerson(personId) {
  if (!personId) return { data: null, isLive: false };
  if (_federalPersonCache.has(personId)) {
    return { data: _federalPersonCache.get(personId), isLive: true };
  }
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/federal-officials/person/${encodeURIComponent(personId)}`
    );
    if (response.status === 404) {
      return { data: null, isLive: true, notSeeded: true };
    }
    if (!response.ok) throw new Error(`API Error ${response.status}`);
    const data = await response.json();
    _federalPersonCache.set(personId, data);
    return { data, isLive: true };
  } catch (error) {
    console.warn('Federal person API unavailable:', error.message);
    return { data: null, isLive: false };
  }
}

// Executive orders for a given president (Federal Register slug).
// Returns an array of: { document_number, title, eo_number, signing_date,
// publication_date, citation, url, pdf_url, abstract }
const _execOrdersCache = new Map();

// ─── Executive-order AI summaries ────────────────────────────────────
// Mirrors the Bills CRS/AI cache pattern. EOs always carry an
// `abstract` field straight from Federal Register (free, no LLM
// needed); the cached `plain_english` is the Haiku-generated
// upgrade, fetched on demand and stored per document_number.
export async function fetchEoSummary(documentNumber, { title, eoNumber, abstract } = {}) {
  if (!documentNumber) return { data: null, error: 'missing_document_number' };
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/eos/${encodeURIComponent(documentNumber)}/summary`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title || null,
          eo_number: eoNumber || null,
          abstract: abstract || null,
        }),
      },
    );
    if (!response.ok) {
      const detail = await response.json().catch(() => ({ detail: '' }));
      return { data: null, error: detail.detail || `HTTP ${response.status}` };
    }
    const data = await response.json();
    return { data, error: null };
  } catch (error) {
    console.warn('EO summary fetch failed:', error.message);
    return { data: null, error: error.message || 'network' };
  }
}

export async function translateEoSummary(documentNumber, { title, eoNumber, abstract } = {}) {
  if (!documentNumber) return { data: null, error: 'missing_document_number' };
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/eos/${encodeURIComponent(documentNumber)}/summary/translate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title || null,
          eo_number: eoNumber || null,
          abstract: abstract || null,
        }),
      },
    );
    if (!response.ok) {
      const detail = await response.json().catch(() => ({ detail: '' }));
      return { data: null, error: detail.detail || `HTTP ${response.status}` };
    }
    const data = await response.json();
    return { data, error: null };
  } catch (error) {
    console.warn('EO summary translate failed:', error.message);
    return { data: null, error: error.message || 'network' };
  }
}

export async function fetchExecutiveOrders(presidentSlug, limit = 20) {
  if (!presidentSlug) return { data: [], isLive: false };
  const key = `${presidentSlug}::${limit}`;
  if (_execOrdersCache.has(key)) {
    return { data: _execOrdersCache.get(key), isLive: true };
  }
  try {
    const qs = new URLSearchParams({
      president_slug: presidentSlug,
      limit: String(limit),
    });
    const response = await fetch(
      `${API_BASE_URL}/api/federal-officials/executive-orders?${qs}`
    );
    if (!response.ok) throw new Error(`API Error ${response.status}`);
    const data = await response.json();
    const orders = data.orders || [];
    _execOrdersCache.set(key, orders);
    return { data: orders, isLive: true };
  } catch (error) {
    console.warn('Executive orders API unavailable:', error.message);
    return { data: [], isLive: false };
  }
}

// Presidential actions on bills — signed (enacted laws) or vetoed.
// Returns an array of: { congress, type, number, citation, title,
// latest_action, latest_action_date, law_number, url }
const _presidentialActionsCache = new Map();

export async function fetchPresidentialActions({
  congress = 119,
  type = 'signed',
  limit = 100,
} = {}) {
  const key = `${congress}::${type}::${limit}`;
  if (_presidentialActionsCache.has(key)) {
    return { data: _presidentialActionsCache.get(key), isLive: true };
  }
  try {
    const qs = new URLSearchParams({
      congress: String(congress),
      type,
      limit: String(limit),
    });
    const response = await fetch(
      `${API_BASE_URL}/api/federal-officials/presidential-actions?${qs}`
    );
    if (!response.ok) throw new Error(`API Error ${response.status}`);
    const data = await response.json();
    const bills = data.bills || [];
    _presidentialActionsCache.set(key, bills);
    return { data: bills, isLive: true };
  } catch (error) {
    console.warn('Presidential actions API unavailable:', error.message);
    return { data: [], isLive: false };
  }
}

// Recent SCOTUS opinion clusters, optionally filtered by justice surname.
// Returns an array of: { id, case_name, date_filed, docket_number,
// precedential_status, judges, absolute_url, url, syllabus }
const _scotusCasesCache = new Map();

export async function fetchSCOTUSCases({ justiceName = null, limit = 15 } = {}) {
  const key = `${justiceName || 'all'}::${limit}`;
  if (_scotusCasesCache.has(key)) {
    return { data: _scotusCasesCache.get(key), isLive: true };
  }
  try {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (justiceName) qs.set('justice_name', justiceName);
    const response = await fetch(
      `${API_BASE_URL}/api/federal-officials/scotus-cases?${qs}`
    );
    if (!response.ok) throw new Error(`API Error ${response.status}`);
    const data = await response.json();
    const cases = data.cases || [];
    _scotusCasesCache.set(key, cases);
    return { data: cases, isLive: true };
  } catch (error) {
    console.warn('SCOTUS cases API unavailable:', error.message);
    return { data: [], isLive: false };
  }
}

// ─── State-level officials (governor, cabinet, state leg leadership) ─
// Cached per-state.
const _stateOfficialsCache = new Map();

export async function fetchStateOfficials(stateCode) {
  if (!stateCode) return { data: null, isLive: false };
  const key = stateCode.toUpperCase();
  if (_stateOfficialsCache.has(key)) {
    return { data: _stateOfficialsCache.get(key), isLive: true };
  }
  try {
    const response = await fetch(`${API_BASE_URL}/api/state-officials/${key}`);
    if (response.status === 404) {
      return { data: null, isLive: true, notSeeded: true };
    }
    if (!response.ok) throw new Error(`API Error ${response.status}`);
    const data = await response.json();
    _stateOfficialsCache.set(key, data);
    return { data, isLive: true };
  } catch (error) {
    console.warn('State officials API unavailable:', error.message);
    return { data: null, isLive: false };
  }
}

// ─── State person lookup (any role) ───────────────────────────────────
// Returns a person dict with injected `role_type` ∈ {state_governor,
// state_cabinet, state_legislator, state_scotus, state_dca, ...}.
const _statePersonCache = new Map();

export async function fetchStatePerson(stateCode, personId) {
  if (!stateCode || !personId) return { data: null, isLive: false };
  const key = `${stateCode.toUpperCase()}::${personId}`;
  if (_statePersonCache.has(key)) {
    return { data: _statePersonCache.get(key), isLive: true };
  }
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/state-officials/${stateCode.toUpperCase()}/person/${encodeURIComponent(personId)}`
    );
    if (response.status === 404) {
      return { data: null, isLive: true, notSeeded: true };
    }
    if (!response.ok) throw new Error(`API Error ${response.status}`);
    const data = await response.json();
    _statePersonCache.set(key, data);
    return { data, isLive: true };
  } catch (error) {
    console.warn('State person API unavailable:', error.message);
    return { data: null, isLive: false };
  }
}

// ─── State legislator bills (OpenStates proxy) ───────────────────────
const _stateLegBillsCache = new Map();

export async function fetchStateLegislatorBills({
  stateCode, name, chamber = null, district = null, limit = 15,
} = {}) {
  if (!stateCode || !name) return { data: [], isLive: false };
  const key = `${stateCode.toUpperCase()}::${name}::${chamber || ''}::${district || ''}::${limit}`;
  if (_stateLegBillsCache.has(key)) {
    return { data: _stateLegBillsCache.get(key), isLive: true };
  }
  try {
    const qs = new URLSearchParams({ name, limit: String(limit) });
    if (chamber) qs.set('chamber', chamber);
    if (district) qs.set('district', String(district));
    const response = await fetch(
      `${API_BASE_URL}/api/state-officials/${stateCode.toUpperCase()}/legislator-bills?${qs}`
    );
    if (!response.ok) throw new Error(`API Error ${response.status}`);
    const data = await response.json();
    const bills = data.bills || [];
    _stateLegBillsCache.set(key, bills);
    return { data: bills, isLive: true };
  } catch (error) {
    console.warn('State legislator bills API unavailable:', error.message);
    return { data: [], isLive: false };
  }
}

// ─── State legislator votes (OpenStates proxy) ───────────────────────
const _stateLegVotesCache = new Map();

export async function fetchStateLegislatorVotes({
  stateCode, name, chamber = null, district = null, limit = 15,
} = {}) {
  if (!stateCode || !name) return { data: [], isLive: false };
  const key = `${stateCode.toUpperCase()}::${name}::${chamber || ''}::${district || ''}::${limit}`;
  if (_stateLegVotesCache.has(key)) {
    return { data: _stateLegVotesCache.get(key), isLive: true };
  }
  try {
    const qs = new URLSearchParams({ name, limit: String(limit) });
    if (chamber) qs.set('chamber', chamber);
    if (district) qs.set('district', String(district));
    const response = await fetch(
      `${API_BASE_URL}/api/state-officials/${stateCode.toUpperCase()}/legislator-votes?${qs}`
    );
    if (!response.ok) throw new Error(`API Error ${response.status}`);
    const data = await response.json();
    const votes = data.votes || [];
    _stateLegVotesCache.set(key, votes);
    return { data: votes, isLive: true };
  } catch (error) {
    console.warn('State legislator votes API unavailable:', error.message);
    return { data: [], isLive: false };
  }
}

// ─── Governor actions (signed / vetoed bills) ────────────────────────
const _governorActionsCache = new Map();

export async function fetchGovernorActions({
  stateCode, type = 'signed', limit = 15,
} = {}) {
  if (!stateCode) return { data: [], isLive: false };
  const key = `${stateCode.toUpperCase()}::${type}::${limit}`;
  if (_governorActionsCache.has(key)) {
    return { data: _governorActionsCache.get(key), isLive: true };
  }
  try {
    const qs = new URLSearchParams({ type, limit: String(limit) });
    const response = await fetch(
      `${API_BASE_URL}/api/state-officials/${stateCode.toUpperCase()}/governor-actions?${qs}`
    );
    if (!response.ok) throw new Error(`API Error ${response.status}`);
    const data = await response.json();
    const bills = data.bills || [];
    _governorActionsCache.set(key, bills);
    return { data: bills, isLive: true };
  } catch (error) {
    console.warn('Governor actions API unavailable:', error.message);
    return { data: [], isLive: false };
  }
}

// ─── State supreme-court cases (CourtListener proxy) ─────────────────
const _stateCourtCasesCache = new Map();

export async function fetchStateCourtCases({
  stateCode, justiceName = null, limit = 15,
} = {}) {
  if (!stateCode) return { data: [], isLive: false };
  const key = `${stateCode.toUpperCase()}::${justiceName || 'all'}::${limit}`;
  if (_stateCourtCasesCache.has(key)) {
    return { data: _stateCourtCasesCache.get(key), isLive: true };
  }
  try {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (justiceName) qs.set('justice_name', justiceName);
    const response = await fetch(
      `${API_BASE_URL}/api/state-officials/${stateCode.toUpperCase()}/court-cases?${qs}`
    );
    if (!response.ok) throw new Error(`API Error ${response.status}`);
    const data = await response.json();
    const cases = data.cases || [];
    _stateCourtCasesCache.set(key, cases);
    return { data: cases, isLive: true };
  } catch (error) {
    console.warn('State court cases API unavailable:', error.message);
    return { data: [], isLive: false };
  }
}

// ─── Local officials (mayor + council/commission) ─────────────────────
// Cached by (state, city_slug).
const _localCitiesCache = new Map();
const _localOfficialsCache = new Map();

export async function fetchLocalCities(stateCode) {
  if (!stateCode) return { data: [], isLive: false };
  const key = stateCode.toUpperCase();
  if (_localCitiesCache.has(key)) {
    return { data: _localCitiesCache.get(key), isLive: true };
  }
  try {
    const response = await fetch(`${API_BASE_URL}/api/local-officials/${key}`);
    if (!response.ok) throw new Error(`API Error ${response.status}`);
    const data = await response.json();
    _localCitiesCache.set(key, data.cities || []);
    return { data: data.cities || [], isLive: true };
  } catch (error) {
    console.warn('Local cities API unavailable:', error.message);
    return { data: [], isLive: false };
  }
}

export async function fetchLocalOfficials(stateCode, citySlug) {
  if (!stateCode || !citySlug) return { data: null, isLive: false };
  const cacheKey = `${stateCode.toUpperCase()}::${citySlug.toLowerCase()}`;
  if (_localOfficialsCache.has(cacheKey)) {
    return { data: _localOfficialsCache.get(cacheKey), isLive: true };
  }
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/local-officials/${stateCode.toUpperCase()}/${encodeURIComponent(citySlug.toLowerCase())}`
    );
    if (response.status === 404) {
      return { data: null, isLive: true, notSeeded: true };
    }
    if (!response.ok) throw new Error(`API Error ${response.status}`);
    const data = await response.json();
    _localOfficialsCache.set(cacheKey, data);
    return { data, isLive: true };
  } catch (error) {
    console.warn('Local officials API unavailable:', error.message);
    return { data: null, isLive: false };
  }
}

// ─── Elections (full state races + ballot measures) ───────────────────
const _electionsCache = new Map();

export async function fetchElections(stateCode) {
  if (!stateCode) return { data: null, isLive: false };
  const key = stateCode.toUpperCase();
  if (_electionsCache.has(key)) return { data: _electionsCache.get(key), isLive: true };
  try {
    const response = await fetch(`${API_BASE_URL}/api/elections/${key}`);
    if (response.status === 404) {
      return { data: null, isLive: true, notSeeded: true };
    }
    if (!response.ok) throw new Error(`API Error ${response.status}`);
    const data = await response.json();
    _electionsCache.set(key, data);
    return { data, isLive: true };
  } catch (error) {
    console.warn('Elections API unavailable:', error.message);
    return { data: null, isLive: false };
  }
}

// Personalized ballot — pass whatever geography you have; the server includes
// what matches. `geo` shape: { countyFips, countyName, district, stateSenateDistrict,
// stateHouseDistrict, citySlug }.
export async function fetchBallotForAddress(stateCode, geo = {}) {
  if (!stateCode) return { data: null, isLive: false };
  const qs = new URLSearchParams();
  if (geo.countyFips) qs.set('county_fips', geo.countyFips);
  if (geo.countyName) qs.set('county_name', geo.countyName);
  if (geo.district) qs.set('congressional_district', geo.district);
  if (geo.stateSenateDistrict) qs.set('state_senate_district', geo.stateSenateDistrict);
  if (geo.stateHouseDistrict) qs.set('state_house_district', geo.stateHouseDistrict);
  if (geo.citySlug) qs.set('city_slug', geo.citySlug);
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/elections/${stateCode.toUpperCase()}/ballot?${qs.toString()}`
    );
    if (response.status === 404) {
      return { data: null, isLive: true, notSeeded: true };
    }
    if (!response.ok) throw new Error(`API Error ${response.status}`);
    const data = await response.json();
    return { data, isLive: true };
  } catch (error) {
    console.warn('Personalized ballot API unavailable:', error.message);
    return { data: null, isLive: false };
  }
}

// ─── Google Civic Information (voterInfoQuery) ───────────────────────
// The backend proxy returns `{ enabled, data }` where `enabled=false`
// means the server doesn't have GOOGLE_CIVIC_API_KEY set. We normalize
// that into a `{ disabled: true }` signal on the client so callers can
// render a "connect Google Civic" affordance instead of an error.
//
// voterInfo is cached per (address, electionId) to avoid hammering the
// API as a user types into the address bar.
const _voterInfoCache = new Map();

export async function fetchGoogleCivicStatus() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/google-civic/status`);
    if (!response.ok) return { enabled: false };
    return await response.json();
  } catch (error) {
    console.warn('Google Civic status unavailable:', error.message);
    return { enabled: false };
  }
}

export async function fetchVoterInfo(address, { electionId = null, officialOnly = false } = {}) {
  if (!address || !address.trim()) return { data: null, disabled: false };
  const cacheKey = `${address.trim().toLowerCase()}::${electionId ?? ''}::${officialOnly}`;
  if (_voterInfoCache.has(cacheKey)) return { data: _voterInfoCache.get(cacheKey), disabled: false };

  const qs = new URLSearchParams({ address: address.trim() });
  if (electionId != null) qs.set('election_id', String(electionId));
  if (officialOnly) qs.set('official_only', 'true');

  try {
    const response = await fetch(`${API_BASE_URL}/api/google-civic/voter-info?${qs.toString()}`);
    if (!response.ok) throw new Error(`API Error ${response.status}`);
    const payload = await response.json();
    if (!payload.enabled) return { data: null, disabled: true };
    _voterInfoCache.set(cacheKey, payload.data);
    return { data: payload.data, disabled: false };
  } catch (error) {
    console.warn('Google Civic voter-info unavailable:', error.message);
    return { data: null, disabled: false, error: error.message };
  }
}

export async function fetchGoogleCivicElections() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/google-civic/elections`);
    if (!response.ok) throw new Error(`API Error ${response.status}`);
    const payload = await response.json();
    if (!payload.enabled) return { data: [], disabled: true };
    return { data: payload.data || [], disabled: false };
  } catch (error) {
    console.warn('Google Civic elections unavailable:', error.message);
    return { data: [], disabled: false, error: error.message };
  }
}

export async function fetchOcdDivisions(address) {
  if (!address || !address.trim()) return { data: null, disabled: false };
  try {
    const qs = new URLSearchParams({ address: address.trim() });
    const response = await fetch(`${API_BASE_URL}/api/google-civic/divisions?${qs.toString()}`);
    if (!response.ok) throw new Error(`API Error ${response.status}`);
    const payload = await response.json();
    if (!payload.enabled) return { data: null, disabled: true };
    return { data: payload.data, disabled: false };
  } catch (error) {
    console.warn('Google Civic divisions unavailable:', error.message);
    return { data: null, disabled: false, error: error.message };
  }
}

// ─── All candidates (global search index) ────────────────────────────
// Loaded once and cached for the session, just like fetchAllMembers().
// Derives `state` from the id prefix (`fl-cand-…` → `FL`) since the raw
// records don't carry it.
let _allCandidatesCache = null;
let _allCandidatesPromise = null;

function _stateFromCandidateId(id) {
  if (!id || typeof id !== 'string') return null;
  const m = id.match(/^([a-z]{2})-/i);
  return m ? m[1].toUpperCase() : null;
}

export async function fetchAllCandidates() {
  if (_allCandidatesCache) return { data: _allCandidatesCache, isLive: true };
  if (_allCandidatesPromise) return _allCandidatesPromise;

  _allCandidatesPromise = (async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/candidates`);
      if (!response.ok) throw new Error(`API Error ${response.status}`);
      const data = await response.json();
      const candidates = (data.candidates || []).map((c) => ({
        ...c,
        state: c.state || _stateFromCandidateId(c.id),
      }));
      _allCandidatesCache = candidates;
      return { data: candidates, isLive: true };
    } catch (error) {
      console.warn('All-candidates index unavailable:', error.message);
      return { data: [], isLive: false };
    } finally {
      _allCandidatesPromise = null;
    }
  })();

  return _allCandidatesPromise;
}

// ─── Candidate detail ────────────────────────────────────────────────
const _candidateCache = new Map();

export async function fetchCandidate(candidateId) {
  if (!candidateId) return { data: null, isLive: false };
  if (_candidateCache.has(candidateId)) {
    return { data: _candidateCache.get(candidateId), isLive: true };
  }
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/candidates/${encodeURIComponent(candidateId)}`
    );
    if (response.status === 404) {
      return { data: null, isLive: true, notSeeded: true };
    }
    if (!response.ok) throw new Error(`API Error ${response.status}`);
    const data = await response.json();
    _candidateCache.set(candidateId, data);
    return { data, isLive: true };
  } catch (error) {
    console.warn('Candidate API unavailable:', error.message);
    return { data: null, isLive: false };
  }
}

// ─── State info (legislature + elections) ────────────────────────────
export async function fetchStateInfo(stateCode) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/states/${stateCode}`);
    if (!response.ok) throw new Error(`API Error ${response.status}`);
    const data = await response.json();

    // Backend returns {name, stateLeg: [{chamber, ...}], elections: [...]}
    // Transform stateLeg into {senate, house}
    const stateLegArr = data.stateLeg || [];
    const senate = stateLegArr.filter((m) => m.chamber === 'State Senate').map((m) => ({
      id: m.id,
      name: m.name,
      party: m.party,
      chamber: m.chamber,
      title: `${m.chamber} - District ${m.district} · ${m.role}`,
      photoUrl: null,
    }));
    const house = stateLegArr
      .filter((m) => m.chamber === 'State House' || m.chamber === 'State Assembly')
      .map((m) => ({
        id: m.id,
        name: m.name,
        party: m.party,
        chamber: m.chamber,
        title: `${m.chamber} - District ${m.district} · ${m.role}`,
        photoUrl: null,
      }));

    return {
      data: {
        stateLeg: { senate, house },
        elections: data.elections || [],
      },
      isLive: true,
    };
  } catch (error) {
    console.warn('State API unavailable, using sample data:', error.message);
    const fallback = SAMPLE_DATA[stateCode];
    return {
      data: fallback
        ? { stateLeg: fallback.stateLeg, elections: fallback.elections }
        : { stateLeg: { senate: [], house: [] }, elections: [] },
      isLive: false,
    };
  }
}

// ─── Sample / Fallback Data ──────────────────────────────────────────
// Historically this object carried a hand-curated snapshot of a few
// senators + reps per sample state so the UI had *something* to show
// when the backend was unreachable. Problem: the snapshot rots. It was
// still showing Marco Rubio as a FL senator in April 2026 (he resigned
// in January 2025 and was replaced by Ashley Moody), and it only
// covered 4 of Florida's 28 House reps.
//
// Strategy now: empty fallbacks. If the backend is down we want the
// caller to surface an honest "unavailable" state rather than silently
// serve stale data that's indistinguishable from a live response. The
// shape is preserved so existing consumers don't NPE.
const EMPTY_STATE_FALLBACK = {
  congress: { senators: [], representatives: [] },
  stateLeg: { senate: [], house: [] },
  elections: [],
};

const SAMPLE_DATA = new Proxy({}, {
  get: () => EMPTY_STATE_FALLBACK,
  has: () => false,
});
