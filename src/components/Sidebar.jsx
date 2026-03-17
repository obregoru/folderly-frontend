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
  return (
    <div className="grid gap-[5px]" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
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
    <aside className="bg-white border-r border-border p-4 overflow-y-auto flex flex-col gap-5">
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
        {[['platform_tiktok', 'TikTok', true], ['platform_instagram', 'Instagram', true], ['platform_facebook', 'Facebook', true], ['platform_twitter', 'X / Twitter', false], ['platform_google', 'Google Business', false], ['platform_blog', 'Blog post', false]].map(([key, label, defaultOn]) => (
          <div key={key} className="flex items-center justify-between text-xs py-0.5 mt-1.5">
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

function SocialConnections({ settings, apiUrl, onRefresh }) {
  const s = settings
  const [showFbSetup, setShowFbSetup] = useState(false)
  const [fbAppId, setFbAppId] = useState('')
  const [fbAppSecret, setFbAppSecret] = useState('')
  const [fbSaving, setFbSaving] = useState(false)
  const [fbError, setFbError] = useState('')

  const handleSaveFbCreds = async () => {
    if (!fbAppId || !fbAppSecret) return
    setFbSaving(true)
    setFbError('')
    try {
      const data = await api.saveFbCredentials(fbAppId, fbAppSecret)
      if (data.ok) {
        setShowFbSetup(false)
        setFbAppId(''); setFbAppSecret('')
        onRefresh()
      } else {
        setFbError(data.error || 'Failed')
      }
    } catch (err) { setFbError(err.message) }
    setFbSaving(false)
  }

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
    if (!confirm('Reset Facebook credentials? You will need to re-enter the App ID and Secret.')) return
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
          <span>{s.fb_connected ? s.fb_page_name : 'Facebook'}</span>
        </div>
        {s.fb_connected
          ? <div className="flex gap-1">
              <button onClick={handleDisconnectFb} className={`${btn} text-[#c0392b]`}>Disconnect</button>
              <button onClick={handleResetFb} className={`${btn} text-muted`}>Reset</button>
            </div>
          : <div className="flex gap-1">
              {s.fb_app_configured && <button onClick={handleConnectFb} className={`${btn} bg-[#1877F2] text-white border-[#1877F2]`}>Connect Page</button>}
              <button onClick={() => setShowFbSetup(true)} className={`${btn}`}>{s.fb_app_configured ? 'Edit' : 'Set up'}</button>
            </div>
        }
      </div>
      {showFbSetup && (
        <div className="bg-[#fff3cd] border-2 border-[#856404] rounded p-2 text-[11px]">
          <p className="text-muted mb-1.5">Enter your Facebook App credentials from <a href="https://developers.facebook.com" target="_blank" rel="noopener" className="text-sage underline">developers.facebook.com</a></p>
          <input className={`${inp} mb-1.5`} placeholder="App ID" value={fbAppId} onChange={e => setFbAppId(e.target.value)} />
          <input className={`${inp} mb-1.5`} placeholder="App Secret" type="password" value={fbAppSecret} onChange={e => setFbAppSecret(e.target.value)} />
          {fbError && <p className="text-[#c0392b] text-[10px] mb-1">{fbError}</p>}
          <div className="flex gap-1">
            <button onClick={handleSaveFbCreds} disabled={fbSaving} className={`${btn} bg-sage text-white border-sage`}>{fbSaving ? 'Saving...' : 'Save'}</button>
            <button onClick={() => setShowFbSetup(false)} className={btn}>Cancel</button>
          </div>
        </div>
      )}
      {s.fb_app_configured && !s.fb_connected && (
        <div className="flex items-center justify-between pl-3.5">
          <span className="text-[10px] text-muted">App configured</span>
          <button onClick={handleResetFb} className={`${btn} text-[#c0392b]`}>Reset</button>
        </div>
      )}

      {/* Instagram (auto-connected via Facebook Page link) */}
      <div className="flex items-center justify-between text-xs py-0.5">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.ig_connected ? '#2D9A5E' : '#ccc' }} />
          <span>{s.ig_connected ? `@${s.ig_username}` : 'Instagram'}</span>
        </div>
        {s.ig_connected
          ? <span className="text-[10px] text-sage">Via Facebook</span>
          : <span className="text-[10px] text-muted italic">{s.fb_connected ? 'Link IG to FB Page' : 'Connect FB first'}</span>
        }
      </div>

      {/* X/Twitter */}
      <div className="flex items-center justify-between text-xs py-0.5">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.twitter_connected ? '#2D9A5E' : '#ccc' }} />
          <span>{s.twitter_connected ? `@${s.twitter_username}` : 'X / Twitter'}</span>
        </div>
        <span className="text-[10px] text-muted italic">Coming soon</span>
      </div>

      {/* WordPress */}
      <div className="flex items-center justify-between text-xs py-0.5">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.wp_connected ? '#2D9A5E' : '#ccc' }} />
          <span>{s.wp_connected ? 'WordPress' : 'WordPress'}</span>
        </div>
        <span className="text-[10px] text-muted italic">Coming soon</span>
      </div>
    </div>
  )
}
