import { useState } from 'react'
import { sampleChannels } from '../mockData'

/**
 * Per-channel destinations. Each channel inherits the default video +
 * overlays + voiceover by default. Tap "Customize" to break inheritance
 * and tweak just for that platform.
 */
export default function ChannelsPanel() {
  const [channels, setChannels] = useState(sampleChannels)

  const toggle = (key) => setChannels(prev => prev.map(c => c.key === key ? { ...c, enabled: !c.enabled } : c))
  const customize = (key) => setChannels(prev => prev.map(c => c.key === key ? { ...c, customized: !c.customized } : c))

  return (
    <div className="space-y-2">
      <div className="text-[12px] font-medium">Destinations</div>
      <div className="text-[10px] text-muted">
        Each channel inherits the shared video + captions + voiceover by default. Tap <b>Customize</b> to break the link and tweak just for that platform.
      </div>
      <div className="space-y-1.5">
        {channels.map(c => (
          <div
            key={c.key}
            className={`border rounded-lg p-2.5 ${c.enabled ? 'border-[#2D9A5E]/30 bg-[#f0faf4]' : 'border-[#e5e5e5] bg-white'}`}
          >
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded bg-[#6C5CE7]/10 flex items-center justify-center text-[9px] font-bold text-[#6C5CE7] flex-shrink-0">
                {c.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-medium">{c.label}</div>
                <div className="text-[9px] text-muted">
                  {c.customized ? (
                    <span className="text-[#6C5CE7]">● Customized for this channel</span>
                  ) : (
                    <span>Same as default</span>
                  )}
                </div>
              </div>
              <label className="relative inline-block w-10 h-6 cursor-pointer flex-shrink-0">
                <input
                  type="checkbox"
                  checked={c.enabled}
                  onChange={() => toggle(c.key)}
                  className="sr-only peer"
                />
                <span className="absolute inset-0 bg-[#e5e5e5] rounded-full peer-checked:bg-[#2D9A5E] transition-colors" />
                <span className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-4" />
              </label>
            </div>
            {c.enabled && (
              <div className="flex items-center gap-2 mt-2 pt-2 border-t border-[#e5e5e5]">
                <button
                  onClick={() => customize(c.key)}
                  className={`text-[10px] py-1 px-2 rounded border cursor-pointer ${c.customized ? 'bg-[#6C5CE7] text-white border-[#6C5CE7]' : 'bg-white text-[#6C5CE7] border-[#6C5CE7]'}`}
                >{c.customized ? 'Remove customization' : 'Customize for ' + c.label}</button>
                {c.customized && (
                  <button className="text-[10px] text-muted bg-transparent border-none cursor-pointer">
                    Edit channel-specific overlays, caption, scheduling →
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
