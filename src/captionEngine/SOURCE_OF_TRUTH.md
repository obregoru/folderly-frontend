# Caption engine — mirror of `../folderly-backend/remotion/`

**Do not edit files here directly.**

The authoritative source is [`folderly-backend/remotion/`](../../../folderly-backend/remotion/).
The server-side Remotion bundler reads from the backend copy at render
time; this directory exists only because Vercel's single-repo clone
can't resolve `../folderly-backend/...` paths during `vite build`.

## Keeping in sync

After any change to the backend composition (`Word.tsx`, `WordTrack.tsx`,
`FinalRender.tsx`, etc.), run from the frontend repo root:

```sh
npm run sync-caption
```

That rsyncs `../folderly-backend/remotion/` into `src/captionEngine/`,
preserving deletions. Commit the resulting diff as part of the same
change that touched the backend files, so prod server and browser
always render the same composition.

## Long-term

If this sync ritual becomes painful, options to consider:
1. Extract caption engine into a shared npm package, published from
   the backend repo and installed in both.
2. Move both repos into a pnpm/npm workspace monorepo; caption engine
   becomes a workspace package imported by both.
3. Git submodule — less clean but avoids republishing.
