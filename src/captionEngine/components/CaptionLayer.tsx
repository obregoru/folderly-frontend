// Lower-third caption stack, extracted from CaptionedVideo so the
// Phase-7 "FinalRender" composition can drop it over the FFmpeg-
// composed final video without duplicating the entire composition.
//
// Renders the Phase 2–6 tree:
//   AnimationWrapper → (optional) VerticalFit → CaptionBox → WordTrack
//
// Standalone <AbsoluteFill> so it overlays whatever is below it. The
// parent composition (CaptionedVideo, FinalRender, or future Player
// embeds) just needs to mount this component — positioning, sizing,
// and the full effect stack live here.

import React from 'react';
import { AbsoluteFill } from 'remotion';
import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import type { WordTiming } from '../hooks/useActiveWord';
import { resolveGoogleFont } from '../hooks/useGoogleFont';
import { WordTrack } from './WordTrack';
import { CaptionBox } from './CaptionBox';
import { CaptionHighlighter } from './CaptionHighlighter';
import { CaptionBackdrop } from './CaptionBackdrop';
import { VerticalFit } from './VerticalFit';
import { AnimationWrapper } from '../animation/AnimationWrapper';
import { normalizeLayoutConfig } from './styleTypes';
import { textEffectToShadow } from './textEffects';
import type { CaptionStyle, WordStyle } from './styleTypes';
// Make sure every registered preset is available when a consumer of
// CaptionLayer is used outside CaptionedVideo.
import '../animation/presets';

// Subset Inter to weights / italic variants we actually use, latin
// only. Default loadInter() pulls every weight × every italic ×
// every subset (~63 woff2 requests) which trips Google Fonts' 429
// limit on warm-cache reload.
const { fontFamily: defaultFontFamily } = loadInter('normal', {
  weights: ['400', '700', '800'],
  subsets: ['latin'],
  ital: ['0', '1'],
});

export interface CaptionLayerProps {
  text: string;
  width: number;
  height: number;
  wordTimings?: WordTiming[];
  captionStyle?: CaptionStyle | null;
  // topPct default picks lower-third for vertical, lower-center for
  // square. Consumers can override if they need a different anchor.
  topPct?: number;
}

