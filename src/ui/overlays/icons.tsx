// Inline SVG icons used by the top toolbar. Kept in one file so adding /
// retheming icons doesn't touch the toolbar layout code.

export function BrandMark() {
  return (
    <span
      className="inline-flex items-center justify-center h-6 w-6 rounded-md bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white"
      aria-hidden
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <ellipse cx="8" cy="3.5" rx="5" ry="1.8" stroke="currentColor" strokeWidth="1.4" />
        <path d="M3 3.5v9c0 1 2.2 1.8 5 1.8s5-.8 5-1.8v-9" stroke="currentColor" strokeWidth="1.4" />
        <path d="M3 8c0 1 2.2 1.8 5 1.8s5-.8 5-1.8" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    </span>
  );
}

export function UploadIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M8 13V4m0 0L5 7m3-3l3 3M3 13.5h10"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ForceIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="3.5" cy="4" r="1.4" fill="currentColor" />
      <circle cx="12.5" cy="5" r="1.4" fill="currentColor" />
      <circle cx="8" cy="11" r="1.4" fill="currentColor" />
      <path d="M3.8 4.3l3.7 6m4.7-5L8.4 10.8m-4.7-6.3l8.5.5" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

export function LayersIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2" y="3" width="12" height="2.5" rx="0.6" stroke="currentColor" strokeWidth="1.2" />
      <rect x="2" y="6.75" width="12" height="2.5" rx="0.6" stroke="currentColor" strokeWidth="1.2" />
      <rect x="2" y="10.5" width="12" height="2.5" rx="0.6" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

export function SearchIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.5 10.5l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function ClearIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function FitIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M2 5V2h3M14 5V2h-3M2 11v3h3M14 11v3h-3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M13.2 9.6A5.5 5.5 0 1 1 6.4 2.8a5.5 5.5 0 0 0 6.8 6.8z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function MonitorIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2" y="3" width="12" height="8.5" rx="1.4" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 14h4M8 11.5V14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// "Shuffle / sparkle" hinting both "re-run" (the arrow) and "auto-arrange"
// (the sparkle) at once.
export function RelayoutIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M13 8a5 5 0 1 1-1.46-3.54" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path
        d="M13.5 2.5V5h-2.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="11.5" cy="11" r="0.7" fill="currentColor" />
      <circle cx="3.5" cy="11" r="0.5" fill="currentColor" />
    </svg>
  );
}
