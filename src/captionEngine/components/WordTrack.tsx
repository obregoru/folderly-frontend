// Word-track renderer. Consumes a word_timings array + a caption style
// config, renders one <Word> per token with the active one styled via
// the caption style's activeWord* fields.
//
// Falls back to a single <span> of `fallbackText` when wordTimings is
// absent/empty — this preserves Phase 0's static-caption behavior for
// legacy segments that haven't been backfilled.

import React from 'react';
import { useActiveWord } from '../hooks/useActiveWord';
import type { WordTiming } from '../hooks/useActiveWord';
import { Word } from './Word';
import type { WordStyle, ActiveWordStyle, CaptionStyle, LayoutConfig, AnimationConfigShape, RevealConfig } from './styleTypes';
import {
  getAnimationPreset,
  useEntryProgress,
  useExitProgress,
  type AnimationContext,
} from '../animation/framework';
import { continuousMotionStyle } from '../animation/continuous';
// Side-effect import to register built-in continuous-motion presets
// (waveSine). Same pattern as animation/presets.
import '../animation/continuous';
import { interpolate } from 'remotion';
import { useCaptionClock } from '../runtime/captionClock';

export interface WordTrackProps {
  wordTimings?: WordTiming[];
  fallbackText: string;
  baseStyle: WordStyle;
  captionStyle?: CaptionStyle | null;
  // Phase 3 — layout config. Consumed by line-break + per-word font
  // passes in 3.3 / 3.5. Unused in 3.2 but threaded through now so the
  // prop shape is stable for the remaining sub-phases.
  layout?: LayoutConfig | null;
  // Phase 5 — entry / exit animation config. WordTrack only consumes
  // the per-word and per-char scopes; block-scope animations live on
  // AnimationWrapper one level up.
  entry?: AnimationConfigShape | null;
  exit?: AnimationConfigShape | null;
  // Phase 6 — reveal config. perLetter reveals chars on a clock,
  // perWord reveals words on a clock, perWordSynced uses word_timings.
  reveal?: RevealConfig | null;
  compositionWidth: number;
  compositionHeight: number;
}

