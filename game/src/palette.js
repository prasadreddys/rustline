// The look plan, in one place. A dusk industrial yard: warm sand and rust under a
// cooling sky, ember orange for the attackers, teal for the defenders. The same
// names are the CSS custom properties in index.html.
export const PALETTE = {
  canvas: '#14100c',
  surface: '#2a2118',
  ground: '#7d6a50',
  wall: '#5d4a36',
  crate: '#7a5c38',
  container: '#37505a',
  ink: '#f2ead9',
  muted: '#a89a83',
  accent: '#ff7a2f',
  teal: '#2fd8c8',
  danger: '#e5484d',
};

export function shade(name) {
  return PALETTE[name];
}
