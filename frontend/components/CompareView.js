'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import { useEffect, useMemo, useState } from 'react';
import {
  fetchMemberBills,
  fetchMemberDetail,
  fetchMemberStats,
  fetchMemberVotes,
  fetchCandidate,
} from '@/lib/api';
import { EmptyState, Newspaper } from './ui';
import { useIsMobile } from '@/lib/useViewport';
import HScroll from './HScroll';

const PARTY_COLORS = { R: '#e63946', D: '#457b9d', I: '#6c3ec1', NP: '#666' };
const PARTY_BG = { R: '#fde8e8', D: '#e3f0f7', I: '#f0eaff', NP: '#eef' };
const PARTY_NAMES = { R: 'Republican', D: 'Democrat', I: 'Independent', NP: 'Non-partisan' };

/**
 * Unified compare modal — handles officials (sitting reps, federal execs,
 * state/local officials) AND ballot candidates in the same layout. Each item
 * in `items` carries `_kind: 'official' | 'candidate'`. Columns render the
 * appropriate blocks for each kind; the shared roll-call votes section only
 * activates when ≥2 officials with bioguide_ids are present.
 */
export default function CompareView({ open, items, onClose }) {
  // Keyed by `${_kind}-${bioguide_id || id}` so candidate + official ids can't
  // collide even on the same seed string.
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(false);
  const isMobile = useIsMobile();
  // 'all' | 'agree' | 'disagree' vote filter. MUST live with the other hooks,
  // BEFORE the `if (!open) return null` early return below — React requires a
  // stable hook count/order across renders. This previously sat after the
  // return, so opening the modal rendered one extra hook and threw
  // "rendered more hooks than during the previous render" (hard crash).
  const [voteFilter, setVoteFilter] = useState('all');

  useEffect(() => {
    if (!open || !items?.length) return;
    let cancelled = false;
    setLoading(true);
    Promise.all(
      items.map(async (it) => {
        const key = itemKey(it);

        // ── Candidates ───────────────────────────────────────────────
        if (it._kind === 'candidate') {
          // If the stub already carries the rich fields, skip the fetch.
          if (it.top_issues && it.endorsements) {
            return [key, { candidate: it }];
          }
          try {
            const { data: full } = await fetchCandidate(it.id);
            return [key, { candidate: full || it }];
          } catch (e) {
            return [key, { candidate: it }];
          }
        }

        // ── Officials ────────────────────────────────────────────────
        // Non-Congress officials (federal/state/local) carry top_issues +
        // experience on the object itself — no Congress-API fetch.
        if (!it.bioguide_id) {
          return [key, {
            stats: null,
            bills: { sponsored: [], cosponsored: [] },
            votes: [],
            top_issues: it.top_issues || [],
            experience: it.experience || [],
          }];
        }
        // Congress members: stats + bills + votes + detail (sidecar merged).
        const [stats, bills, votes, detail] = await Promise.all([
          fetchMemberStats(it.bioguide_id, it.party),
          fetchMemberBills(it.bioguide_id, 8),
          // 50 recent votes per member (was 25) — deeper overlap window
          // makes the agreement rate meaningful for cross-chamber pairs.
          fetchMemberVotes(it.bioguide_id, 50),
          fetchMemberDetail(it.bioguide_id),
        ]);
        const d = detail?.data || {};
        return [key, {
          stats: stats.data,
          bills: bills.data,
          votes: votes.data,
          top_issues: d.top_issues || it.top_issues || [],
          experience: d.experience || it.experience || [],
        }];
      })
    ).then((entries) => {
      if (cancelled) return;
      setData(Object.fromEntries(entries));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [open, items]);

  // Esc closes
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // ── Shared roll-call votes (officials with bioguide_ids only) ────────
  const votingOfficials = useMemo(
    () => (items || []).filter((i) => i._kind !== 'candidate' && i.bioguide_id),
    [items]
  );
  const sharedVotes = useMemo(() => {
    if (votingOfficials.length < 2) return [];
    const ids = votingOfficials.map((m) => m.bioguide_id);
    const map = new Map();
    for (const m of votingOfficials) {
      const key = itemKey(m);
      const votes = data[key]?.votes || [];
      for (const v of votes) {
        if (!v.vote_id) continue;
        if (!map.has(v.vote_id)) {
          map.set(v.vote_id, {
            vote_id: v.vote_id, question: v.question, date: v.date,
            chamber: v.chamber, url: v.url, positions: {},
          });
        }
        map.get(v.vote_id).positions[m.bioguide_id] = (v.position || '').trim();
      }
    }
    const shared = [];
    for (const v of map.values()) {
      if (!ids.every((id) => v.positions[id])) continue;
      const positions = ids.map((id) => normalizeVote(v.positions[id]));
      const distinct = new Set(positions.filter((p) => p !== 'other'));
      let agreement = 'mixed';
      if (distinct.size === 1) agreement = 'agree';
      else if (distinct.size > 1) agreement = 'disagree';
      shared.push({ ...v, _agreement: agreement, _normPositions: positions });
    }
    shared.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return shared;
  }, [data, votingOfficials]);

  // ── Cross-item shared-topic stances (any kind × any kind) ────────────
  // Unifies top_issues across officials + candidates. Lets the user see how
  // Byron Donalds's stance on "Immigration" stacks against Donald Trump's.
  const sharedTopics = useMemo(() => {
    if (!items || items.length < 2) return [];
    const byKey = new Map();
    for (const it of items) {
      const bucket = data[itemKey(it)];
      const list = it._kind === 'candidate'
        ? (bucket?.candidate?.top_issues || [])
        : (bucket?.top_issues || []);
      for (const raw of list) {
        if (!raw || typeof raw === 'string') continue;
        const name = raw.name || raw.topic;
        const stance = raw.stance || raw.position;
        if (!name || !stance) continue;
        if (!byKey.has(name)) byKey.set(name, {});
        byKey.get(name)[itemKey(it)] = stance;
      }
    }
    // Keep only topics that have stances from ≥ 2 items (genuine comparison).
    const rows = [];
    for (const [name, byId] of byKey.entries()) {
      if (Object.keys(byId).length < 2) continue;
      rows.push({ name, byId });
    }
    return rows;
  }, [items, data]);

  if (!open) return null;

  const officialCount = items.filter((i) => i._kind !== 'candidate').length;
  const candidateCount = items.filter((i) => i._kind === 'candidate').length;
  const headerLabel = candidateCount === 0
    ? `Compare ${items.length} ${items.length === 1 ? 'Representative' : 'Representatives'}`
    : officialCount === 0
      ? `Compare ${items.length} ${items.length === 1 ? 'Candidate' : 'Candidates'}`
      : `Compare ${items.length} (${officialCount} official${officialCount === 1 ? '' : 's'} · ${candidateCount} candidate${candidateCount === 1 ? '' : 's'})`;

  const agreeCount = sharedVotes.filter((v) => v._agreement === 'agree').length;
  const disagreeCount = sharedVotes.filter((v) => v._agreement === 'disagree').length;
  // Agreement rate over decisive (agree/disagree) shared votes — 'mixed'
  // rows (Present / Not Voting) don't count toward either side.
  const decisiveCount = agreeCount + disagreeCount;
  const agreementPct = decisiveCount > 0 ? Math.round((agreeCount / decisiveCount) * 100) : null;
  const filteredVotes = voteFilter === 'all'
    ? sharedVotes
    : sharedVotes.filter((v) => v._agreement === voteFilter);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Compare"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        zIndex: 110, display: 'flex',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          margin: 'auto', width: 'min(1200px, 96vw)', height: 'min(90vh, 920px)',
          background: 'white', borderRadius: '14px', overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 24px 64px rgba(0,0,0,0.32)',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '14px 20px', borderBottom: '1px solid var(--cl-border)',
            background: 'var(--cl-bg)', display: 'flex', alignItems: 'center', gap: '10px',
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--cl-primary)' }}>
              {headerLabel}
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--cl-text-light)', marginTop: '2px' }}>
              {candidateCount === 0
                ? 'Side-by-side stats, bills, and shared votes'
                : officialCount === 0
                  ? 'Side-by-side issues, experience, endorsements, and fundraising'
                  : 'Side-by-side issues, experience, and records'}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              padding: '6px 10px', background: 'white', border: '1px solid var(--cl-border)',
              borderRadius: '8px', cursor: 'pointer', fontSize: '0.82rem', color: 'var(--cl-text-light)',
            }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px' }}>
          {/* Mixed columns — each item picks its kind-appropriate renderer */}
          {(() => {
            const cards = items.map((it) => {
              const key = itemKey(it);
              const col = it._kind === 'candidate'
                ? <CandidateColumn candidate={data[key]?.candidate || it} loading={loading} />
                : <MemberColumn member={it} state={data[key]} loading={loading} />;
              return (
                <div
                  key={key}
                  style={isMobile
                    ? { minWidth: '82vw', maxWidth: '82vw', flexShrink: 0, scrollSnapAlign: 'start' }
                    : { display: 'contents' }}
                >
                  {col}
                </div>
              );
            });
            // Mobile: snap-scroll carousel wrapped in HScroll so the shared
            // edge-arrow affordance (fades in at a scrollable edge, hides when
            // there's nothing to scroll) tells users they can swipe between
            // people. Desktop: plain grid, no scroll, no arrows.
            return isMobile ? (
              <HScroll
                ariaLabel="Compare people"
                scrollerStyle={{ gap: '12px', scrollSnapType: 'x mandatory', paddingBottom: '4px' }}
                itemCount={items.length}
              >
                {cards}
              </HScroll>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`, gap: '14px' }}>
                {cards}
              </div>
            );
          })()}

          {/* Shared topic stances — works across any kind */}
          {sharedTopics.length > 0 && (
            <div style={{ marginTop: '24px' }}>
              <div
                style={{
                  fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: '0.5px', color: 'var(--cl-text-light)', marginBottom: '8px',
                }}
              >
                Shared Topic Stances
              </div>
{isMobile ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {sharedTopics.map((row) => (
                    <div key={row.name} style={{ border: '1px solid var(--cl-border)', borderRadius: '10px', overflow: 'hidden', background: 'white' }}>
                      <div style={{ padding: '8px 12px', background: 'var(--cl-bg)', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', color: 'var(--cl-primary)' }}>
                        {row.name}
                      </div>
                      {items.map((it, idx) => {
                        const k = itemKey(it);
                        const stance = row.byId[k];
                        return (
                          <div key={k} style={{ padding: '8px 12px', borderTop: idx === 0 ? 'none' : '1px solid var(--cl-border)' }}>
                            <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--cl-text-light)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '2px' }}>
                              {it.name}
                            </div>
                            <div style={{ fontSize: '0.8rem', lineHeight: 1.4, color: stance ? 'var(--cl-text)' : 'var(--cl-text-light)', fontStyle: stance ? 'normal' : 'italic' }}>
                              {stance || '—'}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              ) : (
              <div
                style={{
                  border: '1px solid var(--cl-border)', borderRadius: '10px',
                  overflow: 'hidden', background: 'white',
                }}
              >
                {sharedTopics.map((row, i) => (
                  <div
                    key={row.name}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: `160px repeat(${items.length}, 1fr)`,
                      borderBottom: i === sharedTopics.length - 1 ? 'none' : '1px solid var(--cl-border)',
                      alignItems: 'stretch',
                    }}
                  >
                    <div
                      style={{
                        padding: '10px 12px', fontSize: '0.74rem',
                        fontWeight: 700, color: 'var(--cl-primary)',
                        textTransform: 'uppercase', letterSpacing: '0.4px',
                        background: 'var(--cl-bg)',
                      }}
                    >
                      {row.name}
                    </div>
                    {items.map((it) => {
                      const k = itemKey(it);
                      const stance = row.byId[k];
                      return (
                        <div key={k} style={{
                          padding: '10px 12px', fontSize: '0.8rem',
                          lineHeight: 1.4, color: 'var(--cl-text)',
                          borderLeft: '1px solid var(--cl-border)',
                        }}>
                          {stance || <span style={{ color: 'var(--cl-text-light)', fontStyle: 'italic' }}>—</span>}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
              )}
            </div>
          )}

          {/* Shared roll-call votes — only meaningful when ≥2 officials with
              bioguide_ids. Hide entirely when comparing only candidates or
              a mix that lacks two voting members. */}
          {votingOfficials.length >= 2 && (
            <div style={{ marginTop: '24px' }}>
              <div
                style={{
                  fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: '0.5px', color: 'var(--cl-text-light)', marginBottom: '8px',
                  display: 'flex', alignItems: 'center', gap: '12px',
                }}
              >
                <span>Shared Roll-Call Votes</span>
                {sharedVotes.length > 0 && (
                  <span style={{ display: 'flex', gap: '8px', fontSize: '0.7rem', textTransform: 'none', letterSpacing: 0 }}>
                    <span style={{ color: '#1d8a4b', fontWeight: 700 }}>● {agreeCount} agree</span>
                    <span style={{ color: '#c1311b', fontWeight: 700 }}>● {disagreeCount} disagree</span>
                  </span>
                )}
                {candidateCount > 0 && (
                  <span style={{ fontSize: '0.7rem', color: 'var(--cl-text-light)', textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>
                    ({votingOfficials.length} with voting records)
                  </span>
                )}
              </div>

              {loading && (
                <div style={{ padding: '20px', color: 'var(--cl-text-light)', fontSize: 'var(--cl-text-sm)' }}>
                  Loading shared votes…
                </div>
              )}

              {!loading && sharedVotes.length === 0 && (
                <EmptyState
                  icon={<Newspaper size={32} active color="muted" />}
                  headline="No overlapping votes"
                  body="These members haven't been in shared sessions on the same bills recently."
                  tone="muted"
                  dense
                />
              )}

              {!loading && sharedVotes.length > 0 && agreementPct !== null && (
                <div
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                    margin: '0 0 10px', padding: '10px 12px',
                    background: 'var(--cl-bg)', border: '1px solid var(--cl-border)',
                    borderRadius: '10px',
                  }}
                >
                  <div style={{ fontSize: '0.8rem', color: 'var(--cl-text)', fontWeight: 600, whiteSpace: isMobile ? 'normal' : 'nowrap', flexBasis: isMobile ? '100%' : 'auto' }}>
                    Voted the same way on {agreeCount} of {decisiveCount} shared votes
                  </div>
                  <div style={{ flex: 1, height: 8, borderRadius: 4, background: '#f3d9d3', overflow: 'hidden', minWidth: 60 }}>
                    <div style={{ width: `${agreementPct}%`, height: '100%', background: '#1d8a4b' }} />
                  </div>
                  <div style={{ fontSize: '0.8rem', fontWeight: 800, color: agreementPct >= 50 ? '#1d8a4b' : '#c1311b' }}>
                    {agreementPct}%
                  </div>
                </div>
              )}

              {!loading && sharedVotes.length > 0 && (
                <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                  {[['all', `All (${sharedVotes.length})`], ['agree', `Agree (${agreeCount})`], ['disagree', `Disagree (${disagreeCount})`]].map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setVoteFilter(key)}
                      style={{
                        padding: '4px 12px', borderRadius: 999, fontSize: '0.72rem', fontWeight: 700,
                        fontFamily: 'inherit', cursor: 'pointer',
                        border: '1px solid ' + (voteFilter === key ? 'var(--cl-accent)' : 'var(--cl-border)'),
                        background: voteFilter === key ? 'var(--cl-accent-soft, rgba(37,99,235,0.10))' : 'white',
                        color: voteFilter === key ? 'var(--cl-accent)' : 'var(--cl-text-light)',
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}

              {!loading && sharedVotes.length > 0 && filteredVotes.length === 0 && (
                <div style={{ padding: '14px', fontSize: '0.8rem', color: 'var(--cl-text-light)' }}>
                  No {voteFilter === 'agree' ? 'agreeing' : 'disagreeing'} votes in the shared window.
                </div>
              )}

              {!loading && filteredVotes.length > 0 && (
                <div
                  style={{
                    border: '1px solid var(--cl-border)', borderRadius: '10px',
                    overflow: 'hidden', background: 'white',
                  }}
                >
                  {filteredVotes.slice(0, 30).map((v, i) => (
                    <SharedVoteRow
                      key={v.vote_id}
                      vote={v}
                      officials={votingOfficials}
                      isLast={i === filteredVotes.slice(0, 30).length - 1}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* If comparing candidates or mixed without voting officials, show a
              gentle note so the user knows why no roll-call section appears. */}
          {votingOfficials.length < 2 && candidateCount > 0 && (
            <div style={{ marginTop: '24px' }}>
              <div
                style={{
                  padding: '12px 14px', background: 'var(--cl-bg)',
                  border: '1px dashed var(--cl-border)', borderRadius: '10px',
                  fontSize: '0.8rem', color: 'var(--cl-text-light)', lineHeight: 1.4,
                }}
              >
                Ballot candidates don't have roll-call voting records yet — use the
                stances, experience, and fundraising columns above to compare.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Per-official column ──────────────────────────────────────────────
function MemberColumn({ member, state, loading }) {
  const partyColor = PARTY_COLORS[member.party] || PARTY_COLORS.I;
  const stats = state?.stats;
  const bills = state?.bills;

  return (
    <div
      style={{
        border: `1px solid var(--cl-border)`, borderRadius: '12px',
        background: 'white', overflow: 'hidden',
        borderTop: `3px solid ${partyColor}`,
      }}
    >
      {/* Header */}
      <div style={{ padding: '14px', display: 'flex', alignItems: 'center', gap: '10px', borderBottom: '1px solid var(--cl-border)' }}>
        {member.photoUrl && (
          <img
            src={member.photoUrl}
            alt=""
            style={{ width: '48px', height: '48px', borderRadius: '50%', objectFit: 'cover', background: '#e9ecef' }}
            onError={(e) => { e.target.style.visibility = 'hidden'; }}
          />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--cl-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {member.name}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--cl-text-light)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {member.title || member.role || ''} {member.state ? `· ${member.state}` : ''}
          </div>
        </div>
      </div>

      {/* Stats */}
      <Block label="Party-line voting">
        {loading && !stats && <Skeleton width="60%" />}
        {stats && stats.party_line_pct == null && (
          <div style={{ fontSize: '0.8rem', color: 'var(--cl-text-light)' }}>No data yet</div>
        )}
        {stats && stats.party_line_pct != null && (
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
              <div style={{ fontSize: '1.4rem', fontWeight: 800, color: partyColor }}>
                {stats.party_line_pct}%
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--cl-text-light)' }}>
                of {stats.votes_analyzed} votes
              </div>
            </div>
            <div style={{ marginTop: '6px', height: '6px', background: 'var(--cl-bg)', borderRadius: '4px', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${stats.party_line_pct}%`, height: '100%',
                  background: partyColor, transition: 'width 0.4s',
                }}
              />
            </div>
          </div>
        )}
        {!stats && !loading && (
          <div style={{ fontSize: '0.78rem', color: 'var(--cl-text-light)' }}>
            Not applicable for this role
          </div>
        )}
      </Block>

      {/* Curated top-issue stances take priority; fall back to the
          stats-derived tag list from bill activity for Congress members
          when no curated profile exists. */}
      <Block label="Top issue stances">
        {loading && !state && <Skeleton width="90%" />}
        {(() => {
          const curated = Array.isArray(state?.top_issues)
            ? state.top_issues.filter((i) => i && typeof i === 'object' && i.name)
            : [];
          if (curated.length > 0) {
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {curated.slice(0, 4).map((iss, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: '7px 9px', borderRadius: '8px',
                      background: 'var(--cl-bg)', border: '1px solid var(--cl-border)',
                    }}
                  >
                    <div style={{
                      fontSize: '0.74rem', fontWeight: 700,
                      color: 'var(--cl-primary)', marginBottom: '2px',
                    }}>
                      {iss.name}
                    </div>
                    {iss.stance && (
                      <div style={{
                        fontSize: '0.72rem', lineHeight: 1.35, color: 'var(--cl-text)',
                      }}>
                        {iss.stance}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            );
          }
          const statsIssues = stats?.top_issues || [];
          if (statsIssues.length === 0) {
            return (
              <div style={{ fontSize: '0.78rem', color: 'var(--cl-text-light)' }}>
                No issue positions on file.
              </div>
            );
          }
          return (
            <>
              <div style={{
                fontSize: '0.7rem', color: 'var(--cl-text-light)',
                marginBottom: '4px', fontStyle: 'italic',
              }}>
                Inferred from recent bill activity
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {statsIssues.slice(0, 5).map((iss) => (
                  <span
                    key={iss.name}
                    style={{
                      padding: '2px 8px', borderRadius: '999px',
                      background: 'var(--cl-bg)', border: '1px solid var(--cl-border)',
                      fontSize: '0.7rem', color: 'var(--cl-text)', fontWeight: 500,
                    }}
                  >
                    {iss.name}
                  </span>
                ))}
              </div>
            </>
          );
        })()}
      </Block>

      <Block label="Experience highlights">
        {loading && !state && <Skeleton width="100%" />}
        {(() => {
          const exp = Array.isArray(state?.experience)
            ? state.experience.filter((x) => x && typeof x === 'object' && x.role)
            : [];
          if (exp.length === 0) {
            return (
              <div style={{ fontSize: '0.78rem', color: 'var(--cl-text-light)' }}>
                No experience listed.
              </div>
            );
          }
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {exp.slice(0, 3).map((x, idx) => (
                <div
                  key={idx}
                  style={{
                    fontSize: '0.76rem', lineHeight: 1.4,
                    paddingLeft: '10px', borderLeft: '2px solid var(--cl-border)',
                  }}
                >
                  <div style={{
                    fontSize: '0.68rem', color: 'var(--cl-text-light)', fontWeight: 600,
                  }}>
                    {formatCompareTenure(x.from, x.to)}
                  </div>
                  <div style={{ color: 'var(--cl-text)', fontWeight: 500 }}>
                    {x.role}
                  </div>
                </div>
              ))}
            </div>
          );
        })()}
      </Block>

      <Block label="Recent sponsored bills">
        {loading && !bills && <Skeleton width="100%" />}
        {bills && (bills.sponsored || []).length === 0 && (
          <div style={{ fontSize: '0.8rem', color: 'var(--cl-text-light)' }}>None recently</div>
        )}
        {bills && (bills.sponsored || []).slice(0, 4).map((b, i) => (
          <div
            key={i}
            style={{
              padding: '6px 0', borderBottom: i === Math.min(3, bills.sponsored.length - 1) ? 'none' : '1px solid var(--cl-border)',
              fontSize: '0.78rem', color: 'var(--cl-text)', lineHeight: 1.35,
            }}
          >
            <div style={{ fontWeight: 600 }}>{b.citation || 'Bill'}</div>
            <div style={{ color: 'var(--cl-text-light)', fontSize: '0.74rem', marginTop: '2px' }}>
              {b.title?.length > 80 ? b.title.slice(0, 80) + '…' : b.title}
            </div>
          </div>
        ))}
      </Block>
    </div>
  );
}

