// Font catalog — single source of truth for every font the app exposes.
//
// TO ADD OR REMOVE A FONT: edit this file. Nothing else.
//
// The backend's Remotion font loader (remotion/hooks/useGoogleFont.ts)
// has its own parallel mapping because it must statically import each
// @remotion/google-fonts module. Any new family added here must ALSO be
// added to that file — a comment at the top of useGoogleFont.ts pins
// this contract. If the two lists drift, the picker will show a font
// that the renderer can't actually use; validate with the live list
// at `/api/t/:slug/fonts/catalog` (Phase 4.1 endpoint).
//
// License: every entry here is a Google Fonts family whose OFL or
// Apache 2.0 license permits commercial use royalty-free. If you're
// unsure, leave it off — we'd rather a small catalog than a license
// surprise.

/**
 * @typedef {object} CatalogFont
 * @property {string} family
 * @property {'sans-serif'|'serif'|'display'|'handwriting'|'monospace'} category
 * @property {number[]} weights
 * @property {boolean} popular        pinned to "Popular" filter by default
 * @property {'commercial'} licensedFor
 * @property {string} [previewText]   optional per-font sample override
 */

/** @type {CatalogFont[]} */
export const FONT_CATALOG = [
  // ───────────────── sans-serif (workhorses) ─────────────────
  { family: 'Inter',          category: 'sans-serif', weights: [400, 500, 700, 900], popular: true,  licensedFor: 'commercial' },
  { family: 'Roboto',         category: 'sans-serif', weights: [400, 500, 700, 900], popular: true,  licensedFor: 'commercial' },
  { family: 'Open Sans',      category: 'sans-serif', weights: [400, 600, 700, 800], popular: true,  licensedFor: 'commercial' },
  { family: 'Montserrat',     category: 'sans-serif', weights: [400, 600, 700, 900], popular: true,  licensedFor: 'commercial' },
  { family: 'Poppins',        category: 'sans-serif', weights: [400, 500, 700, 900], popular: true,  licensedFor: 'commercial' },
  { family: 'Lato',           category: 'sans-serif', weights: [400, 700, 900],      popular: false, licensedFor: 'commercial' },
  { family: 'Work Sans',      category: 'sans-serif', weights: [400, 600, 700],      popular: false, licensedFor: 'commercial' },
  { family: 'DM Sans',        category: 'sans-serif', weights: [400, 500, 700],      popular: false, licensedFor: 'commercial' },
  { family: 'Nunito',         category: 'sans-serif', weights: [400, 700, 900],      popular: false, licensedFor: 'commercial' },
  { family: 'Rubik',          category: 'sans-serif', weights: [400, 500, 700, 900], popular: false, licensedFor: 'commercial' },
  { family: 'Barlow',         category: 'sans-serif', weights: [400, 600, 700],      popular: false, licensedFor: 'commercial' },
  { family: 'Archivo',        category: 'sans-serif', weights: [400, 600, 700],      popular: false, licensedFor: 'commercial' },
  { family: 'Outfit',         category: 'sans-serif', weights: [400, 600, 700, 900], popular: false, licensedFor: 'commercial' },
  { family: 'Plus Jakarta Sans', category: 'sans-serif', weights: [400, 600, 700],   popular: false, licensedFor: 'commercial' },
  { family: 'Manrope',        category: 'sans-serif', weights: [400, 600, 700, 800], popular: false, licensedFor: 'commercial' },

  // ───────────────── serif ─────────────────
  { family: 'Playfair Display', category: 'serif', weights: [400, 700, 900], popular: true,  licensedFor: 'commercial' },
  { family: 'Merriweather',     category: 'serif', weights: [400, 700, 900], popular: false, licensedFor: 'commercial' },
  { family: 'Lora',             category: 'serif', weights: [400, 600, 700], popular: false, licensedFor: 'commercial' },
  { family: 'DM Serif Display', category: 'serif', weights: [400],           popular: true,  licensedFor: 'commercial' },
  { family: 'Cormorant Garamond', category: 'serif', weights: [400, 600, 700], popular: false, licensedFor: 'commercial' },
  { family: 'Crimson Text',     category: 'serif', weights: [400, 700],      popular: false, licensedFor: 'commercial' },
  { family: 'EB Garamond',      category: 'serif', weights: [400, 600, 700], popular: false, licensedFor: 'commercial' },
  { family: 'Bitter',           category: 'serif', weights: [400, 700, 900], popular: false, licensedFor: 'commercial' },
  { family: 'Spectral',         category: 'serif', weights: [400, 600, 700], popular: false, licensedFor: 'commercial' },

  // ───────────────── display (posters, hero captions) ─────────────────
  { family: 'Bangers',        category: 'display', weights: [400], popular: true,  licensedFor: 'commercial', previewText: 'WHAM! POW!' },
  { family: 'Bungee',         category: 'display', weights: [400], popular: true,  licensedFor: 'commercial' },
  { family: 'Righteous',      category: 'display', weights: [400], popular: true,  licensedFor: 'commercial' },
  { family: 'Fredoka',        category: 'display', weights: [400, 600, 700], popular: true,  licensedFor: 'commercial' },
  { family: 'Lilita One',     category: 'display', weights: [400], popular: false, licensedFor: 'commercial' },
  { family: 'Paytone One',    category: 'display', weights: [400], popular: false, licensedFor: 'commercial' },
  { family: 'Shrikhand',      category: 'display', weights: [400], popular: false, licensedFor: 'commercial', previewText: 'Shrikhand!' },
  { family: 'Black Ops One',  category: 'display', weights: [400], popular: false, licensedFor: 'commercial', previewText: 'MISSION READY' },
  { family: 'Alfa Slab One',  category: 'display', weights: [400], popular: false, licensedFor: 'commercial' },
  { family: 'Anton',          category: 'display', weights: [400], popular: true,  licensedFor: 'commercial', previewText: 'HEADLINE' },
  { family: 'Bebas Neue',     category: 'display', weights: [400], popular: true,  licensedFor: 'commercial', previewText: 'BEBAS NEUE' },
  { family: 'Russo One',      category: 'display', weights: [400], popular: false, licensedFor: 'commercial' },
  { family: 'Oswald',         category: 'display', weights: [400, 600, 700], popular: true,  licensedFor: 'commercial', previewText: 'OSWALD' },
  { family: 'Ultra',          category: 'display', weights: [400], popular: false, licensedFor: 'commercial' },

  // ───────────────── handwriting / script ─────────────────
  { family: 'Lobster',        category: 'handwriting', weights: [400], popular: true,  licensedFor: 'commercial', previewText: 'Fresh lobster roll' },
  { family: 'Pacifico',       category: 'handwriting', weights: [400], popular: true,  licensedFor: 'commercial', previewText: 'Beach day vibes' },
  { family: 'Dancing Script', category: 'handwriting', weights: [400, 700], popular: false, licensedFor: 'commercial', previewText: 'Save the date' },
  { family: 'Caveat',         category: 'handwriting', weights: [400, 700], popular: false, licensedFor: 'commercial', previewText: 'A quick note…' },
  { family: 'Permanent Marker', category: 'handwriting', weights: [400], popular: true, licensedFor: 'commercial', previewText: 'Sharpie energy' },
  { family: 'Kalam',          category: 'handwriting', weights: [400, 700], popular: false, licensedFor: 'commercial' },
  { family: 'Patrick Hand',   category: 'handwriting', weights: [400], popular: false, licensedFor: 'commercial' },
  { family: 'Satisfy',        category: 'handwriting', weights: [400], popular: false, licensedFor: 'commercial', previewText: 'Just right' },
  { family: 'Great Vibes',    category: 'handwriting', weights: [400], popular: false, licensedFor: 'commercial', previewText: 'Invitation' },
  { family: 'Kaushan Script', category: 'handwriting', weights: [400], popular: false, licensedFor: 'commercial', previewText: 'Signature' },

  // ───────────────── monospace (for code-adjacent captions) ─────────────────
  { family: 'JetBrains Mono', category: 'monospace', weights: [400, 700], popular: false, licensedFor: 'commercial', previewText: 'const caption = "hi"' },
  { family: 'Fira Code',      category: 'monospace', weights: [400, 700], popular: false, licensedFor: 'commercial', previewText: 'x => x + 1' },
  { family: 'Source Code Pro', category: 'monospace', weights: [400, 700], popular: false, licensedFor: 'commercial' },
  { family: 'IBM Plex Mono',  category: 'monospace', weights: [400, 700], popular: false, licensedFor: 'commercial' },
];

/** Categories the picker filters by, in display order. */
export const CATEGORIES = ['sans-serif', 'serif', 'display', 'handwriting', 'monospace'];

/** Quick family-name lookup for validation at write-sites. */
const FAMILY_SET = new Set(FONT_CATALOG.map(f => f.family));

/** @param {string|null|undefined} family @returns {boolean} */
export function isCatalogFamily(family) {
  return !!family && FAMILY_SET.has(family);
}

/** @param {string|null|undefined} family @returns {CatalogFont|undefined} */
export function getCatalogFont(family) {
  return FONT_CATALOG.find(f => f.family === family);
}

/** Sample text shown in a font tile. Prefers the font's override. */
export function sampleTextFor(font) {
  if (font.previewText) return font.previewText;
  if (font.category === 'display' || font.category === 'handwriting') {
    return 'The quick brown fox';
  }
  if (font.category === 'monospace') return 'for (let x of xs) …';
  return 'The quick brown fox jumps over';
}
