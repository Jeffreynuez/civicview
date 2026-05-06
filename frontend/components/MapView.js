'use client';

import { useEffect, useRef, useState } from 'react';
import { STATE_NAME_TO_CODE, STATE_CODE_TO_FIPS } from '@/lib/constants';
import { fetchDistrictGeometry, fetchDistrictsForState } from '@/lib/api';
import { useIsMobile } from '@/lib/useViewport';
import { ArrowLeft } from './ui';

// Zoom bounds for the map — the slider maps linearly between these.
const MIN_ZOOM = 2;
const MAX_ZOOM = 14;

// Compute a [west, south, east, north] bbox from a GeoJSON geometry.
function geometryBounds(geom) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const visit = (coords) => {
    if (typeof coords[0] === 'number') {
      const [x, y] = coords;
      if (x < w) w = x; if (x > e) e = x;
      if (y < s) s = y; if (y > n) n = y;
    } else {
      coords.forEach(visit);
    }
  };
  visit(geom.coordinates);
  return [[w, s], [e, n]];
}

function zoomToPct(z) {
  return Math.round(((z - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM)) * 100);
}
function pctToZoom(pct) {
  return MIN_ZOOM + (pct / 100) * (MAX_ZOOM - MIN_ZOOM);
}

export default function MapView({ onStateSelect, onStateDeselect, onDistrictSelect, onDistrictBack, selectedState, activeDistrict }) {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const mapLoaded = useRef(false);
  const selectedStateRef = useRef(null);
  const hoveredDistrictId = useRef(null);
  // Cache of every loaded state feature keyed by its 2-letter code. We need
  // this because `querySourceFeatures` only returns features that fall within
  // the *currently rendered* tiles — so once the map has zoomed into one
  // state, picking a different state from outside that viewport (e.g. via
  // the Browse-by-state grid) would silently fail to find the feature. The
  // cache is populated once when the states source finishes loading and
  // gives us O(1) lookups regardless of viewport.
  const stateFeaturesByCode = useRef({});
  // Remember the last district we focused on so re-rendering with the same
  // (but freshly-constructed) activeDistrict object doesn't trigger another
  // redundant fly-to.
  const lastFocusedDistrictKey = useRef(null);
  // Keep the latest deselect callback reachable from the one-shot init effect
  const onStateDeselectRef = useRef(onStateDeselect);
  useEffect(() => { onStateDeselectRef.current = onStateDeselect; }, [onStateDeselect]);
  // Set by the layer-specific click handlers so the generic handler can tell
  // whether the click actually landed on a state or district. Cleared on the
  // next tick after the generic handler reads it.
  const clickHitLayerRef = useRef(false);

  const [hoveredState, setHoveredState] = useState(null);
  const [hoveredDistrictLabel, setHoveredDistrictLabel] = useState(null);
  const [currentLabel, setCurrentLabel] = useState('United States');
  const [zoomPct, setZoomPct] = useState(zoomToPct(3.5));
  // On mobile we hide the bottom-left zoom dock (MapLibre's built-in
  // NavigationControl + native pinch-zoom cover the same affordance
  // and don't burn screen space the panel needs more than the map).
  const isMobile = useIsMobile();

  // ─── One-time map init ──────────────────────────────────────────────
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    const initMap = async () => {
      const maplibregl = await import('maplibre-gl');

      map.current = new maplibregl.Map({
        container: mapContainer.current,
        style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
        center: [-98.5, 39.8],
        zoom: 3.5,
        minZoom: MIN_ZOOM,
        maxZoom: MAX_ZOOM,
      });

      map.current.addControl(new maplibregl.NavigationControl(), 'top-right');

      let hoveredStateId = null;

      map.current.on('load', () => {
        mapLoaded.current = true;

        map.current.addSource('states', {
          type: 'geojson',
          data: 'https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json',
        });

        // Pre-fetch the same GeoJSON ourselves so we can build a cache keyed
        // by state code. `querySourceFeatures` is viewport-bound and was
        // missing far-off states once the map had zoomed in (e.g. selecting
        // California from the Browse-by-state grid while zoomed into FL
        // would not return the CA feature, so the map never zoomed). The
        // cache fixes that — any state lookup is O(1) regardless of zoom.
        // Includes DC because the upstream feature is named
        // "District Of Columbia" which our STATE_NAME_TO_CODE table omits.
        (async () => {
          try {
            const resp = await fetch(
              'https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json'
            );
            const fc = await resp.json();
            const cache = {};
            for (const feat of fc.features || []) {
              const name = feat?.properties?.name;
              if (!name) continue;
              let code = STATE_NAME_TO_CODE[name];
              if (!code && name.toLowerCase() === 'district of columbia') {
                code = 'DC';
              }
              if (!code) continue;
              cache[code] = feat;
            }
            stateFeaturesByCode.current = cache;
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn('MapView: failed to pre-cache state features', err);
          }
        })();

        // All districts for the currently-selected state (overview layer).
        map.current.addSource('state-districts', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
          promoteId: 'GEOID', // use GEOID as feature id for hover highlighting
        });

        // Single highlighted district (from address lookup OR district click).
        map.current.addSource('active-district', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });

        // State fill layer — at rest the state interior is fully transparent
        // so the underlying map (cities, lakes, terrain, basemap labels)
        // shows through. Hover and selected layer an accent-green tint on
        // top while keeping the map readable. Selected state stays subtler
        // than hover (6% vs 12%) because the 2px green border on selected
        // does the heavy lifting for that signal.
        //
        // The fill IS still present — clicks and hover detection rely on
        // a hit-testable surface — it's just transparent. Maplibre treats
        // a 0-opacity fill as fully clickable, same as a solid fill.
        //
        // Earlier Phase 4B treatment used a solid #f1f3f5 (surface-100) at
        // full opacity, which obscured the basemap entirely until hover.
        // This change preserves the same hover/selected tints but lets the
        // map breathe through at rest.
        map.current.addLayer({
          id: 'state-fills',
          type: 'fill',
          source: 'states',
          paint: {
            'fill-color': [
              'case',
              ['boolean', ['feature-state', 'selected'], false],
              '#2d6a4f', // --cl-accent
              ['boolean', ['feature-state', 'hover'], false],
              '#2d6a4f', // --cl-accent
              '#2d6a4f', // unused at rest (opacity is 0) but a valid color
            ],
            'fill-opacity': [
              'case',
              ['boolean', ['feature-state', 'selected'], false], 0.06,
              ['boolean', ['feature-state', 'hover'], false], 0.12,
              0.0, // resting — fully transparent so the basemap shows through
            ],
          },
        });

        // State borders — always visible so the state shape is legible even
        // when districts are overlaid on top. Selected state now flips to
        // accent-green stroke at 2px (was a darker green at 2.5px).
        map.current.addLayer({
          id: 'state-borders',
          type: 'line',
          source: 'states',
          paint: {
            'line-color': [
              'case',
              ['boolean', ['feature-state', 'selected'], false],
              '#2d6a4f', // --cl-accent
              ['boolean', ['feature-state', 'hover'], false],
              '#2d6a4f', // --cl-accent
              '#dee2e6', // --cl-border (hairline neutral)
            ],
            'line-width': [
              'case',
              ['boolean', ['feature-state', 'selected'], false], 2,
              ['boolean', ['feature-state', 'hover'], false], 1.5,
              0.75,
            ],
            'line-opacity': 1,
          },
        });

        // Districts overview — fill. Near-invisible by default (just enough
        // to be hit-testable) and highlighted on hover. Phase 4B: hover
        // uses accent-green tint (was party-red, conflated with reactions).
        map.current.addLayer({
          id: 'district-overview-fill',
          type: 'fill',
          source: 'state-districts',
          paint: {
            'fill-color': [
              'case',
              ['boolean', ['feature-state', 'hover'], false],
              '#2d6a4f', // --cl-accent
              '#2d6a4f', // --cl-accent (very faint resting)
            ],
            'fill-opacity': [
              'case',
              ['boolean', ['feature-state', 'hover'], false], 0.22,
              0.0,
            ],
          },
        });

        // Districts overview — outlines. Always visible (hairline) once a
        // state is selected, beefed up on hover. Phase 4B: hover uses
        // accent-green stroke (was dark-red).
        map.current.addLayer({
          id: 'district-overview-line',
          type: 'line',
          source: 'state-districts',
          paint: {
            'line-color': [
              'case',
              ['boolean', ['feature-state', 'hover'], false],
              '#2d6a4f', // --cl-accent
              '#ced4da', // --cl-border-strong (surface-400 hairline)
            ],
            'line-width': [
              'case',
              ['boolean', ['feature-state', 'hover'], false],
              2,
              1.2,
            ],
            'line-opacity': [
              'case',
              ['boolean', ['feature-state', 'hover'], false], 1.0,
              0.55,
            ],
          },
        });

        // Active district — highlighted selection (on top). Phase 4B:
        // accent-green at 35% fill + 2px accent-green stroke per the
        // design system MapView spec (was the GOP-red treatment, which
        // conflated party signaling with selection signaling).
        map.current.addLayer({
          id: 'district-fill',
          type: 'fill',
          source: 'active-district',
          paint: { 'fill-color': '#2d6a4f', 'fill-opacity': 0.35 },
        });
        map.current.addLayer({
          id: 'district-outline',
          type: 'line',
          source: 'active-district',
          paint: { 'line-color': '#2d6a4f', 'line-width': 2 },
        });

        // ── Hover / click on states ───────────────────────────────
        map.current.on('mousemove', 'state-fills', (e) => {
          // If a district is under the cursor, districts get the hover
          // affordance instead — state hover would be misleading since the
          // click will land on the district.
          const districtHit = map.current.queryRenderedFeatures(e.point, {
            layers: ['district-overview-fill'],
          });
          if (districtHit.length > 0) {
            if (hoveredStateId !== null) {
              map.current.setFeatureState({ source: 'states', id: hoveredStateId }, { hover: false });
              hoveredStateId = null;
              setHoveredState(null);
            }
            return;
          }
          if (e.features.length > 0) {
            if (hoveredStateId !== null) {
              map.current.setFeatureState({ source: 'states', id: hoveredStateId }, { hover: false });
            }
            hoveredStateId = e.features[0].id;
            map.current.setFeatureState({ source: 'states', id: hoveredStateId }, { hover: true });
            map.current.getCanvas().style.cursor = 'pointer';
            setHoveredState(e.features[0].properties.name);
          }
        });

        map.current.on('mouseleave', 'state-fills', () => {
          if (hoveredStateId !== null) {
            map.current.setFeatureState({ source: 'states', id: hoveredStateId }, { hover: false });
          }
          hoveredStateId = null;
          map.current.getCanvas().style.cursor = '';
          setHoveredState(null);
        });

        // State click — defers to the district-overview-fill handler when a
        // district is under the click point. That way once a state is
        // selected, clicking on a district selects the district (not the
        // state again), and clicking on the selected state's body outside any
        // district is a no-op.
        map.current.on('click', 'state-fills', (e) => {
          if (e.features.length === 0) return;
          const districtHit = map.current.queryRenderedFeatures(e.point, {
            layers: ['district-overview-fill'],
          });
          if (districtHit.length > 0) return;

          const feature = e.features[0];
          const stateName = feature.properties.name;
          const stateCode = STATE_NAME_TO_CODE[stateName];
          if (!stateCode) return;
          clickHitLayerRef.current = true;

          if (selectedStateRef.current !== null && selectedStateRef.current !== feature.id) {
            map.current.setFeatureState(
              { source: 'states', id: selectedStateRef.current },
              { selected: false }
            );
          }
          selectedStateRef.current = feature.id;
          map.current.setFeatureState({ source: 'states', id: feature.id }, { selected: true });

          try {
            const [sw, ne] = geometryBounds(feature.geometry);
            map.current.fitBounds([sw, ne], { padding: 60, duration: 900, maxZoom: 7 });
          } catch {
            map.current.flyTo({ center: [-98.5, 39.8], zoom: 5, duration: 900 });
          }
          setCurrentLabel(stateName);
          onStateSelect(stateCode, stateName);
        });

        // District click — layer-specific, fires when clicking an actually
        // rendered district polygon. Districts appear as soon as a state is
        // selected, so no zoom-gate here.
        map.current.on('click', 'district-overview-fill', (e) => {
          if (e.features.length === 0) return;
          clickHitLayerRef.current = true;
          const f = e.features[0];
          const props = f.properties;
          const stateFips = props.STATE;
          const stateCode = Object.entries(STATE_CODE_TO_FIPS).find(
            ([, fips]) => fips === stateFips
          )?.[0];
          const cd119 = String(props.CD119 || '');
          let district;
          if (cd119 === '00' || cd119 === '98') district = 'At-Large';
          else district = String(parseInt(cd119, 10));
          const districtLabel =
            district === 'At-Large' ? `${stateCode}-At-Large` : `${stateCode}-${district}`;

          if (onDistrictSelect) {
            onDistrictSelect({ stateCode, stateFips, district, districtLabel, address: null });
          }
        });

        // ── Hover / click on districts ────────────────────────────
        map.current.on('mousemove', 'district-overview-fill', (e) => {
          if (e.features.length === 0) return;
          const f = e.features[0];
          if (hoveredDistrictId.current !== null) {
            map.current.setFeatureState({ source: 'state-districts', id: hoveredDistrictId.current }, { hover: false });
          }
          hoveredDistrictId.current = f.id;
          map.current.setFeatureState({ source: 'state-districts', id: f.id }, { hover: true });
          map.current.getCanvas().style.cursor = 'pointer';
          const cd = (f.properties.CD119 || '').replace(/^0+/, '') || 'At-Large';
          setHoveredDistrictLabel(`District ${cd === '98' ? 'Delegate' : cd}`);
        });

        map.current.on('mouseleave', 'district-overview-fill', () => {
          if (hoveredDistrictId.current !== null) {
            map.current.setFeatureState({ source: 'state-districts', id: hoveredDistrictId.current }, { hover: false });
          }
          hoveredDistrictId.current = null;
          map.current.getCanvas().style.cursor = '';
          setHoveredDistrictLabel(null);
        });

        // ── Background click — click outside any state/district to deselect ──
        // Layer-specific click handlers above set clickHitLayerRef.current = true
        // when they fire. By deferring this handler to the next microtask via
        // setTimeout(0), we guarantee the layer handlers have already updated
        // the flag by the time we read it. This is more reliable than
        // queryRenderedFeatures, which can miss features at low zoom when the
        // fill opacity is interpolated near the edges of the stop range.
        map.current.on('click', () => {
          setTimeout(() => {
            if (clickHitLayerRef.current) {
              clickHitLayerRef.current = false;
              return;
            }
            // True background click — no layer handler fired for it.
            if (selectedStateRef.current !== null) {
              map.current.setFeatureState(
                { source: 'states', id: selectedStateRef.current },
                { selected: false }
              );
              selectedStateRef.current = null;
            }
            setCurrentLabel('United States');
            if (onStateDeselectRef.current) onStateDeselectRef.current();
          }, 0);
        });

        // ── Zoom tracking ─────────────────────────────────────────
        const updateZoom = () => setZoomPct(zoomToPct(map.current.getZoom()));
        map.current.on('zoom', updateZoom);
        map.current.on('zoomend', updateZoom);
        updateZoom();
      });
    };

    initMap();

    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
        mapLoaded.current = false;
      }
    };
  }, []);

  // ─── Fetch + render state district overview when selectedState changes ──
  useEffect(() => {
    let cancelled = false;
    const apply = async () => {
      if (!map.current) return;
      if (!mapLoaded.current) {
        await new Promise((resolve) => map.current.once('load', resolve));
      }
      const src = map.current.getSource('state-districts');
      if (!src) return;

      if (!selectedState) {
        src.setData({ type: 'FeatureCollection', features: [] });
        return;
      }

      const fips = STATE_CODE_TO_FIPS[selectedState];
      if (!fips) {
        src.setData({ type: 'FeatureCollection', features: [] });
        return;
      }

      const gj = await fetchDistrictsForState(fips);
      if (cancelled) return;
      if (gj?.features?.length) {
        src.setData(gj);
      } else {
        src.setData({ type: 'FeatureCollection', features: [] });
      }
    };
    apply();
    return () => { cancelled = true; };
  }, [selectedState]);

  // ─── Fetch + render the single active district ─────────────────────
  useEffect(() => {
    let cancelled = false;
    const applyDistrict = async () => {
      if (!map.current) return;
      if (!mapLoaded.current) {
        await new Promise((resolve) => map.current.once('load', resolve));
      }
      const src = map.current.getSource('active-district');
      if (!src) return;

      if (!activeDistrict || !activeDistrict.stateFips || !activeDistrict.district) {
        src.setData({ type: 'FeatureCollection', features: [] });
        lastFocusedDistrictKey.current = null;
        return;
      }

      const geo = await fetchDistrictGeometry(activeDistrict.stateFips, activeDistrict.district);
      if (cancelled || !geo || !geo.features?.length) {
        src.setData({ type: 'FeatureCollection', features: [] });
        return;
      }

      src.setData(geo);
      setCurrentLabel(activeDistrict.districtLabel || `${activeDistrict.stateCode} — ${activeDistrict.district}`);

      // Skip the fly-to if the parent just rebuilt the same district object.
      const districtKey = `${activeDistrict.stateFips}-${activeDistrict.district}`;
      if (lastFocusedDistrictKey.current === districtKey) return;
      lastFocusedDistrictKey.current = districtKey;

      try {
        const bounds = geometryBounds(geo.features[0].geometry);
        map.current.fitBounds(bounds, { padding: 60, duration: 600, maxZoom: 10 });
      } catch (err) {
        console.warn('Could not fit bounds to district:', err);
      }
    };
    applyDistrict();
    return () => { cancelled = true; };
  }, [activeDistrict]);

  // ─── React to selectedState prop (when set externally, e.g. via lookup ──
  // or via the Browse-by-state grid). Two-step strategy:
  //
  //  1. Look up the target state's GeoJSON via our pre-built cache (so we
  //     have its geometry regardless of which states are currently in the
  //     viewport) and call fitBounds.
  //
  //  2. Setting the `selected` feature-state highlight needs maplibre's
  //     auto-assigned feature id — which we can only get from
  //     querySourceFeatures, and that's viewport-bound. We try once
  //     immediately (works when the state was already partially rendered),
  //     and if that fails we wait for the camera to settle on its new
  //     center via 'idle' before re-querying.
  useEffect(() => {
    if (!map.current || !mapLoaded.current || !selectedState) return;
    if (activeDistrict) return;

    // Try cache first (works for any state regardless of viewport), then
    // fall back to querySourceFeatures (works pre-cache while the upstream
    // GeoJSON fetch is still in flight).
    const cached = stateFeaturesByCode.current[selectedState];
    let geomFeature = cached;
    if (!geomFeature) {
      const features = map.current.querySourceFeatures('states', {});
      geomFeature = features.find(
        (f) => STATE_NAME_TO_CODE[f?.properties?.name] === selectedState
      );
    }
    if (!geomFeature) return;

    // Clear any prior selected highlight.
    if (selectedStateRef.current !== null) {
      try {
        map.current.setFeatureState(
          { source: 'states', id: selectedStateRef.current },
          { selected: false }
        );
      } catch { /* noop */ }
      selectedStateRef.current = null;
    }

    // Try to apply the highlight immediately (works if the state is in the
    // currently-rendered tile set).
    const liveNow = map.current
      .querySourceFeatures('states', {})
      .find((f) => STATE_NAME_TO_CODE[f?.properties?.name] === selectedState);
    if (liveNow && liveNow.id !== undefined) {
      selectedStateRef.current = liveNow.id;
      map.current.setFeatureState(
        { source: 'states', id: liveNow.id },
        { selected: true }
      );
    }

    // Fly to the cached geometry — works for any state in the cache.
    try {
      const [sw, ne] = geometryBounds(geomFeature.geometry);
      map.current.fitBounds([sw, ne], { padding: 60, duration: 900, maxZoom: 7 });
    } catch { /* noop */ }
    setCurrentLabel(geomFeature.properties?.name || selectedState);

    // If the highlight didn't apply yet (state was outside the viewport),
    // re-query once the camera settles. 'idle' fires after the move + tile
    // load completes, so the target feature is now guaranteed renderable.
    if (!liveNow) {
      const onIdle = () => {
        if (!map.current) return;
        const f = map.current
          .querySourceFeatures('states', {})
          .find(
            (feat) =>
              STATE_NAME_TO_CODE[feat?.properties?.name] === selectedState
          );
        if (f && f.id !== undefined) {
          selectedStateRef.current = f.id;
          map.current.setFeatureState(
            { source: 'states', id: f.id },
            { selected: true }
          );
        }
        map.current.off('idle', onIdle);
      };
      map.current.on('idle', onIdle);
    }
  }, [selectedState, activeDistrict]);

  // ─── Slider handler ───────────────────────────────────────────────
  const handleSliderChange = (e) => {
    const pct = Number(e.target.value);
    setZoomPct(pct);
    if (map.current) {
      map.current.easeTo({ zoom: pctToZoom(pct), duration: 250 });
    }
  };

  // ─── "Back to state view" handler ─────────────────────────────────
  // Clears the active district while keeping the selected state and zooms
  // back to the state's bbox so the user sees all districts again.
  const handleBackToState = () => {
    if (!activeDistrict) return;
    if (onDistrictBack) onDistrictBack();
    if (!map.current) return;
    // Zoom back to the selected state's bbox.
    try {
      const features = map.current.querySourceFeatures('states', {});
      const match = features.find(
        (f) => STATE_NAME_TO_CODE[f.properties.name] === (activeDistrict.stateCode || selectedState)
      );
      if (match) {
        const [sw, ne] = geometryBounds(match.geometry);
        map.current.fitBounds([sw, ne], { padding: 60, duration: 700, maxZoom: 7 });
      }
    } catch { /* noop */ }
  };

  return (
    <div className="relative flex-1">
      <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />

      {/* Back-to-state view pill — top-left, only when a district is active.
          Phase 4B: tokenized chrome + Phosphor ArrowLeft glyph + accent-
          green text per the design system's "ambient floating chrome"
          treatment. */}
      {activeDistrict && (
        <button
          onClick={handleBackToState}
          style={{
            position: 'absolute', top: 16, left: 16,
            background: 'var(--cl-card)',
            // Mobile bumps padding so the pill clears the 44px tap-
            // target minimum. Desktop stays compact since cursor
            // precision is fine.
            padding: isMobile ? '12px 18px' : '8px 14px',
            borderRadius: 'var(--cl-radius-pill)',
            fontSize: isMobile ? '0.95rem' : 'var(--cl-text-sm)',
            color: 'var(--cl-accent)',
            fontWeight: 600,
            fontFamily: 'var(--cl-font-sans)',
            boxShadow: 'var(--cl-shadow-pop)',
            border: '1px solid var(--cl-border)',
            zIndex: 10,
            display: 'flex', alignItems: 'center', gap: 6,
            cursor: 'pointer',
            minHeight: isMobile ? 44 : undefined,
          }}
        >
          <ArrowLeft size={isMobile ? 16 : 14} color="accent" active />
          {activeDistrict.stateCode || 'United States'}
        </button>
      )}

      {/* Zoom dock — bottom-LEFT (was bottom-right; fixed Phase 4B follow-up:
          right edge collides with the maplibre attribution badge and other
          floating chrome). Tokenized chrome, accent-green slider thumb,
          .cl-num percentage label.

          Hidden on mobile: the slider isn't a meaningful touch
          affordance (the thumb is a desktop-pointer interaction), and
          MapLibre's built-in NavigationControl (top-right) plus native
          pinch-zoom cover the same job without burning the panel's
          horizontal real estate. */}
      {!isMobile && (
        <div
          style={{
            position: 'absolute',
            left: 16,
            bottom: 16,
            zIndex: 10,
            background: 'var(--cl-card)',
            borderRadius: 'var(--cl-radius-lg)',
            padding: '8px 12px',
            boxShadow: 'var(--cl-shadow-pop)',
            border: '1px solid var(--cl-border)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            width: 200,
          }}
        >
          <div
            className="cl-num"
            style={{
              fontSize: 'var(--cl-text-sm)',
              fontWeight: 700,
              color: 'var(--cl-text)',
              minWidth: 34,
            }}
          >
            {zoomPct}%
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={zoomPct}
            onChange={handleSliderChange}
            aria-label="Map zoom"
            style={{
              flex: 1,
              accentColor: 'var(--cl-accent)',
              cursor: 'pointer',
            }}
          />
        </div>
      )}

      {/* State / district label — top center.
          Was bottom-center, but on phone-sized maps that pill overlaps
          the bottom-left zoom dock (desktop) and the bottom-right
          OpenStreetMap attribution badge. Top-center keeps the
          attribution clearly readable and pairs naturally with the
          MapLibre NavigationControl at top-right.

          When a district is active, the back-to-state pill in the
          top-left also lives in this row — they stay clear of each
          other because the back pill is left-aligned and the label
          is centered with `transform: translateX(-50%)`. */}
      <div
        style={{
          position: 'absolute', top: 16, left: '50%',
          transform: 'translateX(-50%)',
          background: 'var(--cl-primary)',
          color: 'var(--cl-text-on-dark)',
          padding: '8px 20px',
          borderRadius: 'var(--cl-radius-pill)',
          fontSize: 'var(--cl-text-sm)',
          fontWeight: 500,
          fontFamily: 'var(--cl-font-sans)',
          opacity: 0.9,
          zIndex: 10,
          pointerEvents: 'none',
          // Cap the width so very long district labels don't push
          // into the NavigationControl on the right at narrow widths.
          maxWidth: 'calc(100% - 140px)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {hoveredDistrictLabel || hoveredState || currentLabel}
      </div>
    </div>
  );
}
