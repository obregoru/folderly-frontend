// Phase 7 — the final pass Remotion composition.
//
// Takes an already-FFmpeg-composed video (merged clips + overlays +
// voiceover mix) and stacks per-segment caption layers on top, each
// gated by its own time range via <Sequence>.
//
// Why this and not a single giant CaptionedVideo? Because the FFmpeg
// pipeline (mergeVideos, processStoryVideo, addVoiceoverSegments)
// handles multi-clip merge + ducking + mixing far better than
// re-implementing that in Remotion would. This composition is only
// responsible for caption rendering.
//
// Every cue passes its own text, word_timings, and caption_style so
// segments with Phase 2-6 effects render in full fidelity while
// segments without a caption_styles row fall back to a minimal
// white-on-black lower-third (matching the old burnCaptionTimeline
// look exactly).
//
// Durations are frame-aligned at composition mount via framesFromMs.

import React from 'react';
import { AbsoluteFill, Audio, OffthreadVideo, Sequence, useVideoConfig } from 'remotion';
import type { WordTiming } from '../hooks/useActiveWord';
import type { CaptionStyle } from '../components/styleTypes';
import { CaptionLayer } from '../components/CaptionLayer';
import { RemotionClockProvider, useCaptionClock } from '../runtime/captionClock';

export interface FinalRenderCue {
  startMs: number;
  endMs: number;
  text: string;
  wordTimings?: WordTiming[];
  captionStyle?: CaptionStyle | null;
  // Phase 7.2 — crossfade. fadeInMs ramps caption opacity 0→1 over the
  // first fadeInMs of the cue; fadeOutMs ramps 1→0 over the last
  // fadeOutMs. Either can be 0 to disable that edge. When neither is
  // set, the cue renders as a hard cut (pre-7.2 behavior).
  fadeInMs?: number;
  fadeOutMs?: number;
}

// Step-2 browser-preview support. When the composition runs on the
// SERVER through @remotion/renderer, the videoUrl points at an
// FFmpeg-composed intermediate that already has voiceover + original-
// video audio mixed together — audioTracks is omitted and the video
// element's own audio carries. When it runs in the BROWSER through
// @remotion/player, the videoUrl points at the raw merged video (no
// voiceover mix), and each voiceover segment arrives as its own
// AudioTrack that Remotion layers on top. Prop SHAPE is identical
// between the two contexts — only which fields the caller populates
// differs.
export interface FinalRenderAudioTrack {
  src: string;
  startMs: number;
  durationMs: number;
  volume?: number; // default 1
}

export interface FinalRenderProps {
  videoUrl: string;      // FFmpeg-composed intermediate OR merged video
  width: number;
  height: number;
  cues: FinalRenderCue[];
  // Browser-preview path only. Omit or pass empty for server renders
  // where the video already carries the mixed audio.
  audioTracks?: FinalRenderAudioTrack[];
  // Ducks the underlying video's own audio when voiceover tracks are
  // layered on top. Defaults to 1 (full volume) so server renders —
  // which pre-mix audio via FFmpeg — are unaffected. Browser previews
  // typically pass ~0.3 to approximate the 30% duck FFmpeg applies
  // during voiceover segments.
  videoAudioVolume?: number;
}

// Wrapper around CaptionLayer that applies the crossfade envelope.
// Inlined so the Sequence's local currentFrame is what we interpolate
// off — an opacity envelope computed outside the Sequence would use
// composition-absolute frames.
const FadedCaption: React.FC<{
  cue: FinalRenderCue;
  width: number;
  height: number;
  durationMs: number;
}> = ({ cue, width, height, durationMs }) => {
  // Clock is Sequence-local here — FinalRender nests a
  // RemotionClockProvider inside each Sequence so nowMs starts at 0
  // when this cue enters view. Cue-relative math (fade envelopes,
  // word timings inside WordTrack) all key off the same zero.
  const { nowMs } = useCaptionClock();
  const fadeInMs = cue.fadeInMs || 0;
  const fadeOutMs = cue.fadeOutMs || 0;

  let opacity = 1;
  if (fadeInMs > 0 && nowMs < fadeInMs) {
    opacity = Math.max(0, Math.min(1, nowMs / fadeInMs));
  } else if (fadeOutMs > 0 && nowMs > durationMs - fadeOutMs) {
    opacity = Math.max(0, Math.min(1, (durationMs - nowMs) / fadeOutMs));
  }
  return (
    <div style={{ opacity, width: '100%', height: '100%' }}>
      <CaptionLayer
        text={cue.text}
        wordTimings={cue.wordTimings}
        captionStyle={cue.captionStyle || null}
        width={width}
        height={height}
      />
    </div>
  );
};

export const FinalRender: React.FC<FinalRenderProps> = ({ videoUrl, width, height, cues, audioTracks, videoAudioVolume }) => {
  const { fps } = useVideoConfig();
  const framesFromMs = (ms: number) => Math.max(1, Math.round((ms / 1000) * fps));
  const effectiveVideoVolume = typeof videoAudioVolume === 'number' ? videoAudioVolume : 1;

  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      {/* Source video carries its own audio. Server path: videoUrl is
          already FFmpeg-composed with voiceover mixed in, so volume=1
          is the implicit default. Browser path: videoUrl is the raw
          merged video and voiceover rides on the audioTracks below,
          so callers typically pass videoAudioVolume ~0.3 to duck. */}
      <OffthreadVideo
        src={videoUrl}
        volume={effectiveVideoVolume}
        style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center' }}
      />

      {/* Layered voiceover tracks — browser preview path only.
          Server renders usually pass audioTracks=undefined/[] because
          the FFmpeg stage already mixed these into videoUrl's audio. */}
      {(audioTracks || []).map((track, i) => {
        const from = framesFromMs(Math.max(0, track.startMs));
        const dur = Math.max(1, framesFromMs(track.durationMs));
        return (
          <Sequence key={`audio-${i}`} from={from} durationInFrames={dur} layout="none">
            <Audio src={track.src} volume={typeof track.volume === 'number' ? track.volume : 1} />
          </Sequence>
        );
      })}

      {cues.map((cue, i) => {
        // Extend cue visibility to include its fade-in and fade-out
        // windows: fade-in prefixes startMs, fade-out extends past
        // endMs. Caption stays visually anchored to its original
        // startMs..endMs audio window through the opacity envelope.
        const fadeInMs = cue.fadeInMs || 0;
        const fadeOutMs = cue.fadeOutMs || 0;
        const effectiveStartMs = Math.max(0, cue.startMs - fadeInMs);
        const effectiveEndMs = cue.endMs + fadeOutMs;
        const effectiveDurationMs = effectiveEndMs - effectiveStartMs;
        const from = framesFromMs(effectiveStartMs);
        const dur = Math.max(1, framesFromMs(effectiveDurationMs));
        // Sequence rebases useCurrentFrame to 0 at `from`, and the
        // nested RemotionClockProvider picks that up — so caption
        // components below see cue-local nowMs. Word timings and fade
        // envelopes match the cue's own time origin whether rendered
        // on the server (this path) or in the editor overlay (which
        // uses OffsetClockProvider to achieve the same rebase).
        return (
          <Sequence key={i} from={from} durationInFrames={dur} layout="none">
            <RemotionClockProvider width={width} height={height}>
              <FadedCaption cue={cue} width={width} height={height} durationMs={effectiveDurationMs} />
            </RemotionClockProvider>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
