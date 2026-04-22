// CaptionedVideo — single-segment composition (source video + segment
// audio + one caption layer). Platform variants (vertical / square)
// in Phase 0.3 wrap this with the right width/height/duration.
//
// The caption-rendering logic moved to <CaptionLayer> in Phase 7 so
// the new <FinalRender> composition can stack multiple caption layers
// over a single background video. Everything here is just the thin
// video/audio/optional-debug shell around one <CaptionLayer> instance.

import React from 'react';
import { AbsoluteFill, Audio, OffthreadVideo } from 'remotion';
import { useActiveWord } from '../hooks/useActiveWord';
import type { WordTiming } from '../hooks/useActiveWord';
import { CaptionLayer } from '../components/CaptionLayer';
import type { CaptionStyle } from '../components/styleTypes';
import { RemotionClockProvider } from '../runtime/captionClock';

export type { WordTiming };

export interface CaptionedVideoProps {
  videoUrl: string;
  audioUrl: string;
  text: string;
  width: number;
  height: number;
  wordTimings?: WordTiming[];
  debug?: boolean;
  captionStyle?: CaptionStyle | null;
}

export const CaptionedVideo: React.FC<CaptionedVideoProps> = ({
  videoUrl,
  audioUrl,
  text,
  width,
  height,
  wordTimings,
  debug,
  captionStyle,
}) => {
  return (
    <RemotionClockProvider width={width} height={height}>
      <CaptionedVideoInner
        videoUrl={videoUrl}
        audioUrl={audioUrl}
        text={text}
        width={width}
        height={height}
        wordTimings={wordTimings}
        debug={debug}
        captionStyle={captionStyle}
      />
    </RemotionClockProvider>
  );
};

// useActiveWord needs to run INSIDE the provider, so split inner body
// into a child component that the provider wraps.
const CaptionedVideoInner: React.FC<CaptionedVideoProps> = ({
  videoUrl, audioUrl, text, width, height, wordTimings, debug, captionStyle,
}) => {
  const activeIdx = useActiveWord(wordTimings);
  const activeWord =
    activeIdx != null && wordTimings ? wordTimings[activeIdx]?.word : null;

  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      {/* OffthreadVideo pulls each frame via ffmpeg so server-side
          renders don't stutter — the <video> element in headless
          Chrome drops frames under load, which was Phase 2's choppy
          output bug. */}
      <OffthreadVideo
        src={videoUrl}
        muted
        style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center' }}
      />
      <Audio src={audioUrl} />

      <CaptionLayer
        text={text}
        width={width}
        height={height}
        wordTimings={wordTimings}
        captionStyle={captionStyle}
      />

      {debug && (
        <AbsoluteFill
          style={{
            pointerEvents: 'none',
            alignItems: 'flex-start',
            justifyContent: 'flex-start',
            padding: 24,
          }}
        >
          <div
            style={{
              fontFamily: 'ui-monospace, Menlo, monospace',
              fontSize: Math.round(Math.min(width, height) * 0.022),
              lineHeight: 1.35,
              color: '#10b981',
              background: 'rgba(0,0,0,0.72)',
              padding: '8px 12px',
              borderRadius: 6,
              whiteSpace: 'pre',
            }}
          >
            {`phase-6 debug\n` +
              `words: ${wordTimings?.length ?? 0}\n` +
              `active: ${activeIdx ?? 'none'}\n` +
              `"${activeWord ?? '—'}"`}
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
