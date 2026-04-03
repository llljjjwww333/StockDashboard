/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#07111f',
        secondary: '#0d1a2b',
        tertiary: '#12243a',
        quaternary: '#19314d',
        border: '#213b58',
        'text-primary': '#edf4ff',
        'text-secondary': '#c8d6eb',
        'text-tertiary': '#8ea3bd',
        'text-quaternary': '#71839a',
        success: '#1ed98b',
        danger: '#ff6b6b',
        accent: '#23b5d3',
        accentSoft: '#8af3ff',
        gold: '#f5c96a',
      },
      fontFamily: {
        sans: ['Manrope', 'Segoe UI', 'sans-serif'],
        display: ['Sora', 'Manrope', 'sans-serif'],
        mono: ['JetBrains Mono', 'Consolas', 'monospace'],
      },
      boxShadow: {
        card: '0 18px 50px rgba(4, 12, 24, 0.42)',
        soft: '0 10px 28px rgba(0, 0, 0, 0.22)',
        glow: '0 0 0 1px rgba(138, 243, 255, 0.08), 0 16px 48px rgba(35, 181, 211, 0.18)',
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-in-out',
        'slide-up': 'slideUp 0.3s ease-in-out',
        'float-slow': 'floatSlow 8s ease-in-out infinite',
        'pulse-glow': 'pulseGlow 4s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        floatSlow: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        pulseGlow: {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(138, 243, 255, 0.06)' },
          '50%': { boxShadow: '0 0 0 10px rgba(138, 243, 255, 0)' },
        },
      },
    },
  },
  plugins: [],
}
