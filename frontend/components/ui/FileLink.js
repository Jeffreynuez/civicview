'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import { useEffect, useId, useRef, useState } from 'react';
import { linkKind, hostLabel, externalLinkProps } from '@/lib/externalLink';

/**
 * A link to a downloadable file that ASKS BEFORE IT DOWNLOADS.
 *
 * PRODUCT RULE (Jeffrey, 2026-08): a download must never start on its
 * own. Labeling a link "(PDF)" warns the reader, but the click still
 * fires the download — the person has already lost the choice by the
 * time they understand what they clicked. Jarring, and on a civic
 * product it reads as something worse than jarring: a site that puts
 * files on your machine without asking is a site you stop trusting, and
 * these links are specifically the ones inviting people to verify our
 * sourcing. A download prompt that a reader chose is a completely
 * different experience from one that happened to them.
 *
 * Behavior:
 *   - Ordinary page URLs render as a plain link and do NOT prompt. The
 *     confirmation is reserved for actual files, so it never becomes
 *     noise people click through reflexively.
 *   - File URLs render as a button; clicking opens an inline panel that
 *     names the file type and the host it comes from, with Download and
 *     Cancel. Confirming opens it in a new tab.
 *
 * Inline panel rather than a modal on purpose: these links live inside a
 * scrolling side panel, and throwing a full-screen overlay over the page
 * to ask a small question is its own kind of jarring.
 */
export default function FileLink({
  href,
  children,
  style,
  description,
  className,
}) {
  const kind = linkKind(href);
  const [asking, setAsking] = useState(false);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const panelId = useId();

  // Escape closes; focus returns to the trigger so keyboard users aren't
  // dropped at the top of the document.
  useEffect(() => {
    if (!asking) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setAsking(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [asking]);

  // Move focus into the panel when it opens so the choice is reachable
  // without a mouse and screen readers announce it.
  useEffect(() => {
    if (asking) panelRef.current?.focus();
  }, [asking]);

  // Not a file — nothing to warn about. Render an ordinary link.
  if (!kind) {
    return (
      <a {...externalLinkProps(href)} style={style} className={className}>
        {children}
      </a>
    );
  }

  function confirmDownload() {
    setAsking(false);
    // Opened from inside the click handler of the Download button, so the
    // browser still counts this as a user gesture and popup blockers
    // leave it alone.
    window.open(href, '_blank', 'noopener,noreferrer');
    triggerRef.current?.focus();
  }

  return (
    <span style={{ display: 'inline-block' }}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setAsking((v) => !v)}
        aria-expanded={asking}
        aria-controls={asking ? panelId : undefined}
        title={externalLinkProps(href).title}
        className={className}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          font: 'inherit',
          cursor: 'pointer',
          textDecoration: 'underline',
          ...style,
        }}
      >
        {children}
      </button>

      {asking && (
        <div
          id={panelId}
          ref={panelRef}
          role="dialog"
          aria-modal="false"
          aria-label={`Download this ${kind.label}?`}
          tabIndex={-1}
          style={{
            display: 'block',
            marginTop: 6,
            padding: '10px 12px',
            background: 'var(--cl-card, white)',
            border: '1px solid var(--cl-border)',
            borderRadius: 8,
            boxShadow: 'var(--cl-shadow-sticky, 0 2px 10px rgba(0,0,0,0.10))',
            maxWidth: '44ch',
            fontSize: '0.78rem',
            lineHeight: 1.45,
            color: 'var(--cl-text)',
            outline: 'none',
            whiteSpace: 'normal',
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 3 }}>
            Download this {kind.label}?
          </div>
          <div style={{ color: 'var(--cl-text-muted, var(--cl-text-light))' }}>
            {description ? `${description} ` : ''}
            This opens a <strong>.{kind.ext}</strong> file from{' '}
            <strong>{hostLabel(href)}</strong> and will save to your device.
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 9, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={confirmDownload}
              style={{
                padding: '6px 13px',
                borderRadius: 6,
                border: '1px solid var(--cl-accent)',
                background: 'var(--cl-accent)',
                color: 'white',
                fontSize: '0.76rem',
                fontWeight: 700,
                fontFamily: 'var(--cl-font-sans)',
                cursor: 'pointer',
              }}
            >
              Download
            </button>
            <button
              type="button"
              onClick={() => {
                setAsking(false);
                triggerRef.current?.focus();
              }}
              style={{
                padding: '6px 13px',
                borderRadius: 6,
                border: '1px solid var(--cl-border)',
                background: 'var(--cl-card, white)',
                color: 'var(--cl-text)',
                fontSize: '0.76rem',
                fontWeight: 600,
                fontFamily: 'var(--cl-font-sans)',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </span>
  );
}
