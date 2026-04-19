/**
 * EditorV2 — Phase 1 stub. Will be replaced with the full
 * mockup-style editor (FinalPreview + ToolMenu + MediaPanel /
 * HintsPanel / VoiceoverPanel / OverlaysPanel / ChannelsPanel /
 * CaptionsPanel) in Phase 2-4.
 */
export default function EditorV2({ draftId, jobSync, files, settings }) {
  return (
    <div className="p-3 space-y-3">
      <div className="bg-white border border-[#e5e5e5] rounded-lg p-4 space-y-2">
        <div className="text-[12px] font-medium">Editor — Phase 1 stub</div>
        <div className="text-[10px] text-muted">
          Draft <span className="font-mono">{draftId?.slice(0, 8)}</span> loaded ·
          {' '}{files.length} file{files.length === 1 ? '' : 's'} in memory
        </div>
        <div className="text-[10px] text-muted mt-2 border-t border-[#e5e5e5] pt-2">
          The full editor (final preview + tool menu + Media/Hints/Voice/Overlays/Post
          text/Channels panels) lands in the next phase. For now, use the real
          app at <a href={`/?real=1`} className="text-[#6C5CE7] underline">?real=1</a> to do actual editing
          on this draft — the job state is shared.
        </div>
        <div className="pt-2 flex gap-2">
          <a
            href={`/?real=1`}
            className="text-[10px] py-1.5 px-3 bg-[#6C5CE7] text-white rounded no-underline inline-block"
          >Open in real app →</a>
        </div>
      </div>
    </div>
  )
}
