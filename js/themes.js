// Colour themes. A theme is 8 colours; everything else in newtab.css is derived from them with color-mix().
//   settings.theme        : 'auto' | 'light' | 'dark' | <id of a custom theme>
//   settings.customThemes : [{ id, name, colors }]
export const COLOR_KEYS = [
  ['pageBg', 'Page background'],
  ['folderBg', 'Folder background'],
  ['text', 'Text'],
  ['muted', 'Secondary text'],
  ['accent', 'Accent'],
  ['surface', 'Panels & menus'],
  ['field', 'Inputs & bars'],
  ['label', 'Tile caption'],
  ['thumbBg', 'Tile background'],
];
export const PRESETS = {
  dark: { name: 'Dark', colors: { pageBg: '#2b2b30', text: '#e8e8ec', muted: '#a6a6b0', accent: '#7b83f5', surface: '#2a2a2f', field: '#1f1f24', label: '#2f2f34', thumbBg: '#3b3b3b' } },
  light: { name: 'Light', colors: { pageBg: '#eceef3', text: '#1d1d22', muted: '#6a6a75', accent: '#5560e8', surface: '#ffffff', field: '#f1f2f6', label: '#f2f2f2', thumbBg: '#ffffff' } },
};
const VARS = { pageBg: '--page-bg', text: '--fg', muted: '--muted', accent: '--accent', surface: '--surface', field: '--field', label: '--label', thumbBg: '--thumb-bg', folderBg: '--folder-bg' };

export const isDarkOs = () => matchMedia('(prefers-color-scheme: dark)').matches;
const lum = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
};
export const newId = () => 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

// -> { id (what is really used: 'auto' becomes light or dark), colors, scheme }
export function resolve(s) {
  let id = s.theme || 'auto';
  if (id === 'auto') id = isDarkOs() ? 'dark' : 'light';
  const custom = (s.customThemes || []).find((t) => t.id === id);
  if (!custom && !PRESETS[id]) id = 'dark';
  const colors = custom ? { ...PRESETS.dark.colors, ...custom.colors } : PRESETS[id].colors;
  const full = { ...colors, folderBg: colors.folderBg || colors.pageBg };   // the folder window follows the page background unless set
  return { id, colors: full, scheme: lum(full.text) > 0.5 ? 'dark' : 'light' };   // light text -> dark theme
}

let last = null;
export function apply(s) {
  last = s;
  const { colors, scheme } = resolve(s), root = document.documentElement, vars = {};
  for (const k in VARS) { root.style.setProperty(VARS[k], colors[k]); vars[VARS[k]] = colors[k]; }
  root.style.colorScheme = scheme;                         // native controls, scrollbars and select popups follow the theme
  root.dataset.scheme = scheme;
  try { localStorage.setItem('msd-theme', JSON.stringify({ vars, scheme })); } catch {}   // read by theme-boot.js to avoid a flash
}
// "Auto" follows the browser: re-apply when its light / dark mode changes
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (last && (last.theme || 'auto') === 'auto') apply(last); });
