// Phase 3.6 — translate a TextEffectConfig into a CSS text-shadow
// string. Kept separate so CaptionLayer can use it for base text and
// Word.tsx can compose it with active-word outlines on top.
//
// All four types emit comma-separated text-shadow entries, so the
// active-word outline (Word.tsx, Phase 2.5) can append its own layers
// without blowing away the base effect — a readability requirement
// from the Phase 3.6 acceptance ("base text shadow, then active-word
// outline additionally layered on when active").

import type { TextEffectConfig } from './styleTypes';

export function textEffectToShadow(effect: TextEffectConfig | null | undefined): string | undefined {
  if (!effect) return undefined;
  const p = effect.params || {};
  switch (effect.type) {
    case 'dropShadow': {
      const x = num(p.x, 0);
      const y = num(p.y, 4);
      const blur = num(p.blur, 8);
      const color = str(p.color, 'rgba(0,0,0,0.85)');
      const opacity = typeof p.opacity === 'number' ? clamp01(p.opacity) : null;
      const resolved = opacity != null ? withAlpha(color, opacity) : color;
      return `${x}px ${y}px ${blur}px ${resolved}`;
    }
    case 'longShadow': {
      // Stacked shadows offset progressively along an angle. 30 layers
      // at 1px increments = clean long-shadow look without blowing up
      // render time on normal caption lengths.
      const length = Math.max(4, Math.min(80, num(p.length, 30)));
      const angle = num(p.angle, 45);
      const color = str(p.color, '#000000');
      const rad = (angle * Math.PI) / 180;
      const dx = Math.cos(rad);
      const dy = Math.sin(rad);
      const layers: string[] = [];
      for (let i = 1; i <= Math.round(length); i++) {
        layers.push(`${(dx * i).toFixed(1)}px ${(dy * i).toFixed(1)}px 0 ${color}`);
      }
      return layers.join(', ');
    }
    case 'dualShadow': {
      // Two offset duplicates in contrasting colors — glitchy Y2K
      // look. Shape: { primary: {x,y,color}, secondary: {x,y,color} }.
      const primary = (p.primary as Record<string, unknown>) || {};
      const secondary = (p.secondary as Record<string, unknown>) || {};
      const px = num(primary.x, 3);
      const py = num(primary.y, 3);
      const pc = str(primary.color, '#00ffff');
      const sx = num(secondary.x, -3);
      const sy = num(secondary.y, -3);
      const sc = str(secondary.color, '#ff00ff');
      return `${px}px ${py}px 0 ${pc}, ${sx}px ${sy}px 0 ${sc}`;
    }
    case 'sticker3d': {
      const offset = num(p.offset, 4);
      const color = str(p.color, '#111111');
      // Solid tight offset duplicate underneath for a pressed-button
      // look. Zero blur keeps the edge crisp.
      return `${offset}px ${offset}px 0 ${color}`;
    }
  }
  return undefined;
}

// Layer active-word outline on top of a base text-shadow. When both
// exist, comma-join so the browser paints both. When only one exists,
// just that one. Used by Word.tsx to preserve the base text effect
// during active-word outline.
export function composeShadows(base: string | undefined, activeOutline: string | undefined): string | undefined {
  if (base && activeOutline) return `${activeOutline}, ${base}`;
  return activeOutline || base || undefined;
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
function str(v: unknown, fallback: string): string {
  return typeof v === 'string' && v ? v : fallback;
}
function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
// Best-effort alpha application — only covers the #rrggbb case, which
// is what users will paste from color pickers. For rgb()/rgba() input
// we return as-is (the caller's explicit opacity wins via their own
// alpha in the string).
function withAlpha(color: string, opacity: number): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${opacity})`;
  }
  return color;
}
