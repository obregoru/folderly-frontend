import { useState, useEffect, useCallback, useRef, Component } from 'react'
import * as api from './api'
import { parse, allTags, TONE_DESC } from './lib/parse'
import { loadFaceModel, captureVideoFrame, toBase64 } from './lib/crop'
import { exportAll, exportSeoPhotos, getSeoName } from './lib/export'
import Login from './components/Login'
import Sidebar from './components/Sidebar'
import Dropzone from './components/Dropzone'
import FileGrid from './components/FileGrid'
import ResultCard from './components/ResultCard'
import HistoryModal from './components/HistoryModal'
import RefineModal from './components/RefineModal'
import AdminPanel from './components/AdminPanel'

export default function App() {
  const [user, setUser] = useState(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [connected, setConnected] = useState(false)
  const [settings, setSettings] = useState({})
  const [files, setFiles] = useState([])
  const [folderCtx, setFolderCtx] = useState(null)
  const [hashtagSets, setHashtagSets] = useState([])
  const [selectedHashtagSetId, setSelectedHashtagSetId] = useState(null)
  const [error, setError] = useState(null)
  const [generating, setGenerating] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [refineCtx, setRefineCtx] = useState(null)
  const [showAdmin, setShowAdmin] = useState(false)
  const [rules, setRules] = useState({ name: true, cta: true, brand: true, seo: true, hashtags: true })
  const [userHint, setUserHint] = useState('')

  const tenantSlug = api.tenantSlug()
  const apiUrl = `${import.meta.env.VITE_API_URL || ''}/api/t/${tenantSlug}`

  // Check if already logged in
  useEffect(() => {
    api.getMe().then(u => {
      if (u && u.id) {
        setUser(u)
        // Set tenant slug from user's tenant
        if (u.tenant_id) {
          // Slug will be resolved from URL or localStorage
        }
      }
      setAuthChecked(true)
    }).catch(() => setAuthChecked(true))
  }, [])

  // Load data once authenticated
  useEffect(() => {
    if (!user) return
    loadFaceModel()
    api.checkHealth().then(r => {
      if (r.ok) {
        setConnected(true)
        if (tenantSlug) {
          api.getSettings().then(s => setSettings(s || {})).catch(() => {})
          api.getHashtags().then(h => setHashtagSets(Array.isArray(h) ? h : [])).catch(() => {})
        }
      }
    }).catch(() => setConnected(false))
  }, [user, tenantSlug])

  const handleLogin = (data) => {
    setUser({ id: data.id, email: data.email, role: data.role, tenant_id: data.tenant_id })
    if (data.redirect) {
      const m = data.redirect.match(/\/t\/([^/]+)/)
      if (m) api.setTenantSlug(m[1])
    }
  }

  const showError = msg => { setError(msg); setTimeout(() => setError(null), 7000) }

  const saveSettingsToServer = useCallback((newSettings) => {
    setSettings(prev => {
      const merged = { ...prev, ...newSettings }
      api.saveSettings(merged)
      return merged
    })
  }, [])

  const addFiles = useCallback((fileList, folder) => {
    const newFiles = []
    for (let i = 0; i < fileList.length; i++) {
      const f = fileList[i]
      if (!f.type.startsWith('image/') && !f.type.startsWith('video/')) continue
      if (files.find(x => x.file.name === f.name && x.file.size === f.size)) continue
      const id = Math.random().toString(36).slice(2)
      newFiles.push({
        file: f, id, parsed: parse(f.name.replace(/\.[^.]+$/, '')),
        isImg: f.type.startsWith('image/'), status: null, captions: null, errMsg: null,
      })
    }
    if (newFiles.length) setFiles(prev => [...prev, ...newFiles])
    if (folder) {
      const p = parse(folder)
      setFolderCtx({ name: folder, parsed: p })
    }
  }, [files])

  const removeFile = id => setFiles(prev => prev.filter(f => f.id !== id))

  const clearAll = () => {
    setFiles([])
    setFolderCtx(null)
    setUserHint('')
  }

  const getTones = () => {
    const t = settings.default_tone || 'warm'
    return typeof t === 'string' ? t : 'warm'
  }

  const getActivePlatforms = () => {
    const p = []
    if (settings.platform_tiktok !== false) p.push('tiktok')
    if (settings.platform_instagram !== false) p.push('instagram')
    if (settings.platform_facebook !== false) p.push('facebook')
    if (settings.platform_twitter === true) p.push('twitter')
    if (settings.platform_google === true) p.push('google')
    if (settings.platform_blog === true) p.push('blog')
    return p
  }

  const genCaptions = async (item, batchId) => {
    // Upload file first
    let videoThumb = null
    if (!item.isImg) videoThumb = await captureVideoFrame(item.file)

    const uploadResult = await api.uploadFile(
      item.file,
      folderCtx?.name,
      batchId,
      item.parsed,
      videoThumb
    )
    item.uploadResult = uploadResult
    if (uploadResult.previously_used) {
      item.previouslyUsed = true
      item.previousCaptions = uploadResult.previous_captions
    }

    // Build body
    const merged = {
      occasions: [...(folderCtx?.parsed.occasions || []), ...item.parsed.occasions],
      products: [...(folderCtx?.parsed.products || []), ...item.parsed.products],
      moments: [...(folderCtx?.parsed.moments || []), ...item.parsed.moments],
    }
    const occ = settings.occasion_override || merged.occasions[0] || ''
    const avail = settings.availability_on !== false ? (settings.availability_text || '') : ''
    const platforms = getActivePlatforms()

    const body = {
      filename: item.file.name,
      folder_name: folderCtx?.name || '',
      occasion: occ,
      tone: getTones(),
      availability: avail,
      platforms,
      upload_id: uploadResult.id,
      batch_id: batchId || undefined,
      hashtag_set_id: selectedHashtagSetId || undefined,
      rule_name: rules.name,
      rule_cta: rules.cta,
      rule_brand: rules.brand,
      rule_seo: rules.seo,
      rule_hashtags: rules.hashtags,
      user_hint: userHint || undefined,
    }

    // Add base64 for images
    if (item.isImg) {
      body.base64 = await toBase64(item.file)
      body.media_type = item.file.type || 'image/jpeg'
    }

    // Use streaming endpoint -- returns captions progressively
    const allCaps = {}
    await api.generateStream(body, (partialCaps) => {
      Object.assign(allCaps, partialCaps)
      // Update UI immediately as each batch arrives
      setFiles(prev => prev.map(f => f.id === item.id ? { ...f, status: 'done', captions: { ...f.captions, ...partialCaps }, uploadResult: item.uploadResult, previouslyUsed: item.previouslyUsed, previousCaptions: item.previousCaptions } : f))
    })
    return allCaps
  }

  const runAll = async () => {
    if (!files.length) return
    setGenerating(true)
    try {
      const batch = await api.createBatch(folderCtx?.name, files.length)
      for (let i = 0; i < files.length; i++) {
        const item = files[i]
        item.batchId = batch.id
        setFiles(prev => prev.map(f => f.id === item.id ? { ...f, status: 'loading', captions: null } : f))
        try {
          await genCaptions(item, batch.id)
        } catch (e) {
          showError(`Error on "${item.file.name}": ${e.message}`)
          setFiles(prev => prev.map(f => f.id === item.id ? { ...f, status: 'error', errMsg: e.message } : f))
        }
      }
    } catch (e) {
      showError('Failed to create batch: ' + e.message)
    }
    setGenerating(false)
  }

  const regenOne = async (item) => {
    setFiles(prev => prev.map(f => f.id === item.id ? { ...f, status: 'loading', captions: null } : f))
    try {
      const caps = await genCaptions(item, item.batchId)
      setFiles(prev => prev.map(f => f.id === item.id ? { ...f, status: 'done', captions: caps } : f))
    } catch (e) {
      setFiles(prev => prev.map(f => f.id === item.id ? { ...f, status: 'error', errMsg: e.message } : f))
    }
  }

  const regenAll = async () => {
    for (const item of files.filter(f => f.captions)) {
      await regenOne(item)
    }
  }

  const updateCaption = (itemId, platform, text, captionId) => {
    setFiles(prev => prev.map(f => {
      if (f.id !== itemId) return f
      const captions = { ...f.captions }
      if (typeof captions[platform] === 'object') captions[platform] = { ...captions[platform], text }
      else captions[platform] = text
      return { ...f, captions }
    }))
    if (captionId) api.updateCaption(captionId, text)
  }

  const handleExportAll = async () => {
    setExporting(true)
    try {
      await exportAll(files, tenantSlug, apiUrl)
    } catch (e) {
      showError('Export error: ' + e.message)
    }
    setExporting(false)
  }

  const handleExportSeo = () => exportSeoPhotos(files, apiUrl)

  const handleLogout = () => api.logout().then(() => { setUser(null); api.setTenantSlug('') })

  const hasCaptions = files.some(f => f.captions)

  // Auth gates — must be after all hooks
  if (!authChecked) return null
  if (!user) return <Login onLogin={handleLogin} />

  const isAdmin = user.role === 'super_admin' || user.role === 'tenant_admin'

  if (showAdmin && isAdmin) {
    return <AdminPanel user={user} onBack={() => setShowAdmin(false)} onLogout={handleLogout} />
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 h-[52px] border-b border-border bg-white sticky top-0 z-10">
        <div className="font-serif text-[19px]">posty<span className="text-terra"> posty</span></div>
        <div className="flex items-center gap-2.5">
          <span className={`w-[7px] h-[7px] rounded-full inline-block ${connected ? 'bg-tk' : 'bg-border'}`} />
          <span className="text-[11px] text-muted">
            {connected ? `Connected` : 'Connecting...'}
          </span>
          <button onClick={() => setHistoryOpen(true)} className="text-[11px] py-1 px-3 border border-border rounded-sm bg-cream cursor-pointer font-sans">History</button>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="text-[10px] py-0.5 px-2 bg-terra-light text-terra rounded-full font-medium">Beta</span>
          {isAdmin && <button onClick={() => setShowAdmin(true)} className="text-[11px] py-1 px-3 border border-border rounded-sm bg-cream cursor-pointer font-sans">Admin</button>}
          <button onClick={handleLogout} className="text-[11px] py-1 px-3 border border-border rounded-sm bg-cream cursor-pointer font-sans">Sign out</button>
        </div>
      </nav>

      {/* Shell */}
      <div className="grid grid-cols-[260px_1fr] h-[calc(100vh-52px)]">
        <Sidebar
          settings={settings}
          onSave={saveSettingsToServer}
          hashtagSets={hashtagSets}
          selectedHashtagSetId={selectedHashtagSetId}
          onSelectHashtag={setSelectedHashtagSetId}
          onHashtagsChange={() => api.getHashtags().then(setHashtagSets)}
          rules={rules}
          onRulesChange={setRules}
          apiUrl={apiUrl}
        />

        <main className="p-5 overflow-y-auto flex flex-col gap-4 max-w-[640px]">
          {/* Tips */}
          <div className="text-xs text-muted leading-relaxed text-center">
            <p className="mb-2"><strong className="text-ink">Tip:</strong> Descriptive names help the AI write better captions.</p>
            <p>Name your files with keywords like <strong className="text-ink">couple-reveal-reaction.jpg</strong> instead of IMG_4382.jpg</p>
            <p className="mt-1">Uploading a folder? Name it too — <strong className="text-ink">birthday-group/</strong> tells the AI it's a birthday event. <em className="text-muted">(Optional)</em></p>
          </div>

          {/* User hint */}
          <div>
            <label className="text-[11px] text-muted">Context hint <span className="italic text-[10px]">(optional — tell the AI what's happening)</span></label>
            <textarea
              rows={2}
              value={userHint}
              onChange={e => setUserHint(e.target.value)}
              className="field-input resize-y mt-1"
              placeholder="e.g. This is how many cans of beer we drank during the snow storm"
            />
          </div>

          {error && <div className="bg-[#FBF0F7] border border-[#F4C0D1] rounded-sm py-2 px-3 text-xs text-[#A32D2D]">{error}</div>}

          <Dropzone onFiles={addFiles} />

          <p className="text-[11px] text-muted text-center">Captions are generated for each photo — copy, edit, and post to your platforms.</p>

          {folderCtx && (
            <div className="flex items-start gap-2.5 bg-sage-light border border-[#C2D4C9] rounded-sm py-2 px-3 text-xs">
              <span className="text-base flex-shrink-0">📁</span>
              <div>
                <div>Folder: <span className="font-medium text-sage">{folderCtx.name}/</span></div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {allTags(folderCtx.parsed).map(t => (
                    <span key={t} className="inline-block bg-sage-light text-sage border border-[#C2D4C9] rounded-full px-2 py-0.5 text-[10px]">{t}</span>
                  ))}
                </div>
              </div>
            </div>
          )}

          <FileGrid files={files} onRemove={removeFile} />

          {files.length > 0 && (
            <div className="flex items-center gap-2.5">
              <button
                onClick={runAll}
                disabled={generating}
                className="flex-1 py-2.5 px-4 text-[13px] font-medium font-sans bg-ink text-white border-none rounded-sm cursor-pointer hover:bg-[#333] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {generating ? 'Generating...' : 'Generate captions ↗'}
              </button>
              <span className="text-xs text-muted whitespace-nowrap">{files.length} file{files.length !== 1 ? 's' : ''}</span>
            </div>
          )}

          {/* Results */}
          {files.some(f => f.status) && (
            <div className="flex items-center justify-between mb-2">
              <div className="font-serif text-[17px]">Generated captions</div>
              <div className="flex gap-1.5">
                <button onClick={clearAll} className="text-[11px] py-1 px-3 border border-border rounded-sm bg-white cursor-pointer font-sans">Clear</button>
                {hasCaptions && <button onClick={regenAll} className="text-[11px] py-1 px-3 border border-border rounded-sm bg-white cursor-pointer font-sans">Regenerate all</button>}
                {hasCaptions && <button onClick={handleExportSeo} className="text-[11px] py-1 px-3 border border-border rounded-sm bg-white cursor-pointer font-sans">SEO photos ↓</button>}
                {hasCaptions && <button onClick={handleExportAll} disabled={exporting} className="text-[11px] py-1 px-3 border border-border rounded-sm bg-white cursor-pointer font-sans disabled:opacity-40">
                  {exporting ? 'Exporting...' : 'Export all ↓'}
                </button>}
              </div>
            </div>
          )}
          {files.filter(f => f.status).map(item => {
            return (
              <ErrorBoundary key={item.id} name={item.file?.name}>
                <ResultCard
                  item={item}
                  folderCtx={folderCtx}
                  onRegen={() => regenOne(item)}
                  onUpdateCaption={(platform, text, captionId) => updateCaption(item.id, platform, text, captionId)}
                  onRefine={(textVal, platform, captionId) => setRefineCtx({ item, textarea: textVal, platform, captionId })}
                  apiUrl={apiUrl}
                />
              </ErrorBoundary>
            )
          })}
        </main>
      </div>

      {historyOpen && <HistoryModal onClose={() => setHistoryOpen(false)} />}
      {refineCtx && (
        <RefineModal
          ctx={refineCtx}
          onClose={() => setRefineCtx(null)}
          onAccept={(text, platform, captionId, item) => {
            updateCaption(item.id, platform, text, captionId)
            setRefineCtx(null)
          }}
        />
      )}
    </div>
  )
}

class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  componentDidCatch(error, info) {
    console.error('ResultCard crash for', this.props.name, ':', error, info.componentStack)
  }
  render() {
    if (this.state.error) {
      return (
        <div className="bg-[#fdeaea] border border-[#f4c0c0] rounded p-3 text-xs text-[#a32d2d] mb-2">
          Card crashed: {this.state.error.message}
        </div>
      )
    }
    return this.props.children
  }
}
