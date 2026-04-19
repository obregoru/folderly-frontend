import { useState } from 'react'

/**
 * Settings drawer — slides in from the right (or full-screen on mobile).
 * Groups all the existing real-app Sidebar settings into categories so
 * the editor stays focused on the current draft's creative flow.
 *
 * Each category opens a settings panel. For the mockup we just show the
 * categories + a preview of typical fields, not full interactive forms.
 */

const CATEGORIES = [
  {
    key: 'brand', icon: '🏷️', label: 'Brand',
    desc: 'Business info, brand rules, insights, audience notes, vocabulary, tone',
    fields: [
      'Business type + location',
      'Brand name, target URL, logo, primary color',
      'Brand rules (voice instructions)',
      'Key insights (payoffs, differentiators)',
      'Audience notes (who this business serves)',
      'Vocabulary (word substitutions)',
      'Default tone / POV / marketing intensity',
    ],
  },
  {
    key: 'voice', icon: '🎤', label: 'Voice & AI',
    desc: 'ElevenLabs, hook categories, pronunciation overrides',
    fields: [
      'ElevenLabs API key + default voice',
      'Hook categories & prompt context',
      'Pronunciation overrides',
      'Default voice settings (stability, clarity, speed)',
    ],
  },
  {
    key: 'platforms', icon: '📤', label: 'Platforms',
    desc: 'Connected channels + per-platform audiences',
    fields: [
      'TikTok (connection + analytics import)',
      'Instagram (connection + analytics import)',
      'Facebook (connection + Story defaults)',
      'YouTube (OAuth + Shorts default)',
      'Google Business Profile (OAuth)',
      'Blog (Buffer / WordPress / custom)',
      'Pinterest (OAuth — deprioritized)',
      'Per-platform audience profiles',
    ],
  },
  {
    key: 'posting', icon: '⚙️', label: 'Posting defaults',
    desc: 'Caption length, availability, occasion, watermark, SEO',
    fields: [
      'Caption length default',
      'Default POV (first / second / third person)',
      'Availability text ("Open weekends")',
      'Occasion override',
      'SEO prepend brand name',
      'Watermark enabled',
      'AI detection provider + key',
      'Humanize blog / YouTube',
      'Posting style (per-tenant AI guidance)',
    ],
  },
  {
    key: 'scheduling', icon: '📅', label: 'Scheduling',
    desc: 'Best-time analytics, calendar defaults',
    fields: [
      'Best-time suggestions per channel (from imported analytics)',
      'Calendar defaults (default scope, reminders)',
      'Reminder / retry policy for failed posts',
    ],
  },
  {
    key: 'account', icon: '👤', label: 'Account',
    desc: 'Profile, tenants, sign out, admin',
    fields: [
      'User profile (name, email, timezone)',
      'Active tenant + switch tenant',
      'Sign out',
      'Admin panel (if allowed)',
    ],
  },
]

export default function SettingsDrawer({ open, onClose }) {
  const [selectedKey, setSelectedKey] = useState(null)
  const selected = CATEGORIES.find(c => c.key === selectedKey)

  if (!open) return null

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-white">
      {/* Drawer top bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#e5e5e5]">
        {selected ? (
          <>
            <button
              onClick={() => setSelectedKey(null)}
              className="text-[11px] text-[#6C5CE7] bg-transparent border-none cursor-pointer p-0"
            >← Settings</button>
            <div className="text-[12px] font-medium flex-1">{selected.icon} {selected.label}</div>
          </>
        ) : (
          <div className="text-[12px] font-medium flex-1">Settings</div>
        )}
        <button
          onClick={() => { setSelectedKey(null); onClose() }}
          className="text-[14px] text-muted bg-transparent border-none cursor-pointer px-1"
        >✕</button>
      </div>

      {/* Drawer body */}
      <div className="flex-1 overflow-y-auto">
        {!selected ? (
          <div className="p-2 space-y-1">
            {CATEGORIES.map(c => (
              <button
                key={c.key}
                onClick={() => setSelectedKey(c.key)}
                className="w-full flex items-start gap-3 bg-white border border-[#e5e5e5] rounded-lg p-3 text-left cursor-pointer hover:bg-[#f8f7f3]"
              >
                <div className="w-10 h-10 rounded bg-[#6C5CE7]/10 flex items-center justify-center text-[20px] flex-shrink-0">
                  {c.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-medium">{c.label}</div>
                  <div className="text-[10px] text-muted mt-0.5">{c.desc}</div>
                </div>
                <div className="text-muted text-[14px] leading-none self-center">›</div>
              </button>
            ))}
          </div>
        ) : (
          <div className="p-3 space-y-2">
            <div className="text-[10px] text-muted italic">
              Mockup — real settings forms live here. Every field below is a row in the current app.
            </div>
            {selected.fields.map((f, i) => (
              <div key={i} className="flex items-center gap-2 bg-[#f8f7f3] border border-[#e5e5e5] rounded p-2.5 text-[11px]">
                <span className="text-muted w-4 text-center">{i + 1}.</span>
                <span className="flex-1">{f}</span>
                <span className="text-[9px] text-muted">edit →</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
