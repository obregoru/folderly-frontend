import { CAPTION_PRESETS, validateCompositionMatrix } from '../../lib/captionPresets/catalog'

/**
 * Preset picker grid. Renders each CAPTION_PRESET as a clickable tile
 * with its display name, emoji thumbnail, and a one-line description.
 * Clicking applies the preset's full config via the `onApply` callback
 * — the parent CaptionStyleEditor handles the PUT.
 *
 * No customization here — this is the "library" entry point. Users
 * start from a preset and tweak individual fields below in the editor.
 *
 * @param {{ onApply: (preset: import('../../lib/captionPresets/catalog').CaptionPreset) => void }} props
 */
export default function CaptionPresetPicker({ onApply }) {
  return (
    <div className="space-y-2">
      <div className="text-[10px] text-muted">
        Pick a preset to start from. You can still tweak any field below.
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {CAPTION_PRESETS.map(preset => {
          const warnings = validateCompositionMatrix(preset.config)
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => onApply(preset)}
              className="bg-white border border-[#e5e5e5] rounded-lg p-2 text-left cursor-pointer hover:border-[#6C5CE7] transition-colors"
            >
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-[18px] leading-none">{preset.thumbnailEmoji}</span>
                <span className="text-[11px] font-medium truncate">{preset.displayName}</span>
              </div>
              <div className="text-[9px] text-muted line-clamp-2">{preset.description}</div>
              {warnings.length > 0 && (
                <div className="text-[8px] text-[#d97706] mt-1 italic">⚠ {warnings[0].slice(0, 60)}</div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
