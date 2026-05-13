// Tailwind directives are emitted into globals.css via @tailwind base /
// components / utilities. The survey UI is mostly raw CSS keyed off design
// tokens (see src/styles/tokens.css), so we only expose those tokens as
// Tailwind colours/fonts/spacing in case a future utility wants them.
const cssVar = (name) => `var(--${name})`;

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: cssVar('bg'),
        surface: cssVar('surface'),
        'surface-2': cssVar('surface-2'),
        text: cssVar('text'),
        'text-strong': cssVar('text-strong'),
        muted: cssVar('muted'),
        action: cssVar('action'),
        'action-ink': cssVar('action-ink'),
        gold: cssVar('gold'),
        cobalt: cssVar('cobalt'),
        sage: cssVar('sage'),
        amber: cssVar('amber'),
        vermillion: cssVar('vermillion'),
        border: cssVar('border'),
        'border-strong': cssVar('border-strong'),
      },
      fontFamily: {
        display: ['var(--display)'],
        body: ['var(--body)'],
        ui: ['var(--ui)'],
        mono: ['var(--mono)'],
      },
      spacing: {
        gap: 'var(--gap)',
        row: 'var(--row)',
        pad: 'var(--pad)',
      },
      boxShadow: {
        lift: 'var(--shadow-lift)',
      },
    },
  },
  plugins: [],
};
