'use client';

// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import { useEffect, useRef } from 'react';

/**
 * Keep keyboard focus inside a dialog while it is open, and give it back
 * afterwards (audit F6).
 *
 * While `active`:
 *   - if focus is not already inside `ref` (an autoFocus field counts),
 *     it moves to the first focusable element, or to the container;
 *   - Tab and Shift+Tab wrap around inside the container instead of
 *     walking into the page behind the dialog.
 * When `active` turns false or the dialog unmounts, focus goes back to
 * the element that had it when the dialog opened, but only if focus was
 * lost (it is on the page body or was inside the closed dialog). A dialog
 * that replaced this one and focused its own field keeps that focus.
 *
 * Several dialogs can be open at once (a sign-in opened from a page).
 * Only the most recently opened one handles Tab, so two traps never pull
 * focus back and forth.
 *
 * Content that belongs with the dialog but lives elsewhere in the page
 * (the app tour's panel and step card, a menu portaled to <body>) is
 * marked with a data-focus-trap-allow attribute. Its controls join the
 * dialog's Tab cycle after the dialog's own, so a keyboard user in a
 * dialog the tour opened can still reach the tour's Next button, and a
 * dialog does not take focus away from them when it opens.
 *
 * The container does not need a tabIndex. If it has nothing focusable,
 * the hook gives it tabindex="-1" for as long as it is open.
 */
const FOCUSABLE = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

const ALLOW = '[data-focus-trap-allow]';

// Open traps, oldest first. The last one is the one that handles Tab.
const openTraps = [];

function focusableIn(node) {
  return Array.from(node.querySelectorAll(FOCUSABLE)).filter(
    (el) => el.getAttribute('aria-hidden') !== 'true' && el.getClientRects().length > 0,
  );
}

function inAllowedRegion(el) {
  return !!(el && typeof el.closest === 'function' && el.closest(ALLOW));
}

function allowedItems(node) {
  return Array.from(document.querySelectorAll(ALLOW))
    .filter((region) => !node.contains(region))
    .flatMap((region) => focusableIn(region));
}

function focusQuietly(el) {
  try { el.focus({ preventScroll: true }); } catch { /* old browser */ }
}

function isConnected(el) {
  return !!(el && typeof el.focus === 'function' && el !== document.body && document.contains(el));
}

export default function useFocusTrap(ref, active) {
  // The element to return to, read while rendering the render that opens
  // the dialog: that is before any autoFocus field inside it takes focus.
  // Safari does not focus a button on click, so this can be <body>; then
  // there is nothing to return to. When the opener sits in another open
  // dialog, that dialog's own opener is kept as a fallback, for when the
  // first dialog closes as this one opens (Claim, then its sign-in link).
  const openerRef = useRef(null);
  if (!active) {
    openerRef.current = null;
  } else if (openerRef.current === null && typeof document !== 'undefined') {
    const direct = document.activeElement || document.body;
    const host = openTraps.find((t) => t.node.contains(direct));
    openerRef.current = { direct, fallback: host ? host.opener : null };
  }

  useEffect(() => {
    if (!active || typeof document === 'undefined') return undefined;
    const node = ref.current;
    if (!node) return undefined;
    const opener = openerRef.current || { direct: null, fallback: null };
    // What a later dialog opened from inside this one falls back to.
    const entry = { node, opener: isConnected(opener.direct) ? opener.direct : opener.fallback };
    openTraps.push(entry);

    let addedTabIndex = false;
    const ensureFocusable = () => {
      if (!node.hasAttribute('tabindex')) {
        node.setAttribute('tabindex', '-1');
        addedTabIndex = true;
      }
    };

    const current = document.activeElement;
    if (!node.contains(current) && !inAllowedRegion(current)) {
      const first = focusableIn(node)[0];
      if (!first) ensureFocusable();
      focusQuietly(first || node);
    }

    const onKeyDown = (e) => {
      if (e.key !== 'Tab') return;
      if (openTraps[openTraps.length - 1] !== entry) return;
      const focused = document.activeElement;
      const own = focusableIn(node);
      const extra = allowedItems(node);
      const cycle = own.concat(extra);
      if (cycle.length === 0) {
        e.preventDefault();
        ensureFocusable();
        focusQuietly(node);
        return;
      }
      const at = cycle.indexOf(focused);
      const insideOwn = node.contains(focused);
      const leavingEnd = insideOwn && own.length > 0
        && (e.shiftKey ? focused === own[0] : focused === own[own.length - 1]);
      // Inside the dialog (and from the page body, where a mouse click
      // leaves the browser's starting point), the browser's own order is
      // kept: it knows about radio groups and where the user clicked. The
      // trap only steps in at the ends, and pulls focus back if the
      // browser's move left the dialog (Safari and Firefox on macOS skip
      // buttons, so their Tab can leave from a text field).
      if ((insideOwn && !leavingEnd) || !focused || focused === document.body) {
        const backward = e.shiftKey;
        setTimeout(() => {
          if (openTraps[openTraps.length - 1] !== entry) return;
          const now = document.activeElement;
          if (node.contains(now) || inAllowedRegion(now)) return;
          const items = focusableIn(node).concat(allowedItems(node));
          if (items.length) items[backward ? items.length - 1 : 0].focus();
        }, 0);
        return;
      }
      e.preventDefault();
      let next;
      if (at === -1) {
        next = e.shiftKey ? cycle[cycle.length - 1] : cycle[0];
      } else {
        next = cycle[(at + (e.shiftKey ? -1 : 1) + cycle.length) % cycle.length];
      }
      // A plain focus() so the browser scrolls the control into view.
      next.focus();
    };
    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      const at = openTraps.indexOf(entry);
      if (at !== -1) openTraps.splice(at, 1);
      if (addedTabIndex) node.removeAttribute('tabindex');
      const now = document.activeElement;
      const lost = !now || now === document.body || node.contains(now);
      if (!lost) return;
      const target = [opener.direct, opener.fallback].find((el) => isConnected(el) && !node.contains(el));
      if (target) focusQuietly(target);
    };
    // Only open/close matters; `ref` is a stable ref object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}
