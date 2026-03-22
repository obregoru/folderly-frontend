import { useState } from 'react'
import * as api from '../api'

const BUSINESS_TYPES = [
  'Make & Take studio', 'Escape room', 'Axe throwing venue', 'Paint & sip studio',
  'Pottery studio', 'Candle making studio', 'Salon / spa', 'Restaurant', 'Bakery',
  'Coffee shop', 'Brewery / taproom', 'Fitness studio / gym', 'Yoga studio',
  'Photography studio', 'Florist', 'Boutique retail', 'Event venue',
]

const TONES = ['warm', 'funny', 'upbeat', 'inviting', 'engaging', 'informal', 'formal']
const MKT_LEVELS = ['subtle', 'balanced', 'strong']
const HOOKS = ['question', 'caption_this', 'share_yours', 'behind_scenes', 'storytelling']
const HOOK_LABELS = { question: 'Question', caption_this: 'Caption this', share_yours: 'Share yours', behind_scenes: 'Behind scenes', storytelling: 'Storytelling' }
const LENGTHS = ['small', 'medium', 'large']
const LENGTH_LABELS = { small: 'Short', medium: 'Medium', large: 'Long' }
const OCCASIONS = [
  { value: '', label: 'Auto-detect from folder/filename' },
  { value: 'birthday', label: 'Birthday' },
  { value: 'date night', label: 'Date night / couples' },
  { value: 'girls night', label: 'Girls night out' },
  { value: 'bachelorette', label: 'Bachelorette' },
  { value: 'team building', label: 'Team building' },
  { value: 'same-day', label: 'Same-day availability' },
  { value: 'weekday session', label: 'Weekday session' },
  { value: 'friday evening', label: 'Friday evening slot' },
]

function Toggle({ on, onChange, title }) {
  return <button className={`tog ${on ? 'on' : ''}`} onClick={() => onChange(!on)} title={title} />
}

