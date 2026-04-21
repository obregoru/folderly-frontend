// Caption style preset library (Phase 6.4). Each preset bundles a
// full caption_styles config — base font + colors + active-word
// effects + layout + entry/exit animation + reveal. Applying a preset
// is a one-click PUT to /jobs/:id/voiceover/:segmentId/caption-style.
//
// COMPOSITION MATRIX (constraints enforced in UI):
//   ✓ perWordSynced reveal + active-word effects — intended
//   ✓ entry animation + active-word effects — entry runs first, then
//     active-word takes over (Phase 5.6 rule)
//   ✗ letterSpacingCollapse entry + perLetter reveal — redundant,
//     avoid. Picker warns if both configured.
//   ✓ neonFadeIn entry + static "neon" outline on active_word_outline
//     — intended pairing, looks authentic

/**
 * @typedef {object} CaptionPreset
 * @property {string} id
 * @property {string} displayName
 * @property {string} description
 * @property {string} [thumbnailEmoji]        // simple inline preview
 * @property {object} config                  // full PUT body for caption-style endpoint
 */

/** @type {CaptionPreset[]} */
export const CAPTION_PRESETS = [
  {
    id: 'minimal-white',
    displayName: 'Minimal White',
    description: 'White text, black outline, no effects. Safe default.',
    thumbnailEmoji: '⚪',
    config: {
      base_font_family: 'Inter',
      base_font_color: '#ffffff',
      active_word_color: null,
      active_word_font_family: null,
      active_word_outline_config: { type: 'outline', color: '#000000', width: 3 },
      layout_config: null,
      entry_animation: null,
      exit_animation: null,
      reveal_config: null,
    },
  },
  {
    id: 'bold-pill',
    displayName: 'Bold Pill',
    description: 'Bold sans on a white rounded-pill background. No motion.',
    thumbnailEmoji: '💊',
    config: {
      base_font_family: 'Montserrat',
      base_font_color: '#111827',
      active_word_color: null,
      active_word_font_family: null,
      active_word_outline_config: null,
      layout_config: {
        box: { color: '#ffffff', opacity: 0.95, paddingX: 28, paddingY: 14, cornerRadius: 28 },
        lineBreak: 'auto',
        maxWidthFraction: 0.88,
      },
      entry_animation: null,
      exit_animation: null,
      reveal_config: null,
    },
  },
  {
    id: 'karaoke-yellow',
    displayName: 'Karaoke Yellow',
    description: 'Spoken word glows yellow. Classic sing-along feel.',
    thumbnailEmoji: '🎤',
    config: {
      base_font_family: 'Inter',
      base_font_color: '#ffffff',
      active_word_color: '#facc15',
      active_word_font_family: null,
      active_word_outline_config: { type: 'outline', color: '#000000', width: 3 },
      layout_config: null,
      entry_animation: null,
      exit_animation: null,
      reveal_config: null,
    },
  },
  {
    id: 'neon-karaoke',
    displayName: 'Neon Karaoke',
    description: 'Neon outline base + spoken word intensifies + neon fade-in entry.',
    thumbnailEmoji: '🌃',
    config: {
      base_font_family: 'Righteous',
      base_font_color: '#ffffff',
      active_word_color: '#f97316',
      active_word_font_family: 'Bangers',
      active_word_outline_config: { type: 'neon', color: '#f97316', width: 4, blur: 16 },
      layout_config: null,
      entry_animation: { preset: 'neonFadeIn', durationMs: 800, easing: 'easeOut' },
      exit_animation: null,
      reveal_config: null,
    },
  },
  {
    id: 'karaoke-pop',
    displayName: 'Karaoke Pop',
    description: 'All four active-word effects stacked: color + font + outline + scale pulse. Big and bouncy.',
    thumbnailEmoji: '🎉',
    config: {
      // Phase 2.7 reference preset — composes every active-word effect
      // so the combined-effect render path is exercised end-to-end.
      base_font_family: 'Inter',
      base_font_color: '#ffffff',
      active_word_color: '#facc15',
      active_word_font_family: 'Bangers',
      active_word_outline_config: { type: 'outline', color: '#000000', width: 3 },
      active_word_scale_pulse: { peakScale: 1.18, attackMs: 80, releaseMs: 140 },
      layout_config: null,
      entry_animation: null,
      exit_animation: null,
      reveal_config: null,
    },
  },
  {
    id: 'bounce-reveal',
    displayName: 'Bounce Reveal',
    description: 'Words bounce in one after another. Playful, energetic.',
    thumbnailEmoji: '🏀',
    config: {
      base_font_family: 'Fredoka',
      base_font_color: '#ffffff',
      active_word_color: null,
      active_word_font_family: null,
      active_word_outline_config: { type: 'outline', color: '#000000', width: 3 },
      layout_config: null,
      entry_animation: { preset: 'fallBounce', durationMs: 1000, easing: 'spring', staggerMs: 80 },
      exit_animation: null,
      reveal_config: { mode: 'perWord', staggerMs: 80 },
    },
  },
  {
    id: 'spoken-reveal',
    displayName: 'Spoken Reveal',
    description: 'Words appear as they are spoken + subtle color highlight.',
    thumbnailEmoji: '🗣️',
    config: {
      base_font_family: 'Poppins',
      base_font_color: '#ffffff',
      active_word_color: '#fde047',
      active_word_font_family: null,
      active_word_outline_config: { type: 'outline', color: '#000000', width: 3 },
      layout_config: null,
      entry_animation: null,
      exit_animation: null,
      reveal_config: { mode: 'perWordSynced' },
    },
  },
  {
    id: 'collapse-entry',
    displayName: 'Collapse Entry',
    description: 'Letters fly in from the edges and converge. Minimal otherwise.',
    thumbnailEmoji: '↔️',
    config: {
      base_font_family: 'Bebas Neue',
      base_font_color: '#ffffff',
      active_word_color: null,
      active_word_font_family: null,
      active_word_outline_config: { type: 'outline', color: '#000000', width: 3 },
      layout_config: null,
      entry_animation: { preset: 'letterSpacingCollapse', durationMs: 1200, easing: 'easeOut' },
      exit_animation: null,
      reveal_config: null,
    },
  },
  {
    id: 'zoom-pop',
    displayName: 'Zoom Pop',
    description: 'Text pops in from small → big. Bold display font, active color.',
    thumbnailEmoji: '💥',
    config: {
      base_font_family: 'Anton',
      base_font_color: '#ffffff',
      active_word_color: '#ef4444',
      active_word_font_family: null,
      active_word_outline_config: { type: 'outline', color: '#000000', width: 4 },
      layout_config: null,
      entry_animation: { preset: 'zoomIn', durationMs: 500, easing: 'spring' },
      exit_animation: null,
      reveal_config: null,
    },
  },
];

/** @param {string} id */
export function getCaptionPreset(id) {
  return CAPTION_PRESETS.find(p => p.id === id);
}

// Check a proposed config against the composition matrix. Returns an
// array of human-readable warnings, or [] if all good.
export function validateCompositionMatrix(config) {
  const warnings = [];
  const entryPreset = config?.entry_animation?.preset;
  const revealMode = config?.reveal_config?.mode;

  if (entryPreset === 'letterSpacingCollapse' && revealMode === 'perLetter') {
    warnings.push('Letter-collapse entry + perLetter reveal do similar things. Pick one — combining them looks busy.');
  }

  if (revealMode === 'perWordSynced' && !config?.active_word_color && !config?.active_word_font_family) {
    warnings.push('Spoken reveal usually pairs with an active-word color for extra emphasis.');
  }

  return warnings;
}
