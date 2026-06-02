/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg:       '#0a1726',
        panel:    'rgba(25, 45, 70, 0.72)',
        ink:      '#e8f4ff',
        dim:      '#8aa0b5',
        cyan:     '#00e5ff',
        orange:   '#ff8a3d',
        green:    '#2ee59d',
        yellow:   '#ffd54a',
        red:      '#ff5577',
        purple:   '#b070ff',
      },
      fontFamily: {
        pixel:   ['var(--font-pixel)', '"Press Start 2P"', 'monospace'],
        display: ['var(--font-pixel)', '"Press Start 2P"', 'monospace'],
      },
      backdropBlur: {
        xs: '4px',
      },
    },
  },
  plugins: [],
};
