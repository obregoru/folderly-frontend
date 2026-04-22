// Outer container for block-level entry/exit animations.
//
// Lives OUTSIDE VerticalFit (Phase 3.4) so animation scales and fit
// scales don't multiply. Tree shape:
//
//   <AnimationWrapper>       ← Phase 5 scale / translate / opacity
//     <VerticalFit>          ← Phase 3.4 scale-to-box
//       <CaptionBox>         ← Phase 3.2 pill
//         <WordTrack>        ← Phase 2 per-word
//           <Word>*          ← Phase 2 active styling
//
// If no entry/exit preset is configured, this component renders its
// children unchanged — Phase-0..3 output identical.

import React from 'react';
import type { AnimationConfigShape } from '../components/styleTypes';
import {
  getAnimationPreset,
  useEntryProgress,
  useExitProgress,
} from './framework';

export interface AnimationWrapperProps {
  entry?: AnimationConfigShape | null;
  exit?: AnimationConfigShape | null;
  width: number;
  height: number;
  children: React.ReactNode;
}

export const AnimationWrapper: React.FC<AnimationWrapperProps> = ({ entry, exit, width, height, children }) => {
  // useEntryProgress / useExitProgress must be called unconditionally
  // to respect the Rules of Hooks — we call them with 0-duration when
  // unconfigured, which makes them return 1 / 0 instantly.
  const entryDuration = entry?.durationMs ?? 0;
  const exitDuration = exit?.durationMs ?? 0;
  const entryEasing = entry?.easing ?? 'spring';
  const exitEasing = exit?.easing ?? 'easeIn';
  const entryProgress = useEntryProgress(Math.max(1, entryDuration), entryEasing);
  const exitProgress = useExitProgress(Math.max(1, exitDuration), exitEasing);

  const entryPreset = getAnimationPreset(entry?.preset);
  const exitPreset = getAnimationPreset(exit?.preset);

  // Collect block-level styles. Per-word / per-char scope presets
  // don't touch this wrapper — they hook in at WordTrack instead.
  let style: React.CSSProperties = {};
  const ctx = {
    wordIndex: 0,
    totalWords: 1,
    frameRate: 30,
    compositionWidth: width,
    compositionHeight: height,
  };
  if (entry && entryPreset && entryPreset.scope === 'block' && entryDuration > 0) {
    style = { ...style, ...entryPreset.apply(entryProgress, ctx) };
  }
  if (exit && exitPreset && exitPreset.scope === 'block' && exitDuration > 0) {
    // Exit "progress" is 0..1 through the exit window. Feed the
    // complement into entry-style presets so an exit of "zoomIn" feels
    // like the opposite (zoom toward 0.3 with opacity fading) — most
    // visually natural for the zoom/neon pair.
    const complement = 1 - exitProgress;
    const exitStyle = exitPreset.apply(complement, ctx);
    // Merge carefully so we don't overwrite opacity the entry is still
    // animating (the two windows don't overlap under normal config,
    // but if they do we prefer the exit result during the late frames).
    if (exitProgress > 0) style = { ...style, ...exitStyle };
  }

  return <div style={style}>{children}</div>;
};