export const CaptionLayer: React.FC<CaptionLayerProps> = ({
  text, width, height, wordTimings, captionStyle, topPct,
}) => {
  const minDim = Math.min(width, height);
  // User-authored baseFontSize is specified "at 1080 reference width".
  // Scale to the actual composition width so preview (e.g. 400 px) and
  // server render (1080 px) show the same proportion of the frame.
  // Without this scale, a user-set 60 px showed as 15% of the preview
  // width but only 5.5% of the 1080-wide final render — so the preview
  // looked huge compared to what downloaded.
  const widthScale = width / 1080;
  const baseFontSize = Math.round(
    captionStyle?.baseFontSize != null
      ? captionStyle.baseFontSize * widthScale
      : minDim * 0.055
  );

  const layout = normalizeLayoutConfig(captionStyle?.layoutConfig);
  // Vertical position precedence:
  //   1. explicit topPct prop (consumer override)
  //   2. layoutConfig.verticalPosition (authored per caption style)
  //   3. aspect-ratio default (72% for vertical, 78% for square)
  const configuredPct = typeof layout?.verticalPosition === 'number'
    ? layout.verticalPosition : null;
  const finalTopPct = typeof topPct === 'number' ? topPct
    : (configuredPct != null ? configuredPct : (height > width ? 72 : 78));
  const boxScale = width / 1080;

  // Resolve fonts at root so all referenced families are loaded before
  // Remotion emits frames.
  const baseFamily = resolveGoogleFont(captionStyle?.baseFontFamily, defaultFontFamily);
  const activeFamilyRequested = captionStyle?.activeWordFontFamily || null;
  const activeFamilyResolved =
    activeFamilyRequested && activeFamilyRequested !== captionStyle?.baseFontFamily
      ? resolveGoogleFont(activeFamilyRequested, baseFamily)
      : null;

  // Phase 3.6 — when a textEffect is configured, it replaces the
  // generic drop-shadow we default to for readability. Absent effect
  // falls back to the same default so legacy captions look identical.
  const baseTextShadow = textEffectToShadow(layout?.textEffect)
    || '0 2px 4px rgba(0,0,0,0.85), 0 0 8px rgba(0,0,0,0.6)';
  // Base outline (applies to EVERY word, not just the active one).
  // Lives in layout_config.baseOutline. Same shape as the
  // active-word outline so the math reuses fourWayOutline / glow.
  // Composes onto baseTextShadow so a configured textEffect still
  // renders, plus the outline reads cleanly on top.
  const baseOutlineShadow = baseOutlineToShadow((layout as any)?.baseOutline);
  const composedBaseShadow = baseOutlineShadow
    ? `${baseTextShadow}, ${baseOutlineShadow}`
    : baseTextShadow;

  const baseStyle: WordStyle = {
    color: captionStyle?.baseFontColor || '#ffffff',
    fontFamily: baseFamily,
    fontSize: baseFontSize,
    fontWeight: 700,
    textShadow: composedBaseShadow,
  };
  const resolvedCaptionStyle: CaptionStyle | null | undefined = captionStyle
    ? { ...captionStyle, activeWordFontFamily: activeFamilyResolved }
    : captionStyle;
  const resolvedLayout = layout ? { ...layout } : null;
  if (resolvedLayout?.perWordFontOverrides) {
    const next: Record<string, string> = {};
    for (const [k, family] of Object.entries(resolvedLayout.perWordFontOverrides)) {
      next[k] = resolveGoogleFont(family, baseFamily);
    }
    resolvedLayout.perWordFontOverrides = next;
  }

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {/*
        Horizontal centering uses left:50% + translateX(-50%) rather
        than flex alignItems:center + padding. The flex path depended
        on a right-edge constraint (right:0 on AbsoluteFill's default
        style) competing with width:100% + percentage padding, and in
        some layouts (flex-1 video container with max-h-clamped aspect
        ratio) it resolved to a small left bias. Explicit 50%/-50%
        centering sidesteps all of that and is independent of the
        AbsoluteFill style order.
      */}
      <div
        style={{
          position: 'absolute',
          top: `${finalTopPct}%`,
          left: '50%',
          transform: 'translateX(-50%)',
          width: '88%',
          maxWidth: '88%',
          pointerEvents: 'none',
          // textAlign: center on a block-level wrapper centers EACH
          // line independently within the wrapper's inline formatting
          // context. The previous flex+align-items:center path shrunk
          // the inner block to its max-line width and then centered
          // that shrunk block — which caused shorter lines (line 1)
          // to appear left/right-biased relative to the visible wrapper
          // (because they were only centered within the shrunk block,
          // not within the full wrapper).
          textAlign: 'center',
        }}
      >
      <AnimationWrapper
        entry={captionStyle?.entryAnimation}
        exit={captionStyle?.exitAnimation}
        width={width}
        height={height}
      >
        <div
          style={{
            textAlign: 'center',
            lineHeight: 1.2,
            maxWidth: `${(layout?.maxWidthFraction ?? 0.92) * 100}%`,
            // margin:0 auto centers this block within its parent when
            // maxWidth makes it narrower than the parent. Without
            // this, a block with maxWidth:X% is left-aligned, so the
            // textAlign:center here was centering text within a LEFT-
            // ANCHORED box — producing the slight leftward bias the
            // user saw.
            marginLeft: 'auto',
            marginRight: 'auto',
            whiteSpace: layout?.lineBreak === 'manual' ? 'pre-wrap' : 'normal',
            // Break long words rather than overflowing the 9:16 frame
            // when the user sets a large baseFontSize (e.g. 140 + a
            // 12-char word like "bachelorette" was punching past the
            // ~88% maxWidth wrapper). word-break:break-word is a
            // superset of overflow-wrap:break-word; both are set so
            // Chromium / WebKit / Safari all honor it.
            overflowWrap: 'break-word',
            wordBreak: 'break-word',
          }}
        >
          {(() => {
            // Phase 3.7 — single background picker used for both the
            // verticalBox and plain branches so adding types only
            // requires editing one place. Back-compat: when
            // backgroundType is absent but a `box` config is present,
            // normalizeLayoutConfig defaults backgroundType to 'box'.
            const wordTrack = (
              <WordTrack
                wordTimings={wordTimings}
                fallbackText={text}
                baseStyle={baseStyle}
                captionStyle={resolvedCaptionStyle}
                layout={resolvedLayout}
                entry={captionStyle?.entryAnimation}
                exit={captionStyle?.exitAnimation}
                reveal={captionStyle?.revealConfig}
                compositionWidth={width}
                compositionHeight={height}
              />
            );
            let wrapped: React.ReactNode;
            const bgType = layout?.backgroundType || null;
            if (bgType === 'highlighter' && layout?.highlighter) {
              wrapped = <CaptionHighlighter config={layout.highlighter}>{wordTrack}</CaptionHighlighter>;
            } else if (bgType === 'blurredBackdrop' && layout?.blurredBackdrop) {
              wrapped = <CaptionBackdrop config={layout.blurredBackdrop} scale={boxScale}>{wordTrack}</CaptionBackdrop>;
            } else {
              // 'box' (explicit or implied) and the null case both
              // flow through CaptionBox — it's a no-op when box is
              // null, so legacy captions pass through untouched.
              wrapped = <CaptionBox box={layout?.box} scale={boxScale}>{wordTrack}</CaptionBox>;
            }
            if (layout?.verticalBox) {
              return (
                <VerticalFit
                  heightPx={layout.verticalBox.heightPx}
                  maxLines={layout.verticalBox.maxLines}
                  scale={boxScale}
                >
                  {wrapped}
                </VerticalFit>
              );
            }
            return wrapped;
          })()}
        </div>
      </AnimationWrapper>
      </div>
    </AbsoluteFill>
  );
};

