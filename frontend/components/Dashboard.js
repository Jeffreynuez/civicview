'use client';

import { useEffect, useState } from 'react';
import { fetchOwnerDashboard } from '../lib/pagesApi';
import { ThumbsUp, ThumbsDown, ChatText } from './ui';

/**
 * Constituent Dashboard — owner-only engagement rollup across every
 * post on this page.
 *
 * Swaps the place where the composer + feed live when the owner
 * toggles "Dashboard" at the top of the page. Respects the same
 * OwnerScopeFilter chip row rendered above it — when `scope` changes
 * we refetch. The dashboard itself is gated 403 server-side; the UI
 * only ever renders it for the page owner so that's a belt-and-
 * suspenders check.
 *
 * Props:
 *   officialId         — page id used in the fetch URL.
 *   scope              — 'country' | 'state' | 'district' | 'city' | null
 *                        (null === country, owner hasn't narrowed).
 *   onJumpToPost(id)   — optional; fires when the owner clicks a top-
 *                        engaged post. Parent switches back to feed
 *                        and scrolls+pulses that post.
 */
export default function Dashboard({ officialId, scope, onJumpToPost }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    fetchOwnerDashboard(officialId, { scope: scope || undefined }).then(({ data, error }) => {
      if (cancelled) return;
      setLoading(false);
      if (error) {
        setErr(error);
        setData(null);
        return;
      }
      setData(data);
    });
    return () => { cancelled = true; };
  }, [officialId, scope]);

  if (loading && !data) {
    return (
      <div style={{
        padding: '40px', textAlign: 'center',
        color: 'var(--cl-text-light)', fontSize: '0.9rem',
      }}>
        Loading dashboard…
      </div>
    );
  }
  if (err) {
    return (
      <div style={{
        padding: '16px', border: '1px solid #f5c2c7',
        background: '#f8d7da', color: '#842029',
        borderRadius: '10px', fontSize: '0.85rem',
      }}>
        Could not load the dashboard: {err}
      </div>
    );
  }
  if (!data) return null;

  const s = data.summary || {};
  const top = data.top_posts || [];
  const commenters = data.top_commenters || [];
  const rb = data.reactions_breakdown || {};
  const scopeLabel = data.scope_label || 'United States';

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '14px' }}>
        <div style={{
          fontSize: '0.68rem', fontWeight: 800, letterSpacing: '0.06em',
          color: 'var(--cl-text-light)', textTransform: 'uppercase',
        }}>
          Constituent Dashboard
        </div>
        <div style={{ fontSize: '0.82rem', color: 'var(--cl-text)', marginTop: '2px' }}>
          Engagement rollup across every post on your page. Currently
          showing <strong>{scopeLabel}</strong>.
        </div>
      </div>

      {/* Summary cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: '10px', marginBottom: '16px',
        }}
      >
        <StatCard label="Posts"        value={s.total_posts} />
        <StatCard label="Engaged citizens" value={s.unique_engaged_citizens} />
        <StatCard label="Reactions"    value={s.total_reactions}
                  sublabel={`net ${s.reactions_net > 0 ? '+' : ''}${s.reactions_net}`}
                  accent={s.reactions_net > 0 ? '#1877f2' : s.reactions_net < 0 ? '#c33333' : null} />
        <StatCard label="Comments"     value={s.total_comments} />
        <StatCard label="Poll votes"   value={s.total_poll_votes} />
      </div>

      {/* Reactions breakdown */}
      <SectionCard title="Reactions">
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '1rem' }}>👍</span>
            <strong style={{ fontSize: '1.1rem', color: '#1877f2' }}>{rb.up_total || 0}</strong>
            <span style={{ fontSize: '0.78rem', color: 'var(--cl-text-light)' }}>likes</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '1rem' }}>👎</span>
            <strong style={{ fontSize: '1.1rem', color: '#c33333' }}>{rb.down_total || 0}</strong>
            <span style={{ fontSize: '0.78rem', color: 'var(--cl-text-light)' }}>dislikes</span>
          </div>
          {rb.up_total === 0 && rb.down_total === 0 && (
            <span style={{ fontSize: '0.78rem', color: 'var(--cl-text-light)', fontStyle: 'italic' }}>
              No reactions at this scope yet.
            </span>
          )}
        </div>
        {(rb.most_liked_post || rb.most_disliked_post) && (
          <div style={{ marginTop: '10px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '10px' }}>
            {rb.most_liked_post && (
              <MiniPostRow
                label="Most liked"
                accent="var(--cl-up)"
                post={rb.most_liked_post}
                metricIcon={<ThumbsUp size={12} active color="up" />}
                metricValue={rb.most_liked_post.up_count}
                onJump={onJumpToPost}
              />
            )}
            {rb.most_disliked_post && (
              <MiniPostRow
                label="Most disliked"
                accent="var(--cl-down)"
                post={rb.most_disliked_post}
                metricIcon={<ThumbsDown size={12} active color="down" />}
                metricValue={rb.most_disliked_post.down_count}
                onJump={onJumpToPost}
              />
            )}
          </div>
        )}
      </SectionCard>

      {/* Two-column: top posts + top commenters */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '12px',
        }}
      >
        <SectionCard title="Top posts by engagement">
          {top.length === 0 ? (
            <EmptyNote>No engagement yet at this scope.</EmptyNote>
          ) : (
            <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {top.map((p, idx) => (
                <li key={p.post_id} style={{ marginBottom: '8px' }}>
                  <button
                    type="button"
                    onClick={() => onJumpToPost?.(p.post_id)}
                    style={{
                      width: '100%', textAlign: 'left', cursor: 'pointer',
                      padding: '10px', background: 'white',
                      border: '1px solid var(--cl-border)', borderRadius: '8px',
                      font: 'inherit', color: 'inherit',
                    }}
                    onMouseOver={(e) => e.currentTarget.style.borderColor = 'var(--cl-accent)'}
                    onMouseOut={(e) => e.currentTarget.style.borderColor = 'var(--cl-border)'}
                  >
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px' }}>
                      <span style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--cl-accent)' }}>
                        #{idx + 1}
                      </span>
                      <span style={{ fontSize: '0.72rem', color: 'var(--cl-text-light)' }}>
                        {new Date(p.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.86rem', color: 'var(--cl-text)', marginTop: '4px', lineHeight: 1.4 }}>
                      {p.body_preview}
                    </div>
                    <div style={{ marginTop: '6px', display: 'flex', gap: '10px', flexWrap: 'wrap', fontSize: '0.72rem', color: 'var(--cl-text-light)', fontVariantNumeric: 'tabular-nums', alignItems: 'center' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <ThumbsUp size={11} active color="up" /> {p.up_count}
                      </span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <ThumbsDown size={11} active color="down" /> {p.down_count}
                      </span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <ChatText size={11} /> {p.comment_count}
                      </span>
                      <span>🗳 {p.poll_vote_count}</span>
                      <span style={{ marginLeft: 'auto', fontWeight: 700, color: 'var(--cl-text)' }}>
                        score {p.engagement_score}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </SectionCard>

        <SectionCard title="Most active commenters">
          {commenters.length === 0 ? (
            <EmptyNote>No comments at this scope yet.</EmptyNote>
          ) : (
            <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {commenters.map((c, idx) => (
                <li key={c.citizen_id} style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '10px', background: 'white',
                  border: '1px solid var(--cl-border)', borderRadius: '8px',
                  marginBottom: '6px',
                }}>
                  <span style={{
                    width: '22px', height: '22px', borderRadius: '50%',
                    background: 'var(--cl-bg)',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.7rem', fontWeight: 800, color: 'var(--cl-accent)',
                    flexShrink: 0,
                  }}>
                    {idx + 1}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                      <strong style={{ fontSize: '0.86rem', color: 'var(--cl-text)' }}>
                        {c.display_name}
                      </strong>
                      <span title="Self-attested identity in the demo" style={{
                        fontSize: '0.6rem', fontWeight: 700,
                        padding: '1px 5px', borderRadius: '6px',
                        background: '#fff7e6', color: '#8a6100',
                        border: '1px solid #ffe1a3',
                        textTransform: 'uppercase',
                        letterSpacing: '0.02em',
                      }}>
                        Unverified
                      </span>
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--cl-text-light)', marginTop: '1px' }}>
                      {[c.scope_district, c.city, c.scope_state].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--cl-text)', fontVariantNumeric: 'tabular-nums' }}>
                    {c.comment_count} {c.comment_count === 1 ? 'comment' : 'comments'}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

// ── Bits ──────────────────────────────────────────────────────────────
function StatCard({ label, value, sublabel, accent }) {
  return (
    <div
      style={{
        padding: '12px', background: 'white',
        border: '1px solid var(--cl-border)', borderRadius: '10px',
      }}
    >
      <div style={{
        fontSize: '0.68rem', fontWeight: 800, letterSpacing: '0.04em',
        color: 'var(--cl-text-light)', textTransform: 'uppercase',
      }}>
        {label}
      </div>
      <div style={{
        fontSize: '1.5rem', fontWeight: 700, color: accent || 'var(--cl-text)',
        marginTop: '2px', fontVariantNumeric: 'tabular-nums',
      }}>
        {value ?? 0}
      </div>
      {sublabel && (
        <div style={{ fontSize: '0.72rem', color: 'var(--cl-text-light)', marginTop: '1px' }}>
          {sublabel}
        </div>
      )}
    </div>
  );
}

function SectionCard({ title, children }) {
  return (
    <div
      style={{
        padding: '14px', background: 'var(--cl-bg)',
        border: '1px solid var(--cl-border)', borderRadius: '12px',
        marginBottom: '12px',
      }}
    >
      <div style={{
        fontSize: '0.74rem', fontWeight: 700, color: 'var(--cl-text-light)',
        textTransform: 'uppercase', letterSpacing: '0.04em',
        marginBottom: '8px',
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function MiniPostRow({ label, accent, post, metricIcon, metricValue, metric, onJump }) {
  return (
    <button
      type="button"
      onClick={() => onJump?.(post.post_id)}
      style={{
        width: '100%', textAlign: 'left', cursor: 'pointer',
        padding: '10px', background: 'var(--cl-card)',
        border: '1px solid var(--cl-border)', borderRadius: 'var(--cl-radius-md)',
        font: 'inherit', color: 'inherit',
      }}
      onMouseOver={(e) => e.currentTarget.style.borderColor = accent}
      onMouseOut={(e) => e.currentTarget.style.borderColor = 'var(--cl-border)'}
    >
      <div style={{
        fontSize: 'var(--cl-text-2xs)', fontWeight: 800, letterSpacing: 'var(--cl-tracking-wide)',
        color: accent, textTransform: 'uppercase',
      }}>
        {label}
      </div>
      <div style={{ fontSize: 'var(--cl-text-sm)', color: 'var(--cl-text)', marginTop: 4, lineHeight: 1.4 }}>
        {post.body_preview}
      </div>
      <div
        style={{
          marginTop: 6,
          fontSize: 'var(--cl-text-sm)',
          color: accent,
          fontWeight: 700,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        {metricIcon}
        {metricValue != null ? <span className="cl-num">{metricValue}</span> : metric}
      </div>
    </button>
  );
}

function EmptyNote({ children }) {
  return (
    <div style={{
      padding: '12px', textAlign: 'center',
      color: 'var(--cl-text-light)', fontSize: '0.82rem', fontStyle: 'italic',
    }}>
      {children}
    </div>
  );
}
