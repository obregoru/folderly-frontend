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
const LOADERS: Record<string, () => { fontFamily: string }> = {
  'Inter': loadInter,
  'Roboto': loadRoboto,
  'Montserrat': loadMontserrat,
  'Poppins': loadPoppins,
  'Bangers': loadBangers,
  'Lobster': loadLobster,
  'Pacifico': loadPacifico,
  'Permanent Marker': loadPermanentMarker,
  'Fredoka One': loadFredoka,
  'Fredoka': loadFredoka,
  'Lilita One': loadLilitaOne,
  'Paytone One': loadPaytoneOne,
  'Shrikhand': loadShrikhand,
  'Bungee': loadBungee,
  'Righteous': loadRighteous,
  'Dancing Script': loadDancingScript,
  'Caveat': loadCaveat,
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
