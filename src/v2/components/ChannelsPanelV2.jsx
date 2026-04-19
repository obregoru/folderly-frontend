import { useEffect, useState } from 'react'
import * as api from '../../api'

/**
 * ChannelsPanelV2 — destinations + scheduling entry point. Per-channel
 * toggles read/write the first file's post_destinations JSONB column
 * so real app + v2 share state. Scheduling hands off to the real app's
 * ScheduleModal in a later sub-phase.
 */

const CHANNELS = [
  { key: 'tiktok',   label: 'TikTok',             icon: 'TT', requiresVideo: true  },
  { key: 'ig_reel',  label: 'Instagram Reel',     icon: 'IG', requiresVideo: true  },
  { key: 'fb_reel',  label: 'Facebook Reel',      icon: 'FB', requiresVideo: true  },
  { key: 'yt_short', label: 'YouTube Shorts',     icon: 'YT', requiresVideo: true  },
  { key: 'ig_story', label: 'Instagram Story',    icon: 'IG', requiresVideo: false },
  { key: 'fb_story', label: 'Facebook Story',     icon: 'FB', requiresVideo: false },
  { key: 'fb_post',  label: 'Facebook Post',      icon: 'FB', requiresVideo: false },
  { key: 'blog',     label: 'Blog',               icon: 'BL', requiresVideo: false },
  { key: 'gbp',      label: 'Google Business',    icon: 'GBP',requiresVideo: false },
]

export default function ChannelsPanelV2({ draftId, files }) {
  const [destinations, setDestinations] = useState({})
  const [firstFileDbId, setFirstFileDbId] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!draftId) return
    api.getJob(draftId).then(job => {
      const f0 = job?.files?.[0]
      if (f0) {
        setFirstFileDbId(f0.id)
        const dest = f0.post_destinations && typeof f0.post_destinations === 'object' ? f0.post_destinations : {}
        setDestinations(dest)
      }
    }).catch(() => {})
  }, [draftId])

  const toggle = async (key) => {
    const next = { ...destinations, [key]: !destinations[key] }
    setDestinations(next)
    if (!draftId || !firstFileDbId) return
    setSaving(true)
    try {
      await api.updateJobFile(draftId, firstFileDbId, { post_destinations: next })
    } catch (e) {
      console.warn('[ChannelsV2] save failed:', e.message)
    }
    setSaving(false)
  }

  const enabledCount = Object.values(destinations).filter(Boolean).length

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="text-[12px] font-medium flex-1">Destinations</div>
        {saving && <span className="text-[9px] text-muted">Saving…</span>}
        <span className="text-[9px] text-muted">{enabledCount} enabled</span>
      </div>

      <div className="text-[10px] text-muted">
        Each channel inherits the shared video + captions + voiceover by default.
        Per-channel customization ports in a later sub-phase.
      </div>

      <div className="space-y-1.5">
        {CHANNELS.map(c => {
          const enabled = !!destinations[c.key]
          return (
            <div
              key={c.key}
              className={`border rounded-lg p-2.5 ${enabled ? 'border-[#2D9A5E]/30 bg-[#f0faf4]' : 'border-[#e5e5e5] bg-white'}`}
            >
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded bg-[#6C5CE7]/10 flex items-center justify-center text-[9px] font-bold text-[#6C5CE7] flex-shrink-0">
                  {c.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-medium">{c.label}</div>
                  <div className="text-[9px] text-muted">
                    {c.requiresVideo ? 'video required' : 'photo or video'}
                  </div>
                </div>
                <label className="relative inline-block w-10 h-6 cursor-pointer flex-shrink-0">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={() => toggle(c.key)}
                    className="sr-only peer"
                  />
                  <span className="absolute inset-0 bg-[#e5e5e5] rounded-full peer-checked:bg-[#2D9A5E] transition-colors" />
                  <span className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-4" />
                </label>
              </div>
            </div>
          )
        })}
      </div>

      <div className="border-t border-[#e5e5e5] pt-2 flex flex-col gap-1.5">
        <div className="text-[10px] text-muted italic">
          Scheduling + posting runs from the real app for now.
        </div>
        <a
          href="/?real=1"
          className="text-[10px] py-1.5 px-3 bg-[#6C5CE7] text-white rounded text-center no-underline inline-block"
        >Open scheduling in real app →</a>
      </div>
    </div>
  )
}