// ─── Per-candidate column ─────────────────────────────────────────────
function CandidateColumn({ candidate, loading }) {
  const party = candidate.party || 'NP';
  const partyColor = PARTY_COLORS[party] || PARTY_COLORS.NP;
  const initials = (candidate.name || '').split(' ').map((p) => p[0]).slice(0, 2).join('');

  return (
    <div
      style={{
        border: `1px solid var(--cl-border)`, borderRadius: '12px',
        background: 'white', overflow: 'hidden',
        borderTop: `3px solid ${partyColor}`,
      }}
    >
      {/* Header */}
      <div style={{ padding: '14px', display: 'flex', alignItems: 'center', gap: '10px', borderBottom: '1px solid var(--cl-border)' }}>
        <div
          style={{
            width: '48px', height: '48px', borderRadius: '50%',
            background: PARTY_BG[party] || '#eef',
            color: partyColor,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: '1rem', flexShrink: 0,
          }}
        >
          {initials}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--cl-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {candidate.name}
            </div>
            <span
              title="Ballot candidate"
              style={{
                padding: '1px 5px', borderRadius: '6px', fontSize: '0.58rem',
                fontWeight: 700, letterSpacing: '0.4px',
                background: '#fff7e6', color: '#b36b00',
              }}
            >
              🗳
            </span>
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--cl-text-light)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {PARTY_NAMES[party] || party}
            {candidate.seeking_office ? ` · ${candidate.seeking_office}` : ''}
          </div>
        </div>
      </div>

      {/* Current role / hometown */}
      {(candidate.current_office || candidate.hometown) && (
        <Block label="Background">
          {candidate.current_office && (
            <div style={{ fontSize: '0.8rem', color: 'var(--cl-text)' }}>
              <span style={{ color: 'var(--cl-text-light)' }}>Current: </span>
              {candidate.current_office}
            </div>
          )}
          {candidate.hometown && (
            <div style={{ fontSize: '0.8rem', color: 'var(--cl-text)', marginTop: '2px' }}>
              <span style={{ color: 'var(--cl-text-light)' }}>Hometown: </span>
              {candidate.hometown}
            </div>
          )}
        </Block>
      )}

      {/* Top priorities — chip list */}
      <Block label="Top priorities">
        {loading && (!candidate.top_issues || candidate.top_issues.length === 0) && <Skeleton width="90%" />}
        {(() => {
          const topics = (candidate.top_issues || [])
            .map((t) => (typeof t === 'string' ? t : t.name || t.topic))
            .filter(Boolean);
          if (!topics.length) {
            return <div style={{ fontSize: '0.78rem', color: 'var(--cl-text-light)' }}>None listed.</div>;
          }
          return (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {topics.slice(0, 6).map((t, idx) => (
                <span
                  key={idx}
                  style={{
                    fontSize: '0.7rem', fontWeight: 600, padding: '2px 8px',
                    borderRadius: '10px', background: 'var(--cl-bg)', color: 'var(--cl-primary)',
                  }}
                >
                  {t}
                </span>
              ))}
            </div>
          );
        })()}
      </Block>

      {/* Issue stances — same renderer as the official column */}
      <Block label="Top issue stances">
        {(() => {
          const curated = (candidate.top_issues || [])
            .filter((i) => i && typeof i === 'object' && i.name && i.stance);
          if (curated.length === 0) {
            return (
              <div style={{ fontSize: '0.78rem', color: 'var(--cl-text-light)' }}>
                No issue stances on file.
              </div>
            );
          }
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {curated.slice(0, 4).map((iss, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: '7px 9px', borderRadius: '8px',
                    background: 'var(--cl-bg)', border: '1px solid var(--cl-border)',
                  }}
                >
                  <div style={{
                    fontSize: '0.74rem', fontWeight: 700,
                    color: 'var(--cl-primary)', marginBottom: '2px',
                  }}>
                    {iss.name}
                  </div>
                  <div style={{
                    fontSize: '0.72rem', lineHeight: 1.35, color: 'var(--cl-text)',
                  }}>
                    {iss.stance}
                  </div>
                </div>
              ))}
            </div>
          );
        })()}
      </Block>

      {/* Endorsements */}
      <Block label="Endorsements">
        {(() => {
          const list = (candidate.endorsements || []).slice(0, 5);
          if (!list.length) {
            return <div style={{ fontSize: '0.78rem', color: 'var(--cl-text-light)' }}>None listed.</div>;
          }
          return (
            <ul style={{ margin: 0, paddingLeft: '16px', lineHeight: 1.5, fontSize: '0.78rem' }}>
              {list.map((e, idx) => (
                <li key={idx}>{typeof e === 'string' ? e : (e.name || '')}</li>
              ))}
            </ul>
          );
        })()}
      </Block>

      {/* Experience highlights */}
      <Block label="Experience highlights">
        {(() => {
          const exp = (candidate.experience || []).filter((x) => x && typeof x === 'object');
          if (!exp.length) {
            return <div style={{ fontSize: '0.78rem', color: 'var(--cl-text-light)' }}>No experience listed.</div>;
          }
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {exp.slice(0, 3).map((x, idx) => (
                <div
                  key={idx}
                  style={{
                    fontSize: '0.76rem', lineHeight: 1.4,
                    paddingLeft: '10px', borderLeft: '2px solid var(--cl-border)',
                  }}
                >
                  <div style={{
                    fontSize: '0.68rem', color: 'var(--cl-text-light)', fontWeight: 600,
                  }}>
                    {formatCompareTenure(x.from, x.to)}
                  </div>
                  <div style={{ color: 'var(--cl-text)', fontWeight: 500 }}>
                    {x.role || x.title}
                    {x.organization ? <span style={{ color: 'var(--cl-text-light)', fontWeight: 400 }}> · {x.organization}</span> : null}
                  </div>
                </div>
              ))}
            </div>
          );
        })()}
      </Block>

      {/* Fundraising */}
      {candidate.fundraising && (candidate.fundraising.total_raised || candidate.fundraising.cash_on_hand) && (
        <Block label="Fundraising">
          {candidate.fundraising.total_raised && (
            <div style={{ fontSize: '0.82rem', marginBottom: '4px' }}>
              <span style={{ color: 'var(--cl-text-light)' }}>Raised: </span>
              <strong style={{ color: 'var(--cl-primary)' }}>${fmtMoney(candidate.fundraising.total_raised)}</strong>
            </div>
          )}
          {candidate.fundraising.cash_on_hand && (
            <div style={{ fontSize: '0.78rem', color: 'var(--cl-text)' }}>
              Cash on hand: ${fmtMoney(candidate.fundraising.cash_on_hand)}
            </div>
          )}
        </Block>
      )}
    </div>
  );
}

