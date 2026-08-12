'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

// The embeddable map. MapView does all the work; this is the minimum shell it
// needs to run outside app/page.js.
//
// WHAT MapView EXPECTS FROM A PARENT
// It owns its view state — hover, camera, zoom readout — but NOT the
// selection. `selectedState` and `activeDistrict` are props, and the drill-down
// only advances when the parent sets them in response to the callbacks. So the
// whole contract is two pieces of state and four handlers. Everything else
// app/page.js does around those callbacks (fetching officials, opening the side
// panel, notifications) is side-panel work and is deliberately absent here.
//
// WHY THIS NEEDS NO BACKEND
// The map's three data sources are all public, keyless and CORS-open:
// the Carto Positron basemap style, the state outlines on GitHub, and the
// district polygons from the Census Bureau's TIGERweb ArcGIS service. Nothing
// here touches api.civicview.app, so the embed keeps working for an anonymous
// visitor on a third-party page, and a backend outage cannot take out a panel
// on someone else's site.
//
// SIZING
// MapView's root is `relative flex-1`, which means it contributes no height of
// its own — it fills a flex parent that already has one. Inside an iframe there
// is no page to inherit from, so the shell is `position: fixed; inset: 0`
// rather than a height percentage: that resolves against the viewport no matter
// what the root layout's body classes are doing, and it cannot be collapsed by
// a wrapper somewhere above it. MapView's own ResizeObserver handles the rest,
// including the parent animating the frame's size.

import { useCallback, useState } from 'react';
import MapView from '@/components/MapView';

// Where the "open the real thing" link goes. Absolute and not a next/link:
// inside an iframe this must escape the frame, not navigate it.
const APP_URL = 'https://civicview.app/';

export default function EmbedMap() {
  const [selectedState, setSelectedState] = useState(null);
  const [stateName, setStateName] = useState(null);
  const [activeDistrict, setActiveDistrict] = useState(null);

  const handleStateSelect = useCallback((stateCode, name) => {
    setSelectedState(stateCode);
    setStateName(name || stateCode);
    // Picking a different state while zoomed into a district must clear the
    // district, or MapView keeps painting the old state's polygon on top.
    setActiveDistrict(null);
  }, []);

  const handleStateDeselect = useCallback(() => {
    setSelectedState(null);
    setStateName(null);
    setActiveDistrict(null);
  }, []);

  const handleDistrictSelect = useCallback((info) => setActiveDistrict(info), []);
  const handleDistrictBack = useCallback(() => setActiveDistrict(null), []);

  // The readout doubles as proof the drill-down is live: a visitor who clicks
  // Kentucky and then its third district sees the words change, which a
  // screenshot cannot do.
  let readout = null;
  if (activeDistrict) {
    const d = activeDistrict.districtLabel
      || (activeDistrict.district === 'At-Large' ? 'At-Large' : 'District ' + activeDistrict.district);
    readout = (stateName || activeDistrict.stateCode || '') + ' · ' + d;
  } else if (stateName) {
    readout = stateName;
  }

  return (
    <div
      className="cv-embed-shell"
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--cl-bg, #f8f9fa)',
      }}
    >
      <MapView
        onStateSelect={handleStateSelect}
        onStateDeselect={handleStateDeselect}
        onDistrictSelect={handleDistrictSelect}
        onDistrictBack={handleDistrictBack}
        selectedState={selectedState}
        activeDistrict={activeDistrict}
      />

      {/* Top-right, because MapView already owns top-left (the back pill) and
          bottom-left (the zoom readout), and bottom-right belongs to the
          MapLibre attribution — which stays, it is a licence condition of the
          basemap, not decoration. */}
      <div
        style={{
          position: 'absolute',
          top: 12,
          right: 12,
          zIndex: 20,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          flexWrap: 'wrap',
          gap: 8,
          maxWidth: 'calc(100% - 24px)',
          pointerEvents: 'none',
        }}
      >
        {readout && (
          <span
            style={{
              pointerEvents: 'auto',
              background: 'var(--cl-card, #fff)',
              border: '1px solid var(--cl-border, #e2e5ea)',
              borderRadius: 'var(--cl-radius-pill, 999px)',
              boxShadow: 'var(--cl-shadow-pop, 0 6px 18px rgba(0,0,0,.12))',
              color: 'var(--cl-text, #1b263b)',
              font: '600 var(--cl-text-sm, 0.85rem)/1 var(--cl-font-sans, system-ui)',
              padding: '9px 13px',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {readout}
          </span>
        )}

        <a
          href={APP_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            pointerEvents: 'auto',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            background: 'var(--cl-card, #fff)',
            border: '1px solid var(--cl-border, #e2e5ea)',
            borderRadius: 'var(--cl-radius-pill, 999px)',
            boxShadow: 'var(--cl-shadow-pop, 0 6px 18px rgba(0,0,0,.12))',
            color: 'var(--cl-accent, #1b263b)',
            font: '600 var(--cl-text-sm, 0.85rem)/1 var(--cl-font-sans, system-ui)',
            padding: '9px 13px',
            textDecoration: 'none',
            whiteSpace: 'nowrap',
            minHeight: 36,
          }}
        >
          Open CivicView
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path
              d="M4 2h6v6M10 2 2.6 9.4"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </a>
      </div>
    </div>
  );
}
