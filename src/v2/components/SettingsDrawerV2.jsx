/**
 * SettingsDrawerV2 — Phase 1 placeholder. Shows the categorized
 * structure from the mockup with a link back to the real Sidebar for
 * actual editing. Each category will graduate into a real form in a
 * later phase.
 */
export default function SettingsDrawerV2({ open, onClose, settings }) {
  if (!open) return null

  const tenantSections = [
    { icon: '🏷️', label: 'Brand',          desc: 'Business info, brand rules, key insights, audience notes, vocabulary' },
    { icon: '🎤', label: 'Voice & AI behavior', desc: 'Voice settings, hook categories, pronunciation' },
    { icon: '🔑', label: 'API keys',        desc: 'ElevenLabs, AI detection, webhook keys' },
    { icon: '📤', label: 'Platforms',       desc: 'TikTok, Instagram, Facebook, YouTube, GBP, Blog, Pinterest' },
    { icon: '⚙️', label: 'Posting defaults',desc: 'Caption length, availability, watermark, SEO, AI detection' },
    { icon: '📅', label: 'Scheduling',      desc: 'Best-time analytics, calendar defaults' },
  ]
  const accountSections = [
    { icon: '👤', label: 'Profile',         desc: 'Name, email, timezone, notifications' },
    { icon: '🔀', label: 'Switch tenant',   desc: 'Manage tenants you have access to' },
    { icon: '🛠', label: 'Admin',           desc: 'Superuser tools (visible when allowed)' },
  ]

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-white">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#e5e5e5]">
        <div className="text-[12px] font-medium flex-1">Settings</div>
        <button
          onClick={onClose}
          className="text-[14px] text-muted bg-transparent border-none cursor-pointer px-1"
        >✕</button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-3">
        {/* Phase notice */}
        <div className="bg-[#fef3c7] border border-[#d97706]/40 rounded-lg p-3 text-[11px] text-[#92400e]">
          <div className="font-medium">Settings forms land in a later v2 phase</div>
          <div className="text-[10px] mt-1">
            For now, use the real app's sidebar to change any of these. Your tenant
            data is shared — changes made there show up here immediately.
          </div>
          <a
            href="/?real=1"
            className="inline-block mt-2 text-[10px] py-1.5 px-3 bg-[#d97706] text-white rounded no-underline"
          >Open real settings →</a>
        </div>

        <div>
          <div className="flex items-center gap-2 px-1 pb-1 pt-2">
            <div className="text-[10px] uppercase tracking-wide text-muted font-medium">This business</div>
            <div className="text-[11px] font-medium text-ink">{settings?.name || 'Your tenant'}</div>
          </div>
          <div className="space-y-1">
            {tenantSections.map((s, i) => (
              <div
                key={i}
                className="flex items-start gap-3 bg-white border border-[#e5e5e5] rounded-lg p-3 opacity-60"
              >
                <div className="w-10 h-10 rounded bg-[#6C5CE7]/10 flex items-center justify-center text-[20px] flex-shrink-0">
                  {s.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-medium">{s.label}</div>
                  <div className="text-[10px] text-muted mt-0.5">{s.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted font-medium px-1 pb-1 pt-2">Your account</div>
          <div className="space-y-1">
            {accountSections.map((s, i) => (
              <div
                key={i}
                className="flex items-start gap-3 bg-white border border-[#e5e5e5] rounded-lg p-3 opacity-60"
              >
                <div className="w-10 h-10 rounded bg-[#6C5CE7]/10 flex items-center justify-center text-[20px] flex-shrink-0">
                  {s.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-medium">{s.label}</div>
                  <div className="text-[10px] text-muted mt-0.5">{s.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="pt-2 px-1">
          <button className="w-full text-[11px] py-2 text-[#c0392b] bg-white border border-[#c0392b] rounded cursor-pointer" onClick={() => alert('Mock: sign out — use the real app for now.')}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
