import { useState, useEffect, useCallback, useRef, Component } from 'react'
import * as api from './api'
import HelpTip from './components/HelpTip'
import { parse, allTags, TONE_DESC } from './lib/parse'
import { loadFaceModel, captureVideoFrame, toBase64 } from './lib/crop'
import { exportAll, exportSeoPhotos, getSeoName } from './lib/export'
import Login from './components/Login'
import Landing from './components/Landing'
import Sidebar from './components/Sidebar'
import Dropzone from './components/Dropzone'
import FileGrid from './components/FileGrid'
import VideoTrimmer from './components/VideoTrimmer'
import VideoMerge from './components/VideoMerge'
import VoiceoverRecorder from './components/VoiceoverRecorder'
import ResultCard from './components/ResultCard'
import ScheduledPosts from './components/ScheduledPosts'
// Calendar removed from main form — schedule modal now has all calendar views with job names
// import Calendar from './components/Calendar'
import ScheduleModal from './components/ScheduleModal'
import HistoryModal from './components/HistoryModal'
import RefineModal from './components/RefineModal'
import AdminPanel from './components/AdminPanel'
import WeekPlanner from './components/WeekPlanner'

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; ++i) arr[i] = raw.charCodeAt(i)
  return arr
}

export default function App() {
  const [user, setUser] = useState(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [connected, setConnected] = useState(false)
  const [settings, setSettings] = useState({})
  const [files, setFiles] = useState([])
  const [folderCtx, setFolderCtx] = useState(null)
  const [hashtagSets, setHashtagSets] = useState([])
  const [selectedHashtagSetId, setSelectedHashtagSetId] = useState(null)
  const [autoHashtagSetId, setAutoHashtagSetId] = useState(null) // tracks auto-selection
  const [seoKeywordSets, setSeoKeywordSets] = useState([])
  const [selectedSeoKeywordSetId, setSelectedSeoKeywordSetId] = useState(null)
  const [autoSeoKeywordSetId, setAutoSeoKeywordSetId] = useState(null)
  const [error, setError] = useState(null)
  const [generating, setGenerating] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [refineCtx, setRefineCtx] = useState(null)
  const [showAdmin, setShowAdmin] = useState(false)
  const [rules, setRules] = useState({ name: true, cta: true, brand: true, seo: true, hashtags: true })
  const [userHint, setUserHint] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const [reviewResult, setReviewResult] = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [targetWeek, setTargetWeek] = useState(null)
  const [showLogin, setShowLogin] = useState(false)

  const tenantSlug = api.tenantSlug()
  const apiUrl = `${import.meta.env.VITE_API_URL || ''}/api/t/${tenantSlug}`

  // Check if already logged in
  useEffect(() => {
    api.getMe().then(u => {
      if (u && u.id) {
        setUser(u)
        if (u.csrf_token) api.setCsrfToken(u.csrf_token)
      }
      setAuthChecked(true)
    }).catch(() => setAuthChecked(true))
  }, [])

  // Listen for sidebar close events from mobile drawer
  useEffect(() => {
    const handler = () => setSidebarOpen(false)
    window.addEventListener('close-sidebar', handler)
    return () => window.removeEventListener('close-sidebar', handler)
  }, [])

  // Load data once authenticated
  useEffect(() => {
    if (!user) return
    loadFaceModel()
    api.checkHealth().then(r => {
      if (r.ok) {
        setConnected(true)
        if (tenantSlug) {
          api.getSettings().then(s => {
            if (s && s.error === 'Access denied') {
              // Wrong tenant — redirect to user's own
              const ownSlug = localStorage.getItem('tenant_slug')
              if (ownSlug && ownSlug !== tenantSlug) {
                api.setTenantSlug(ownSlug)
                window.location.href = '/t/' + ownSlug
              }
              return
            }
            setSettings(s || {})
          }).catch(() => {})
          api.getHashtags().then(h => setHashtagSets(Array.isArray(h) ? h : [])).catch(() => {})
          api.getSeoKeywordSets().then(k => setSeoKeywordSets(Array.isArray(k) ? k : [])).catch(() => {})
        }
      }
    }).catch(() => setConnected(false))
  }, [user, tenantSlug])

  // Auto-detect relevant hashtag and SEO keyword sets from hint + filenames
  // Only auto-selects when user hasn't made a manual selection
  useEffect(() => {
    // Build the search text from hint + all uploaded filenames + folder names
    const textParts = []
    if (userHint && userHint.trim()) textParts.push(userHint.toLowerCase())
    for (const f of files) {
      if (f.file?.name) {
        const stem = f.file.name.replace(/\.[^.]+$/, '').replace(/[_\-\.]/g, ' ')
        textParts.push(stem.toLowerCase())
      }
    }
    if (folderCtx?.name) textParts.push(folderCtx.name.toLowerCase().replace(/[_\-\.]/g, ' '))
    const searchText = textParts.join(' ')

    if (!searchText.trim()) {
      // No text to match against — clear any auto-selections (but preserve manual)
      if (autoHashtagSetId && selectedHashtagSetId === autoHashtagSetId) {
        setSelectedHashtagSetId(null)
        setAutoHashtagSetId(null)
      }
      if (autoSeoKeywordSetId && selectedSeoKeywordSetId === autoSeoKeywordSetId) {
        setSelectedSeoKeywordSetId(null)
        setAutoSeoKeywordSetId(null)
      }
      return
    }

    // Match a set by scoring overlap between set name/content and search text
    const findBestMatch = (sets, contentKey) => {
      if (!sets || !sets.length) return null
      let best = null
      let bestScore = 0
      for (const set of sets) {
        const name = (set.name || '').toLowerCase()
        const content = (set[contentKey] || '').toLowerCase()
        // Extract distinct words (3+ chars) from the set's name and content
        const setWords = new Set(
          (name + ' ' + content)
            .split(/[\s,#]+/)
            .map(w => w.replace(/[^a-z0-9]/g, ''))
            .filter(w => w.length >= 3)
        )
        let score = 0
        // Name words weighted heavier
        const nameWords = name.split(/\s+/).filter(w => w.length >= 3)
        for (const w of nameWords) {
          if (searchText.includes(w)) score += 5
        }
        // Content words weighted lighter
        for (const w of setWords) {
          if (searchText.includes(w)) score += 1
        }
        if (score > bestScore) {
          bestScore = score
          best = set
        }
      }
      // Only auto-select if there's a decent match (name hit, or multiple content hits)
      return bestScore >= 3 ? best : null
    }

    // Hashtag sets — only auto-select if not manually chosen
    if (!selectedHashtagSetId || selectedHashtagSetId === autoHashtagSetId) {
      const match = findBestMatch(hashtagSets, 'hashtags')
      if (match) {
        if (match.id !== autoHashtagSetId) {
          setSelectedHashtagSetId(match.id)
          setAutoHashtagSetId(match.id)
        }
      } else if (autoHashtagSetId && selectedHashtagSetId === autoHashtagSetId) {
        setSelectedHashtagSetId(null)
        setAutoHashtagSetId(null)
      }
    }

    // SEO keyword sets — same logic
    if (!selectedSeoKeywordSetId || selectedSeoKeywordSetId === autoSeoKeywordSetId) {
      const match = findBestMatch(seoKeywordSets, 'keywords')
      if (match) {
        if (match.id !== autoSeoKeywordSetId) {
          setSelectedSeoKeywordSetId(match.id)
          setAutoSeoKeywordSetId(match.id)
        }
      } else if (autoSeoKeywordSetId && selectedSeoKeywordSetId === autoSeoKeywordSetId) {
        setSelectedSeoKeywordSetId(null)
        setAutoSeoKeywordSetId(null)
      }
    }
  }, [userHint, files, folderCtx, hashtagSets, seoKeywordSets])

  // When user manually selects a set, clear the "auto" flag
  const handleSelectHashtag = (id) => {
    setSelectedHashtagSetId(id)
    if (id !== autoHashtagSetId) setAutoHashtagSetId(null)
  }
  const handleSelectSeoKeywordSet = (id) => {
    setSelectedSeoKeywordSetId(id)
    if (id !== autoSeoKeywordSetId) setAutoSeoKeywordSetId(null)
  }

  const handleLogin = (data) => {
    setUser({ id: data.id, email: data.email, role: data.role, tenant_id: data.tenant_id })
    if (data.csrf_token) api.setCsrfToken(data.csrf_token)
    if (data.tenant_slug) {
      api.setTenantSlug(data.tenant_slug)
    } else if (data.redirect) {
      const m = data.redirect.match(/\/t\/([^/]+)/)
      if (m) api.setTenantSlug(m[1])
    }
  }

  // Register service worker and subscribe to push notifications
  useEffect(() => {
    if (!user || !('serviceWorker' in navigator) || !('PushManager' in window)) return
    let cancelled = false

    async function setupPush() {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js')
        // Check if already subscribed
        const existing = await reg.pushManager.getSubscription()
        if (existing) return // Already subscribed

        // Get VAPID key
        let publicKey
        try {
          const vapidData = await api.getVapidKey()
          publicKey = vapidData?.publicKey
        } catch { return }
        if (!publicKey || cancelled) return

        // Request permission
        const permission = await Notification.requestPermission()
        if (permission !== 'granted' || cancelled) return

        // Subscribe
        const subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        })

        // Save to server
        await api.subscribePush(subscription.toJSON())
      } catch (err) {
        console.error('Push setup error:', err)
      }
    }

    // Listen for navigation messages from service worker (notification click)
    const swListener = (event) => {
      if (event.data?.type === 'navigate' && event.data.url) {
        window.location.href = event.data.url
      }
    }
    navigator.serviceWorker.addEventListener('message', swListener)

    // Delay push prompt slightly so it doesn't interrupt initial load
    const timer = setTimeout(setupPush, 3000)
    return () => { cancelled = true; clearTimeout(timer); navigator.serviceWorker.removeEventListener('message', swListener) }
  }, [user])

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
    if (settings.platform_youtube === true) p.push('youtube')
    return p
  }

  const genCaptions = async (item, batchId) => {
    // Upload file first
    let videoThumb = null
    if (!item.isImg) {
      try { videoThumb = await captureVideoFrame(item.file) } catch { videoThumb = null }
    }

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
      seo_keyword_set_id: selectedSeoKeywordSetId || undefined,
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
      // Save job_name on the item if returned
      if (partialCaps.job_name) item.job_name = partialCaps.job_name
      // Update UI immediately as each batch arrives
      setFiles(prev => prev.map(f => f.id === item.id ? { ...f, status: 'done', captions: { ...f.captions, ...partialCaps }, job_name: partialCaps.job_name || f.job_name, uploadResult: item.uploadResult, previouslyUsed: item.previouslyUsed, previousCaptions: item.previousCaptions } : f))
    })
    return allCaps
  }

  // Check if a filename looks like a generic camera name (IMG_1234.jpg, DSC00123.MOV, etc.)
  const isGenericFilename = (name) => /^(IMG|DSC|VID|MOV|MVI|DSCN|P|PXL|Screenshot|Screen Shot|Photo|Video|Clip|trim|output)[_\s-]?\d/i.test(name)

  const runAll = async () => {
    if (!files.length) return

    // On mobile, always require a hint
    const isMobile = window.innerWidth < 768
    if (isMobile && !userHint.trim()) {
      showError('Please describe what\'s in the photo or video — this helps the AI write better content.')
      return
    }
    // On desktop, require hint only if all filenames are generic
    if (!isMobile && !userHint.trim() && files.every(f => isGenericFilename(f.file?.name || ''))) {
      showError('Your files have generic names (like IMG_1234). Add a context hint so the AI knows what\'s happening.')
      return
    }

    setGenerating(true)
    if (userHint) localStorage.setItem('posty_last_hint', userHint)
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
  if (!user) {
    // Show marketing landing page when there's no tenant in URL and user hasn't clicked Sign in
    const path = window.location.pathname
    const onRootPath = path === '/' || path === ''
    if (onRootPath && !showLogin) {
      return <Landing onSignIn={() => setShowLogin(true)} />
    }
    return <Login onLogin={handleLogin} />
  }

  const isAdmin = user.role === 'super_admin' || user.role === 'tenant_admin'

  if (showAdmin && isAdmin) {
    return <AdminPanel user={user} onBack={() => setShowAdmin(false)} onLogout={handleLogout} />
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Nav */}
      <nav className="flex items-center justify-between px-3 md:px-6 h-[52px] md:h-[52px] border-b border-border bg-white sticky top-0 z-20">
        <div className="flex items-center gap-2">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="md:hidden text-ink p-2 -ml-1 cursor-pointer bg-transparent border-none min-h-[44px] min-w-[44px] flex items-center justify-center">
            <svg width="22" height="22" viewBox="0 0 20 20" fill="currentColor"><path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none"/></svg>
          </button>
          <div className="font-serif text-[17px] md:text-[19px]">posty<span className="text-terra"> posty</span></div>
          <span className={`w-[7px] h-[7px] rounded-full inline-block flex-shrink-0 md:hidden ${connected ? 'bg-tk' : 'bg-border'}`} />
        </div>
        <div className="flex items-center gap-1 md:gap-2.5 flex-shrink-0">
          <span className={`w-[7px] h-[7px] rounded-full inline-block flex-shrink-0 hidden md:inline ${connected ? 'bg-tk' : 'bg-border'}`} />
          <span className="text-[11px] text-muted hidden md:inline">
            {connected ? `Connected` : 'Connecting...'}
          </span>
          <button onClick={() => setScheduleOpen(true)} className="text-[11px] md:text-[11px] py-2 px-2.5 md:px-3 border border-[#6C5CE7] rounded-sm bg-[#f3f0ff] text-[#6C5CE7] cursor-pointer font-sans whitespace-nowrap min-h-[44px] md:min-h-0">Sched</button>
          <button onClick={() => setHistoryOpen(true)} className="text-[11px] md:text-[11px] py-2 px-2.5 md:px-3 border border-border rounded-sm bg-cream cursor-pointer font-sans whitespace-nowrap min-h-[44px] md:min-h-0 hidden sm:block">History</button>
          <span className="text-[10px] py-0.5 px-2 bg-terra-light text-terra rounded-full font-medium hidden md:inline">Beta</span>
          {isAdmin && <button onClick={() => setShowAdmin(true)} className="text-[11px] md:text-[11px] py-2 px-2.5 md:px-3 border border-border rounded-sm bg-cream cursor-pointer font-sans whitespace-nowrap min-h-[44px] md:min-h-0">Admin</button>}
          <button onClick={handleLogout} className="text-[11px] md:text-[11px] py-2 px-2.5 md:px-3 border border-border rounded-sm bg-cream cursor-pointer font-sans whitespace-nowrap min-h-[44px] md:min-h-0">Out</button>
        </div>
      </nav>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && <div className="fixed inset-0 bg-black/30 z-30 md:hidden" onClick={() => setSidebarOpen(false)} />}

      {/* Shell */}
      <div className="flex md:grid md:grid-cols-[260px_1fr] h-[calc(100vh-52px)] overflow-x-hidden">
        <div className={`fixed md:static inset-y-0 left-0 z-40 w-[300px] md:w-auto bg-white transform transition-transform md:transform-none overflow-y-auto ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        <Sidebar
          settings={settings}
          onSave={saveSettingsToServer}
          hashtagSets={hashtagSets}
          selectedHashtagSetId={selectedHashtagSetId}
          autoHashtagSetId={autoHashtagSetId}
          onSelectHashtag={handleSelectHashtag}
          onHashtagsChange={() => api.getHashtags().then(setHashtagSets)}
          seoKeywordSets={seoKeywordSets}
          selectedSeoKeywordSetId={selectedSeoKeywordSetId}
          autoSeoKeywordSetId={autoSeoKeywordSetId}
          onSelectSeoKeywordSet={handleSelectSeoKeywordSet}
          onSeoKeywordSetsChange={() => api.getSeoKeywordSets().then(setSeoKeywordSets)}
          rules={rules}
          onRulesChange={setRules}
          apiUrl={apiUrl}
        />
        </div>

        <main className="flex-1 p-3 md:p-5 pb-24 md:pb-32 overflow-y-auto overflow-x-hidden flex flex-col gap-3 md:gap-4 max-w-full md:max-w-[640px] mx-auto w-full min-w-0">
          {error && <div className="bg-[#FBF0F7] border border-[#F4C0D1] rounded-sm py-2 px-3 text-xs text-[#A32D2D]">{error}</div>}

          <WeekPlanner settings={settings} targetWeek={targetWeek} onWeekSelect={setTargetWeek} />

          <Dropzone onFiles={addFiles} />

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

          {/* Per-video trim strips — one iOS-style filmstrip trimmer per uploaded video */}
          {files.filter(f => f.file?.type?.startsWith('video/')).length > 0 && (
            <div className="flex flex-col gap-2">
              {files.filter(f => f.file?.type?.startsWith('video/')).map(f => (
                <VideoTrimmer key={f.id} item={f} />
              ))}
            </div>
          )}

          {/* Merge videos — shown below trimmers when 2+ videos are uploaded */}
          {files.filter(f => f.file?.type?.startsWith('video/')).length >= 2 && (
            <VideoMerge
              videoFiles={files.filter(f => f.file?.type?.startsWith('video/'))}
              onMerged={({ blob, url, base64 }) => {
                // Store the merged video so the post flow can use it.
                // We stash it on window for now — a proper state solution
                // would be a context, but this keeps it simple.
                window._postyMergedVideo = { blob, url, base64 }
              }}
            />
          )}

          {/* Voiceover — shown when 1+ video is uploaded (or merged result exists) */}
          {files.filter(f => f.file?.type?.startsWith('video/')).length > 0 && (
            <VoiceoverRecorder
              videoFiles={files.filter(f => f.file?.type?.startsWith('video/'))}
              mergedVideoBase64={window._postyMergedVideo?.base64 || null}
              settings={settings}
              onResult={({ blob, url, base64 }) => {
                window._postyVoiceoverVideo = { blob, url, base64 }
              }}
            />
          )}

          {/* Content hint — between uploads and generate button */}
          <div>
            <div className="flex items-center justify-between">
              <label className="text-[13px] md:text-[11px] text-ink md:text-muted font-medium md:font-normal">
                <span className="md:hidden">Describe this photo / video <span className="text-[#c0392b]">*</span></span>
                <span className="hidden md:inline">Context hint <span className="italic text-[10px]">(optional)</span></span>
                <HelpTip text="Tell the AI what's happening in the photo. The more detail you give, the better the content. You can also paste AI-generated content and click 'Review with AI' to check it against your brand settings." />
              </label>
              <div className="flex gap-2">
                {userHint.length > 20 && (
                  <button onClick={async () => {
                    setReviewing(true); setReviewResult(null)
                    try { const r = await api.reviewHint(userHint); setReviewResult(r) } catch (e) { setReviewResult({ error: e.message }) }
                    setReviewing(false)
                  }} disabled={reviewing} className="text-[11px] md:text-[10px] text-[#6C5CE7] hover:underline disabled:opacity-50">
                    {reviewing ? 'Reviewing...' : 'Review with AI'}
                  </button>
                )}
                {!userHint && (settings.last_hint || localStorage.getItem('posty_last_hint')) && (
                  <button onClick={() => setUserHint(settings.last_hint || localStorage.getItem('posty_last_hint'))} className="text-[11px] md:text-[10px] text-sage hover:underline">Reuse last</button>
                )}
              </div>
            </div>
            <textarea
              rows={2}
              value={userHint}
              onChange={e => { setUserHint(e.target.value); setReviewResult(null) }}
              className="field-input resize-y mt-1"
              placeholder="e.g. Girls night, wine canvas painting"
            />
          </div>
          {/* Review result */}
          {reviewResult && (
            <div className="border border-[#6C5CE7]/30 rounded-sm p-2.5 bg-[#6C5CE7]/5">
              {reviewResult.error ? (
                <p className="text-[11px] text-[#c0392b]">{reviewResult.error}</p>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[10px] text-muted">{reviewResult.changes}</p>
                    {(() => { const h = 100 - (reviewResult.score?.score || 0); return (
                      <span className={`text-[9px] py-0.5 px-1.5 rounded-full font-semibold ${h >= 70 ? 'bg-[#e8efe9] text-[#3a6b42]' : h >= 40 ? 'bg-[#fef3cd] text-[#856404]' : 'bg-[#fdeaea] text-[#c0392b]'}`}>
                        Human: {h}%
                      </span>
                    )})()}
                  </div>
                  <p className="text-[11px] text-ink whitespace-pre-wrap">{reviewResult.text}</p>
                  <div className="flex gap-2 mt-1.5">
                    <button onClick={() => { setUserHint(reviewResult.text); setReviewResult(null) }} className="text-[10px] text-[#2D9A5E] hover:underline font-medium">Use this</button>
                    <button onClick={() => setReviewResult(null)} className="text-[10px] text-muted hover:underline">Dismiss</button>
                  </div>
                </>
              )}
            </div>
          )}

          <p className="text-[11px] text-muted text-center">Content is generated for each photo — copy, edit, and post to your platforms.</p>

          {files.length > 0 && (
            <div className="flex items-center gap-2.5">
              <button
                onClick={runAll}
                disabled={generating}
                className="flex-1 py-2.5 px-4 text-[13px] font-medium font-sans bg-ink text-white border-none rounded-sm cursor-pointer hover:bg-[#333] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {generating ? 'Generating...' : 'Generate content ↗'}
              </button>
              <button onClick={clearAll} className="text-[11px] py-2 px-3 border border-border rounded-sm bg-white cursor-pointer font-sans hover:bg-cream">Clear all</button>
              <span className="text-xs text-muted whitespace-nowrap">{files.length} file{files.length !== 1 ? 's' : ''}</span>
            </div>
          )}

          {/* Results */}
          {files.some(f => f.status) && (
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <div className="font-serif text-[17px]">Generated content</div>
              <div className="flex gap-1 flex-wrap">
                <button onClick={clearAll} className="text-[10px] md:text-[11px] py-1 px-2 md:px-3 border border-border rounded-sm bg-white cursor-pointer font-sans">Clear</button>
                {hasCaptions && <button onClick={regenAll} className="text-[10px] md:text-[11px] py-1 px-2 md:px-3 border border-border rounded-sm bg-white cursor-pointer font-sans">Regen all</button>}
                {hasCaptions && <button onClick={handleExportSeo} className="text-[10px] md:text-[11px] py-1 px-2 md:px-3 border border-border rounded-sm bg-white cursor-pointer font-sans hidden sm:block">SEO photos</button>}
                {hasCaptions && <button onClick={handleExportAll} disabled={exporting} className="text-[10px] md:text-[11px] py-1 px-2 md:px-3 border border-border rounded-sm bg-white cursor-pointer font-sans disabled:opacity-40">
                  {exporting ? 'Exporting...' : 'Export all'}
                </button>}
              </div>
            </div>
          )}
          {/* Calendar removed — now in ScheduleModal. Component kept in components/Calendar.jsx if needed again */}
          <ScheduledPosts />
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
                  settings={settings}
                  targetWeek={targetWeek}
                />
              </ErrorBoundary>
            )
          })}
        </main>
      </div>

      {historyOpen && <HistoryModal onClose={() => setHistoryOpen(false)} />}
      {scheduleOpen && <ScheduleModal onClose={() => setScheduleOpen(false)} />}
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
