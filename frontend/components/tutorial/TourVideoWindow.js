'use client';

// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * TourVideoWindow: the overview video, opened from the guided tour's
 * Welcome card ("Watch a 2-minute overview").
 *
 * A window over the app (ModalShell, lightbox backdrop) that sits above
 * the tour's own card, so the tour is still there when it closes.
 * Enlarge grows it to fill the browser window, keeping 16:9; the
 * player's own full-screen button goes further. Phones get the shell's
 * full-screen sheet (the video centered in it), so there is no Enlarge
 * there. Captions are on by default. Focus moves to the player when the
 * window opens (Space plays and pauses, Left and Right seek; the tour
 * leaves those keys alone while it is open) and goes back to the Watch
 * button when it closes. The x, Esc and the backdrop close it, and
 * closing stops the video (the element unmounts).
 *
 * The files are static (TOUR_VIDEO in lib/tutorialSegments.js). Every
 * post, poll, comment, reply and alert in the video comes from a demo
 * account, and the window says so (the video does too).
 */

import { useEffect, useRef, useState } from 'react';

import ModalShell from '@/components/ui/ModalShell';
import { TOUR_VIDEO } from '@/lib/tutorialSegments';
import { useIsMobile } from '@/lib/useViewport';
import './TourVideoWindow.css';

// Room the window needs around the video: its padding, the title row
// and the note under the player. The width follows from the height left
// over, so the video never has to letterbox to fit the screen.
const CHROME_W = 36;
const CHROME_H = 150;
const MOBILE_CARD = {
  padding: '56px 12px 24px',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
};
const fitWidth = (cap) => `min(${cap}, calc((100vh - ${CHROME_H}px) * 16 / 9 + ${CHROME_W}px))`;

export default function TourVideoWindow({ open, onClose }) {
  const isMobile = useIsMobile();
  const [large, setLarge] = useState(false);
  const videoRef = useRef(null);

  // The Watch button sits in the tour's card, which the focus trap lets
  // keep focus, so move it into the window here.
  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => {
      try { videoRef.current?.focus({ preventScroll: true }); } catch { /* old browser */ }
    }, 0);
    return () => clearTimeout(t);
  }, [open]);

  if (!open || !TOUR_VIDEO) return null;
  const big = large && !isMobile;

  return (
    <ModalShell
      open
      onClose={onClose}
      variant="lightbox"
      zIndex={3100}
      width={big ? fitWidth('96vw') : fitWidth('960px')}
      showEscHint={false}
      cardStyle={isMobile ? MOBILE_CARD : { padding: '14px 18px 12px' }}
    >
      <div className="cvvideo__head">
        <h2 className="cvvideo__title">A quick look at CivicView</h2>
        {!isMobile && (
          <button
            type="button"
            className="cvvideo__size"
            onClick={() => setLarge((v) => !v)}
            aria-pressed={big}
          >
            {big ? 'Smaller' : 'Enlarge'}
          </button>
        )}
      </div>

      <video
        ref={videoRef}
        className="cvvideo__player"
        controls
        autoPlay
        playsInline
        preload="metadata"
        poster={`${TOUR_VIDEO}.jpg`}
        width={1920}
        height={1080}
      >
        <source src={`${TOUR_VIDEO}.mp4`} type="video/mp4" />
        <track kind="captions" src={`${TOUR_VIDEO}.vtt`} srcLang="en" label="English" default />
      </video>

      <p className="cvvideo__note">
        The posts, polls, comments, replies and alerts in this video come
        from demo accounts. Real officials appear only in public records.
      </p>
    </ModalShell>
  );
}
