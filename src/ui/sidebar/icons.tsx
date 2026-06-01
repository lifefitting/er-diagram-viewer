/**
 * Sidebar / accordion-section icons.
 *
 * All icons share the toolbar's visual language:
 *  - 16×16 viewBox, rendered at 14–16px
 *  - Stroke = 1.4–1.5 with round caps/joins, `currentColor`
 *  - Flat outline (no fills) except where a "swatch" semantic is helpful
 *    (e.g. the 4-square Modules glyph)
 *
 * The set is intentionally tiny — one component per concept — so callers in
 * App.tsx stay declarative.
 */

interface IconProps {
  /** Pixel size (square). Defaults to 14, matching the section header rhythm. */
  size?: number;
  /** Extra classNames merged onto the <svg> for tone/spacing tweaks. */
  className?: string;
}

const baseSvgProps = (size: number, className?: string) => ({
  width: size,
  height: size,
  viewBox: '0 0 16 16',
  fill: 'none' as const,
  'aria-hidden': true,
  className,
});

/** Eye glyph — used by 字段显示 (column-visibility controls). */
export function SectionIconEye({ size = 14, className }: IconProps = {}) {
  return (
    <svg {...baseSvgProps(size, className)}>
      <path
        d="M1.6 8c1.4-3.2 3.7-4.8 6.4-4.8S13 4.8 14.4 8c-1.4 3.2-3.7 4.8-6.4 4.8S3 11.2 1.6 8Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="2.1" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="8" cy="8" r="0.85" fill="currentColor" />
    </svg>
  );
}

/**
 * Four-square grid — used by 模块 (module legend). Slight alpha variation
 * across squares hints at "color-grouped tables" without coupling to any
 * specific palette.
 */
export function SectionIconBlocks({ size = 14, className }: IconProps = {}) {
  return (
    <svg {...baseSvgProps(size, className)}>
      <rect x="2" y="2" width="5.5" height="5.5" rx="1.1" fill="currentColor" fillOpacity="0.9" />
      <rect
        x="8.5"
        y="2"
        width="5.5"
        height="5.5"
        rx="1.1"
        fill="currentColor"
        fillOpacity="0.45"
      />
      <rect
        x="2"
        y="8.5"
        width="5.5"
        height="5.5"
        rx="1.1"
        fill="currentColor"
        fillOpacity="0.35"
      />
      <rect
        x="8.5"
        y="8.5"
        width="5.5"
        height="5.5"
        rx="1.1"
        fill="currentColor"
        fillOpacity="0.7"
      />
    </svg>
  );
}

/**
 * Magic wand + sparkle — used by 推断的外键. Reads as "AI / inference" at
 * 14px better than a literal brain icon does (brains lose detail below 18px).
 * The wand stroke runs from bottom-left to top-right, with two tiny
 * cross-sparkles flanking the tip.
 */
export function SectionIconSparklesWand({ size = 14, className }: IconProps = {}) {
  return (
    <svg {...baseSvgProps(size, className)}>
      {/* wand shaft */}
      <path d="M3 13 10.5 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      {/* wand tip + small star at tip */}
      <path d="m9.6 4.6 1.9 1.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      {/* top-right sparkle */}
      <path d="M13 2.5v2M12 3.5h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      {/* bottom-right sparkle (smaller) */}
      <path
        d="M13.25 9v1.5M12.5 9.75h1.5"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Lightbulb — used by 智能提示. */
export function SectionIconLightbulb({ size = 14, className }: IconProps = {}) {
  return (
    <svg {...baseSvgProps(size, className)}>
      <path
        d="M8 1.6a4.2 4.2 0 0 0-2.6 7.5v1.4h5.2V9.1A4.2 4.2 0 0 0 8 1.6Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M6.2 12.4h3.6M6.8 14h2.4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Triangle exclamation — used by 解析告警. */
export function SectionIconWarning({ size = 14, className }: IconProps = {}) {
  return (
    <svg {...baseSvgProps(size, className)}>
      <path
        d="M8 2.2 14.4 13.4H1.6L8 2.2Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M8 6.4v3.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="11.5" r="0.75" fill="currentColor" />
    </svg>
  );
}

/**
 * Four-point sparkle (a.k.a. "AI star"). Used as the sidebar brand mark in
 * both expanded and collapsed states, echoing the indigo→fuchsia gradient
 * already on the toolbar's BrandMark.
 */
export function SparklesIcon({ size = 14, className }: IconProps = {}) {
  return (
    <svg {...baseSvgProps(size, className)}>
      <path d="M8 2.2 9 6.4l4.2 1L9 8.6 8 12.8 7 8.6 2.8 7.4 7 6.4 8 2.2Z" fill="currentColor" />
      <path
        d="M12.5 11.2 13 12.7l1.4.4-1.4.4-.5 1.5-.5-1.5-1.4-.4 1.4-.4.5-1.5Z"
        fill="currentColor"
        fillOpacity="0.75"
      />
    </svg>
  );
}

/**
 * Left-pointing chevron with a faint right rail, used to communicate
 * "collapse this panel toward the left edge". Replaces the previous "✕"
 * close glyph, which read more like "dismiss a modal".
 */
export function CollapseLeftIcon({ size = 14, className }: IconProps = {}) {
  return (
    <svg {...baseSvgProps(size, className)}>
      <path
        d="M9.5 4 5.5 8l4 4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12.5 3v10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Inverse of CollapseLeftIcon: right-pointing chevron + faint left rail,
 * used as the affordance on the collapsed-state rail to suggest "expand
 * back out".
 */
export function SidebarOpenIcon({ size = 12, className }: IconProps = {}) {
  return (
    <svg {...baseSvgProps(size, className)}>
      <path d="M3.5 3v10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path
        d="M6.5 4 10.5 8l-4 4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
