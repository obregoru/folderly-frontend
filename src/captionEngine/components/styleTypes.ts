// Shared style shapes used by <Word> and <WordTrack>. Keeping them in
// their own file avoids circular imports when the renderer (Phase 2.3+)
// builds a CaptionStyle from a /caption_styles row.

export interface WordStyle {
  color: string;
  fontFamily: string;
  fontSize: number;
  fontWeight?: number;
  textShadow?: string;
}

export interface ActiveWordOutlineConfig {
  type: 'outline' | 'glow' | 'neon';
  color: string;
  width?: number; // pixels
  blur?: number;  // glow/neon spread
}

export interface ActiveWordStyle {
  color?: string;
  fontFamily?: string;
  outline?: ActiveWordOutlineConfig;
}

// Phase 3 — layout config shapes. Stored as JSONB on
// caption_styles.layout_config. All fields optional; absence = no
// layout feature applied for that dimension.
export interface BoxConfig {
  color: string;        // hex or CSS color for the pill fill
  opacity?: number;     // 0..1, default 1
  paddingX?: number;    // px at 1080p, scaled by composition size
  paddingY?: number;    // px at 1080p, scaled by composition size
  cornerRadius?: number; // px at 1080p, scaled by composition size
}

export interface VerticalBoxConfig {
  heightPx: number;     // target fixed vertical region at 1080p
  maxLines?: number;    // hard cap; text past this is truncated (docs)
}

// Phase 3.6 — static text effect applied to base text. Active-word
// outline (Phase 2.5) layers on top; base effect is preserved and
// the active outline is merged via comma-separated text-shadow.
export type TextEffectType = 'dropShadow' | 'longShadow' | 'dualShadow' | 'sticker3d';
export interface TextEffectConfig {
  type: TextEffectType;
  // Shape varies by type. Kept loose here; Word.tsx translates to CSS.
  //   dropShadow:  { x, y, blur, color, opacity? }
  //   longShadow:  { length, angle, color }     // angle in degrees
  //   dualShadow:  { primary: {x,y,color}, secondary: {x,y,color} }
  //   sticker3d:   { offset, color }            // xy offset in px
  params?: Record<string, unknown>;
}

// Phase 3.7 — alternative caption background treatments. `box` stays
// the Phase 3.2 pill; `highlighter` is a per-line colored band through
// the text's midline; `blurredBackdrop` is a frosted-glass panel.
export type BackgroundType = 'box' | 'highlighter' | 'blurredBackdrop';

export interface HighlighterConfig {
  color: string;
  opacity?: number;                // default 0.7
  heightFraction?: number;         // 0..1 of line height, default 0.55
  verticalOffsetFraction?: number; // 0..1 shift of the band, default 0.15
  sweepIn?: boolean;               // animate left-to-right at start
  sweepDurationMs?: number;        // default 400
}

export interface BlurredBackdropConfig {
  blurPx?: number;                 // default 20
  tintColor?: string;              // default #000000
  tintOpacity?: number;            // 0..1, default 0.25
  paddingX?: number;               // px at 1080p, default 24
  paddingY?: number;               // px at 1080p, default 12
  cornerRadius?: number;           // px at 1080p, default 12
}

// Phase 3.8 — image/video-filled text. Fill type 'video' is gated on
// SVG-mask support in headless Chrome and is specced but not wired in
// this phase (v1 = image only per the Phase 3.8 risk note). The field
// is parsed so existing caption_styles carrying 'video' don't crash.
export interface TextFillConfig {
  type: 'image' | 'video';
  url: string;
  fit?: 'cover' | 'contain';
  opacity?: number;                // 0..1, default 1
}

export interface LayoutConfig {
  box?: BoxConfig | null;
  lineBreak?: 'auto' | 'manual';
  maxWidthFraction?: number;           // 0..1 of composition width
  verticalBox?: VerticalBoxConfig | null;
  perWordFontOverrides?: Record<string, string> | null; // wordIndex(string) → family
  // 3.6 / 3.7 / 3.8 additions — all additive + nullable.
  textEffect?: TextEffectConfig | null;
  backgroundType?: BackgroundType | null;  // absent + box present = 'box' (back-compat)
  highlighter?: HighlighterConfig | null;
  blurredBackdrop?: BlurredBackdropConfig | null;
  textFill?: TextFillConfig | null;
}

