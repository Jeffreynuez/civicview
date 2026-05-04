'use client';

import { useState } from 'react';
import { createRepEvent, deleteRepEvent } from '../lib/pagesApi';

/**
 * Rep-side event composer, shown in the "Upcoming Events" sidebar of
 * PageView when the signed-in rep owns the page. Hidden otherwise.
 *
 * The composer is intentionally tight: title + start_at + optional
 * location + optional RSVP url. The backend validates that start_at
 * parses as ISO-8601 and is in the future. Existing events render
 * above with a small "remove" control.
 *
 * Props:
 *   officialId — target page (ownership enforced by backend)
 *   events     — current upcoming events (from PageView)
 *   onCreated(evt) — parent merges the new event into upcoming_events
 *   onDeleted(eventId) — parent drops the event
 */
const MAX_TITLE = 255;
const MAX_LOCATION = 255;
const MAX_URL = 512;

function toLocalInputValue(d) {
  if (!d) return '';
  // Format a Date into an <input type="datetime-local"> string in local time.
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function RepEventComposer({ officialId, events = [], onCreated, onDeleted }) {
  // Default the date picker to ~24h from now so the user doesn't have to
  // think about tomorrow's date when adding a quick event.
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(18, 0, 0, 0);

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [startAt, setStartAt] = useState(toLocalInputValue(tomorrow));
  const [location, setLocation] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const canSubmit = title.trim().length > 0 && startAt && !busy;

  const reset = () => {
    setTitle(''); setLocation(''); setUrl(''); setErr(null);
    setStartAt(toLocalInputValue(tomorrow));
    setOpen(false);
  };

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    // Convert the local input to an ISO string the backend can parse.
    const iso = new Date(startAt).toISOString();
    const { data, error } = await createRepEvent(officialId, {
      title: title.trim(),
      start_at: iso,
      location: location.trim() || null,
      url: url.trim() || null,
    });
    setBusy(false);
    if (error) {
      setErr(error);
      return;
    }
    if (data && onCreated) onCreated(data);
    reset();
  };

  const handleDelete = async (evt) => {
    if (!evt?.id) return;
    const ok = typeof window !== 'undefined'
      ? window.confirm(`Remove "${evt.title}" from your upcoming events?`)
      : true;
    if (!ok) return;
    const { error } = await deleteRepEvent(evt.id);
    if (error) {
      setErr(error);
      return;
    }
    if (onDeleted) onDeleted(evt.id);
  };

  return (
    <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px dashed var(--cl-border)' }}>
      {/* Your-events list with remove affordance */}
      {events.length > 0 && (
        <div style={{ marginBottom: '10px' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--cl-text-light)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '4px' }}>
            Your scheduled events
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: '0.78rem' }}>
            {events.map((evt) => (
              <li
                key={evt.id}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '4px 0', gap: '6px', color: 'var(--cl-text)',
                }}
              >
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {evt.title}
                </span>
                <button
                  type="button"
                  onClick={() => handleDelete(evt)}
                  title="Remove this event"
                  aria-label={`Remove ${evt.title}`}
                  style={{
                    background: 'transparent', border: 'none',
                    color: '#d63031', fontSize: '0.78rem', cursor: 'pointer',
                    padding: '2px 6px',
                  }}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {open ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, MAX_TITLE))}
            placeholder="Event title (e.g. Town Hall — Naples)"
            style={{
              padding: '7px 9px', borderRadius: '6px',
              border: '1px solid var(--cl-border)', fontSize: '0.82rem',
              color: 'var(--cl-text)', background: 'white', boxSizing: 'border-box',
            }}
          />
          <input
            type="datetime-local"
            value={startAt}
            onChange={(e) => setStartAt(e.target.value)}
            style={{
              padding: '7px 9px', borderRadius: '6px',
              border: '1px solid var(--cl-border)', fontSize: '0.82rem',
              color: 'var(--cl-text)', background: 'white', boxSizing: 'border-box',
            }}
          />
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value.slice(0, MAX_LOCATION))}
            placeholder="Location (optional)"
            style={{
              padding: '7px 9px', borderRadius: '6px',
              border: '1px solid var(--cl-border)', fontSize: '0.82rem',
              color: 'var(--cl-text)', background: 'white', boxSizing: 'border-box',
            }}
          />
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value.slice(0, MAX_URL))}
            placeholder="RSVP link (optional)"
            style={{
              padding: '7px 9px', borderRadius: '6px',
              border: '1px solid var(--cl-border)', fontSize: '0.82rem',
              color: 'var(--cl-text)', background: 'white', boxSizing: 'border-box',
            }}
          />
          {err && (
            <div style={{ color: '#d63031', fontSize: '0.76rem' }}>{err}</div>
          )}
          <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={reset}
              disabled={busy}
              style={{
                border: '1px solid var(--cl-border)', background: 'white',
                color: 'var(--cl-text-light)', padding: '6px 10px',
                borderRadius: '6px', fontSize: '0.76rem', fontWeight: 600,
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
                border: '1px solid var(--cl-accent)',
                background: canSubmit ? 'var(--cl-accent)' : 'var(--cl-bg)',
                color: canSubmit ? 'white' : 'var(--cl-text-light)',
                padding: '6px 12px', borderRadius: '6px',
                fontSize: '0.78rem', fontWeight: 700,
                cursor: canSubmit ? 'pointer' : 'not-allowed',
              }}
            >
              {busy ? 'Adding…' : 'Add event'}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            width: '100%', padding: '8px 10px',
            border: '1px dashed var(--cl-accent)',
            background: 'transparent', color: 'var(--cl-accent)',
            fontSize: '0.8rem', fontWeight: 600,
            borderRadius: '8px', cursor: 'pointer',
          }}
          onMouseOver={(e) => (e.currentTarget.style.background = 'rgba(24,119,242,0.06)')}
          onMouseOut={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          + Add an upcoming event
        </button>
      )}
    </div>
  );
}