function ChipGrid({ items, active, onToggle, cols = 3, multi = false }) {
  const mobileCols = Math.min(cols, 2)
  return (
    <div className="grid gap-1.5 md:gap-[5px]" style={{ '--mobile-cols': mobileCols, '--desktop-cols': cols, gridTemplateColumns: `repeat(var(--desktop-cols), 1fr)` }}>
      <style>{`@media(max-width:768px){[style*="--mobile-cols"]{grid-template-columns:repeat(var(--mobile-cols),1fr) !important}}`}</style>
      {items.map(item => {
        const isOn = multi ? active.includes(item.value) : active === item.value
        return (
          <button key={item.value} className={`chip ${isOn ? 'on' : ''}`} onClick={() => onToggle(item.value)}>
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

export default function Sidebar({ settings, onSave, hashtagSets, selectedHashtagSetId, onSelectHashtag, onHashtagsChange, rules, onRulesChange, apiUrl }) {
  const [hsFormOpen, setHsFormOpen] = useState(false)
  const [hsName, setHsName] = useState('')
  const [hsTags, setHsTags] = useState('')

  const s = settings
  const save = (key, val) => onSave({ [key]: val })

  const activeHooks = s.engagement_hooks || []

  const handleAddHashtag = () => {
    if (!hsName.trim() || !hsTags.trim()) return
    api.createHashtag(hsName, hsTags).then(() => {
      setHsFormOpen(false); setHsName(''); setHsTags('')
      onHashtagsChange()
    })
  }

  return (
    <aside className="bg-white border-r border-border p-4 md:p-4 overflow-y-auto flex flex-col gap-4 md:gap-5 h-full">
      {/* Mobile drawer header */}
      <div className="md:hidden flex items-center justify-between pb-2 border-b border-border -mx-4 px-4 -mt-2 pt-2">
        <span className="font-serif text-[17px]">Settings</span>
        <button onClick={() => { /* Close handled by overlay in App.jsx */ const evt = new CustomEvent('close-sidebar'); window.dispatchEvent(evt) }} className="p-2 text-muted min-h-[44px] min-w-[44px] flex items-center justify-center">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 5l10 10M15 5L5 15"/></svg>
        </button>
      </div>
      {/* Brand Profile */}
      <div>
        <div className="s-head">Brand profile</div>
        <div className="mb-2"><label className="text-[11px] text-muted block mb-0.5">Business name</label>
          <input className="field-input" value={s.name || ''} onChange={e => save('name', e.target.value)} onBlur={e => save('name', e.target.value)} /></div>
        <div className="mb-2"><label className="text-[11px] text-muted block mb-0.5">Booking / CTA URL</label>
          <input className="field-input" placeholder="https://book.example.com" value={s.target_url || ''} onChange={e => save('target_url', e.target.value)} /></div>
        <div className="mb-2"><label className="text-[11px] text-muted block mb-0.5">Location</label>
          <input className="field-input" value={s.location || ''} onChange={e => save('location', e.target.value)} /></div>
        <div className="mb-2"><label className="text-[11px] text-muted block mb-0.5">Business type</label>
          <input className="field-input" list="biz-type-list" placeholder="Type or select (leave blank to exclude)" value={s.business_type || ''} onChange={e => save('business_type', e.target.value)} />
          <datalist id="biz-type-list">{BUSINESS_TYPES.map(t => <option key={t} value={t} />)}</datalist></div>
        <div className="mb-2"><label className="text-[11px] text-muted block mb-0.5">Brand rules</label>
          <textarea rows={5} className="field-input resize-none" value={s.brand_rules || ''} onChange={e => save('brand_rules', e.target.value)} /></div>
        <div className="mb-2"><label className="text-[11px] text-muted block mb-0.5">SEO keywords</label>
          <input className="field-input" placeholder="perfume making, candle workshop, date night Milwaukee" value={s.seo_keywords || ''} onChange={e => save('seo_keywords', e.target.value)} /></div>

        {/* Hashtag sets */}
        <div className="mb-2">
          <label className="text-[11px] text-muted block mb-0.5">Hashtag sets <span className="float-right text-[10px] text-sage cursor-pointer" onClick={() => setHsFormOpen(true)}>+ add</span></label>
          <div className="flex flex-col gap-1.5">
            {hashtagSets.length === 0 && <span className="text-[10px] text-muted">No sets yet</span>}
            {hashtagSets.map(hs => (
              <div key={hs.id} className={`border rounded-sm overflow-hidden ${selectedHashtagSetId === hs.id ? 'border-terra' : 'border-border'}`}>
                <div className={`flex items-center justify-between px-2 py-1 cursor-pointer ${selectedHashtagSetId === hs.id ? 'bg-terra-light' : 'bg-cream'}`}>
                  <span className={`text-[11px] font-medium ${selectedHashtagSetId === hs.id ? 'text-terra' : 'text-ink'}`}>{hs.name}</span>
                  <span className="flex gap-1.5 items-center">
                    <span className="text-[9px] text-sage cursor-pointer" onClick={() => onSelectHashtag(selectedHashtagSetId === hs.id ? null : hs.id)}>
                      {selectedHashtagSetId === hs.id ? 'selected' : 'select'}
                    </span>
                    <span className="text-[9px] text-muted cursor-pointer" onClick={() => { if (confirm(`Delete "${hs.name}"?`)) api.deleteHashtag(hs.id).then(onHashtagsChange) }}>delete</span>
                  </span>
                </div>
                <textarea className="w-full text-[10px] font-sans p-1.5 border-none border-t border-border resize-y min-h-[32px] leading-relaxed text-ink bg-white"
                  defaultValue={hs.hashtags} onBlur={e => { if (e.target.value !== hs.hashtags) api.updateHashtag(hs.id, e.target.value) }} />
              </div>
            ))}
          </div>
          {hsFormOpen && (
            <div className="mt-1.5">
              <input className="field-input mb-1 text-[11px]" placeholder="Set name" value={hsName} onChange={e => setHsName(e.target.value)} />
              <input className="field-input mb-1 text-[11px]" placeholder="#tag1 #tag2 #tag3" value={hsTags} onChange={e => setHsTags(e.target.value)} />
              <div className="flex gap-1">
                <button className="text-[10px] py-0.5 px-2.5 bg-sage text-white border-none rounded-sm cursor-pointer font-sans" onClick={handleAddHashtag}>Save</button>
                <button className="text-[10px] py-0.5 px-2.5 bg-cream border border-border rounded-sm cursor-pointer font-sans" onClick={() => setHsFormOpen(false)}>Cancel</button>
              </div>
            </div>
          )}
        </div>

        {/* Toggles */}
        <div className="flex items-center justify-between text-xs py-0.5"><span>Keep anonymous</span><Toggle on={s.keep_anonymous !== false} onChange={v => save('keep_anonymous', v)} /></div>
        <div className="flex items-center justify-between text-xs py-0.5"><span>Brand name in filenames</span><Toggle on={s.seo_prepend_brand !== false} onChange={v => save('seo_prepend_brand', v)} /></div>
        <div className="flex items-center justify-between text-xs py-0.5"><span>Watermark exports</span><Toggle on={s.watermark_enabled === true} onChange={v => save('watermark_enabled', v)} /></div>
        {s.watermark_enabled && (
          <WatermarkUpload path={s.watermark_path} onUploaded={(path) => save('watermark_path', path)} />
        )}
      </div>

      {/* Connected accounts */}
      <div>
        <div className="s-head">Connected accounts</div>
        <SocialConnections settings={s} apiUrl={apiUrl} onRefresh={() => api.getSettings().then(s => onSave(s))} />
      </div>

      {/* Notifications */}
      <NotificationSettings settings={s} />

      {/* TikTok settings */}
      {s.platform_tiktok && (
        <div>
          <div className="s-head">TikTok settings</div>
          <label className="text-[11px] text-muted block mb-0.5">Default TikTok hashtags</label>
          <input className="field-input" placeholder="#fyp #smallbusiness" value={s.tiktok_default_hashtags || ''} onChange={e => save('tiktok_default_hashtags', e.target.value)} />
          <label className="text-[11px] text-muted block mt-2 mb-0.5">Custom hook styles (comma-separated)</label>
          <input className="field-input" placeholder="POV:, Wait for it..." value={(s.tiktok_hooks || []).join(', ')} onChange={e => {
            const hooks = e.target.value.split(',').map(h => h.trim()).filter(Boolean);
            save('tiktok_hooks', hooks);
          }} />
        </div>
      )}

      {/* This batch */}
      <div>
        <div className="s-head">This batch</div>
        <div className="flex items-center justify-between text-xs py-0.5"><span>Availability signal</span><Toggle on={s.availability_on !== false} onChange={v => save('availability_on', v)} /></div>
        {s.availability_on !== false && (
          <input className="field-input mt-1.5" placeholder="e.g. Sat 11am full, PM open" value={s.availability_text || ''} onChange={e => save('availability_text', e.target.value)} />
        )}
        <div className="mt-2.5 mb-2"><label className="text-[11px] text-muted block mb-0.5">Override occasion</label>
          <select className="field-input" value={s.occasion_override || ''} onChange={e => save('occasion_override', e.target.value)}>
            {OCCASIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="mt-2.5">
          <label className="text-[10px] text-muted uppercase tracking-wider">Caption rules</label>
          {[['name', 'Mention business name'], ['cta', 'Include booking CTA'], ['brand', 'Apply brand rules'], ['seo', 'Include SEO keywords'], ['hashtags', 'Include hashtags']].map(([key, label]) => (
            <div key={key} className="flex items-center justify-between text-xs py-0.5 mt-1">
              <span>{label}</span>
              <Toggle on={rules[key]} onChange={v => onRulesChange({ ...rules, [key]: v })} />
            </div>
          ))}
        </div>
      </div>

      {/* Tone */}
      <div>
        <div className="s-head">Tone</div>
        <ChipGrid items={TONES.map(t => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) }))} active={s.default_tone || 'warm'} multi onToggle={v => {
          const current = (s.default_tone || 'warm').split(', ')
          const next = current.includes(v) ? current.filter(x => x !== v) : [...current, v]
          save('default_tone', next.length ? next.join(', ') : 'warm')
        }} />
      </div>

      {/* Marketing level */}
      <div>
        <div className="s-head">Marketing level</div>
        <ChipGrid items={MKT_LEVELS.map(m => ({ value: m, label: m.charAt(0).toUpperCase() + m.slice(1) }))} active={s.marketing_intensity || 'balanced'} onToggle={v => save('marketing_intensity', v)} />
      </div>

      {/* Engagement hooks */}
      <div>
        <div className="s-head">Engagement hooks</div>
        <ChipGrid cols={2} multi items={HOOKS.map(h => ({ value: h, label: HOOK_LABELS[h] }))} active={activeHooks} onToggle={v => {
          const next = activeHooks.includes(v) ? activeHooks.filter(x => x !== v) : [...activeHooks, v]
          save('engagement_hooks', next)
        }} />
      </div>

      {/* Caption length */}
      <div>
        <div className="s-head">Caption length</div>
        <ChipGrid items={LENGTHS.map(l => ({ value: l, label: LENGTH_LABELS[l] }))} active={s.caption_length || 'large'} onToggle={v => save('caption_length', v)} />
      </div>

      {/* Platforms */}
      <div>
        <div className="s-head">Platforms</div>
        {[['platform_tiktok', 'TikTok', true], ['platform_instagram', 'Instagram', true], ['platform_facebook', 'Facebook', true], ['platform_twitter', 'X / Twitter', false], ['platform_google', 'Google Business', false], ['platform_blog', 'Blog post', false], ['platform_youtube', 'YouTube', false]].map(([key, label, defaultOn]) => (
          <div key={key} className="flex items-center justify-between text-xs md:text-xs text-[13px] py-2 md:py-0.5 mt-1 md:mt-1.5 min-h-[44px] md:min-h-0">
            <span>{label}</span>
            <Toggle on={defaultOn ? s[key] !== false : s[key] === true} onChange={v => save(key, v)} />
          </div>
        ))}
      </div>

      {/* Quality */}
      <div>
        <div className="s-head">Quality</div>
        <div className="flex items-center justify-between text-xs py-0.5"><span>AI detection scoring</span><Toggle on={s.ai_detection_enabled === true} onChange={v => save('ai_detection_enabled', v)} /></div>
      </div>
    </aside>
  )
}

function WatermarkUpload({ path, onUploaded }) {
  const [uploading, setUploading] = useState(false)
  const [status, setStatus] = useState('')

  const imgSrc = path ? (path.startsWith('http') ? path : `/uploads/${path}`) : null

  const handleFile = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)
    setStatus('Uploading...')
    try {
      const d = await api.uploadWatermark(file)
      if (d.watermark_path) {
        onUploaded(d.watermark_path)
        setStatus('Uploaded!')
        setTimeout(() => setStatus(''), 2000)
      }
    } catch (err) {
      setStatus('Upload failed')
      setTimeout(() => setStatus(''), 3000)
    }
    setUploading(false)
    e.target.value = ''
  }

  return (
    <div className="mt-1 flex items-center gap-1.5">
      {imgSrc && <img src={imgSrc} className="w-8 h-8 object-contain rounded bg-[#eee]" />}
      <label className={`text-[10px] py-0.5 px-2.5 bg-cream border border-border rounded-sm cursor-pointer ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
        {uploading ? 'Uploading...' : (path ? 'Replace logo' : 'Upload logo')}
        <input type="file" accept="image/png" className="hidden" onChange={handleFile} />
      </label>
      {status && !uploading && <span className="text-[10px] text-sage">{status}</span>}
    </div>
  )
}

function NotificationSettings({ settings }) {
  const s = settings

  return (
    <div>
      <div className="s-head">Notifications</div>
      {s.notify_enabled ? (
        <div className="text-[11px] text-muted">
          Reminders → <strong>{s.notify_email || 'not set'}</strong>
          <br />{s.notify_minutes_before || 15} min before scheduled posts
          {!s.email_configured && <p className="text-[#c0392b] mt-1">Email provider not configured. Set up in Admin → Edit Tenant.</p>}
        </div>
      ) : (
        <p className="text-[11px] text-muted">Disabled. Enable in Admin → Edit Tenant.</p>
      )}
    </div>
  )
}

function SocialConnections({ settings, apiUrl, onRefresh }) {
  const s = settings
  const [fbError, setFbError] = useState('')
  const [showTwitterSetup, setShowTwitterSetup] = useState(false)
  const [twClientId, setTwClientId] = useState('')
  const [twClientSecret, setTwClientSecret] = useState('')
  const [twSaving, setTwSaving] = useState(false)
  const [showGoogleSetup, setShowGoogleSetup] = useState(false)
  const [gClientId, setGClientId] = useState('')
  const [gClientSecret, setGClientSecret] = useState('')
  const [gSaving, setGSaving] = useState(false)
  const [showTiktokSetup, setShowTiktokSetup] = useState(false)
  const [tkClientKey, setTkClientKey] = useState('')
  const [tkClientSecret, setTkClientSecret] = useState('')
  const [tkSaving, setTkSaving] = useState(false)
  const [showWpSetup, setShowWpSetup] = useState(false)
  const [wpUrl, setWpUrl] = useState('')
  const [wpUser, setWpUser] = useState('')
  const [wpPass, setWpPass] = useState('')
  const [wpSaving, setWpSaving] = useState(false)

  const handleConnectFb = async () => {
    try {
      const data = await api.startFbConnect()
      if (data.error) { setFbError(data.error); return }
      if (data.url) {
        const popup = window.open(data.url, 'fb-connect', 'width=600,height=700')
        const handler = (e) => {
          if (e.data && e.data.type === 'fb-connected') {
            window.removeEventListener('message', handler)
            onRefresh()
          }
        }
        window.addEventListener('message', handler)
        const check = setInterval(() => {
          if (popup && popup.closed) { clearInterval(check); onRefresh() }
        }, 1000)
      }
    } catch (err) { setFbError(err.message) }
  }

  const handleDisconnectFb = async () => {
    if (!confirm('Disconnect Facebook Page?')) return
    await api.disconnectFb()
    onRefresh()
  }

  const handleResetFb = async () => {
    if (!confirm('Disconnect Facebook and reset?')) return
    await api.resetFb()
    onRefresh()
  }

  const btn = "text-[10px] py-1 px-2.5 border border-border rounded-sm cursor-pointer font-sans"
  const inp = "w-full py-1.5 px-2 border border-[#ddd] rounded text-[11px] font-sans focus:outline-none focus:border-sage"

  return (
    <div className="flex flex-col gap-1.5">
      {/* Facebook */}
      <div className="flex items-center justify-between text-xs py-0.5">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.fb_connected ? '#2D9A5E' : '#ccc' }} />
          <span>{s.fb_connected ? `Facebook (${s.fb_page_name})` : 'Facebook'}</span>
        </div>
        {s.fb_connected
          ? <div className="flex gap-1">
              <button onClick={handleDisconnectFb} className={`${btn} text-[#c0392b]`}>Disconnect</button>
            </div>
          : s.fb_app_configured
            ? <button onClick={handleConnectFb} className={`${btn} bg-[#1877F2] text-white border-[#1877F2]`}>Connect Page</button>
            : <span className="text-[10px] text-muted italic">Not available</span>
        }
      </div>
      {fbError && <p className="text-[#c0392b] text-[10px] pl-3.5">{fbError}</p>}

      {/* Instagram (auto-connected via Facebook Page link) */}
      <div className="flex items-center justify-between text-xs py-0.5">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.ig_connected ? '#2D9A5E' : '#ccc' }} />
          <span>{s.ig_connected ? `Instagram @${s.ig_username}` : 'Instagram'}</span>
        </div>
        {s.ig_connected
          ? <span className="text-[10px] text-sage">Via Facebook</span>
          : <span className="text-[10px] text-muted italic">{s.fb_connected ? 'Link IG to FB Page' : 'Connect FB first'}</span>
        }
      </div>

      {/* X/Twitter */}
      <div className="text-xs py-0.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.twitter_connected ? '#2D9A5E' : '#ccc' }} />
            <span>{s.twitter_connected ? `X @${s.twitter_username}` : 'X / Twitter'}</span>
          </div>
          {!s.twitter_connected && !s.twitter_app_configured && !showTwitterSetup && (
            <button onClick={() => setShowTwitterSetup(true)} className="text-[10px] text-[#2D9A5E] hover:underline">Set up</button>
          )}
          {!s.twitter_connected && s.twitter_app_configured && (
            <div className="flex gap-1">
              <button onClick={async () => {
                const data = await api.startTwitterConnect()
                if (data.url) {
                  const popup = window.open(data.url, 'twitter-connect', 'width=600,height=700')
                  const handler = (e) => { if (e.data?.type === 'twitter-connected') { window.removeEventListener('message', handler); onRefresh() } }
                  window.addEventListener('message', handler)
                  const check = setInterval(() => {
                    if (popup && popup.closed) { clearInterval(check); onRefresh() }
                  }, 1000)
                }
              }} className="text-[10px] text-[#2D9A5E] hover:underline">Connect</button>
              <button onClick={async () => { await api.resetTwitter(); onRefresh() }} className="text-[10px] text-red-500 hover:underline">Reset</button>
            </div>
          )}
          {s.twitter_connected && (
            <div className="flex gap-1">
              <button onClick={async () => { await api.disconnectTwitter(); onRefresh() }} className="text-[10px] text-red-500 hover:underline">Disconnect</button>
              <button onClick={async () => { await api.resetTwitter(); onRefresh() }} className="text-[10px] text-red-500 hover:underline">Reset</button>
            </div>
          )}
        </div>
        {showTwitterSetup && (
          <div className="mt-1 space-y-1">
            <input value={twClientId} onChange={e => setTwClientId(e.target.value)} placeholder="API Key" className="w-full px-2 py-1 text-xs border rounded bg-white" />
            <input value={twClientSecret} onChange={e => setTwClientSecret(e.target.value)} type="password" placeholder="API Secret" className="w-full px-2 py-1 text-xs border rounded bg-white" />
            <p className="text-[9px] text-muted">From developer.x.com → your app → Keys and tokens → Consumer Keys</p>
            <div className="flex gap-1">
              <button onClick={async () => {
                setTwSaving(true)
                try {
                  await api.saveTwitterCredentials(twClientId, twClientSecret)
                  setShowTwitterSetup(false)
                  setTwClientId(''); setTwClientSecret('')
                  onRefresh()
                } catch (e) { alert(e.message) }
                setTwSaving(false)
              }} disabled={twSaving || !twClientId || !twClientSecret} className="px-2 py-0.5 text-[10px] bg-[#2D9A5E] text-white rounded disabled:opacity-50">
                {twSaving ? 'Saving...' : 'Save'}
              </button>
              <button onClick={() => { setShowTwitterSetup(false); setTwClientId(''); setTwClientSecret('') }} className="px-2 py-0.5 text-[10px] border rounded">Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* Google Business */}
      <div className="text-xs py-0.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.google_connected ? '#2D9A5E' : '#ccc' }} />
            <span>{s.google_connected ? `Google (${s.google_location_name})` : 'Google Business'}</span>
          </div>
          {!s.google_connected && !s.google_app_configured && !showGoogleSetup && (
            <button onClick={() => setShowGoogleSetup(true)} className="text-[10px] text-[#2D9A5E] hover:underline">Set up</button>
          )}
          {!s.google_connected && s.google_app_configured && (
            <div className="flex gap-1">
              <button onClick={async () => {
                const data = await api.startGoogleConnect()
                if (data.url) {
                  const popup = window.open(data.url, 'google-connect', 'width=600,height=700')
                  const handler = (e) => { if (e.data?.type === 'google-connected') { window.removeEventListener('message', handler); onRefresh() } }
                  window.addEventListener('message', handler)
                  const check = setInterval(() => {
                    if (popup && popup.closed) { clearInterval(check); onRefresh() }
                  }, 1000)
                }
              }} className="text-[10px] text-[#2D9A5E] hover:underline">Connect</button>
              <button onClick={async () => { await api.resetGoogle(); onRefresh() }} className="text-[10px] text-red-500 hover:underline">Reset</button>
            </div>
          )}
          {s.google_connected && (
            <div className="flex gap-1">
              <button onClick={async () => { await api.disconnectGoogle(); onRefresh() }} className="text-[10px] text-red-500 hover:underline">Disconnect</button>
              <button onClick={async () => { await api.resetGoogle(); onRefresh() }} className="text-[10px] text-red-500 hover:underline">Reset</button>
            </div>
          )}
        </div>
        {showGoogleSetup && (
          <div className="mt-1 space-y-1">
            <input value={gClientId} onChange={e => setGClientId(e.target.value)} placeholder="OAuth Client ID" className="w-full px-2 py-1 text-xs border rounded bg-white" />
            <input value={gClientSecret} onChange={e => setGClientSecret(e.target.value)} type="password" placeholder="OAuth Client Secret" className="w-full px-2 py-1 text-xs border rounded bg-white" />
            <p className="text-[9px] text-muted">From Google Cloud Console → APIs & Services → Credentials</p>
            <div className="flex gap-1">
              <button onClick={async () => {
                setGSaving(true)
                try {
                  await api.saveGoogleCredentials(gClientId, gClientSecret)
                  setShowGoogleSetup(false)
                  setGClientId(''); setGClientSecret('')
                  onRefresh()
                } catch (e) { alert(e.message) }
                setGSaving(false)
              }} disabled={gSaving || !gClientId || !gClientSecret} className="px-2 py-0.5 text-[10px] bg-[#2D9A5E] text-white rounded disabled:opacity-50">
                {gSaving ? 'Saving...' : 'Save'}
              </button>
              <button onClick={() => { setShowGoogleSetup(false); setGClientId(''); setGClientSecret('') }} className="px-2 py-0.5 text-[10px] border rounded">Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* TikTok */}
      <div className="text-xs py-0.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.tiktok_connected ? '#2D9A5E' : '#ccc' }} />
            <span>{s.tiktok_connected ? `TikTok @${s.tiktok_username}` : 'TikTok'}</span>
          </div>
          {!s.tiktok_connected && !s.tiktok_app_configured && !showTiktokSetup && (
            <button onClick={() => setShowTiktokSetup(true)} className="text-[10px] text-[#2D9A5E] hover:underline">Set up</button>
          )}
          {!s.tiktok_connected && s.tiktok_app_configured && (
            <div className="flex gap-1">
              <button onClick={async () => {
                const data = await api.startTiktokConnect()
                if (data.url) {
                  const popup = window.open(data.url, 'tiktok-connect', 'width=600,height=700')
                  const handler = (e) => { if (e.data?.type === 'tiktok-connected') { window.removeEventListener('message', handler); onRefresh() } }
                  window.addEventListener('message', handler)
                  const check = setInterval(() => {
                    if (popup && popup.closed) { clearInterval(check); onRefresh() }
                  }, 1000)
                }
              }} className="text-[10px] text-[#2D9A5E] hover:underline">Connect</button>
              <button onClick={async () => { await api.resetTiktok(); onRefresh() }} className="text-[10px] text-red-500 hover:underline">Reset</button>
            </div>
          )}
          {s.tiktok_connected && (
            <div className="flex gap-1">
              <button onClick={async () => { await api.disconnectTiktok(); onRefresh() }} className="text-[10px] text-red-500 hover:underline">Disconnect</button>
              <button onClick={async () => { await api.resetTiktok(); onRefresh() }} className="text-[10px] text-red-500 hover:underline">Reset</button>
            </div>
          )}
        </div>
        {showTiktokSetup && (
          <div className="mt-1 space-y-1">
            <input value={tkClientKey} onChange={e => setTkClientKey(e.target.value)} placeholder="Client Key" className="w-full px-2 py-1 text-xs border rounded bg-white" />
            <input value={tkClientSecret} onChange={e => setTkClientSecret(e.target.value)} type="password" placeholder="Client Secret" className="w-full px-2 py-1 text-xs border rounded bg-white" />
            <p className="text-[9px] text-muted">From developers.tiktok.com → your app → App credentials</p>
            <div className="flex gap-1">
              <button onClick={async () => {
                setTkSaving(true)
                try {
                  await api.saveTiktokCredentials(tkClientKey, tkClientSecret)
                  setShowTiktokSetup(false)
                  setTkClientKey(''); setTkClientSecret('')
                  onRefresh()
                } catch (e) { alert(e.message) }
                setTkSaving(false)
              }} disabled={tkSaving || !tkClientKey || !tkClientSecret} className="px-2 py-0.5 text-[10px] bg-[#2D9A5E] text-white rounded disabled:opacity-50">
                {tkSaving ? 'Saving...' : 'Save'}
              </button>
              <button onClick={() => { setShowTiktokSetup(false); setTkClientKey(''); setTkClientSecret('') }} className="px-2 py-0.5 text-[10px] border rounded">Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* YouTube */}
      <div className="flex items-center justify-between text-xs py-0.5">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.youtube_connected ? '#2D9A5E' : '#ccc' }} />
          <span>{s.youtube_connected ? `YouTube (${s.youtube_channel_name})` : 'YouTube'}</span>
        </div>
        {s.youtube_connected
          ? <button onClick={async () => { if (!confirm('Disconnect YouTube?')) return; await api.disconnectYoutube(); onRefresh() }} className={`${btn} text-[#c0392b]`}>Disconnect</button>
          : s.youtube_app_configured
            ? <button onClick={async () => {
                try {
                  const data = await api.startYoutubeConnect()
                  if (data.error) return
                  if (data.url) {
                    const popup = window.open(data.url, 'youtube-connect', 'width=600,height=700')
                    const handler = (e) => {
                      if (e.data && e.data.type === 'youtube-connected') {
                        window.removeEventListener('message', handler)
                        onRefresh()
                      }
                    }
                    window.addEventListener('message', handler)
                    const check = setInterval(() => {
                      if (popup && popup.closed) { clearInterval(check); onRefresh() }
                    }, 1000)
                  }
                } catch (err) { console.error(err) }
              }} className={`${btn} bg-[#FF0000] text-white border-[#FF0000]`}>Connect</button>
            : <span className="text-[10px] text-muted italic">Not available</span>
        }
      </div>

      {/* Pinterest — hidden, deprioritized for current client base */}

      {/* WordPress */}
      <div className="text-xs py-0.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.wp_site_url ? '#2D9A5E' : '#ccc' }} />
            <span>{s.wp_site_url ? `WordPress (${s.wp_username})` : 'WordPress'}</span>
          </div>
          {!s.wp_site_url && !showWpSetup && (
            <button onClick={() => setShowWpSetup(true)} className="text-[10px] text-[#2D9A5E] hover:underline">Set up</button>
          )}
          {s.wp_site_url && (
            <div className="flex gap-1">
              <button onClick={() => setShowWpSetup(true)} className="text-[10px] text-muted hover:underline">Edit</button>
              <button onClick={async () => { await api.disconnectWp(); onRefresh() }} className="text-[10px] text-red-500 hover:underline">Disconnect</button>
            </div>
          )}
        </div>
        {showWpSetup && (
          <div className="mt-1 space-y-1">
            <input value={wpUrl} onChange={e => setWpUrl(e.target.value)} placeholder="https://yoursite.com" className="w-full px-2 py-1 text-xs border rounded bg-white" />
            <input value={wpUser} onChange={e => setWpUser(e.target.value)} placeholder="WordPress username" className="w-full px-2 py-1 text-xs border rounded bg-white" />
            <input value={wpPass} onChange={e => setWpPass(e.target.value)} type="password" placeholder="Application password" className="w-full px-2 py-1 text-xs border rounded bg-white" />
            <p className="text-[9px] text-muted">In WP Admin → Users → Profile → Application Passwords</p>
            <div className="flex gap-1">
              <button onClick={async () => {
                setWpSaving(true)
                try {
                  await api.saveWpCredentials(wpUrl, wpUser, wpPass)
                  setShowWpSetup(false)
                  setWpUrl(''); setWpUser(''); setWpPass('')
                  onRefresh()
                } catch (e) { alert(e.message) }
                setWpSaving(false)
              }} disabled={wpSaving || !wpUrl || !wpUser || !wpPass} className="px-2 py-0.5 text-[10px] bg-[#2D9A5E] text-white rounded disabled:opacity-50">
                {wpSaving ? 'Testing...' : 'Save & test'}
              </button>
              <button onClick={() => setShowWpSetup(false)} className="px-2 py-0.5 text-[10px] text-muted hover:underline">Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
