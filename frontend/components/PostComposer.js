'use client';

import { useRef, useState } from 'react';
import { createPost, uploadPostImage, resolveImageUrl } from '../lib/pagesApi';

const MAX_BODY = 5000;
const MAX_OPT = 255;
const MAX_QUESTION = 500;
const MAX_IMAGES = 5;
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Post composer — shown at the top of a page for the owner.
 *
 * Minimal surface: a textarea for the body, a toggle to attach a poll
 * (question + 2–4 options), and a Publish button. Errors from the
 * backend (validation, ownership mismatch) surface inline.
 *
 * Props:
 *   officialId — target page id. Server enforces that the logged-in
 *                rep matches; we surface the backend 403 if not.
 *   onCreated(post) — parent merges the new post at the top of the feed
 */
// Which scopes this role supports, in rank order. Country is the
// always-available baseline; we offer the richer scopes based on what
// the rep's account has populated.
const SCOPE_META = {
  country:  { label: 'Country',  hint: 'All US citizens' },
  state:    { label: 'State',    hint: 'Citizens in your state' },
  district: { label: 'District', hint: 'Citizens in your district' },
  city:     { label: 'City',     hint: 'Citizens in your city' },
};

const PRESENTATION_META = {
  full:                { label: 'Full view',           hint: 'Bars + percentages visible to everyone' },
  hidden:              { label: 'Hidden',              hint: 'Viewers expand "Show results" or "Vote" to see' },
  reveal_after_close:  { label: 'Reveal after close',  hint: 'Results stay hidden until the close time passes' },
};

// Compute an ISO-8601 UTC closes_at from the composer inputs. Returns
// null when the author picked "no close time" or the inputs don't
// resolve to a moment in the future.
function computeClosesAt(timing, durationValue, durationUnit, isoDate) {
  if (timing === 'none') return null;
  if (timing === 'duration') {
    const n = Math.max(0, parseFloat(durationValue) || 0);
    if (!n) return null;
    const perUnitMinutes = { minutes: 1, hours: 60, days: 60 * 24 }[durationUnit] || 1;
    const ms = n * perUnitMinutes * 60 * 1000;
    return new Date(Date.now() + ms).toISOString();
  }
  if (timing === 'date') {
    if (!isoDate) return null;
    // <input type="datetime-local"> gives a value in the browser's
    // local TZ without a suffix — Date treats it as local time, which
    // is what we want. Convert to ISO UTC before sending.
    const d = new Date(isoDate);
    if (Number.isNaN(d.getTime()) || d.getTime() <= Date.now()) return null;
    return d.toISOString();
  }
  return null;
}

