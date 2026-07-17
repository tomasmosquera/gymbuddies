export const colors = {
  background: '#0B0F14',
  surface: '#161C24',
  surfaceAlt: '#1F2733',
  border: '#2A3441',
  text: '#F5F7FA',
  textMuted: '#9AA7B5',
  primary: '#3DDC97',
  primaryText: '#04140D',
  danger: '#FF6B6B',
  warning: '#FFB454',
  success: '#3DDC97',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radii = {
  sm: 8,
  md: 12,
  lg: 20,
  pill: 999,
} as const;

export const typography = {
  title: { fontSize: 28, fontWeight: '700' as const },
  heading: { fontSize: 20, fontWeight: '600' as const },
  body: { fontSize: 16, fontWeight: '400' as const },
  caption: { fontSize: 13, fontWeight: '400' as const },
};
