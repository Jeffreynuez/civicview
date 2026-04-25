'use client';

import { useEffect, useRef, useState } from 'react';
import { STATE_NAME_TO_CODE, STATE_CODE_TO_FIPS } from '@/lib/constants';
import { fetchDistrictGeometry, fetchDistrictsForState } from '@/lib/api';

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

        // State fill layer — selected state is dimmed because its districts
        // render on top of it. Unselected states stay clickable everywhere.
        map.current.addLayer({
          id: 'state-fills',
          type: 'fill',
          source: 'states',
          paint: {
            'fill-color': [
              'case',
              ['boolean', ['feature-state', 'selected'], false],
              '#2d6a4f',
              ['boolean', ['feature-state', 'hover'], false],
              '#778da9',
              '#c5d5e4',
            ],
            'fill-opacity': [
              'case',
              ['boolean', ['feature-state', 'selected'], false], 0.08,
              ['boolean', ['feature-state', 'hover'], false], 0.28,
              0.15,
            ],
          },
        });

        // State borders — always visible so the state shape is legible even
        // when districts are overlaid on top.
        map.current.addLayer({
          id: 'state-borders',
          type: 'line',
          source: 'states',
          paint: {
            'line-color': [
              'case',
              ['boolean', ['feature-state', 'selected'], false],
              '#1b4332',
              '#415a77',
            ],
            'line-width': [
              'case',
              ['boolean', ['feature-state', 'selected'], false],
              2.5,
              1,
            ],
            'line-opacity': 0.8,
          },
        });

        // Districts overview — fill. Near-invisible by default (just enough to
        // be hit-testable) and highlighted on hover so it's unambiguous which
        // one you're about to click. Zoom-independent now that districts
        // render as soon as a state is selected.
        map.current.addLayer({
          id: 'district-overview-fill',
          type: 'fill',
          source: 'state-districts',
          paint: {
            'fill-color': [
              'case',
              ['boolean', ['feature-state', 'hover'], false],
              '#e63946', // red — mirrors the selected-district color
              '#457b9d',
            ],
            'fill-opacity': [
              'case',
              ['boolean', ['feature-state', 'hover'], false], 0.22,
              0.04,
            ],
          },
        });

        // Districts overview — outlines. Always visible (hairline) once a
        // state is selected, beefed up on hover.
        map.current.addLayer({
          id: 'district-overview-line',
          type: 'line',
          source: 'state-districts',
          paint: {
            'line-color': [
              'case',
              ['boolean', ['feature-state', 'hover'], false],
              '#a4161a',
              '#1d3557',
            ],
            'line-width': [
              'case',
              ['boolean', ['feature-state', 'hover'], false],
              3,
              1.2,
            ],
            'line-opacity': [
              'case',
              ['boolean', ['feature-state', 'hover'], false], 1.0,
              0.55,
            ],
          },
        });

        // Active district — highlighted selection (on top)
        map.current.addLayer({
          id: 'district-fill',
          type: 'fill',
          source: 'active-district',
          paint: { 'fill-color': '#e63946', 'fill-opacity': 0.25 },
        });
        map.current.addLayer({
          id: 'district-outline',
          type: 'line',
          source: 'active-district',
          paint: { 'line-color': '#a4161a', 'line-width': 3 },
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

  // ─── React to selectedState prop (when set externally, e.g. via lookup) ──
  useEffect(() => {
    if (!map.current || !mapLoaded.current || !selectedState) return;
    if (activeDistrict) return;
    const features = map.current.querySourceFeatures('states', {});
    const match = features.find((f) => STATE_NAME_TO_CODE[f.properties.name] === selectedState);
    if (!match) return;
    if (selectedStateRef.current !== null) {
      map.current.setFeatureState({ source: 'states', id: selectedStateRef.current }, { selected: false });
    }
    selectedStateRef.current = match.id;
    map.current.setFeatureState({ source: 'states', id: match.id }, { selected: true });
    try {
      const [sw, ne] = geometryBounds(match.geometry);
      map.current.fitBounds([sw, ne], { padding: 60, duration: 900, maxZoom: 7 });
    } catch { /* noop */ }
    setCurrentLabel(match.properties.name);
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

      {/* Back-to-state view button — top center, only when a district is active */}
      {activeDistrict && (
        <button
          onClick={handleBackToState}
          style={{
            position: 'absolute', top: '12px', left: '50%', transform: 'translateX(-50%)',
            background: 'white', padding: '8px 14px', borderRadius: '999px',
            fontSize: '0.82rem', color: '#1b263b', fontWeight: 600,
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)', border: '1px solid #e0e0e0',
            zIndex: 10, display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/>
          </svg>
          Back to {activeDistrict.stateCode || 'state'}
        </button>
      )}

      {/* Zoom slider — bottom left. Minimized to just percentage + slider. */}
      <div
        style={{
          position: 'absolute',
          left: '16px',
          bottom: '16px',
          zIndex: 10,
          background: 'white',
          borderRadius: '10px',
          padding: '8px 12px',
          boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          width: '200px',
        }}
      >
        <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--primary)', minWidth: '34px' }}>
          {zoomPct}%
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={zoomPct}
          onChange={handleSliderChange}
          style={{
            flex: 1,
            accentColor: '#457b9d',
            cursor: 'pointer',
          }}
        />
      </div>

      {/* State / district label — bottom center. Reflects hover when available. */}
      <div
        style={{
          position: 'absolute', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
          background: '#1b263b', color: 'white', padding: '8px 20px', borderRadius: '24px',
          fontSize: '0.85rem', fontWeight: 500, opacity: 0.9, zIndex: 10, pointerEvents: 'none',
        }}
      >
        {hoveredDistrictLabel || hoveredState || currentLabel}
      </div>
    </div>
  );
}
