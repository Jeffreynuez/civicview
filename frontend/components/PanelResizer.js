'use client';

import { useEffect, useRef, useState } from 'react';

// A 6px vertical drag handle that sits between the map and the right-side
// panel. On mousedown it captures subsequent mousemove/mouseup on `window`
// and calls `onResize(newWidth)` with `window.innerWidth - clientX`, clamped
// to [minWidth, maxFraction * innerWidth]. The resize is continuous — the
// parent stores the width in React state and re-renders the panel each
// frame.
export default function PanelResizer({
  onResize,
  minWidth = 380,
  maxFraction = 0.5,
}) {
  const [hovering, setHovering] = useState(false);
  const [dragging, setDragging] = useState(false);
  // Keep the latest onResize in a ref so our one-shot mousedown handler
  // doesn't have to re-bind when the parent re-renders.
  const onResizeRef = useRef(onResize);
  useEffect(() => { onResizeRef.current = onResize; }, [onResize]);

  const handleMouseDown = (e) => {
    e.preventDefault();
    setDragging(true);

    const prevBodyUserSelect = document.body.style.userSelect;
    const prevBodyCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'ew-resize';

    const handleMove = (moveEvent) => {
      const maxW = Math.max(minWidth, window.innerWidth * maxFraction);
      const raw = window.innerWidth - moveEvent.clientX;
      const clamped = Math.min(maxW, Math.max(minWidth, raw));
      onResizeRef.current?.(clamped);
    };

    const handleUp = () => {
      setDragging(false);
      document.body.style.userSelect = prevBodyUserSelect;
      document.body.style.cursor = prevBodyCursor;
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  };

  const active = hovering || dragging;

  return (
    <div
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      style={{
        width: '6px',
        flexShrink: 0,
        cursor: 'ew-resize',
        background: active ? 'var(--primary, #457b9d)' : 'transparent',
        opacity: active ? 0.6 : 1,
        borderLeft: active ? 'none' : '1px solid var(--cl-border)',
        transition: 'background 0.15s ease, opacity 0.15s ease',
        position: 'relative',
        zIndex: 5,
      }}
      aria-label="Resize panel"
      role="separator"
      aria-orientation="vertical"
    >
      {/* Subtle grip indicator — centered vertically, visible on hover */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '2px',
          height: '28px',
          borderRadius: '2px',
          background: active ? 'white' : 'var(--text-light, #888)',
          opacity: active ? 0.9 : 0.35,
          pointerEvents: 'none',
          transition: 'background 0.15s ease, opacity 0.15s ease',
        }}
      />
    </div>
  );
}