export const WordTrack: React.FC<WordTrackProps> = ({
  wordTimings,
  fallbackText,
  baseStyle,
  captionStyle,
  layout,
  entry,
  exit,
  reveal,
  compositionWidth,
  compositionHeight,
}) => {
  const activeIdx = useActiveWord(wordTimings);
  const { nowMs, fps } = useCaptionClock();

  // Phase 5 — look up per-word / per-char scope presets; block scope
  // (handled by AnimationWrapper) returns no value here.
  const entryPreset = getAnimationPreset(entry?.preset);
  const exitPreset = getAnimationPreset(exit?.preset);
  const entryDuration = entry?.durationMs ?? 0;
  const exitDuration = exit?.durationMs ?? 0;
  const entryEasing = entry?.easing ?? 'spring';
  const exitEasing = exit?.easing ?? 'easeIn';
  const entryProgress = useEntryProgress(Math.max(1, entryDuration), entryEasing);
  const exitProgress = useExitProgress(Math.max(1, exitDuration), exitEasing);

  // Phase 5.6 — active-word effects SUPPRESSED during entry.
  // During exit they remain active (user-facing rule: the spoken word
  // should keep lighting up even as the caption fades away).
  const entryIsRunning = entry && entryDuration > 0 && entryProgress < 1;
  const effectiveActiveIdx = entryIsRunning ? null : activeIdx;

  // Which per-word / per-char preset is active for THIS frame?
  const wordPreset = (() => {
    if (entryPreset && entryPreset.scope !== 'block' && entryDuration > 0 && entryProgress < 1) return { preset: entryPreset, progress: entryProgress, config: entry };
    if (exitPreset && exitPreset.scope !== 'block' && exitDuration > 0 && exitProgress > 0) return { preset: exitPreset, progress: 1 - exitProgress, config: exit };
    return null;
  })();

  // Static-text fallback path — every legacy segment hits this.
  if (!wordTimings || wordTimings.length === 0) {
    return (
      <span style={baseStyleToCSS(baseStyle)}>{fallbackText}</span>
    );
  }

  // Build the activeStyle object once per render — most word instances
  // skip it (only `isActive` gets a merged style applied).
  const activeStyle: ActiveWordStyle = {
    color: captionStyle?.activeWordColor || undefined,
    fontFamily: captionStyle?.activeWordFontFamily || undefined,
    outline: captionStyle?.activeWordOutlineConfig || undefined,
  };

  // Phase 2.6 — scale pulse config. Passed into every Word; Word short-
  // circuits when null, so the prop is cheap to always hand down.
  const scalePulse = captionStyle?.activeWordScalePulse || null;

  // Phase 3.8 — image/video-filled text. Same pattern as scale pulse:
  // null short-circuits inside Word, so threading it unconditionally
  // costs nothing when the feature is off.
  const textFill = layout?.textFill || null;

  // Phase 5.8 — continuous motion. Computed per-word below and applied
  // as a wrapper-span transform. Composes additively with entry/exit
  // transforms (the entry wrapper sits ABOVE this one in the DOM, so
  // browser transform stacking compounds translateYs cleanly).
  const continuousMotion = captionStyle?.continuousMotion || null;

  // Phase 3.5 — per-word font override map (wordIndex as string → family).
  // The overriding family must already be resolved to a CSS fontFamily
  // string by the composition root (so it's in the loaded font set).
  // When a word is both overridden AND active, the active font swap
  // (from Phase 2.4) wins while isActive=true, then reverts to the
  // override when the next word activates — verified by the Phase 2.5
  // precedence contract in Word.tsx.
  const perWord = layout?.perWordFontOverrides || null;

  const totalWords = wordTimings.length;

  // Phase 6.1–6.3 — reveal visibility. Three modes:
  //   perLetter: absolute letter index across the whole caption controls
  //              when that letter's opacity starts ramping up.
  //   perWord:   same idea at word granularity (clock-driven).
  //   perWordSynced: each word fades in starting at its word_timings
  //              start_ms. Falls back to perWord if timings missing.
  //
  // wordStartLetter[i] = the absolute letter index at which word i
  // begins. Lets perLetter reveal respect line flow (top-to-bottom,
  // then left-to-right within each line — the browser's inline flow
  // naturally renders in that order, so sequential letter indices
  // already map to the visual order).
  const wordStartLetter: number[] = [];
  let letterCount = 0;
  for (const w of wordTimings) {
    wordStartLetter.push(letterCount);
    letterCount += [...w.word].length;
  }

  const revealMode = reveal?.mode || null;
  // perWordSynced needs word_timings — we already know they exist
  // (early-return above catches empty case), but we also flag a
  // fallback when the caller set perWordSynced on a legacy segment
  // with only text.
  const revealDurationMs = reveal?.durationMs ?? 800;
  const revealStaggerMs = reveal?.staggerMs ?? 40;
  // Per-unit reveal window (ms) during which opacity ramps 0→1.
  const REVEAL_UNIT_WINDOW_MS = 150;

  function revealOpacityForWord(wordIndex: number, charIndex: number | null): number {
    if (!revealMode) return 1;
    if (revealMode === 'perWordSynced') {
      // 120ms fade-in starting at word's start_ms. TS needs the nullish
      // guard here even though the enclosing function only runs after
      // the early-return on empty wordTimings.
      const w = wordTimings ? wordTimings[wordIndex] : null;
      if (!w) return 1;
      return interpolate(nowMs, [w.startMs - 120, w.startMs], [0, 1], {
        extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
      });
    }
    // Phase 6.4 — typewriterSynced: characters appear in lockstep with
    // audio, spread evenly across the parent word's [start_ms, end_ms]
    // interval. Hard cut per char (no fade) — classic typewriter feel.
    // Fallback: no word timings → behave like perLetter on the clock
    // (caller warned via console; see revealNeedsCharacterSplit logic
    // for char-splitting requirement below).
    if (revealMode === 'typewriterSynced') {
      const w = wordTimings ? wordTimings[wordIndex] : null;
      if (!w) {
        const absIdx = wordStartLetter[wordIndex] + (charIndex ?? 0);
        const defaultCharMs = 60;
        return nowMs >= absIdx * defaultCharMs ? 1 : 0;
      }
      // Distribute the chars of this word evenly across its duration.
      const chars = [...w.word];
      const ci = charIndex ?? 0;
      // Empty word edge case — shouldn't happen but guard for NaN.
      if (chars.length === 0) return 1;
      const perCharMs = Math.max(1, (w.endMs - w.startMs) / chars.length);
      const charStart = w.startMs + ci * perCharMs;
      return nowMs >= charStart ? 1 : 0;
    }
    if (revealMode === 'perWord') {
      // Left-to-right: word i reveals at i * staggerMs.
      const start = wordIndex * revealStaggerMs;
      return interpolate(nowMs, [start, start + REVEAL_UNIT_WINDOW_MS], [0, 1], {
        extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
      });
    }
    // perLetter: every character's absolute index controls its start.
    const absIdx = wordStartLetter[wordIndex] + (charIndex ?? 0);
    const start = absIdx * revealStaggerMs;
    return interpolate(nowMs, [start, start + REVEAL_UNIT_WINDOW_MS], [0, 1], {
      extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    });
  }

  // Log-once warning for perWordSynced without timings. (The early
  // return above already covers the case where wordTimings is empty,
  // but a fresh segment fetched with empty timings still hits this.)
  // Phase 6.4 — typewriterSynced also needs char-level splitting so
  // each character can flip opacity independently.
  const revealNeedsCharacterSplit = revealMode === 'perLetter' || revealMode === 'typewriterSynced';

  // Phase 6.4 — which word is currently being "typed"? Used by
  // CharAnimatedWord to decide where to paint the cursor. The cursor
  // sits on the word whose [startMs, endMs] interval contains nowMs;
  // before the first word it's hidden, after the last it disappears.
  const showCursor = revealMode === 'typewriterSynced' && (reveal?.showCursor !== false);
  const typingWordIndex = showCursor && wordTimings
    ? (() => {
        for (let i = 0; i < wordTimings.length; i++) {
          const w = wordTimings[i];
          if (nowMs >= w.startMs && nowMs < w.endMs) return i;
        }
        return -1;
      })()
    : -1;

  return (
    <>
      {wordTimings.map((w, i) => {
        const overrideFamily = perWord ? perWord[String(w.wordIndex)] : null;
        const wordBaseStyle = overrideFamily
          ? { ...baseStyle, fontFamily: overrideFamily }
          : baseStyle;

        // Phase 5 — figure out this word's animation contribution.
        let wordAnimStyle: React.CSSProperties | null = null;
        let renderCharacters = false;
        if (wordPreset) {
          const { preset, progress, config } = wordPreset;
          const baseCtx: AnimationContext & { staggerMs?: number; totalMs?: number } = {
            wordIndex: w.wordIndex,
            totalWords,
            frameRate: fps,
            compositionWidth,
            compositionHeight,
            staggerMs: (config?.staggerMs as number | undefined),
            totalMs: (entryIsRunning ? entryDuration : exitDuration) || 600,
          };
          if (preset.scope === 'per-word') {
            wordAnimStyle = preset.apply(progress, baseCtx);
          } else if (preset.scope === 'per-char') {
            renderCharacters = !!preset.wantsCharacters;
          }
        }

        // Phase 6 — if perLetter reveal is active, we need per-char
        // spans with individualized opacity. If an animation preset
        // also wants characters (letterSpacingCollapse), we merge
        // both: the animation style + the per-char reveal opacity.
        const splitChars = renderCharacters || revealNeedsCharacterSplit;

        const wordReveal = !revealMode
          ? 1
          : (revealMode === 'perLetter' ? 1 /* per-char opacities */ : revealOpacityForWord(w.wordIndex, null));

        let wordNode: React.ReactNode;
        if (splitChars) {
          wordNode = (
            <CharAnimatedWord
              word={w.word}
              preset={renderCharacters && wordPreset ? wordPreset.preset : null}
              progress={renderCharacters && wordPreset ? wordPreset.progress : 1}
              wordIndex={w.wordIndex}
              totalWords={totalWords}
              fps={fps}
              compositionWidth={compositionWidth}
              compositionHeight={compositionHeight}
              isActive={effectiveActiveIdx === w.wordIndex}
              baseStyle={wordBaseStyle}
              activeStyle={activeStyle}
              scalePulse={scalePulse}
              textFill={textFill}
              startMs={w.startMs}
              revealOpacityFn={(revealMode === 'perLetter' || revealMode === 'typewriterSynced')
                ? (charIdx: number) => revealOpacityForWord(w.wordIndex, charIdx)
                : null}
              cursorCharIndex={
                // Phase 6.4 — pin the cursor to the next un-revealed
                // char on the currently-typing word. -1 when the
                // cursor should be hidden (not typing, or not this
                // word's turn).
                typingWordIndex === i
                  ? (() => {
                      const chars = [...w.word];
                      for (let c = 0; c < chars.length; c++) {
                        if (revealOpacityForWord(w.wordIndex, c) < 1) return c;
                      }
                      return -1;
                    })()
                  : -1
              }
              cursorBlinkNowMs={showCursor ? nowMs : 0}
            />
          );
        } else {
          wordNode = (
            <Word
              word={w.word}
              wordIndex={w.wordIndex}
              startMs={w.startMs}
              endMs={w.endMs}
              isActive={effectiveActiveIdx === w.wordIndex}
              baseStyle={wordBaseStyle}
              activeStyle={activeStyle}
              scalePulse={scalePulse}
              textFill={textFill}
            />
          );
        }

        // Compose wrappers: outermost applies animation preset style
        // (per-word scope); inner applies reveal opacity (perWord /
        // perWordSynced). perLetter applies opacity per-char inside
        // CharAnimatedWord, so the outer wrapper keeps full opacity.
        //
        // Phase 5.8/5.9 — continuous motion sits BETWEEN the entry/
        // exit per-word wrapper and the reveal wrapper. That order
        // matters: if the continuous transform is inside the entry
        // wrapper, a scaling entry would also scale the wave amplitude
        // (we don't want that — amplitude is specified in absolute px).
        // By putting continuousMotionStyle in its own wrapper at this
        // depth, translateYs compound additively while scale-based
        // entry presets stay unaffected by the wave height.
        const wrappers: React.CSSProperties[] = [];
        if (wordAnimStyle) wrappers.push(wordAnimStyle);
        const contStyle = continuousMotion
          ? continuousMotionStyle(continuousMotion, {
              wordIndex: w.wordIndex,
              totalWords,
              nowMs,
            })
          : null;
        if (contStyle) wrappers.push(contStyle);
        if (revealMode && revealMode !== 'perLetter') wrappers.push({ opacity: wordReveal });

        let rendered: React.ReactNode = wordNode;
        for (const s of wrappers) {
          rendered = <span style={s}>{rendered}</span>;
        }

        return (
          <React.Fragment key={w.wordIndex}>
            {rendered}
            {/*
              Inter-word space. A bare " " text node looked fine in
              the browser preview but sometimes collapsed in the
              Remotion / headless-Chrome export — words like "look at
              what they made" rendered as "lookatwhatthey made". The
              cause is whitespace handling between display:inline-block
              siblings (every Word turns inline-block as soon as
              scalePulse fires or an animation/continuous wrapper sets
              display:inline-block) under specific font-load timings.
              An explicit inline-block span with a 0.25em width gives
              the same visual gap and never collapses, while leaving
              wrapping behavior intact (the parent still has
              whiteSpace:'normal').
            */}
            {i < totalWords - 1 && (
              <span
                aria-hidden="true"
                style={{ display: 'inline-block', width: '0.4em' }}
              >&nbsp;</span>
            )}
          </React.Fragment>
        );
      })}
    </>
  );
};

