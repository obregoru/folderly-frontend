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
    id: 'podcast-typewriter',
    displayName: 'Podcast Typewriter',
    description: 'Characters appear in lockstep with the voice, with a blinking cursor. Clean and minimal.',
    thumbnailEmoji: '⌨️',
    config: {
      base_font_family: 'JetBrains Mono',
      base_font_color: '#ffffff',
      active_word_color: '#facc15',
      active_word_font_family: null,
      active_word_outline_config: null,
      layout_config: {
        backgroundType: 'blurredBackdrop',
        blurredBackdrop: {
          blurPx: 16,
          tintColor: '#000000',
          tintOpacity: 0.35,
          paddingX: 24,
          paddingY: 12,
          cornerRadius: 10,
        },
        maxWidthFraction: 0.86,
      },
      entry_animation: null,
      exit_animation: null,
      reveal_config: { mode: 'typewriterSynced', showCursor: true },
    },
  },
  {
    id: 'slide-left-bold',
    displayName: 'Slide Left Bold',
    description: 'Bold sans slides in from the left. Simple, confident.',
    thumbnailEmoji: '➡️',
    config: {
      base_font_family: 'Montserrat',
      base_font_color: '#ffffff',
      active_word_color: null,
      active_word_font_family: null,
      active_word_outline_config: { type: 'outline', color: '#000000', width: 3 },
      layout_config: null,
      entry_animation: { preset: 'slideInLeft', durationMs: 600, easing: 'easeOut' },
      exit_animation: null,
      reveal_config: null,
    },
  },
  {
    id: 'elastic-pop',
    displayName: 'Elastic Pop',
    description: 'Caption wobbles in with a bouncy elastic scale. Great for playful content.',
    thumbnailEmoji: '🫨',
    config: {
      base_font_family: 'Fredoka',
      base_font_color: '#ffffff',
      active_word_color: null,
      active_word_font_family: null,
      active_word_outline_config: { type: 'outline', color: '#000000', width: 3 },
      active_word_scale_pulse: { peakScale: 1.12, attackMs: 80, releaseMs: 140 },
      layout_config: null,
      entry_animation: { preset: 'elasticIn', durationMs: 900, dampingRatio: 0.35 },
      exit_animation: null,
      reveal_config: null,
    },
  },
  {
    id: 'blur-in-soft',
    displayName: 'Blur In',
    description: 'Caption fades in from a soft blur to sharp focus.',
    thumbnailEmoji: '🌀',
    config: {
      base_font_family: 'Inter',
      base_font_color: '#ffffff',
      active_word_color: null,
      active_word_font_family: null,
      active_word_outline_config: null,
      layout_config: null,
      entry_animation: { preset: 'blurIn', durationMs: 700, blurPx: 20 },
      exit_animation: null,
      reveal_config: null,
    },
  },
  {
    id: 'floating-wave',
    displayName: 'Floating Wave',
    description: 'Words gently bob in a traveling wave. Continuous motion, no entry animation.',
    thumbnailEmoji: '🌊',
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
      continuous_motion: {
        preset: 'waveSine',
        params: { amplitudePx: 6, periodMs: 1400, perWordPhaseOffset: true },
      },
    },
  },
  {
    id: 'highlighter-yellow',
    displayName: 'Highlighter',
    description: 'Yellow highlighter band sweeps across the text. Clean bold sans on top.',
    thumbnailEmoji: '🖍️',
    config: {
      base_font_family: 'Inter',
      base_font_color: '#111827',
      active_word_color: null,
      active_word_font_family: null,
      active_word_outline_config: null,
      layout_config: {
        backgroundType: 'highlighter',
        highlighter: {
          color: '#facc15',
          opacity: 0.85,
          heightFraction: 0.55,
          verticalOffsetFraction: 0.18,
          sweepIn: true,
          sweepDurationMs: 450,
        },
        lineBreak: 'auto',
        maxWidthFraction: 0.9,
      },
      entry_animation: null,
      exit_animation: null,
      reveal_config: null,
    },
  },
  {
    id: 'glass-caption',
    displayName: 'Glass Caption',
    description: 'Frosted-glass backdrop blurs the video behind the caption. Works on busy footage.',
    thumbnailEmoji: '🧊',
    config: {
      base_font_family: 'Inter',
      base_font_color: '#ffffff',
      active_word_color: null,
      active_word_font_family: null,
      active_word_outline_config: null,
      layout_config: {
        backgroundType: 'blurredBackdrop',
        blurredBackdrop: {
          blurPx: 20,
          tintColor: '#000000',
          tintOpacity: 0.25,
          paddingX: 32,
          paddingY: 16,
          cornerRadius: 16,
        },
        lineBreak: 'auto',
        maxWidthFraction: 0.86,
      },
      entry_animation: null,
      exit_animation: null,
      reveal_config: null,
    },
  },
  {
    id: 'long-shadow-comic',
    displayName: 'Comic Long Shadow',
    description: 'Stacked long-shadow text for a bold comic-book feel. Active word highlights red.',
    thumbnailEmoji: '💥',
    config: {
      base_font_family: 'Bangers',
      base_font_color: '#ffffff',
      active_word_color: '#ef4444',
      active_word_font_family: null,
      active_word_outline_config: null,
      layout_config: {
        textEffect: {
          type: 'longShadow',
          params: { length: 24, angle: 45, color: '#111111' },
        },
      },
      entry_animation: null,
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
//
// Matrix authority: catalog-level documentation lives here. The
// backend renderer enforces the hard rules (e.g., active color
// suppresses text fill) as behavior, not warnings.
export function validateCompositionMatrix(config) {
  const warnings = [];
  const entryPreset = config?.entry_animation?.preset;
  const revealMode = config?.reveal_config?.mode;
  const bgType = config?.layout_config?.backgroundType;
  const hasTextFill = !!config?.layout_config?.textFill;
  const continuousPreset = config?.continuous_motion?.preset;

  if (entryPreset === 'letterSpacingCollapse' && revealMode === 'perLetter') {
    warnings.push('Letter-collapse entry + perLetter reveal do similar things. Pick one — combining them looks busy.');
  }

  if ((revealMode === 'perWordSynced' || revealMode === 'typewriterSynced')
      && !config?.active_word_color && !config?.active_word_font_family) {
    warnings.push('Speech-synced reveal usually pairs with an active-word color for extra emphasis.');
  }

  // Phase 6.5 matrix rules.
  if (bgType === 'box' && config?.layout_config?.highlighter) {
    warnings.push('Background is "box" but highlighter config is set. Only one background type renders; switch backgroundType to "highlighter" to use it.');
  }
  if (bgType === 'box' && config?.layout_config?.blurredBackdrop) {
    warnings.push('Background is "box" but blurredBackdrop config is set. Only one background type renders; switch backgroundType to "blurredBackdrop" to use it.');
  }
  if (hasTextFill && config?.active_word_color) {
    warnings.push('Text fill + active-word color: the active color overrides the fill on the spoken word (intentional, but worth knowing).');
  }
  if (continuousPreset === 'waveSine' && revealMode === 'perLetter') {
    warnings.push('Continuous wave motion + per-letter reveal can look jittery as letters fade in during the bob. Consider perWord or no reveal.');
  }

  return warnings;
}