// Build a textShadow string from a baseOutline config. Mirrors the
// active-word outline math in Word.tsx (fourWayOutline + glow) so the
// two outlines look identical when configured the same. Returns null
// when the config is absent / disabled, so the caller can keep the
// default drop shadow untouched.
function baseOutlineToShadow(cfg: any): string | null {
  if (!cfg || typeof cfg !== 'object' || !cfg.color) return null;
  const color = String(cfg.color);
  const width = Math.max(1, Math.round(Number(cfg.width) || 3));
  const blur = Math.max(0, Math.round(Number(cfg.blur) || 0));
  const fourWay: string[] = [];
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      if (x === 0 && y === 0) continue;
      fourWay.push(`${x * width}px ${y * width}px 0 ${color}`);
    }
  }
  if (cfg.type === 'neon') {
    const b = Math.max(1, blur || width * 2);
    const stroke = `${Math.max(1, Math.round(width * 0.5)) * 1}px 0 0 ${color}`;
    const strokes: string[] = [];
    const halfW = Math.max(1, Math.round(width * 0.5));
    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        if (x === 0 && y === 0) continue;
        strokes.push(`${x * halfW}px ${y * halfW}px 0 ${color}`);
      }
    }
    const glow = [
      `0 0 ${Math.round(b * 0.5)}px ${color}`,
      `0 0 ${b}px ${color}`,
      `0 0 ${Math.round(b * 1.8)}px ${color}`,
    ].join(', ');
    return [strokes.join(', '), glow].join(', ');
  }
  return fourWay.join(', ');
}