// Per-character variant used when a preset declares wantsCharacters.
// Each character becomes its own span with a preset-computed transform,
// but the whole word still delegates active-word styling to <Word> so
// Phase 2 effects keep working once the entry settles.
function CharAnimatedWord({
  word, preset, progress, wordIndex, totalWords, fps,
  compositionWidth, compositionHeight, isActive, baseStyle, activeStyle,
  scalePulse, textFill, startMs,
  revealOpacityFn,
  cursorCharIndex,
  cursorBlinkNowMs,
}: {
  word: string;
  preset: import('../animation/framework').AnimationPreset | null;
  progress: number;
  wordIndex: number;
  totalWords: number;
  fps: number;
  compositionWidth: number;
  compositionHeight: number;
  isActive: boolean;
  baseStyle: WordStyle;
  activeStyle: ActiveWordStyle;
  // Phase 2.6 — scale pulse. Applied on the outer <Word>, so all
  // per-char spans scale together around the word's center.
  scalePulse: import('./styleTypes').ActiveWordScalePulse | null;
  // Phase 3.8 — image/video-filled text. Applied at the word level so
  // the fill aligns with the actual glyphs; chars inherit via the
  // background-clip:text cascade on their parent <Word>.
  textFill: import('./styleTypes').TextFillConfig | null;
  startMs: number;
  // Phase 6.1 — per-letter reveal. Absent means no per-char opacity.
  revealOpacityFn: ((charIndex: number) => number) | null;
  // Phase 6.4 — typewriter cursor position (the index of the NEXT
  // char to appear). -1 means no cursor on this word.
  cursorCharIndex: number;
  // Composition-time ms used to drive the cursor's blink. 0 = no
  // cursor (rendering fully suppresses the element).
  cursorBlinkNowMs: number;
}) {
  const chars = [...word];
  const charCount = chars.length;
  return (
    <Word
      word=""
      wordIndex={wordIndex}
      startMs={startMs}
      endMs={0}
      isActive={isActive}
      baseStyle={baseStyle}
      activeStyle={activeStyle}
      scalePulse={scalePulse}
      textFill={textFill}
    >
      {chars.map((ch, i) => {
        let css: React.CSSProperties = { display: 'inline-block' };
        if (preset) {
          css = { ...css, ...preset.apply(progress, {
            wordIndex, totalWords, charIndex: i, charCount,
            frameRate: fps, compositionWidth, compositionHeight,
          }) };
        }
        if (revealOpacityFn) {
          const revealOp = revealOpacityFn(i);
          // Compose opacities multiplicatively so a preset that already
          // sets opacity (e.g., letterSpacingCollapse) doesn't get
          // overridden — its value dims further as the reveal ramps up.
          const existing = typeof css.opacity === 'number' ? css.opacity : 1;
          css.opacity = existing * revealOp;
          // Small scale nudge during reveal so letters pop in rather
          // than a hard opacity cut.
          if (revealOp < 1) {
            const revealScale = 0.6 + 0.4 * revealOp;
            const priorTransform = typeof css.transform === 'string' ? css.transform : '';
            css.transform = `${priorTransform} scale(${revealScale})`.trim();
          }
        }
        // Phase 6.4 — typewriter cursor. Inserted BEFORE the char at
        // cursorCharIndex so it appears to sit at the "next letter to
        // type" position. Blinks via a 500ms square wave driven by
        // the composition clock so the cadence is deterministic
        // across renders.
        const cursor = (cursorCharIndex === i && cursorBlinkNowMs > 0)
          ? <TypewriterCursor key={`cursor-${i}`} nowMs={cursorBlinkNowMs} />
          : null;
        return (
          <React.Fragment key={i}>
            {cursor}
            <span style={css}>{ch}</span>
          </React.Fragment>
        );
      })}
    </Word>
  );
}

function baseStyleToCSS(b: WordStyle): React.CSSProperties {
  return {
    color: b.color,
    fontFamily: b.fontFamily,
    fontSize: b.fontSize,
    fontWeight: b.fontWeight ?? 700,
    textShadow: b.textShadow,
  };
}

// Phase 6.4 — typewriter cursor. A thin vertical bar that blinks at
// ~500ms cadence. Blink cadence is driven by the composition clock
// so the cursor state is deterministic frame-to-frame (no Date.now /
// random phase between renders).
//
// Sized relative to the current font via `1em` so it scales with
// whatever baseStyle the word inherits. No hooks — blink state is
// derived purely from the nowMs prop.
const TypewriterCursor: React.FC<{ nowMs: number }> = ({ nowMs }) => {
  const visible = Math.floor(nowMs / 500) % 2 === 0;
  return (
    <span
      style={{
        display: 'inline-block',
        width: '0.06em',
        height: '1em',
        verticalAlign: 'text-bottom',
        marginBottom: '-0.05em',
        background: 'currentColor',
        opacity: visible ? 1 : 0,
      }}
      aria-hidden="true"
    />
  );
};
