// Step-1 verification stub: pulls in a component from the @caption
// alias (resolves to ../folderly-backend/remotion/) plus @remotion/player
// and remotion so Vite's production build proves the whole import graph
// compiles. Safe to delete once LivePreviewPlayer (Step 2) lands and
// imports the real graph itself.
import { Player } from '@remotion/player'
import { AbsoluteFill } from 'remotion'
import { Word } from '@caption/components/Word'
import { FinalRender } from '@caption/compositions/FinalRender'

// Reference each import so tree-shaking doesn't drop them during build.
export const __probe = { Player, AbsoluteFill, Word, FinalRender }
