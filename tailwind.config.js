/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Bright, vibrant space-arcade palette.
        bg:       '#1b4a8f',
        panel:    'rgba(60, 104, 168, 0.78)',
        ink:      '#f3f9ff',
        dim:      '#c4d6f0',
        cyan:     '#1fd9ff',
        sky:      '#5cc2ff',
        orange:   '#ff9a45',
        green:    '#39e9a6',
        yellow:   '#ffd84d',
        red:      '#ff6b86',
        purple:   '#bb8bff',
        pink:     '#ff8ad0',
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
