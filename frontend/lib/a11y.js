// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * Keyboard support for elements that act as buttons but are not
 * <button>s (a clickable card or row), audit F6.
 *
 * activateOnKey(handler) is an onKeyDown handler: Enter or Space runs
 * `handler`, as a real button would. Keys pressed inside a child control
 * (a Follow button in the card, a text field) are left alone.
 *
 * Use with role="button" and tabIndex={0} on the same element.
 */
export function activateOnKey(handler) {
  return (e) => {
    if (!handler || e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      // A held key repeats keydown; act once, like a real button.
      if (!e.repeat) handler(e);
    }
  };
}