// Validate + normalize a JSONB layout_config coming off the DB. Unknown
// fields are dropped, out-of-range numbers clamped. Returns null when
// the input is fundamentally invalid so the composition can skip the
// layout pass entirely.
export function normalizeLayoutConfig(raw: unknown): LayoutConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const out: LayoutConfig = {};

  if (r.box && typeof r.box === 'object') {
    const b = r.box as Record<string, unknown>;
    if (typeof b.color === 'string') {
      out.box = {
        color: b.color,
        opacity: clamp01(b.opacity, 1),
        paddingX: clampPos(b.paddingX, 24),
        paddingY: clampPos(b.paddingY, 12),
        cornerRadius: clampPos(b.cornerRadius, 16),
      };
    }
  }
  if (r.lineBreak === 'auto' || r.lineBreak === 'manual') out.lineBreak = r.lineBreak;
  if (typeof r.maxWidthFraction === 'number') {
    out.maxWidthFraction = Math.min(1, Math.max(0.2, r.maxWidthFraction));
  }
  if (r.verticalBox && typeof r.verticalBox === 'object') {
    const v = r.verticalBox as Record<string, unknown>;
    if (typeof v.heightPx === 'number' && v.heightPx > 0) {
      out.verticalBox = {
        heightPx: Math.round(v.heightPx),
        maxLines: typeof v.maxLines === 'number' && v.maxLines > 0 ? Math.round(v.maxLines) : 3,
      };
    }
  }
  if (r.perWordFontOverrides && typeof r.perWordFontOverrides === 'object') {
    const m: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.perWordFontOverrides as Record<string, unknown>)) {
      if (typeof v === 'string' && /^\d+$/.test(k)) m[k] = v;
    }
    if (Object.keys(m).length > 0) out.perWordFontOverrides = m;
  }

  // Phase 3.6 — text effect. Params shape varies by type; we keep it
  // loose and let Word.tsx do the CSS translation with its own
  // per-type defaults. Only gate on a known type string.
  if (r.textEffect && typeof r.textEffect === 'object') {
    const t = r.textEffect as Record<string, unknown>;
    const typeOk = t.type === 'dropShadow' || t.type === 'longShadow' ||
      t.type === 'dualShadow' || t.type === 'sticker3d';
    if (typeOk) {
      out.textEffect = {
        type: t.type as TextEffectType,
        params: (t.params && typeof t.params === 'object') ? (t.params as Record<string, unknown>) : {},
      };
    }
  }

  // Phase 3.7 — background type discriminator. Back-compat: if
  // backgroundType is absent but a box is present, treat as 'box'.
  // When backgroundType is 'box' we also expect a box config (already
  // normalized above); for 'highlighter' / 'blurredBackdrop' we read
  // their respective config blocks.
  if (r.backgroundType === 'box' || r.backgroundType === 'highlighter' ||
      r.backgroundType === 'blurredBackdrop') {
    out.backgroundType = r.backgroundType;
  } else if (out.box && !r.backgroundType) {
    out.backgroundType = 'box';
  }
  if (r.highlighter && typeof r.highlighter === 'object') {
    const h = r.highlighter as Record<string, unknown>;
    if (typeof h.color === 'string') {
      out.highlighter = {
        color: h.color,
        opacity: clamp01(h.opacity, 0.7),
        heightFraction: clamp01(h.heightFraction, 0.55),
        verticalOffsetFraction: clamp01(h.verticalOffsetFraction, 0.15),
        sweepIn: h.sweepIn === true,
        sweepDurationMs: typeof h.sweepDurationMs === 'number' && h.sweepDurationMs > 0
          ? Math.round(h.sweepDurationMs) : 400,
      };
    }
  }
  if (r.blurredBackdrop && typeof r.blurredBackdrop === 'object') {
    const b = r.blurredBackdrop as Record<string, unknown>;
    out.blurredBackdrop = {
      blurPx: typeof b.blurPx === 'number' && b.blurPx >= 0 ? b.blurPx : 20,
      tintColor: typeof b.tintColor === 'string' ? b.tintColor : '#000000',
      tintOpacity: clamp01(b.tintOpacity, 0.25),
      paddingX: clampPos(b.paddingX, 24),
      paddingY: clampPos(b.paddingY, 12),
      cornerRadius: clampPos(b.cornerRadius, 12),
    };
  }

  // Phase 3.8 — text fill. Video fill is parsed but wired only at the
  // 'image' path; 'video' falls through to treat-as-image in Word.tsx
  // (passes the url as a background image). Spec calls out SVG-mask
  // compositing as follow-up work.
  if (r.textFill && typeof r.textFill === 'object') {
    const f = r.textFill as Record<string, unknown>;
    if ((f.type === 'image' || f.type === 'video') && typeof f.url === 'string' && f.url) {
      out.textFill = {
        type: f.type,
        url: f.url,
        fit: f.fit === 'contain' ? 'contain' : 'cover',
        opacity: clamp01(f.opacity, 1),
      };
    }
  }

  return out;
}

function clamp01(v: unknown, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(1, Math.max(0, v));
}
function clampPos(v: unknown, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return fallback;
  return v;
}

// Phase 5 — entry / exit animation config. Shape is generic so a
// single JSONB column can carry any preset's knobs (staggerMs,
// preset-specific overshoot, etc.) without schema churn per preset.
export interface AnimationConfigShape {
  preset: string;
  durationMs?: number;
  easing?: 'spring' | 'easeIn' | 'easeOut' | 'linear';
  staggerMs?: number;
  [k: string]: unknown;
}

