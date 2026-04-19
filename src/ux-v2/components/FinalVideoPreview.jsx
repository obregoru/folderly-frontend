/**
 * Final-video preview surface. Single source of truth for what the user
 * ships — every downstream tool (voiceover, overlays, channel tweaks)
 * attaches to this asset.
 */
export default function FinalVideoPreview({ hasMerge }) {
  return (
    <div className="bg-black rounded-lg overflow-hidden relative aspect-[9/16] max-h-[56vh] w-[80%] mx-auto">
      {hasMerge ? (
        <>
          {/* Simulated video poster */}
          <img
            src="https://picsum.photos/seed/final/720/1280"
            alt="Merged preview"
            className="w-full h-full object-cover"
          />
          {/* Play button overlay */}
          <button
            className="absolute inset-0 flex items-center justify-center bg-transparent border-none cursor-pointer"
            onClick={() => alert('Mock: would play the merged video here')}
          >
            <div className="w-16 h-16 rounded-full bg-black/50 flex items-center justify-center">
              <div style={{
                width: 0, height: 0,
                borderLeft: '20px solid white',
                borderTop: '12px solid transparent',
                borderBottom: '12px solid transparent',
                marginLeft: 6,
              }} />
            </div>
          </button>
          {/* Overlay badge */}
          <div className="absolute top-2 left-2 text-[10px] text-white bg-[#2D9A5E]/80 rounded-full px-2 py-0.5">
            Merged · 22.4s
          </div>
        </>
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center text-white/70 p-6 text-center">
          <div className="text-[36px] mb-2">🎬</div>
          <div className="text-[13px] font-medium text-white">No final video yet</div>
          <div className="text-[11px] mt-1">
            Upload clips or photos in the <b>Clips</b> tab, then tap Merge.
          </div>
        </div>
      )}
    </div>
  )
}
