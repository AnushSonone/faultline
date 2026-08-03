// Mirrors the :root color tokens in styles.css. Guarded by tokens.test.ts.
// Mutable on purpose: applyLightTheme() swaps the values in place so canvas
// renderers (cytoscape, d3) that read COLORS at draw time pick up the theme.
export const COLORS: Record<
  | "bg"
  | "panel"
  | "border"
  | "borderStrong"
  | "fg"
  | "muted"
  | "faint"
  | "accent"
  | "ok"
  | "warn"
  | "danger"
  | "dangerSoft",
  string
> = {
  bg: "#0b0e14",
  panel: "#121824",
  border: "#232e42",
  borderStrong: "#33415c",
  fg: "#e7edf5",
  muted: "#8e9bae",
  faint: "#5d6b80",
  accent: "#4da3ff",
  ok: "#45c06d",
  warn: "#e8b93e",
  danger: "#e5604f",
  dangerSoft: "#ffb4a8",
};

// Mirrors the [data-theme="light"] color tokens in styles.css.
export const COLORS_LIGHT: Record<keyof typeof COLORS, string> = {
  bg: "#ffffff",
  panel: "#ffffff",
  border: "#d8dee7",
  borderStrong: "#b9c3d0",
  fg: "#101418",
  muted: "#5a6572",
  faint: "#8a93a0",
  accent: "#1d63d8",
  ok: "#1e8e4b",
  warn: "#9a6d00",
  danger: "#c0392b",
  dangerSoft: "#8c2a1e",
};

export function applyLightTheme() {
  Object.assign(COLORS, COLORS_LIGHT);
}
