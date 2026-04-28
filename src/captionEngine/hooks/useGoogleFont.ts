// Dynamic Google Font loader. Maps a requested family name to the
// matching @remotion/google-fonts module, returns the CSS fontFamily
// string once loaded. Unknown families fall back to the `fallback`
// family (usually Inter from the composition's base load).
//
// Loading happens at composition-root scope by calling the hook inside
// CaptionedVideo — Remotion defers the actual render until every font
// promise resolves, so we don't see a flash of unstyled text during
// export.
//
// ┌────────────────────────────────────────────────────────────────┐
// │ SYNC CONTRACT with frontend/src/lib/fonts/catalog.js           │
// │                                                                │
// │ That file is the single source of truth for the user-facing    │
// │ font picker. Every family exposed there must also appear in    │
// │ this LOADERS map, or the picker will offer a font the          │
// │ renderer can't produce (falls back to Inter silently).         │
// │ When you add a family to the catalog, import its loader here   │
// │ AND add a LOADERS entry. No other font must live outside this  │
// │ pair.                                                          │
// └────────────────────────────────────────────────────────────────┘

import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import { loadFont as loadRoboto } from '@remotion/google-fonts/Roboto';
import { loadFont as loadMontserrat } from '@remotion/google-fonts/Montserrat';
import { loadFont as loadPoppins } from '@remotion/google-fonts/Poppins';
import { loadFont as loadBangers } from '@remotion/google-fonts/Bangers';
import { loadFont as loadLobster } from '@remotion/google-fonts/Lobster';
import { loadFont as loadPacifico } from '@remotion/google-fonts/Pacifico';
import { loadFont as loadPermanentMarker } from '@remotion/google-fonts/PermanentMarker';
import { loadFont as loadFredoka } from '@remotion/google-fonts/Fredoka';
import { loadFont as loadLilitaOne } from '@remotion/google-fonts/LilitaOne';
import { loadFont as loadPaytoneOne } from '@remotion/google-fonts/PaytoneOne';
import { loadFont as loadShrikhand } from '@remotion/google-fonts/Shrikhand';
import { loadFont as loadBungee } from '@remotion/google-fonts/Bungee';
import { loadFont as loadRighteous } from '@remotion/google-fonts/Righteous';
import { loadFont as loadDancingScript } from '@remotion/google-fonts/DancingScript';
import { loadFont as loadCaveat } from '@remotion/google-fonts/Caveat';

// Keyed by the caption_styles.base_font_family / active_word_font_family
// strings the user picks in the overlays panel. Aliases preserve the
// same names the existing ffmpeg pipeline uses so migrating fonts from
// overlays → captions is zero-touch.
//
// Each entry pairs the loader with a SUBSET options object. Without
// it, @remotion/google-fonts loads every weight (×9), every italic
// variant (×2), and every subset (×~10) for that family — a single
// Inter request fan-out hits ~63 individual woff2 fetches and
// frequently triggers Google Fonts' 429. Captions only ever render
// with weights 700 (base) / 800 (bold runs), and we only need
// Latin glyphs, so capping each load to its actually-used variants
// drops the request count by an order of magnitude.
//
// Display fonts that ship in a single weight (Bangers, Lobster,
// Pacifico, Permanent Marker, Lilita One, Paytone One, Shrikhand,
// Bungee, Righteous) accept no `weights` option — passing one would
// 404 — so we just subset their character set to latin.

// Standard subset — 99% of our usage is Latin glyphs. Drop the
// other 9 subsets (cyrillic, vietnamese, latin-ext, etc.) so each
// face request collapses to the one woff2 our renders actually need.
const LATIN: { subsets: string[] } = { subsets: ['latin'] };

// Multi-weight Latin sans / serif faces. We use 400 (italic / regular
// runs from Quill), 700 (default caption bold), 800 (rich-runs bold).
// Italic variants are loaded too because user-formatted runs can flip
// italic on a selection.
const TEXT_WEIGHTS: { weights: string[]; subsets: string[]; ital?: string[] } = {
  weights: ['400', '700', '800'],
  subsets: ['latin'],
  ital: ['0', '1'],
};

const LOADERS: Record<string, () => { fontFamily: string }> = {
  'Inter': () => loadInter('normal', TEXT_WEIGHTS),
  'Roboto': () => loadRoboto('normal', TEXT_WEIGHTS),
  'Montserrat': () => loadMontserrat('normal', TEXT_WEIGHTS),
  'Poppins': () => loadPoppins('normal', TEXT_WEIGHTS),
  // Display fonts — single weight, no italic. Latin subset only.
  'Bangers': () => loadBangers('normal', LATIN),
  'Lobster': () => loadLobster('normal', LATIN),
  'Pacifico': () => loadPacifico('normal', LATIN),
  'Permanent Marker': () => loadPermanentMarker('normal', LATIN),
  // Fredoka has weights 300-700 but we only need 700 for captions.
  'Fredoka One': () => loadFredoka('normal', { weights: ['700'], subsets: ['latin'] }),
  'Fredoka': () => loadFredoka('normal', { weights: ['700'], subsets: ['latin'] }),
  'Lilita One': () => loadLilitaOne('normal', LATIN),
  'Paytone One': () => loadPaytoneOne('normal', LATIN),
  'Shrikhand': () => loadShrikhand('normal', LATIN),
  'Bungee': () => loadBungee('normal', LATIN),
  'Righteous': () => loadRighteous('normal', LATIN),
  // Dancing Script + Caveat are script faces with multiple weights,
  // but our default-bold caption look only needs 700.
  'Dancing Script': () => loadDancingScript('normal', { weights: ['700'], subsets: ['latin'] }),
  'Caveat': () => loadCaveat('normal', { weights: ['700'], subsets: ['latin'] }),
};

// Resolve a requested family name to a CSS fontFamily string. Triggers
// the load once per family per bundle process; subsequent calls reuse
// the cached result from @remotion/google-fonts' own internals.
export function resolveGoogleFont(name: string | null | undefined, fallback: string): string {
  if (!name) return fallback;
  const loader = LOADERS[name];
  if (!loader) return fallback;
  try {
    const { fontFamily } = loader();
    return fontFamily;
  } catch {
    return fallback;
  }
}
