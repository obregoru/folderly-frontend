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

const { fontFamily: defaultFontFamily } = loadInter();

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
  const baseFontSize = Math.round((captionStyle?.baseFontSize ?? minDim * 0.055));
  const finalTopPct = typeof topPct === 'number' ? topPct : (height > width ? 72 : 78);

  const layout = normalizeLayoutConfig(captionStyle?.layoutConfig);
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

  const baseStyle: WordStyle = {
    color: captionStyle?.baseFontColor || '#ffffff',
    fontFamily: baseFamily,
    fontSize: baseFontSize,
    fontWeight: 700,
    textShadow: baseTextShadow,
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
    <AbsoluteFill
      style={{
        top: `${finalTopPct}%`,
        alignItems: 'center',
        justifyContent: 'flex-start',
        padding: '0 6%',
        pointerEvents: 'none',
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
            whiteSpace: layout?.lineBreak === 'manual' ? 'pre-wrap' : 'normal',
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
    </AbsoluteFill>
  );
};
