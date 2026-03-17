/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        cream: '#FAF8F4',
        ink: '#1A1814',
        sage: { DEFAULT: '#5C7A62', light: '#EBF0EC' },
        terra: { DEFAULT: '#C4714E', light: '#F7EAE3' },
        border: '#E2DDD6',
        muted: '#7A756F',
        tk: '#2D9A5E',
        ig: '#B5318A',
        fb: '#1877F2',
        tw: '#000000',
        gb: '#4285F4',
        blog: '#E67E22',
      },
      fontFamily: {
        sans: ['"DM Sans"', 'sans-serif'],
        serif: ['"DM Serif Display"', 'serif'],
      },
      borderRadius: {
        DEFAULT: '10px',
        sm: '7px',
      },
    },
  },
  plugins: [],
}