function Block({ label, children }) {
  return (
    <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--cl-border)' }}>
      <div
        style={{
          fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.5px', color: 'var(--cl-text-light)', marginBottom: '6px',
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

function Skeleton({ width }) {
  return (
    <div
      style={{
        height: '14px', width, background: 'linear-gradient(90deg, #f1f3f5 0%, #e9ecef 50%, #f1f3f5 100%)',
        borderRadius: '4px', animation: 'pulse 1.4s infinite',
      }}
    />
  );
}

// ─── Shared-vote row ──────────────────────────────────────────────────
function SharedVoteRow({ vote, officials, isLast }) {
  const tone = vote._agreement === 'agree'
    ? { bg: '#f0fbf3', border: '#b7ebc6', label: '#1d8a4b', text: 'All agree' }
    : vote._agreement === 'disagree'
      ? { bg: '#fdf3f1', border: '#f4c8c0', label: '#c1311b', text: 'Disagreement' }
      : { bg: 'white', border: 'var(--cl-border)', label: 'var(--cl-text-light)', text: 'Mixed' };

  return (
    <div
      style={{
        padding: '12px 14px',
        borderBottom: isLast ? 'none' : '1px solid var(--cl-border)',
        background: tone.bg,
        borderLeft: `3px solid ${tone.border}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--cl-text)', lineHeight: 1.35 }}>
            {vote.question || 'Roll-call vote'}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--cl-text-light)', marginTop: '2px' }}>
            {vote.date} · {vote.chamber}
            {vote.url && (
              <>
                {' · '}
                <a href={vote.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--cl-accent)' }}>
                  View vote ↗
                </a>
              </>
            )}
          </div>
        </div>
        <span
          style={{
            fontSize: '0.7rem', fontWeight: 700,
            padding: '2px 8px', borderRadius: '999px',
            background: 'white', border: `1px solid ${tone.border}`, color: tone.label,
            flexShrink: 0,
          }}
        >
          {tone.text}
        </span>
      </div>

      {/* Per-member position */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
        {officials.map((m, i) => {
          const norm = vote._normPositions[i];
          const pill = positionPill(norm);
          return (
            <div
              key={m.bioguide_id || m.id}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '3px 8px', borderRadius: '999px',
                background: 'white', border: '1px solid var(--cl-border)',
                fontSize: '0.72rem',
              }}
            >
              <span style={{ fontWeight: 600, color: 'var(--cl-text)' }}>{lastName(m.name)}</span>
              <span
                style={{
                  fontWeight: 700, color: pill.color,
                  padding: '0 6px', borderRadius: '8px', background: pill.bg,
                }}
              >
                {pill.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────
function itemKey(it) {
  return `${it._kind || 'official'}-${it.bioguide_id || it.id}`;
}

function normalizeVote(raw) {
  const v = (raw || '').toLowerCase();
  if (v === 'yes' || v === 'aye' || v === 'yea') return 'yea';
  if (v === 'no' || v === 'nay') return 'nay';
  return 'other';
}

function positionPill(norm) {
  if (norm === 'yea') return { label: 'Yea', color: '#1d8a4b', bg: '#e6f7ec' };
  if (norm === 'nay') return { label: 'Nay', color: '#c1311b', bg: '#fdecea' };
  return { label: '—', color: 'var(--cl-text-light)', bg: '#f1f3f5' };
}

function lastName(name) {
  if (!name) return '';
  const parts = name.split(' ');
  return parts[parts.length - 1];
}

function formatCompareTenure(from, to) {
  const f = from == null ? '' : String(from);
  if (to == null || to === '' || String(to).toLowerCase() === 'present') {
    return f ? `${f} – Present` : 'Present';
  }
  const t = String(to);
  if (t === f) return f;
  return f ? `${f}–${t}` : t;
}

function fmtMoney(n) {
  if (typeof n !== 'number') return n;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString();
}
