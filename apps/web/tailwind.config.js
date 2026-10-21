/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'deep-slate': '#090D16',
        'surface': {
          DEFAULT: '#0F1626',
          muted: '#131C31',
          border: '#1E293B',
          hover: '#1B2742',
        },
        'semantic': {
          emerald: '#10B981',
          amber: '#F59E0B',
          crimson: '#F43F5E',
          cyan: '#06B6D4',
        },
        emerald: {
          DEFAULT: '#10B981',
          glow: 'rgba(16, 185, 129, 0.15)',
        },
        amber: {
          DEFAULT: '#F59E0B',
          glow: 'rgba(245, 158, 11, 0.15)',
        },
        crimson: {
          DEFAULT: '#F43F5E',
          glow: 'rgba(244, 63, 94, 0.15)',
        },
        cyan: {
          DEFAULT: '#06B6D4',
          glow: 'rgba(6, 182, 212, 0.15)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
};
