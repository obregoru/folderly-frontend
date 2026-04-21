import { CAPTION_PRESETS, validateCompositionMatrix } from '../../lib/captionPresets/catalog'

/**
 * Preset picker grid. Renders each CAPTION_PRESET as a clickable tile
 * with its display name, emoji thumbnail, and a one-line description.
 * Clicking applies the preset's full config via the `onApply` callback
 * — the parent CaptionStyleEditor handles the PUT.
 *
 * Visual state (Phase 6.4.1):
 *   - `selectedId`: preset currently applied to THIS segment (purple ring).
 *   - `defaultId`: preset set as the job-level default (green "default"
 *     badge). Both can be the same preset.
 *
 * Optional `onSetDefault(preset)` enables a secondary "set as default for
 * all segments" action per tile. Parent wires this to the job's
 * default_caption_style endpoint.
 *
 * @param {{
 *   onApply: (preset: import('../../lib/captionPresets/catalog').CaptionPreset) => void,
 *   onSetDefault?: (preset: import('../../lib/captionPresets/catalog').CaptionPreset) => void,
 *   selectedId?: string | null,
 *   defaultId?: string | null,
 * }} props
 */
export default function CaptionPresetPicker({ onApply, onSetDefault, selectedId, defaultId }) {
  return (
    <div className="space-y-2">
      <div className="text-[10px] text-muted">
        Pick a preset to start from. You can still tweak any field below.
        {onSetDefault && ' "Set as default" applies it to every segment that hasn\'t been customized.'}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {CAPTION_PRESETS.map(preset => {
          const warnings = validateCompositionMatrix(preset.config)
          const isSelected = selectedId && preset.id === selectedId
          const isDefault = defaultId && preset.id === defaultId
          return (
            <div
              key={preset.id}
              className={`relative bg-white border rounded-lg p-2 text-left transition-colors ${
                isSelected
                  ? 'border-[#6C5CE7] ring-2 ring-[#6C5CE7]/40'
                  : 'border-[#e5e5e5] hover:border-[#6C5CE7]'
              }`}
            >
              {/* Main tile — click to apply to THIS segment */}
              <button
                type="button"
                onClick={() => onApply(preset)}
                className="w-full text-left bg-transparent border-none p-0 cursor-pointer"
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-[18px] leading-none">{preset.thumbnailEmoji}</span>
                  <span className="text-[11px] font-medium truncate flex-1">{preset.displayName}</span>
                  {isSelected && (
                    <span className="text-[8px] px-1 rounded bg-[#6C5CE7] text-white font-medium">applied</span>
                  )}
                  {isDefault && (
                    <span className="text-[8px] px-1 rounded bg-[#2D9A5E] text-white font-medium" title="Set as default for all segments in this job">default</span>
                  )}
                </div>
                <div className="text-[9px] text-muted line-clamp-2">{preset.description}</div>
                {warnings.length > 0 && (
                  <div className="text-[8px] text-[#d97706] mt-1 italic">⚠ {warnings[0].slice(0, 60)}</div>
                )}
              </button>

              {/* Secondary action — set this preset as the job default */}
              {onSetDefault && !isDefault && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onSetDefault(preset) }}
                  className="mt-1.5 w-full text-[9px] py-1 border border-[#2D9A5E]/40 text-[#2D9A5E] bg-white rounded cursor-pointer hover:bg-[#f0faf4]"
                  title="Apply this preset to every segment that doesn't have its own style"
                >Set as default</button>
              )}
              {onSetDefault && isDefault && (
                <div className="mt-1.5 text-[9px] text-center text-[#2D9A5E] italic">
                  current default
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
