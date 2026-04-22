// Composition registry. Phase 0.3 registers the two platform variants
// the backend render endpoint will resolve by id:
//   - "vertical" → 1080×1920 (Reels / TikTok / Shorts / Stories)
//   - "square"   → 1080×1080 (feed posts)
//
// Both wrap CaptionedVideo. The backend (Phase 0.4+) overrides every
// prop via selectComposition({ inputProps }) and renderMedia(), so the
// defaultProps here are only meaningful inside Studio during local
// development.
import React from 'react';
import { Composition } from 'remotion';
import {
  CaptionedVideo,
  CaptionedVideoProps,
} from './compositions/CaptionedVideo';
import { FinalRender, FinalRenderProps } from './compositions/FinalRender';
import type { WordTiming } from './hooks/useActiveWord';
import type { CaptionStyle } from './components/styleTypes';

const VERTICAL_WIDTH = 1080;
const VERTICAL_HEIGHT = 1920;
const SQUARE_SIDE = 1080;
const PREVIEW_FPS = 30;
// ~10s preview window until the backend derives durationInFrames from
// the actual audio length at render time.
const PREVIEW_DURATION_IN_FRAMES = 300;

// Publicly-reachable sample assets so Studio preview never 404s during
// local dev. Swap the URLs in the Studio UI to point at real Supabase
// merges (jobs/<tid>/<uuid>/merge-*.mp4) to sanity-check how a real clip
// composites with a real voiceover.
// Phase 2.6 — a 5-word demo track that exercises the full effect stack
// in Studio. Each word is ~600ms so the cycle is easy to watch; real
// renders use ElevenLabs alignment via word_timings rows.
const DEMO_WORDS: WordTiming[] = [
  { wordIndex: 0, word: 'Phase',     startMs:    0, endMs:  600 },
  { wordIndex: 1, word: 'two',       startMs:  600, endMs: 1200 },
  { wordIndex: 2, word: 'active',    startMs: 1200, endMs: 1800 },
  { wordIndex: 3, word: 'word',      startMs: 1800, endMs: 2400 },
  { wordIndex: 4, word: 'effects!',  startMs: 2400, endMs: 3000 },
];

// All three active-word effects (Phase 2) + the full layout-engine
// feature set (Phase 3) at once. Studio default so local iteration on
// either layer shows every moving part without extra setup.
const DEMO_CAPTION_STYLE: CaptionStyle = {
  baseFontFamily: 'Inter',
  baseFontColor: '#ffffff',
  baseFontSize: null,
  activeWordColor: '#fde047',        // yellow pop
  activeWordFontFamily: 'Bangers',   // chunkier active glyph
  activeWordOutlineConfig: {
    type: 'neon',
    color: '#f97316',                // orange outline + glow
    width: 4,
    blur: 18,
  },
  layoutConfig: {
    box: {
      color: '#ffffff',
      opacity: 0.9,
      paddingX: 28,
      paddingY: 14,
      cornerRadius: 24,
    },
    lineBreak: 'auto',
    maxWidthFraction: 0.9,
    verticalBox: {
      heightPx: 220,
      maxLines: 2,
    },
    perWordFontOverrides: {
      '2': 'Pacifico',        // "active" in a script hand
      '4': 'Permanent Marker', // "effects!" feels handwritten
    },
  },
};

const verticalDefaults: CaptionedVideoProps = {
  videoUrl:
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
  audioUrl:
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
  text: 'Phase two active word effects!',
  width: VERTICAL_WIDTH,
  height: VERTICAL_HEIGHT,
  wordTimings: DEMO_WORDS,
  captionStyle: DEMO_CAPTION_STYLE,
};

const squareDefaults: CaptionedVideoProps = {
  ...verticalDefaults,
  width: SQUARE_SIDE,
  height: SQUARE_SIDE,
};

// Cast via unknown because <Composition>'s default-props type is the
// generic Record<string, unknown>; our component intentionally declares
// a strict interface for IDE clarity.
const CaptionedVideoAsAny = CaptionedVideo as unknown as React.FC;

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="vertical"
        component={CaptionedVideoAsAny}
        width={VERTICAL_WIDTH}
        height={VERTICAL_HEIGHT}
        fps={PREVIEW_FPS}
        durationInFrames={PREVIEW_DURATION_IN_FRAMES}
        defaultProps={verticalDefaults as unknown as Record<string, unknown>}
      />
      <Composition
        id="square"
        component={CaptionedVideoAsAny}
        width={SQUARE_SIDE}
        height={SQUARE_SIDE}
        fps={PREVIEW_FPS}
        durationInFrames={PREVIEW_DURATION_IN_FRAMES}
        defaultProps={squareDefaults as unknown as Record<string, unknown>}
      />
      {/* Phase 7 — final pass. Backend /post/render-final calls this
          with the FFmpeg-composed intermediate as videoUrl + the
          per-segment cues list. Dimensions + durationInFrames are
          always overridden at render time. */}
      <Composition
        id="finalRender"
        component={FinalRender as unknown as React.FC}
        width={VERTICAL_WIDTH}
        height={VERTICAL_HEIGHT}
        fps={PREVIEW_FPS}
        durationInFrames={PREVIEW_DURATION_IN_FRAMES}
        defaultProps={{
          videoUrl: verticalDefaults.videoUrl,
          width: VERTICAL_WIDTH,
          height: VERTICAL_HEIGHT,
          cues: [],
        } as unknown as Record<string, unknown>}
      />
    </>
  );
};
