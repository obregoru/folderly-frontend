import { useState, useEffect, useRef } from 'react'
import * as api from '../api'
import HelpTip from './HelpTip'

const BUSINESS_TYPES = [
  'Make & Take studio', 'Escape room', 'Axe throwing venue', 'Paint & sip studio',
  'Pottery studio', 'Candle making studio', 'Salon / spa', 'Restaurant', 'Bakery',
  'Coffee shop', 'Brewery / taproom', 'Fitness studio / gym', 'Yoga studio',
  'Photography studio', 'Florist', 'Boutique retail', 'Event venue',
]

const TONES = ['warm', 'funny', 'upbeat', 'inviting', 'engaging', 'informal', 'formal']
const POVS = ['first_plural', 'first_singular', 'second', 'third']
const POV_LABELS = { first_plural: 'We / Us', first_singular: 'I / Me', second: 'You / Your', third: 'The shop' }
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

export default function Sidebar({ settings, onSave, hashtagSets, selectedHashtagSetId, autoHashtagSetId, onSelectHashtag, onHashtagsChange, seoKeywordSets = [], selectedSeoKeywordSetId, autoSeoKeywordSetId, onSelectSeoKeywordSet, onSeoKeywordSetsChange, rules, onRulesChange, apiUrl }) {
  const [hsFormOpen, setHsFormOpen] = useState(false)
  const [hsName, setHsName] = useState('')
  const [hsTags, setHsTags] = useState('')
  const [skFormOpen, setSkFormOpen] = useState(false)
  const [skName, setSkName] = useState('')
  const [skKeywords, setSkKeywords] = useState('')

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

  const handleAddSeoKeywordSet = () => {
    if (!skName.trim() || !skKeywords.trim()) return
    api.createSeoKeywordSet(skName, skKeywords).then(() => {
      setSkFormOpen(false); setSkName(''); setSkKeywords('')
      if (onSeoKeywordSetsChange) onSeoKeywordSetsChange()
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
        <div className="s-head">Brand profile <HelpTip text="Your business identity. AI uses this to write content that sounds like your brand — name, type, location, and custom rules." /></div>
        <div className="mb-2"><label className="text-[11px] text-muted block mb-0.5">Business name</label>
          <input className="field-input" value={s.name || ''} onChange={e => save('name', e.target.value)} onBlur={e => save('name', e.target.value)} /></div>
        <div className="mb-2"><label className="text-[11px] text-muted block mb-0.5">Booking / CTA URL</label>
          <input className="field-input" placeholder="https://book.example.com" value={s.target_url || ''} onChange={e => save('target_url', e.target.value)} /></div>
        <div className="mb-2"><label className="text-[11px] text-muted block mb-0.5">Location</label>
          <input className="field-input" value={s.location || ''} onChange={e => save('location', e.target.value)} /></div>
        <div className="mb-2"><label className="text-[11px] text-muted block mb-0.5">Business type</label>
          <input className="field-input" list="biz-type-list" placeholder="Type or select (leave blank to exclude)" value={s.business_type || ''} onChange={e => save('business_type', e.target.value)} />
          <datalist id="biz-type-list">{BUSINESS_TYPES.map(t => <option key={t} value={t} />)}</datalist></div>
        <div className="mb-2"><label className="text-[11px] text-muted block mb-0.5">Brand rules <HelpTip text="Custom instructions the AI must follow. E.g. 'Never mention competitors', 'Always call it a studio not a shop', 'Use emoji sparingly'. These override default behavior." /></label>
          <textarea rows={5} className="field-input resize-none" value={s.brand_rules || ''} onChange={e => save('brand_rules', e.target.value)} /></div>
        <div className="mb-2"><label className="text-[11px] text-muted block mb-0.5">SEO keywords <HelpTip text="Global brand-level keywords that always apply. Keyword sets below add activity-specific keywords on top of these." /></label>
          <input className="field-input" placeholder="perfume making, candle workshop, date night Milwaukee" value={s.seo_keywords || ''} onChange={e => save('seo_keywords', e.target.value)} /></div>

        {/* SEO keyword sets */}
        <div className="mb-2">
          <label className="text-[11px] text-muted block mb-0.5">SEO keyword sets <HelpTip text="Activity-specific SEO keyword groups (e.g. 'Perfume Bar', 'Candle Making'). Select one before generating content to add those keywords to the prompt. Stacks with the global SEO keywords above." /> <span className="float-right text-[10px] text-sage cursor-pointer" onClick={() => setSkFormOpen(true)}>+ add</span></label>
          <div className="flex flex-col gap-1.5">
            {seoKeywordSets.length === 0 && <span className="text-[10px] text-muted">No sets yet</span>}
            {seoKeywordSets.map(sk => (
              <div key={sk.id} className={`border rounded-sm overflow-hidden ${selectedSeoKeywordSetId === sk.id ? 'border-terra' : 'border-border'}`}>
                <div className={`flex items-center justify-between px-2 py-1 cursor-pointer ${selectedSeoKeywordSetId === sk.id ? 'bg-terra-light' : 'bg-cream'}`}>
                  <span className={`text-[11px] font-medium ${selectedSeoKeywordSetId === sk.id ? 'text-terra' : 'text-ink'} flex items-center gap-1`}>
                    {sk.name}
                    {autoSeoKeywordSetId === sk.id && <span className="text-[8px] text-[#6C5CE7] bg-[#f3f0ff] border border-[#6C5CE7] rounded-full px-1 py-0 font-normal" title="Auto-selected from your description">auto</span>}
                  </span>
                  <span className="flex gap-1.5 items-center">
                    <span className="text-[9px] text-sage cursor-pointer" onClick={() => onSelectSeoKeywordSet(selectedSeoKeywordSetId === sk.id ? null : sk.id)}>
                      {selectedSeoKeywordSetId === sk.id ? 'selected' : 'select'}
                    </span>
                    <span className="text-[9px] text-muted cursor-pointer" onClick={() => { if (confirm(`Delete "${sk.name}"?`)) api.deleteSeoKeywordSet(sk.id).then(onSeoKeywordSetsChange) }}>delete</span>
                  </span>
                </div>
                <textarea className="w-full text-[10px] font-sans p-1.5 border-none border-t border-border resize-y min-h-[32px] leading-relaxed text-ink bg-white"
                  defaultValue={sk.keywords} onBlur={e => { if (e.target.value !== sk.keywords) api.updateSeoKeywordSet(sk.id, e.target.value).then(onSeoKeywordSetsChange) }} />
              </div>
            ))}
          </div>
          {skFormOpen && (
            <div className="mt-1.5">
              <input className="field-input mb-1 text-[11px]" placeholder="Set name (e.g. Perfume Bar)" value={skName} onChange={e => setSkName(e.target.value)} />
              <textarea className="field-input mb-1 text-[11px] resize-y min-h-[48px]" placeholder="keyword 1, keyword 2, keyword 3" value={skKeywords} onChange={e => setSkKeywords(e.target.value)} />
              <div className="flex gap-1">
                <button className="text-[10px] py-0.5 px-2.5 bg-sage text-white border-none rounded-sm cursor-pointer font-sans" onClick={handleAddSeoKeywordSet}>Save</button>
                <button className="text-[10px] py-0.5 px-2.5 bg-cream border border-border rounded-sm cursor-pointer font-sans" onClick={() => setSkFormOpen(false)}>Cancel</button>
              </div>
            </div>
          )}
        </div>

        {/* Hashtag sets */}
        <div className="mb-2">
          <label className="text-[11px] text-muted block mb-0.5">Hashtag sets <HelpTip text="Reusable groups of hashtags. Create sets for different themes (e.g. 'Birthday', 'Date Night'). Select one before generating content to include those hashtags." /> <span className="float-right text-[10px] text-sage cursor-pointer" onClick={() => setHsFormOpen(true)}>+ add</span></label>
          <div className="flex flex-col gap-1.5">
            {hashtagSets.length === 0 && <span className="text-[10px] text-muted">No sets yet</span>}
            {hashtagSets.map(hs => (
              <div key={hs.id} className={`border rounded-sm overflow-hidden ${selectedHashtagSetId === hs.id ? 'border-terra' : 'border-border'}`}>
                <div className={`flex items-center justify-between px-2 py-1 cursor-pointer ${selectedHashtagSetId === hs.id ? 'bg-terra-light' : 'bg-cream'}`}>
                  <span className={`text-[11px] font-medium ${selectedHashtagSetId === hs.id ? 'text-terra' : 'text-ink'} flex items-center gap-1`}>
                    {hs.name}
                    {autoHashtagSetId === hs.id && <span className="text-[8px] text-[#6C5CE7] bg-[#f3f0ff] border border-[#6C5CE7] rounded-full px-1 py-0 font-normal" title="Auto-selected from your description">auto</span>}
                  </span>
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
        <div className="flex items-center justify-between text-xs py-0.5"><span>Keep anonymous <HelpTip text="When on, AI won't mention your business name, products, or services. Content describes the photo only — great for personal/generic content." /></span><Toggle on={s.keep_anonymous !== false} onChange={v => save('keep_anonymous', v)} /></div>
        <div className="flex items-center justify-between text-xs py-0.5"><span>Brand name in filenames <HelpTip text="Prepends your business name to exported filenames for SEO. E.g. 'poppy-and-thyme-birthday-group.jpg' instead of 'birthday-group.jpg'." /></span><Toggle on={s.seo_prepend_brand !== false} onChange={v => save('seo_prepend_brand', v)} /></div>
        <div className="flex items-center justify-between text-xs py-0.5"><span>Watermark exports <HelpTip text="Adds your logo as a watermark to exported images. Upload your logo below. Watermark appears on platform-cropped exports." /></span><Toggle on={s.watermark_enabled === true} onChange={v => save('watermark_enabled', v)} /></div>
        {s.watermark_enabled && (
          <WatermarkUpload path={s.watermark_path} onUploaded={(path) => save('watermark_path', path)} />
        )}
      </div>

      {/* Connected accounts */}
      <div>
        <div className="s-head">Connected accounts <HelpTip text="Connect your social media accounts to post directly from Posty Posty. Each platform requires its own authentication." /></div>
        <SocialConnections settings={s} apiUrl={apiUrl} onRefresh={() => api.getSettings().then(s => onSave(s))} />
      </div>

      {/* Notifications */}
      <NotificationSettings settings={s} />

      {/* Default hashtags per platform */}
      <div>
        <div className="s-head">Default hashtags <HelpTip text="Hashtags automatically added to every post on each platform. Set per-platform or use 'All platforms' for shared ones. Limits: TikTok 5, Instagram 30, X/Twitter 3-5. Google doesn't use hashtags." /></div>
        <div className="space-y-1.5">
          <div>
            <label className="text-[10px] text-muted">All platforms <span className="text-[9px]">(added to every post)</span></label>
            <input className="field-input text-[11px]" placeholder="#smallbusiness #handmade" value={s.default_hashtags_all || ''} onChange={e => save('default_hashtags_all', e.target.value)} />
          </div>
          {[
            { key: 'tiktok', label: 'TikTok', limit: 5, placeholder: '#fyp #viral', show: s.platform_tiktok },
            { key: 'instagram', label: 'Instagram', limit: 30, placeholder: '#instagood #explore', show: s.platform_instagram },
            { key: 'facebook', label: 'Facebook', limit: 5, placeholder: '#supportlocal', show: s.platform_facebook },
            { key: 'twitter', label: 'X / Twitter', limit: 3, placeholder: '#local', show: s.platform_twitter },
            { key: 'youtube', label: 'YouTube', limit: 15, placeholder: '#shorts #diy', show: s.platform_youtube },
          ].filter(p => p.show).map(p => (
            <div key={p.key}>
              <label className="text-[10px] text-muted">{p.label} <span className="text-[9px]">(max {p.limit})</span></label>
              <input className="field-input text-[11px]" placeholder={p.placeholder} value={s[`default_hashtags_${p.key}`] || ''} onChange={e => save(`default_hashtags_${p.key}`, e.target.value)} />
            </div>
          ))}
        </div>
      </div>

      {/* TikTok hooks */}
      {s.platform_tiktok && (
        <div>
          <div className="s-head">TikTok hooks <HelpTip text="Custom opening hooks for TikTok content. AI will use one of these styles to start the post. E.g. 'POV:', 'Wait for it...'" /></div>
          <input className="field-input" placeholder="POV:, Wait for it..." value={(s.tiktok_hooks || []).join(', ')} onChange={e => {
            const hooks = e.target.value.split(',').map(h => h.trim()).filter(Boolean);
            save('tiktok_hooks', hooks);
          }} />
        </div>
      )}

      {/* This batch */}
      <div>
        <div className="s-head">This batch <HelpTip text="Settings that apply to the current upload batch. Occasion and availability context help AI write more relevant content." /></div>
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
          <label className="text-[10px] text-muted uppercase tracking-wider">Content rules</label>
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
        <div className="s-head">Tone <HelpTip text="The mood of your content. Select multiple to mix tones. AI adapts its writing style to match." /></div>
        <ChipGrid items={TONES.map(t => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) }))} active={s.default_tone || 'warm'} multi onToggle={v => {
          const current = (s.default_tone || 'warm').split(', ')
          const next = current.includes(v) ? current.filter(x => x !== v) : [...current, v]
          save('default_tone', next.length ? next.join(', ') : 'warm')
        }} />
      </div>

      {/* POV */}
      <div>
        <div className="s-head">Point of view <HelpTip text="Who is 'speaking' in the content. 'We/Us' for the team, 'I/Me' for the owner, 'You/Your' to speak to the customer." /></div>
        <ChipGrid items={POVS.map(p => ({ value: p, label: POV_LABELS[p] }))} active={s.default_pov || 'first_plural'} onToggle={v => save('default_pov', v)} />
      </div>

      {/* Marketing level */}
      <div>
        <div className="s-head">Marketing level <HelpTip text="How salesy the content sounds. Subtle = casual sharing, no hard sell. Balanced = light CTA. Strong = clear calls to action and urgency." /></div>
        <ChipGrid items={MKT_LEVELS.map(m => ({ value: m, label: m.charAt(0).toUpperCase() + m.slice(1) }))} active={s.marketing_intensity || 'balanced'} onToggle={v => save('marketing_intensity', v)} />
      </div>

      {/* Engagement hooks */}
      <div>
        <div className="s-head">Engagement hooks <HelpTip text="Techniques to get people interacting. Questions get comments, 'Caption this' gets shares, Storytelling builds connection. Select multiple." /></div>
        <ChipGrid cols={2} multi items={HOOKS.map(h => ({ value: h, label: HOOK_LABELS[h] }))} active={activeHooks} onToggle={v => {
          const next = activeHooks.includes(v) ? activeHooks.filter(x => x !== v) : [...activeHooks, v]
          save('engagement_hooks', next)
        }} />
      </div>

      {/* Caption length */}
      <div>
        <div className="s-head">Content length <HelpTip text="Short = punchy one-liners. Medium = a few sentences. Long = detailed storytelling. Each platform gets an appropriate length." /></div>
        <ChipGrid items={LENGTHS.map(l => ({ value: l, label: LENGTH_LABELS[l] }))} active={s.caption_length || 'large'} onToggle={v => save('caption_length', v)} />
      </div>

      {/* Platforms */}
      <div>
        <div className="s-head">Platforms <HelpTip text="Which platforms to generate content for. Each gets custom content optimized for that platform's format and audience." /></div>
        {[['platform_tiktok', 'TikTok', true], ['platform_instagram', 'Instagram', true], ['platform_facebook', 'Facebook', true], ['platform_twitter', 'X / Twitter', false], ['platform_google', 'Google Business', false], ['platform_blog', 'Blog post', false], ['platform_youtube', 'YouTube', false]].map(([key, label, defaultOn]) => (
          <div key={key} className="flex items-center justify-between text-xs md:text-xs text-[13px] py-2 md:py-0.5 mt-1 md:mt-1.5 min-h-[44px] md:min-h-0">
            <span>{label}</span>
            <Toggle on={defaultOn ? s[key] !== false : s[key] === true} onChange={v => save(key, v)} />
          </div>
        ))}
      </div>

      {/* Audience targeting (per platform) */}
      <div>
        <div className="s-head">Audience targeting <HelpTip text="Optional: describe who you're talking to on each platform (e.g. 'younger crowd, date nights' for TikTok). AI will adapt framing and references to resonate, while keeping your brand voice. Leave blank to skip." /></div>
        {[
          { key: 'tiktok', label: 'TikTok', enabled: s.platform_tiktok !== false, placeholder: 'e.g. younger crowd, date nights, friends' },
          { key: 'instagram', label: 'Instagram', enabled: s.platform_instagram !== false, placeholder: 'e.g. aesthetic lifestyle, aspirational' },
          { key: 'facebook', label: 'Facebook', enabled: s.platform_facebook !== false, placeholder: 'e.g. family, birthdays, local community' },
          { key: 'twitter', label: 'X / Twitter', enabled: s.platform_twitter === true, placeholder: 'e.g. industry peers, quick takes' },
          { key: 'google', label: 'Google Business', enabled: s.platform_google === true, placeholder: 'e.g. local customers searching for services' },
          { key: 'blog', label: 'Blog', enabled: s.platform_blog === true, placeholder: 'e.g. SEO readers, informational searchers' },
          { key: 'youtube', label: 'YouTube', enabled: s.platform_youtube === true, placeholder: 'e.g. younger viewers, trend-aware' },
        ].filter(p => p.enabled).map(p => (
          <div key={p.key} className="mt-1.5">
            <label className="text-[10px] text-muted block mb-0.5">{p.label}</label>
            <input
              className="field-input text-[11px]"
              placeholder={p.placeholder}
              value={(s.platform_audiences && s.platform_audiences[p.key]) || ''}
              onChange={e => {
                const next = { ...(s.platform_audiences || {}), [p.key]: e.target.value }
                save('platform_audiences', next)
              }}
            />
          </div>
        ))}
      </div>

      {/* Quality */}
      <div>
        <div className="s-head">Quality <HelpTip text="AI detection checks if content sounds human. 'Sound more human' rewrites YouTube/Blog content to pass AI detection tools." /></div>
        <div className="flex items-center justify-between text-xs py-0.5"><span>AI detection scoring</span><Toggle on={s.ai_detection_enabled === true} onChange={v => save('ai_detection_enabled', v)} /></div>
        {s.ai_detection_enabled && (
          <div className="ml-0 mt-1 mb-2 space-y-1.5">
            <div className="flex gap-2 items-center">
              <label className="text-[10px] text-muted">Provider:</label>
              <select className="field-input text-[11px] py-0.5 flex-1" value={s.ai_detection_provider || 'builtin'} onChange={e => save('ai_detection_provider', e.target.value)}>
                <option value="builtin">Built-in (heuristic)</option>
                <option value="zerogpt">ZeroGPT API</option>
              </select>
            </div>
            {(s.ai_detection_provider === 'zerogpt') && (
              <div>
                <label className="text-[10px] text-muted block mb-0.5">ZeroGPT API key</label>
                <input className="field-input text-[11px]" type="password" placeholder="Enter ZeroGPT API key" defaultValue="" onBlur={e => { if (e.target.value) save('zerogpt_api_key', e.target.value) }} />
                {s.zerogpt_api_key && <span className="text-[9px] text-sage mt-0.5 block">Key saved ({s.zerogpt_api_key})</span>}
              </div>
            )}
          </div>
        )}
        <div className="flex items-center justify-between text-xs py-0.5"><span>Sound more human (YouTube) <HelpTip text="Rewrites YouTube descriptions through a second AI pass to sound less robotic and pass AI detection tools." /></span><Toggle on={s.humanize_youtube === true} onChange={v => save('humanize_youtube', v)} /></div>
        <div className="flex items-center justify-between text-xs py-0.5"><span>Sound more human (Blog) <HelpTip text="Rewrites blog posts through a second AI pass to sound more natural and avoid common AI-writing tells." /></span><Toggle on={s.humanize_blog === true} onChange={v => save('humanize_blog', v)} /></div>
        <div className="flex items-center justify-between text-xs py-0.5"><span>Facebook Stories (default) <HelpTip text="When on, the FB Story checkbox is pre-checked when posting. Stories appear at the top of followers' feeds for 24 hours." /></span><Toggle on={s.fb_stories_default === true} onChange={v => save('fb_stories_default', v)} /></div>
        <div className="flex items-center justify-between text-xs py-0.5"><span>YouTube Shorts (default) <HelpTip text="When on, videos upload as YouTube Shorts (vertical, under 60s, #Shorts tag). Turn off to upload as regular YouTube videos." /></span><Toggle on={s.youtube_shorts_default !== false} onChange={v => save('youtube_shorts_default', v)} /></div>
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
      <div className="s-head">Notifications <HelpTip text="Email notifications for scheduled posts. Get notified when posts go out, fail, or need manual posting. Push notifications work automatically via PWA — this is for email alerts." /></div>
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
    const popup = window.open('about:blank', 'fb-connect', 'width=600,height=700')
    try {
      const data = await api.startFbConnect()
      if (data.error) { popup.close(); setFbError(data.error); return }
      if (data.url) {
        popup.location = data.url
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
      } else { popup.close() }
    } catch (err) { popup.close(); setFbError(err.message) }
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
                const popup = window.open('about:blank', 'twitter-connect', 'width=600,height=700')
                try {
                  const data = await api.startTwitterConnect()
                  if (data.url) {
                    popup.location = data.url
                    const handler = (e) => { if (e.data?.type === 'twitter-connected') { window.removeEventListener('message', handler); onRefresh() } }
                    window.addEventListener('message', handler)
                    const check = setInterval(() => { if (popup && popup.closed) { clearInterval(check); onRefresh() } }, 1000)
                  } else { popup.close() }
                } catch (err) { popup.close(); console.error(err) }
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
          {s.google_connected
            ? <button onClick={async () => { if (!confirm('Disconnect Google Business?')) return; await api.disconnectGoogle(); onRefresh() }} className={`${btn} text-[#c0392b]`}>Disconnect</button>
            : s.google_app_configured
              ? <button onClick={async () => {
                  const popup = window.open('about:blank', 'google-connect', 'width=600,height=700')
                  try {
                    const data = await api.startGoogleConnect()
                    if (data.url) {
                      popup.location = data.url
                      const handler = (e) => { if (e.data?.type === 'google-connected') { window.removeEventListener('message', handler); onRefresh() } }
                      window.addEventListener('message', handler)
                      const check = setInterval(() => { if (popup && popup.closed) { clearInterval(check); onRefresh() } }, 1000)
                    } else { popup.close() }
                  } catch (err) { popup.close(); console.error(err) }
                }} className={`${btn} text-[#2D9A5E]`}>Connect</button>
              : null
          }
        </div>
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
                const popup = window.open('about:blank', 'tiktok-connect', 'width=600,height=700')
                try {
                  const data = await api.startTiktokConnect()
                  if (data.url) {
                    popup.location = data.url
                    const handler = (e) => { if (e.data?.type === 'tiktok-connected') { window.removeEventListener('message', handler); onRefresh() } }
                    window.addEventListener('message', handler)
                    const check = setInterval(() => { if (popup && popup.closed) { clearInterval(check); onRefresh() } }, 1000)
                  } else { popup.close() }
                } catch (err) { popup.close(); console.error(err) }
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
                const popup = window.open('about:blank', 'youtube-connect', 'width=600,height=700')
                try {
                  const data = await api.startYoutubeConnect()
                  if (data.error) { popup.close(); return }
                  if (data.url) {
                    popup.location = data.url
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
                  } else { popup.close() }
                } catch (err) { popup.close(); console.error(err) }
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

      {/* Posting Schedule */}
      <PostingSchedule settings={s} />

      {/* Platform Analytics */}
      <PlatformAnalytics />
    </div>
  )
}

const ANALYTICS_PLATFORMS = [
  { key: 'instagram', label: 'Instagram', color: '#E1306C', where: 'Instagram app → Professional dashboard → Insights → Audience → Most Active Times' },
  { key: 'facebook', label: 'Facebook', color: '#1877F2', where: 'Meta Business Suite → Insights → Audience → When Your Fans Are Online' },
  { key: 'tiktok', label: 'TikTok', color: '#000', where: 'TikTok app → Profile → Creator tools → Analytics → Followers → Most Active Times' },
  { key: 'youtube', label: 'YouTube', color: '#FF0000', where: 'YouTube Studio → Analytics → Audience → When Your Viewers Are on YouTube' },
  { key: 'twitter', label: 'X / Twitter', color: '#000', where: 'X Analytics (analytics.x.com) → Tweet Activity → Engagement by time' },
  { key: 'google', label: 'Google Business', color: '#4285F4', where: 'Google Business Profile → Performance → Calls/Directions/Website clicks by time. Also: Google Search Console → Performance → clicks by date' },
]

function PlatformAnalytics() {
  const [expanded, setExpanded] = useState(false)
  const [analytics, setAnalytics] = useState(null)
  const [activePlat, setActivePlat] = useState(null)
  const [pasteText, setPasteText] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [result, setResult] = useState(null)

  useEffect(() => {
    api.getAnalytics().then(d => setAnalytics(d)).catch(() => {})
  }, [])

  const handleAnalyze = async (platform) => {
    if (!pasteText.trim()) return
    setAnalyzing(true); setResult(null)
    try {
      const r = await api.analyzeAnalytics(platform, pasteText)
      if (r.error) { setResult({ error: r.error }); setAnalyzing(false); return }
      setResult(r.data)
      setAnalytics(prev => ({ ...prev, [platform]: { ...r.data, updated_at: new Date().toISOString() } }))
      setPasteText('')
    } catch (e) { setResult({ error: e.message }) }
    setAnalyzing(false)
  }

  return (
    <div className="mt-3 pt-2 border-t border-border">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-medium text-ink">Platform analytics</span>
        <button onClick={() => setExpanded(!expanded)} className="text-[10px] text-sage hover:underline">
          {expanded ? 'Hide' : analytics && Object.keys(analytics).length > 0 ? `${Object.keys(analytics).length} platforms` : 'Set up'}
        </button>
      </div>
      {expanded && (
        <div className="space-y-2">
          <p className="text-[9px] text-muted">Paste analytics data from each platform to improve AI posting time suggestions.</p>
          <div className="flex flex-wrap gap-1">
            {ANALYTICS_PLATFORMS.map(p => (
              <button
                key={p.key}
                onClick={() => { setActivePlat(activePlat === p.key ? null : p.key); setResult(null); setPasteText('') }}
                className={`text-[9px] py-0.5 px-1.5 rounded border cursor-pointer ${activePlat === p.key ? 'text-white border-transparent' : 'text-muted border-border bg-white hover:bg-cream'}`}
                style={activePlat === p.key ? { background: p.color, borderColor: p.color } : {}}
              >
                {p.label} {analytics?.[p.key] ? '\u2713' : ''}
              </button>
            ))}
          </div>
          {activePlat && (() => {
            const plat = ANALYTICS_PLATFORMS.find(p => p.key === activePlat)
            const stored = analytics?.[activePlat]
            return (
              <div className="space-y-1.5">
                <p className="text-[9px] text-muted">
                  <strong>Where to find it:</strong> {plat.where}
                </p>
                {stored && (
                  <div className="bg-[#f8f9fa] border border-border rounded p-1.5">
                    <p className="text-[9px] text-muted mb-0.5">Last updated: {new Date(stored.updated_at).toLocaleDateString()}</p>
                    {stored.summary && <p className="text-[10px] text-ink">{stored.summary}</p>}
                    {stored.best_days?.length > 0 && <p className="text-[9px] text-muted mt-0.5">Best days: {stored.best_days.join(', ')}</p>}
                    {stored.peak_times?.length > 0 && (
                      <p className="text-[9px] text-muted">Peak: {stored.peak_times.slice(0, 5).map(t => `${t.day} ${t.time}`).join(', ')}</p>
                    )}
                  </div>
                )}
                <textarea
                  rows={4}
                  value={pasteText}
                  onChange={e => setPasteText(e.target.value)}
                  className="w-full text-[10px] border border-border rounded p-1.5 bg-white resize-y font-sans"
                  placeholder={`Paste your ${plat.label} analytics/insights data here...\n\nCopy the text from your ${plat.label} insights page — AI will extract the useful data.`}
                />
                <button
                  onClick={() => handleAnalyze(activePlat)}
                  disabled={analyzing || !pasteText.trim()}
                  className="text-[10px] py-1 px-2 border border-[#6C5CE7] text-[#6C5CE7] rounded cursor-pointer disabled:opacity-50"
                >
                  {analyzing ? 'Analyzing...' : stored ? 'Update analytics' : 'Analyze with AI'}
                </button>
                {result?.error && <p className="text-[9px] text-[#c0392b]">{result.error}</p>}
                {result?.summary && !result.error && <p className="text-[9px] text-[#2D9A5E]">Updated: {result.summary}</p>}
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}

function PostingSchedule({ settings }) {
  const saved = settings?.posting_schedule
  const parsed = saved ? (typeof saved === 'string' ? (() => { try { return JSON.parse(saved) } catch { return null } })() : saved) : null
  const [schedule, setSchedule] = useState(parsed)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState('')

  // Sync when settings load/change
  useEffect(() => {
    if (parsed && !schedule) setSchedule(parsed)
  }, [parsed])

  const generate = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await api.getPostingSchedule()
      if (data.error) { setError(data.error); return }
      setSchedule(data)
      setExpanded(true)
    } catch (err) { setError(err.message) }
    setLoading(false)
  }

  const dayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

  return (
    <div className="mt-3 pt-2 border-t border-border">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-medium text-ink">Best times to post</span>
        <div className="flex gap-1">
          {schedule && (
            <button
              onClick={generate}
              disabled={loading}
              className="text-[10px] py-0.5 px-2 border border-[#6C5CE7] rounded-sm text-[#6C5CE7] cursor-pointer font-sans hover:bg-[#6C5CE7] hover:text-white disabled:opacity-50"
            >
              {loading ? 'Analyzing...' : 'Refresh'}
            </button>
          )}
          <button
            onClick={schedule ? () => setExpanded(!expanded) : generate}
            disabled={loading}
            className="text-[10px] py-0.5 px-2 border border-sage rounded-sm bg-sage-light text-sage cursor-pointer font-sans hover:bg-sage hover:text-white disabled:opacity-50"
          >
            {loading ? 'Analyzing...' : schedule ? (expanded ? 'Hide' : 'Show') : 'Suggest schedule'}
          </button>
        </div>
      </div>
      {error && <p className="text-[10px] text-[#c0392b]">{error}</p>}
      {expanded && schedule && (
        <div className="mt-1 space-y-2">
          {schedule.schedule?.map((plat, i) => (
            <div key={i}>
              <div className="text-[10px] font-medium text-ink mb-0.5">{plat.platform}</div>
              {plat.slots?.sort((a, b) => dayOrder.indexOf(a.day) - dayOrder.indexOf(b.day)).map((slot, j) => (
                <div key={j} className="flex items-start gap-1.5 pl-2 py-0.5">
                  <span className="text-[10px] text-ink font-medium min-w-[65px]">{slot.day}</span>
                  <span className="text-[10px] text-sage font-medium min-w-[55px]">{slot.time}</span>
                  <span className="text-[10px] text-muted">{slot.reason}</span>
                </div>
              ))}
            </div>
          ))}
          {schedule.tips?.length > 0 && (
            <div className="mt-1.5 pt-1.5 border-t border-border">
              <div className="text-[10px] font-medium text-ink mb-0.5">Tips</div>
              {schedule.tips.map((tip, i) => (
                <p key={i} className="text-[10px] text-muted pl-2">- {tip}</p>
              ))}
            </div>
          )}
          {schedule.posting_frequency && (
            <p className="text-[10px] text-muted italic mt-1">{schedule.posting_frequency}</p>
          )}
          <button onClick={generate} disabled={loading} className="text-[10px] text-sage hover:underline mt-1">
            {loading ? 'Regenerating...' : 'Regenerate'}
          </button>
        </div>
      )}
    </div>
  )
}