export default function PostComposer({
  officialId, onCreated,
  // Scopes the backend will accept for this owner. Defaults to just
  // 'country' when the parent doesn't know yet (e.g. payload still
  // loading). The backend clamps unsupported scopes on save anyway.
  allowedScopes = ['country'],
}) {
  const [body, setBody] = useState('');
  const [pollOpen, setPollOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  // Default the scope to the most specific one the rep supports — a
  // House rep defaults to 'district', a senator to 'state', etc. Picks
  // the richest available scope so the post author gets the most
  // specific signal by default.
  const defaultScope = allowedScopes[allowedScopes.length - 1] || 'country';
  const [scope, setScope] = useState(defaultScope);
  // Timer controls. `timing` is the chosen strategy, the other three
  // are just the input buffers — they're only read if `timing` picks
  // their shape.
  const [timing, setTiming] = useState('none');
  const [durationValue, setDurationValue] = useState('24');
  const [durationUnit, setDurationUnit] = useState('hours');
  const [dateValue, setDateValue] = useState('');
  // Presentation mode. Reveal-after-close is disabled until the
  // author picks a real closing time.
  const [presentationMode, setPresentationMode] = useState('full');
  // Image gallery — each entry is a {id, url, content_type} from the
  // backend. Uploaded orphans become live gallery images when the post
  // is published (server claims them by id). Removing from the array
  // leaves the orphan on disk — cheap demo tradeoff; a janitor would
  // sweep those later.
  const [images, setImages] = useState([]);
  const [imageBusy, setImageBusy] = useState(false);
  const fileInputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const resolvedClosesAt = computeClosesAt(timing, durationValue, durationUnit, dateValue);
  const revealRequiresClose = presentationMode === 'reveal_after_close' && !resolvedClosesAt;

  const canSubmit = body.trim().length > 0 && !busy && (
    !pollOpen || (
      question.trim().length > 0 &&
      options.filter((o) => o.trim()).length >= 2 &&
      !revealRequiresClose
    )
  );

  const reset = () => {
    setBody(''); setQuestion(''); setOptions(['', '']);
    setPollOpen(false); setErr(null); setScope(defaultScope);
    setTiming('none'); setDurationValue('24'); setDurationUnit('hours');
    setDateValue(''); setPresentationMode('full');
    setImages([]);
  };

  // ── Image upload ──────────────────────────────────────────────────
  // The <input type="file" multiple> hands us a FileList; we upload
  // each sequentially so the user sees thumbnails appear in order.
  // Client-side validation short-circuits anything the server would
  // 400 on, but the server is still the source of truth.
  const handleFilesPicked = async (fileList) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    const remaining = MAX_IMAGES - images.length;
    if (remaining <= 0) {
      setErr(`You can attach at most ${MAX_IMAGES} images per post.`);
      return;
    }
    if (files.length > remaining) {
      setErr(`Only ${remaining} more image${remaining === 1 ? '' : 's'} will fit; the extras were skipped.`);
    }
    setImageBusy(true);
    for (const f of files.slice(0, remaining)) {
      if (!ACCEPTED_IMAGE_TYPES.includes(f.type)) {
        setErr(`"${f.name}" — only JPEG, PNG, or WebP are accepted.`);
        continue;
      }
      const { data, error } = await uploadPostImage(f);
      if (error) {
        setErr(error);
        continue;
      }
      setImages((prev) => [...prev, data]);
    }
    setImageBusy(false);
    // Reset the input so picking the same file twice in a row still
    // fires onChange.
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeImage = (id) => {
    setImages((prev) => prev.filter((img) => img.id !== id));
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    const payload = { body: body.trim() };
    if (pollOpen) {
      payload.poll = {
        question: question.trim(),
        options: options.map((o) => o.trim()).filter(Boolean).map((text) => ({ text })),
        default_visibility_scope: scope,
        presentation_mode: presentationMode,
      };
      if (resolvedClosesAt) payload.poll.closes_at = resolvedClosesAt;
    }
    if (images.length > 0) {
      payload.imageIds = images.map((img) => img.id);
    }
    const { data, error } = await createPost(officialId, payload);
    setBusy(false);
    if (error) {
      setErr(error);
      return;
    }
    if (data && onCreated) onCreated(data);
    reset();
  };

  const setOption = (idx, val) => {
    setOptions((prev) => prev.map((o, i) => (i === idx ? val : o)));
  };

  const addOption = () => {
    if (options.length >= 4) return;
    setOptions((prev) => [...prev, '']);
  };

  const removeOption = (idx) => {
    if (options.length <= 2) return;
    setOptions((prev) => prev.filter((_, i) => i !== idx));
  };

  return (
    <div
      style={{
        padding: '14px',
        border: '1px solid var(--border)',
        borderRadius: '12px',
        background: 'white',
        marginBottom: '16px',
      }}
    >
      <div
        style={{
          fontSize: '0.8rem',
          fontWeight: 700,
          color: 'var(--text-light)',
          textTransform: 'uppercase',
          letterSpacing: '0.4px',
          marginBottom: '8px',
        }}
      >
        Write a post
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value.slice(0, MAX_BODY))}
        placeholder="Share an update with your constituents..."
        rows={3}
        style={{
          width: '100%', resize: 'vertical',
          padding: '10px', borderRadius: '8px',
          border: '1px solid var(--border)',
          fontFamily: 'inherit', fontSize: '0.9rem',
          color: 'var(--text)', background: 'var(--bg)',
          boxSizing: 'border-box',
        }}
      />
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: '0.72rem',
          color: 'var(--text-light)',
          marginTop: '4px',
        }}
      >
        <span>{body.length}/{MAX_BODY}</span>
        <div style={{ display: 'flex', gap: '12px' }}>
          {/* Image upload. Hidden native input drives the file picker
              so we can style the trigger as a regular link button. */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPTED_IMAGE_TYPES.join(',')}
            onChange={(e) => handleFilesPicked(e.target.files)}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={imageBusy || images.length >= MAX_IMAGES}
            title={images.length >= MAX_IMAGES ? `Max ${MAX_IMAGES} images per post` : 'Attach images'}
            style={{
              background: 'transparent', border: 'none',
              color: images.length > 0 ? 'var(--accent)' : 'var(--text-light)',
              fontWeight: 600, fontSize: '0.78rem',
              cursor: (imageBusy || images.length >= MAX_IMAGES) ? 'not-allowed' : 'pointer',
              opacity: images.length >= MAX_IMAGES ? 0.6 : 1,
            }}
          >
            {imageBusy
              ? 'Uploading…'
              : images.length === 0
                ? '+ Add images'
                : `+ Add images (${images.length}/${MAX_IMAGES})`}
          </button>
          <button
            type="button"
            onClick={() => setPollOpen((o) => !o)}
            style={{
              background: 'transparent', border: 'none',
              color: pollOpen ? 'var(--accent)' : 'var(--text-light)',
              fontWeight: 600, fontSize: '0.78rem', cursor: 'pointer',
            }}
          >
            {pollOpen ? '× Remove poll' : '+ Attach poll'}
          </button>
        </div>
      </div>

      {/* Thumbnail strip — appears as soon as the first image uploads.
          Each tile is the image + a small × in the corner to remove. */}
      {images.length > 0 && (
        <div
          style={{
            display: 'flex', flexWrap: 'wrap', gap: '8px',
            marginTop: '10px',
          }}
        >
          {images.map((img) => (
            <div
              key={img.id}
              style={{
                position: 'relative',
                width: '82px', height: '82px',
                borderRadius: '8px', overflow: 'hidden',
                border: '1px solid var(--border)',
                background: '#f5f5f5',
              }}
            >
              <img
                src={resolveImageUrl(img.url)}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
              <button
                type="button"
                onClick={() => removeImage(img.id)}
                aria-label="Remove image"
                title="Remove"
                style={{
                  position: 'absolute', top: '3px', right: '3px',
                  width: '20px', height: '20px',
                  borderRadius: '50%',
                  border: 'none',
                  background: 'rgba(0,0,0,0.6)',
                  color: 'white',
                  fontSize: '0.85rem', lineHeight: '20px',
                  cursor: 'pointer', padding: 0,
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {pollOpen && (
        <div
          style={{
            marginTop: '10px',
            padding: '10px',
            border: '1px dashed var(--border)',
            borderRadius: '10px',
            background: 'var(--bg)',
          }}
        >
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value.slice(0, MAX_QUESTION))}
            placeholder="Poll question (e.g. How should we vote on H.R. 9999?)"
            style={{
              width: '100%', padding: '8px 10px',
              border: '1px solid var(--border)', borderRadius: '6px',
              fontSize: '0.88rem', color: 'var(--text)', background: 'white',
              boxSizing: 'border-box', marginBottom: '8px',
            }}
          />
          {options.map((opt, idx) => (
            <div key={idx} style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
              <input
                type="text"
                value={opt}
                onChange={(e) => setOption(idx, e.target.value.slice(0, MAX_OPT))}
                placeholder={`Option ${idx + 1}`}
                style={{
                  flex: 1, padding: '6px 10px',
                  border: '1px solid var(--border)', borderRadius: '6px',
                  fontSize: '0.85rem', color: 'var(--text)', background: 'white',
                  boxSizing: 'border-box',
                }}
              />
              {options.length > 2 && (
                <button
                  type="button"
                  onClick={() => removeOption(idx)}
                  title="Remove option"
                  aria-label="Remove option"
                  style={{
                    width: '30px', border: '1px solid var(--border)',
                    background: 'white', color: 'var(--text-light)',
                    borderRadius: '6px', cursor: 'pointer',
                  }}
                >
                  ×
                </button>
              )}
            </div>
          ))}
          {options.length < 4 && (
            <button
              type="button"
              onClick={addOption}
              style={{
                background: 'transparent', border: 'none',
                color: 'var(--accent)', fontSize: '0.78rem',
                fontWeight: 600, cursor: 'pointer', padding: '2px 4px',
              }}
            >
              + Add option
            </button>
          )}

          {/* Default visibility scope — what pool of citizens shows up
              in the poll's results first. Viewers can override later
              (Phase 2); this is the initial view. We only expose
              scopes the rep's role actually supports. */}
          <div style={{ marginTop: '10px', paddingTop: '8px', borderTop: '1px dashed var(--border)' }}>
            <div
              style={{
                fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-light)',
                textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '6px',
              }}
            >
              Default visibility
            </div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {allowedScopes.map((s) => {
                const meta = SCOPE_META[s] || { label: s, hint: '' };
                const active = scope === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setScope(s)}
                    title={meta.hint}
                    style={{
                      padding: '5px 10px',
                      borderRadius: '999px',
                      border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                      background: active ? 'var(--accent)' : 'white',
                      color: active ? 'white' : 'var(--text)',
                      fontSize: '0.74rem', fontWeight: active ? 700 : 500,
                      cursor: 'pointer',
                    }}
                  >
                    {meta.label}
                  </button>
                );
              })}
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-light)', marginTop: '5px', fontStyle: 'italic' }}>
              {SCOPE_META[scope]?.hint || ''} — viewers will see these counts first.
            </div>
          </div>

          {/* Close time — timer OR specific date. Empty = stays open. */}
          <div style={{ marginTop: '10px', paddingTop: '8px', borderTop: '1px dashed var(--border)' }}>
            <div
              style={{
                fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-light)',
                textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '6px',
              }}
            >
              When does this poll close?
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.82rem', color: 'var(--text)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                <input
                  type="radio" name="timing" value="none"
                  checked={timing === 'none'}
                  onChange={() => setTiming('none')}
                />
                <span>No close time — stays open indefinitely</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', flexWrap: 'wrap' }}>
                <input
                  type="radio" name="timing" value="duration"
                  checked={timing === 'duration'}
                  onChange={() => setTiming('duration')}
                />
                <span>After</span>
                <input
                  type="number"
                  min="1"
                  value={durationValue}
                  onChange={(e) => { setTiming('duration'); setDurationValue(e.target.value); }}
                  style={{
                    width: '60px', padding: '4px 6px',
                    border: '1px solid var(--border)', borderRadius: '6px',
                    fontSize: '0.82rem', background: 'white', color: 'var(--text)',
                  }}
                />
                <select
                  value={durationUnit}
                  onChange={(e) => { setTiming('duration'); setDurationUnit(e.target.value); }}
                  style={{
                    padding: '4px 6px', border: '1px solid var(--border)',
                    borderRadius: '6px', fontSize: '0.82rem', background: 'white',
                    color: 'var(--text)',
                  }}
                >
                  <option value="minutes">minutes</option>
                  <option value="hours">hours</option>
                  <option value="days">days</option>
                </select>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', flexWrap: 'wrap' }}>
                <input
                  type="radio" name="timing" value="date"
                  checked={timing === 'date'}
                  onChange={() => setTiming('date')}
                />
                <span>On</span>
                <input
                  type="datetime-local"
                  value={dateValue}
                  onChange={(e) => { setTiming('date'); setDateValue(e.target.value); }}
                  style={{
                    padding: '4px 6px', border: '1px solid var(--border)',
                    borderRadius: '6px', fontSize: '0.82rem', background: 'white',
                    color: 'var(--text)',
                  }}
                />
              </label>
              {timing !== 'none' && resolvedClosesAt && (
                <div style={{ fontSize: '0.7rem', color: 'var(--text-light)', fontStyle: 'italic' }}>
                  Closes {new Date(resolvedClosesAt).toLocaleString()}
                </div>
              )}
              {timing !== 'none' && !resolvedClosesAt && (
                <div style={{ fontSize: '0.7rem', color: '#c33333', fontStyle: 'italic' }}>
                  Pick a moment in the future — otherwise the poll would open already closed.
                </div>
              )}
            </div>
          </div>

          {/* Results presentation */}
          <div style={{ marginTop: '10px', paddingTop: '8px', borderTop: '1px dashed var(--border)' }}>
            <div
              style={{
                fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-light)',
                textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '6px',
              }}
            >
              How should results be shown?
            </div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {['full', 'hidden', 'reveal_after_close'].map((m) => {
                const meta = PRESENTATION_META[m];
                const active = presentationMode === m;
                const locked = m === 'reveal_after_close' && !resolvedClosesAt;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => { if (!locked) setPresentationMode(m); }}
                    title={locked ? 'Requires a close time' : meta.hint}
                    disabled={locked}
                    style={{
                      padding: '5px 10px',
                      borderRadius: '999px',
                      border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                      background: active ? 'var(--accent)' : 'white',
                      color: active ? 'white' : (locked ? 'var(--text-light)' : 'var(--text)'),
                      fontSize: '0.74rem', fontWeight: active ? 700 : 500,
                      cursor: locked ? 'not-allowed' : 'pointer',
                      opacity: locked ? 0.55 : 1,
                    }}
                  >
                    {meta.label}
                  </button>
                );
              })}
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-light)', marginTop: '5px', fontStyle: 'italic' }}>
              {PRESENTATION_META[presentationMode]?.hint || ''}
            </div>
            {revealRequiresClose && (
              <div style={{ fontSize: '0.7rem', color: '#c33333', marginTop: '4px' }}>
                Pick a close time above to use &ldquo;Reveal after close.&rdquo;
              </div>
            )}
          </div>
        </div>
      )}

      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
          gap: '10px', marginTop: '12px',
        }}
      >
        {err && <span style={{ color: '#d63031', fontSize: '0.78rem', marginRight: 'auto' }}>{err}</span>}
        <button
          type="button"
          onClick={reset}
          disabled={busy}
          style={{
            border: '1px solid var(--border)', background: 'white',
            color: 'var(--text-light)', padding: '8px 14px',
            borderRadius: '8px', fontSize: '0.82rem', fontWeight: 600,
            cursor: busy ? 'wait' : 'pointer',
          }}
        >
          Clear
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          style={{
            border: '1px solid var(--accent)',
            background: canSubmit ? 'var(--accent)' : 'var(--bg)',
            color: canSubmit ? 'white' : 'var(--text-light)',
            padding: '8px 18px', borderRadius: '8px',
            fontSize: '0.85rem', fontWeight: 700,
            cursor: canSubmit ? 'pointer' : 'not-allowed',
            transition: 'background 0.15s, color 0.15s',
          }}
        >
          {busy ? 'Posting…' : 'Publish'}
        </button>
      </div>
    </div>
  );
}
