/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // Class-based dark mode: a `.dark` ancestor (we toggle it on <html> from
  // the theme effect in App.tsx) flips every `dark:` variant. Chose class
  // over media so users can override their OS preference per-app.
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Light-mode neutral scale. Kept stable so existing classes don't
        // need migration; dark mode is layered on via `dark:` variants.
        ink: {
          50: '#f6f7f9',
          100: '#eceef2',
          200: '#d3d7e0',
          400: '#7a82a0',
          600: '#3f465e',
          800: '#1f2235',
          900: '#13152a',
        },
        // Dark-mode neutral scale ("inkd" = ink dark). Slate-leaning,
        // intentionally not pure black so cards have somewhere to sit
        // visually above the page background. Numbers MIRROR `ink`:
        // larger = lighter (matches how Tailwind's stock slate works in
        // dark contexts), so `dark:bg-inkd-50` is the darkest surface and
        // `dark:text-inkd-900` is the highest-contrast text.
        inkd: {
          50: '#0b1020', // page background — deepest
          100: '#111728', // primary surface (cards, toolbar, sidebar)
          200: '#1c2237', // hover / raised surface
          300: '#262d44', // borders, dividers
          400: '#3a4364', // muted borders, disabled
          500: '#5a648a', // placeholder text
          600: '#838eb4', // secondary text
          700: '#b0b7d3', // primary text (low-contrast)
          800: '#d6dbeb', // primary text (high-contrast)
          900: '#eef0f8', // headings / strongest text
        },
      },
    },
  },
  plugins: [],
};
