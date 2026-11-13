import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

// Design tokens live as CSS variables in src/index.css; Tailwind only maps
// names to them. One palette: deep navy, charcoal ink, warm off-white paper
// and a single restrained amber accent.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: { center: true, padding: '1.5rem' },
    extend: {
      fontFamily: {
        sans: ['"Manrope Variable"', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['"JetBrains Mono Variable"', 'ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
      colors: {
        canvas: 'hsl(var(--canvas))',
        surface: 'hsl(var(--surface))',
        subtle: 'hsl(var(--subtle))',
        ink: {
          DEFAULT: 'hsl(var(--ink))',
          muted: 'hsl(var(--ink-muted))',
          faint: 'hsl(var(--ink-faint))',
        },
        line: {
          DEFAULT: 'hsl(var(--line))',
          strong: 'hsl(var(--line-strong))',
        },
        navy: {
          DEFAULT: 'hsl(var(--navy))',
          raised: 'hsl(var(--navy-raised))',
          line: 'hsl(var(--navy-line))',
          text: 'hsl(var(--navy-text))',
          muted: 'hsl(var(--navy-muted))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          strong: 'hsl(var(--accent-strong))',
          soft: 'hsl(var(--accent-soft))',
        },
        success: { DEFAULT: 'hsl(var(--success))', soft: 'hsl(var(--success-soft))' },
        danger: { DEFAULT: 'hsl(var(--danger))', soft: 'hsl(var(--danger-soft))' },
        warning: { DEFAULT: 'hsl(var(--warning))', soft: 'hsl(var(--warning-soft))' },
        info: { DEFAULT: 'hsl(var(--info))', soft: 'hsl(var(--info-soft))' },
      },
      borderRadius: {
        lg: '10px',
        md: '6px',
        sm: '4px',
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      boxShadow: {
        overlay: '0 12px 32px -8px hsl(220 40% 10% / 0.18), 0 2px 6px hsl(220 40% 10% / 0.06)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'rise-in': { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
        'rise-in': 'rise-in 180ms ease-out',
      },
    },
  },
  plugins: [animate],
} satisfies Config;