export function normalizeAnimationConfig(raw: unknown): AnimationConfigShape | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.preset !== 'string' || !r.preset) return null;
  const out: AnimationConfigShape = { preset: r.preset };
  if (typeof r.durationMs === 'number' && r.durationMs > 0 && r.durationMs < 10000) {
    out.durationMs = Math.round(r.durationMs);
  }
  if (r.easing === 'spring' || r.easing === 'easeIn' || r.easing === 'easeOut' || r.easing === 'linear') {
    out.easing = r.easing;
  }
  if (typeof r.staggerMs === 'number' && r.staggerMs >= 0) {
    out.staggerMs = Math.round(r.staggerMs);
  }
  // Pass-through any other preset-specific knobs as-is. Presets that
  // care about them validate at apply-time.
  for (const k of Object.keys(r)) {
    if (!(k in out) && k !== 'preset') out[k] = r[k];
  }
  return out;
}

// Phase 6 — reveal config. Four modes:
//   perLetter:        left-to-right letter reveal on an animation clock
//   perWord:          left-to-right word reveal on an animation clock
//   perWordSynced:    each word appears at its word_timings.start_ms
//   typewriterSynced: characters appear in lockstep with audio, spread
//                     across each word's [start_ms, end_ms] interval —
//                     classic typewriter aesthetic, hard cut per char.
//                     Falls back to perLetter when word timings missing.
export type RevealMode = 'perLetter' | 'perWord' | 'perWordSynced' | 'typewriterSynced';

export interface RevealConfig {
  mode: RevealMode;
  durationMs?: number;  // ignored by perWordSynced + typewriterSynced
  staggerMs?: number;   // ignored by perWordSynced + typewriterSynced
  // Phase 6.4 — typewriter cursor. Default true. Ignored outside
  // typewriterSynced mode.
  showCursor?: boolean;
}

export function normalizeRevealConfig(raw: unknown): RevealConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const mode = r.mode;
  if (mode !== 'perLetter' && mode !== 'perWord' &&
      mode !== 'perWordSynced' && mode !== 'typewriterSynced') return null;
  const out: RevealConfig = { mode };
  if (typeof r.durationMs === 'number' && r.durationMs > 0 && r.durationMs < 15000) {
    out.durationMs = Math.round(r.durationMs);
  }
  if (typeof r.staggerMs === 'number' && r.staggerMs >= 0) {
    out.staggerMs = Math.round(r.staggerMs);
  }
  // Default true — the cursor is the defining visual of the mode.
  // Only respect explicit false.
  out.showCursor = r.showCursor !== false;
  return out;
}

// Phase 2.6 — one-shot scale pulse on activation. The pulse runs
// attackMs up to peakScale, then releaseMs back to 1.0, then holds at
// 1.0 for the rest of the word's active window. Computed via explicit
// frame math in Word.tsx rather than CSS transitions (spec: CSS
// transitions on transform are flaky across frame boundaries).
export interface ActiveWordScalePulse {
  peakScale: number;   // typical 1.10–1.25; > 1.5 looks cartoony
  attackMs: number;    // ramp-up duration
  releaseMs: number;   // ramp-down duration
}

// Phase 5.8 — continuous (looping) motion for the whole caption
// lifetime. Separate from entry/exit animations because the lifecycle
// is different: runs every frame the caption is visible, composes
// additively with entry/exit transforms. Per-word scope only — block
// motion would feel like the whole frame moved.
export interface ContinuousMotionConfig {
  preset: string;
  params?: Record<string, unknown>;
}

// Specific shape for 'waveSine' preset params — kept exported so the
// frontend can type its catalog configs against it.
export interface WaveSineParams {
  amplitudePx?: number;           // default 6
  periodMs?: number;              // default 1200
  perWordPhaseOffset?: boolean;   // default false; true = traveling wave
}

// The full caption_styles row shape the renderer consumes. Either loaded
// from the caption_styles table by (job_uuid, segment_id) or passed
// inline via the /video/render endpoint.
export interface CaptionStyle {
  baseFontFamily?: string | null;
  baseFontColor?: string | null;
  baseFontSize?: number | null;
  activeWordColor?: string | null;
  activeWordFontFamily?: string | null;
  activeWordOutlineConfig?: ActiveWordOutlineConfig | null;
  activeWordScalePulse?: ActiveWordScalePulse | null;
  layoutConfig?: LayoutConfig | null;
  entryAnimation?: AnimationConfigShape | null;
  exitAnimation?: AnimationConfigShape | null;
  revealConfig?: RevealConfig | null;
  // Phase 5.8 — continuous motion (e.g. waveSine). Runs every frame
  // the caption is visible, composes additively with entry/exit.
  continuousMotion?: ContinuousMotionConfig | null;
}

// Normalize a JSONB continuous_motion off the DB. Returns null for
// missing / unknown preset so the composition cleanly skips the
// per-word motion pass.
export function normalizeContinuousMotion(raw: unknown): ContinuousMotionConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.preset !== 'string' || !r.preset) return null;
  return {
    preset: r.preset,
    params: (r.params && typeof r.params === 'object') ? (r.params as Record<string, unknown>) : {},
  };
}
