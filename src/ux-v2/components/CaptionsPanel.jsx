import { useState } from 'react'

/**
 * Per-platform caption text (the post body, different from overlays).
 * In v2 this is a single tabbed view so the user can see all platform
 * captions in one place and edit each as needed.
 */
export default function CaptionsPanel() {
  const [active, setActive] = useState('tiktok')
  const [captions, setCaptions] = useState({
    tiktok: 'POV: your birthday just got a signature scent 🕯️ #perfumeparty #birthdayvibes',
    instagram: 'Not a party favor. A scent you actually wear months later. DM to book your birthday perfume party ✨',
    facebook: '',
    blog: '',
    youtube: '',
  })

  const TABS = [
    { key: 'tiktok', label: 'TikTok' },
    { key: 'instagram', label: 'Instagram' },
    { key: 'facebook', label: 'Facebook' },
    { key: 'blog', label: 'Blog' },
    { key: 'youtube', label: 'YouTube' },
  ]

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="text-[12px] font-medium flex-1">Post captions (per platform)</div>
        <button className="text-[10px] py-1 px-2 bg-[#6C5CE7] text-white border-none rounded cursor-pointer">
          ✨ Generate
        </button>
      </div>

      <div className="flex items-center gap-1 overflow-x-auto border-b border-[#e5e5e5]">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setActive(t.key)}
            className={`text-[10px] py-1.5 px-2.5 border-none cursor-pointer whitespace-nowrap border-b-2 ${active === t.key ? 'border-[#6C5CE7] text-[#6C5CE7] font-medium' : 'border-transparent text-muted bg-transparent'}`}
          >{t.label}</button>
        ))}
      </div>

      <textarea
        value={captions[active] || ''}
        onChange={e => setCaptions(prev => ({ ...prev, [active]: e.target.value }))}
        placeholder={`${TABS.find(t => t.key === active)?.label} caption…`}
        rows={8}
        className="w-full text-[11px] border border-[#e5e5e5] rounded p-2 bg-white resize-y min-h-[140px]"
      />
      <div className="text-[9px] text-muted flex items-center gap-2">
        <span>{captions[active]?.length || 0} characters</span>
        <span className="ml-auto">{active === 'tiktok' && <>TikTok cap: 2,200</>}</span>
      </div>
    </div>
  )
}
