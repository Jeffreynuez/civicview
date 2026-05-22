'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * CivicView brand mark — magnifying lens viewing the full U.S. flag.
 *
 * Renders one of four SVG files shipped in /public/logo/ via a plain
 * <img>. The SVG files themselves carry the full design (50 stars in
 * the canton arranged in the canonical 6-5-6-5-6-5-6-5-6 pattern, 13
 * alternating stripes, lens highlight on the color variant, etc.) —
 * keeping that geometry inside the SVG files instead of inlined here
 * means the design source of truth is the asset, not the component.
 *
 * Variants:
 *   - 'color'    (default): full-color primary — navy frame, navy
 *                           canton, white stars, muted-red + white
 *                           stripes. Use on light surfaces (≤48px;
 *                           use 'color-detailed' for hero sizes).
 *   - 'color-detailed'    : richer rendering with glass-lens highlight
 *                           + handle shading. Use at 48px and up —
 *                           landing-page hero, app-store icons, social
 *                           profile, marketing surfaces.
 *   - 'mono'              : single-ink navy. Use at 16×16 favicon-class
 *                           sizes and for embossing / mono prints
 *                           where red would muddy.
 *   - 'reverse'           : white frame, muted-red canton, navy +
 *                           white stripes. Use on dark chrome
 *                           (navbar, footer).
 *
 * The component is intentionally tiny — it exists only to give call
 * sites a stable React import surface that mirrors the design system,
 * not because there's any rendering logic worth centralizing.
 */
export default function CivicViewLogo({
  size = 32,
  variant = 'color',
  className,
  title = 'CivicView',
  style,
  ...rest
}) {
  const fileMap = {
    color: '/logo/civicview-glyph-color.svg',
    'color-detailed': '/logo/civicview-glyph-color-detailed.svg',
    mono: '/logo/civicview-glyph-mono.svg',
    reverse: '/logo/civicview-glyph-reverse.svg',
  };
  const src = fileMap[variant] || fileMap.color;

  return (
    <img
      src={src}
      width={size}
      height={size}
      alt={title}
      className={className}
      style={{ display: 'inline-block', ...style }}
      {...rest}
    />
  );
}
