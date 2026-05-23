// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/*
 * StateDropdown — opens from the "States" chip on the /polls page.
 *
 *   • Scrollable list of 50 states + DC (51 entries).
 *   • Fade gradients on the top + bottom of the scroll area:
 *       - Top fade only appears once the user has scrolled away from
 *         the top of the list.
 *       - Bottom fade is always visible until the list reaches its
 *         end, at which point it fades out.
 *   • Single-select; clicking a state fires onSelect(stateCode) and
 *     onClose() so the dropdown collapses back to the chip.
 *   • Anonymous "Clear" link in the header lets the user drop the
 *     selection without picking a different state.
 *   • Mobile: parent CSS turns this into a full-width sheet that
 *     pushes content below; the component doesn't need to know.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

// 50 states + DC. Kept here (rather than in a shared constants file)
// so this component is self-contained and the page can render it
// without an extra import.
const US_STATES = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'],
  ['CA', 'California'], ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'],
  ['DC', 'District of Columbia'], ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'],
  ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'],
  ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'],
  ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'],
  ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'],
  ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'],
  ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'],
  ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'],
  ['SC', 'South Carolina'], ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'],
  ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'],
  ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
];

export default function StateDropdown({ selected, onSelect, onClose, anchor = 'inline' }) {
  const scrollRef = useRef(null);
  const [scrolled, setScrolled] = useState(false);
  const [atEnd, setAtEnd] = useState(false);

  const handleScroll = useCallback((e) => {
    const el = e?.target || scrollRef.current;
    if (!el) return;
    // 6px buffer keeps the top fade from flickering during sub-pixel
    // scroll-restoration adjustments on touch devices.
    setScrolled(el.scrollTop > 6);
    setAtEnd(el.scrollHeight - el.scrollTop - el.clientHeight < 6);
  }, []);

  // Initial pass — when the scroll area is short enough to show every
  // state without scrolling (rare, but possible at very tall window
  // heights), the bottom fade should hide immediately.
  useEffect(() => {
    handleScroll();
  }, [handleScroll]);

  // Esc closes the dropdown — matches the rest of the navbar surface.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className={`states-dd states-dd--${anchor}`} role="listbox" aria-label="Filter by state">
      <div className="states-dd__head">
        <span className="states-dd__title">Filter by state</span>
        {selected && (
          <button
            type="button"
            className="states-dd__clear"
            onClick={() => { onSelect(null); onClose?.(); }}
          >
            Clear
          </button>
        )}
      </div>

      <div className={`states-dd__scroll ${scrolled ? 'is-scrolled' : ''} ${atEnd ? 'is-end' : ''}`}>
        {/* Top fade — only visible once the list is scrolled. */}
        <div className="states-dd__fade states-dd__fade--top" aria-hidden="true" />
        <div className="states-dd__list" ref={scrollRef} onScroll={handleScroll}>
          {US_STATES.map(([abbr, name]) => (
            <button
              key={abbr}
              type="button"
              role="option"
              aria-selected={selected === abbr}
              className={`states-dd__item ${selected === abbr ? 'is-selected' : ''}`}
              onClick={() => { onSelect(abbr); onClose?.(); }}
            >
              <span className="states-dd__abbr">{abbr}</span>
              <span className="states-dd__name">{name}</span>
              {selected === abbr && <span className="states-dd__check" aria-hidden="true">✓</span>}
            </button>
          ))}
        </div>
        {/* Bottom fade — always visible until the user scrolls to the
            end of the list. */}
        <div className="states-dd__fade states-dd__fade--bot" aria-hidden="true" />
      </div>
    </div>
  );
}

export { US_STATES };
