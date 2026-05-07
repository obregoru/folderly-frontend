// V3 Phase 2 — Drafts list + BlogPostEditor.
//
// Two views inside one screen:
//   - List: all blog_posts rows for this tenant with status chip,
//     generated/not, word count, last updated.
//   - Editor: open one draft, generate / regenerate, view + edit
//     body, meta, image specs, internal-link picks, categories, tags.
//     Toggle status drafting → ready manually.
//
// Phase 3 will add the WP publish surface (slug + Yoast field
// passthrough). Phase 4 polishes internal-link suggestions. Phase 6
// wires ZeroGPT scoring.

import { useEffect, useState } from 'react'
import * as api from '../api'
import WpMediaPicker from '../components/WpMediaPicker'
import FreePhotosPicker from '../components/FreePhotosPicker'

const STATUS_TONE = {
  drafting:   { color: '#94a3b8', label: 'Drafting' },
  generating: { color: '#6C5CE7', label: 'Generating…' },
  ready:      { color: '#2D9A5E', label: 'Ready' },
  flagged:    { color: '#d97706', label: 'Flagged' },
  scheduled:  { color: '#3b82f6', label: 'Scheduled' },
  published:  { color: '#0a4d2c', label: 'Published' },
  failed:     { color: '#c0392b', label: 'Failed' },
}

export default function Drafts() {
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeId, setActiveId] = useState(null)

  const reload = async () => {
    try {
      const r = await api.listBlogPosts()
      setPosts(Array.isArray(r?.items) ? r.items : [])
    } catch (e) {
      setError(e?.message || String(e))
    }
  }

  useEffect(() => {
    let cancelled = false
    api.listBlogPosts()
      .then(r => { if (!cancelled) setPosts(Array.isArray(r?.items) ? r.items : []) })
      .catch(e => { if (!cancelled) setError(e?.message || String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  if (activeId) {
    return (
      <BlogPostEditor
        id={activeId}
        onBack={() => { setActiveId(null); reload() }}
      />
    )
  }

  return (
    <div className="space-y-3">
      <div className="bg-white border border-[#e5e5e5] rounded p-3">
        <h2 className="text-[14px] font-bold mb-1">Blog drafts</h2>
        <p className="text-[10px] text-muted">
          Drafts created from the Ideation tab land here. Open one to generate the full article body, edit, and (in later phases) schedule for publishing.
        </p>
      </div>

      {error && (
        <div className="bg-[#fdf2f1] border border-[#c0392b]/30 rounded p-2 text-[11px] text-[#c0392b]">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-[12px] text-muted">Loading…</div>
      ) : posts.length === 0 ? (
        <div className="bg-white border border-[#e5e5e5] rounded p-3 text-[11px] text-muted italic">
          No drafts yet. Open the <b>Ideation</b> tab, generate topics, accept some, and they'll appear here.
        </div>
      ) : (
        <ul className="space-y-1">
          {posts.map(p => {
            const tone = STATUS_TONE[p.status] || STATUS_TONE.drafting
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setActiveId(p.id)}
                  className="w-full text-left flex items-start gap-2 p-2 border border-[#e5e5e5] rounded hover:border-[#6C5CE7]/50 cursor-pointer bg-white"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span
                        className="text-[9px] font-medium uppercase tracking-wide rounded px-1.5 py-0.5"
                        style={{ background: `${tone.color}20`, color: tone.color }}
                      >{tone.label}</span>
                      <span className="text-[9px] text-muted">{p.template}</span>
                      {p.word_count > 0 && (
                        <span className="text-[9px] text-muted">· {p.word_count} words</span>
                      )}
                    </div>
                    <div className="text-[12px] font-medium text-ink truncate">{p.title}</div>
                    <div className="text-[9px] text-muted truncate">/{p.slug}</div>
                  </div>
                  <div className="text-[9px] whitespace-nowrap text-right">
                    {p.status === 'scheduled' && p.scheduled_for ? (
                      <div className="text-[#3b82f6] font-medium">📅 {new Date(p.scheduled_for).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
                    ) : (
                      <div className="text-muted">{p.generated_at ? new Date(p.generated_at).toLocaleDateString() : 'not generated'}</div>
                    )}
                    {typeof p.zerogpt_score === 'number' && (
                      <div className={`text-[9px] mt-0.5 ${
                        p.zerogpt_score >= 60 ? 'text-[#c0392b]' : p.zerogpt_score >= 30 ? 'text-[#d97706]' : 'text-[#2D9A5E]'
                      }`} title="ZeroGPT score">{p.zerogpt_score.toFixed(0)}% AI</div>
                    )}
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ── Editor ────────────────────────────────────────────────────────
function BlogPostEditor({ id, onBack }) {
  const [post, setPost] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(null)
  const [publishing, setPublishing] = useState(false)
  const [publishMode, setPublishMode] = useState('publish') // 'publish' | 'draft'
  // Tenant taxonomy snapshot — feeds the categories/tags datalists
  // so the user picks from existing WP taxonomy by default.
  const [taxonomy, setTaxonomy] = useState({ categories: [], tags: [] })

  // Local edit buffers — separate from `post` so unsaved changes
  // aren't lost on a Generate run.
  const [editBuf, setEditBuf] = useState({})

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const p = await api.getBlogPost(id)
      setPost(p)
      setEditBuf({})
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [id])

  // Pull the tenant's WP taxonomy once on mount. Used to populate
  // the <datalist> behind the categories + tags inputs so the user
  // gets autocomplete against real WP taxonomy.
  useEffect(() => {
    api.getTaxonomy()
      .then(t => setTaxonomy({
        categories: Array.isArray(t?.categories) ? t.categories : [],
        tags: Array.isArray(t?.tags) ? t.tags : [],
      }))
      .catch(() => { /* taxonomy is best-effort; UI still works without */ })
  }, [])

  const value = (field) => editBuf[field] !== undefined ? editBuf[field] : post?.[field]
  const setField = (field, v) => setEditBuf(prev => ({ ...prev, [field]: v }))
  const isDirty = Object.keys(editBuf).length > 0

  const flashSaved = () => { setSavedFlash(true); setTimeout(() => setSavedFlash(false), 1500) }

  // Cmd+S / Ctrl+S → Save. The default browser behavior (save HTML
  // page) is rarely useful in this editor and shadows the most-natural
  // muscle memory for "persist my edits". Only triggers when there
  // are unsaved changes to avoid surprising the user with a no-op save
  // request.
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        if (isDirty && !saving) handleSave()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // handleSave isn't in deps because re-binding on every editBuf
    // tick is wasteful — we read isDirty/saving inside the handler.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty, saving])

  // generate / regenerate. Style hint is one of:
  //   null                       — default prompt
  //   'more_conversational'      — preset key, BE expands
  //   'more_concise'             — preset key, BE expands
  //   'fix_flagged_sentences'    — preset key + use_flagged_sentences=true
  //   'more_specific'            — preset key, BE expands
  //   '<free-form text>'         — custom critique applied verbatim
  const handleGenerate = async (opts = {}) => {
    if (!post) return
    setGenerating(true)
    setError(null)
    try {
      const updated = await api.generateBlogPost(post.id, {
        targetWordCount: 900,
        styleHint: opts.styleHint || null,
        useFlaggedSentences: !!opts.useFlaggedSentences,
      })
      setPost(updated)
      setEditBuf({})
    } catch (e) {
      setError(e?.message || String(e))
      // Reload to pick up the rolled-back status.
      load()
    } finally {
      setGenerating(false)
    }
  }

  const handleSave = async () => {
    if (!post || !isDirty) return
    setSaving(true)
    setError(null)
    try {
      const patch = { ...editBuf }
      const updated = await api.updateBlogPost(post.id, patch)
      setPost(updated)
      setEditBuf({})
      flashSaved()
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  const handleStatusToggle = async () => {
    if (!post) return
    const next = post.status === 'ready' ? 'drafting' : 'ready'
    setSaving(true)
    try {
      const updated = await api.updateBlogPost(post.id, { status: next })
      setPost(updated)
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  const handlePublish = async () => {
    if (!post || isDirty) {
      setError(isDirty ? 'Save your edits before publishing.' : 'No post to publish.')
      return
    }
    if (!confirm(`Publish "${post.title}" to WordPress as ${publishMode === 'draft' ? 'a draft (visible only in WP Admin)' : 'LIVE on the site'}?`)) return
    setPublishing(true)
    setError(null)
    try {
      const updated = await api.publishBlogPost(post.id, { wpStatus: publishMode })
      setPost(updated)
    } catch (e) {
      setError(e?.message || String(e))
      load() // pick up status='failed' + publish_metadata.error
    } finally {
      setPublishing(false)
    }
  }

  const handleUnpublish = async () => {
    if (!post) return
    if (!confirm(`Unpublish "${post.title}"? This flips the WP post back to draft (it's no longer visible to readers but stays in WP Admin).`)) return
    setPublishing(true)
    setError(null)
    try {
      const updated = await api.unpublishBlogPost(post.id)
      setPost(updated)
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setPublishing(false)
    }
  }

  const handleSchedule = async () => {
    if (!post || isDirty) {
      setError(isDirty ? 'Save your edits before scheduling.' : 'No post to schedule.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const updated = await api.scheduleBlogPost(post.id) // null → cadence finder
      setPost(updated)
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  const handleUnschedule = async () => {
    if (!post) return
    setSaving(true)
    setError(null)
    try {
      const updated = await api.unscheduleBlogPost(post.id)
      setPost(updated)
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  const handleRecheckZeroGpt = async () => {
    if (!post) return
    setSaving(true)
    setError(null)
    try {
      const r = await api.recheckZeroGpt(post.id)
      if (r.skipped) {
        setError(`ZeroGPT skipped: ${r.reason}`)
      } else {
        load()
      }
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  const handleRecheckDrift = async () => {
    if (!post) return
    setSaving(true)
    setError(null)
    try {
      const r = await api.recheckDrift(post.id)
      if (r.skipped) {
        setError(`Drift check skipped: ${r.reason}`)
      } else {
        load()
      }
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="text-[12px] text-muted">Loading…</div>
  if (!post) return <div className="text-[12px] text-[#c0392b]">{error || 'Not found'}</div>

  const tone = STATUS_TONE[post.status] || STATUS_TONE.drafting
  const hasBody = !!post.body_md
  const wordCount = post.body_md ? post.body_md.split(/\s+/).filter(Boolean).length : 0

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="bg-white border border-[#e5e5e5] rounded p-3">
        <div className="flex items-start gap-2">
          <button
            type="button"
            onClick={onBack}
            className="text-[10px] py-1 px-2 border border-[#e5e5e5] text-muted bg-white rounded cursor-pointer"
          >← Back</button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span
                className="text-[9px] font-medium uppercase tracking-wide rounded px-1.5 py-0.5"
                style={{ background: `${tone.color}20`, color: tone.color }}
              >{tone.label}</span>
              <span className="text-[9px] text-muted">{post.template}</span>
              {wordCount > 0 && <span className="text-[9px] text-muted">· {wordCount} words</span>}
              {post.regenerate_count > 0 && <span className="text-[9px] text-muted">· regen ×{post.regenerate_count}</span>}
            </div>
            <div className="text-[14px] font-bold text-ink">{value('title')}</div>
            <div className="text-[10px] text-muted">/{value('slug')}</div>
          </div>
          <div className="flex flex-col gap-1 self-start min-w-[180px]">
            {/* Generate is always visible. For first-generate it's a
                plain button. For regenerate (body already exists) it's
                a dropdown so the user can pick a style override. */}
            {hasBody ? (
              <RegenerateMenu
                disabled={generating || publishing}
                generating={generating}
                hasFlaggedSentences={Array.isArray(post.zerogpt_metadata?.sentences) && post.zerogpt_metadata.sentences.length > 0}
                onPick={(opts) => handleGenerate(opts)}
              />
            ) : (
              <button
                type="button"
                onClick={() => handleGenerate()}
                disabled={generating || publishing}
                className="text-[11px] py-1.5 px-3 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50 font-medium whitespace-nowrap"
              >
                {generating ? 'Generating…' : '✨ Generate article'}
              </button>
            )}

            {/* Mark ready / drafting toggle once body exists */}
            {hasBody && post.status !== 'published' && post.status !== 'scheduled' && (
              <button
                type="button"
                onClick={handleStatusToggle}
                disabled={saving || publishing}
                className={`text-[10px] py-1 px-2 border rounded cursor-pointer disabled:opacity-50 font-medium whitespace-nowrap ${
                  post.status === 'ready'
                    ? 'border-[#d97706] text-[#d97706] bg-white'
                    : 'border-[#2D9A5E] bg-[#2D9A5E] text-white'
                }`}
              >
                {post.status === 'ready' ? '↩ Mark drafting' : '✓ Mark ready'}
              </button>
            )}

            {/* Schedule flow — visible on 'ready' or 'flagged' drafts.
                Schedule for a cadence slot (cron auto-publishes after
                the edit window expires) OR publish immediately. */}
            {hasBody && (post.status === 'ready' || post.status === 'flagged') && (
              <button
                type="button"
                onClick={handleSchedule}
                disabled={saving || publishing || isDirty}
                className="text-[11px] py-1.5 px-3 bg-[#3b82f6] text-white border-none rounded cursor-pointer disabled:opacity-40 font-medium whitespace-nowrap"
                title={isDirty ? 'Save your edits before scheduling' : 'Auto-pick the next cadence slot for this draft'}
              >
                📅 Schedule for next slot
              </button>
            )}

            {/* Unschedule when 'scheduled' */}
            {post.status === 'scheduled' && (
              <button
                type="button"
                onClick={handleUnschedule}
                disabled={saving || publishing}
                className="text-[10px] py-1 px-2 border border-[#3b82f6] text-[#3b82f6] bg-white rounded cursor-pointer disabled:opacity-50 font-medium whitespace-nowrap"
                title="Pull this back to 'ready' (clears scheduled_for)"
              >
                ↩ Unschedule
              </button>
            )}

            {/* Publish flow — only when 'ready' or 'failed' + has body */}
            {hasBody && (post.status === 'ready' || post.status === 'failed' || post.status === 'flagged') && (
              <>
                <select
                  value={publishMode}
                  onChange={e => setPublishMode(e.target.value)}
                  disabled={publishing}
                  className="text-[10px] py-1 px-2 border border-[#e5e5e5] rounded cursor-pointer disabled:opacity-50"
                  title="WP publish status"
                >
                  <option value="publish">→ Publish live</option>
                  <option value="draft">→ Push as WP draft</option>
                  <option value="private">→ Publish private</option>
                </select>
                <button
                  type="button"
                  onClick={handlePublish}
                  disabled={publishing || isDirty}
                  className="text-[11px] py-1.5 px-3 bg-[#2D9A5E] text-white border-none rounded cursor-pointer disabled:opacity-40 font-medium whitespace-nowrap"
                  title={isDirty ? 'Save your edits before publishing' : 'Push to WordPress now, skipping the cadence schedule'}
                >
                  {publishing ? 'Publishing…' : '🚀 Publish now'}
                </button>
              </>
            )}

            {/* Unpublish (back to WP draft) — when published / scheduled */}
            {hasBody && (post.status === 'published' || post.status === 'scheduled') && (
              <button
                type="button"
                onClick={handleUnpublish}
                disabled={publishing}
                className="text-[10px] py-1 px-2 border border-[#d97706] text-[#d97706] bg-white rounded cursor-pointer disabled:opacity-50 font-medium whitespace-nowrap"
                title="Flip the WP post back to draft. Stays in WP Admin; not visible to readers."
              >
                {publishing ? 'Working…' : '↩ Unpublish (→ WP draft)'}
              </button>
            )}
          </div>
        </div>

        {/* Prominent ZeroGPT score panel — visible whenever a body
            exists, even when not yet scored, so the user always
            knows where they stand on AI-detection. Color-coded band
            so the verdict is readable at a glance from across the
            room. Replaces the older inline-text row. */}
        {hasBody && (
          <ZeroGptPanel
            score={post.zerogpt_score}
            checkedAt={post.last_zerogpt_check}
            metadata={post.zerogpt_metadata}
            threshold={post.zerogpt_threshold_percent}
            body={value('body_md')}
            onRecheck={handleRecheckZeroGpt}
            recheckDisabled={saving || generating || publishing}
          />
        )}

        {/* Scheduled-for chip + edit-window context */}
        {post.status === 'scheduled' && post.scheduled_for && (
          <div className="mt-2 text-[10px] bg-[#dbeafe] border border-[#3b82f6]/30 text-[#1e40af] rounded p-2">
            <b>📅 Auto-publishing on:</b> {new Date(post.scheduled_for).toLocaleString()}{' '}
            <span className="text-[#1e40af]/70">
              · scheduler runs every 60s · edits between now and then auto-revert this to 'ready' so the schedule re-evaluates
            </span>
          </div>
        )}

        {/* Flagged warning when ZeroGPT flipped status */}
        {post.status === 'flagged' && (
          <div className="mt-2 text-[10px] bg-[#fdf2f1] border border-[#c0392b]/30 text-[#8a1f15] rounded p-2">
            <b>🚩 Flagged for review.</b> ZeroGPT score {typeof post.zerogpt_score === 'number' ? `${post.zerogpt_score.toFixed(1)}%` : '—'} exceeds the tenant threshold. Edit the body to reduce AI-detection signals (vary sentence length, drop hedging phrases, add specific details), then mark Ready again.
          </div>
        )}

        {/* Drift row (audience-lock fit). Renders when we have a score
            OR check timestamp. Reasoning + violations expandable below. */}
        {(typeof post.drift_score === 'number' || post.last_drift_check) && (
          <div className="mt-1 text-[10px]">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-muted">Drift:</span>
              {typeof post.drift_score === 'number' ? (
                <span className={`font-mono font-bold ${
                  post.drift_score >= 8 ? 'text-[#2D9A5E]' : post.drift_score >= 6 ? 'text-[#d97706]' : 'text-[#c0392b]'
                }`}>{post.drift_score.toFixed(1)}/10 audience fit</span>
              ) : <span className="text-muted">no score</span>}
              {post.last_drift_check && (
                <span className="text-muted">· checked {new Date(post.last_drift_check).toLocaleString()}</span>
              )}
              <button
                type="button"
                onClick={handleRecheckDrift}
                disabled={saving || generating || publishing}
                className="text-[9px] py-0.5 px-1.5 border border-[#e5e5e5] text-muted bg-white rounded cursor-pointer disabled:opacity-50"
              >↻ Recheck</button>
            </div>
            {post.drift_metadata && (post.drift_metadata.reasoning || (post.drift_metadata.template_violations || []).length > 0) && (
              <details className="ml-6 mt-1">
                <summary className="text-[9px] text-muted cursor-pointer">Reasoning + violations</summary>
                <div className="mt-1 text-[10px] space-y-1">
                  {post.drift_metadata.audience_match && (
                    <div><b>Audience match:</b> {post.drift_metadata.audience_match}</div>
                  )}
                  {post.drift_metadata.reasoning && (
                    <div className="text-muted">{post.drift_metadata.reasoning}</div>
                  )}
                  {Array.isArray(post.drift_metadata.template_violations) && post.drift_metadata.template_violations.length > 0 && (
                    <ul className="list-disc list-inside text-[#c0392b]">
                      {post.drift_metadata.template_violations.map((v, i) => <li key={i}>{v}</li>)}
                    </ul>
                  )}
                </div>
              </details>
            )}
          </div>
        )}

        {/* Live URL once published */}
        {post.wp_post_url && (
          <div className="mt-2 text-[10px] flex items-center gap-2">
            <span className="text-muted">Live:</span>
            <a
              href={post.wp_post_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#6C5CE7] underline truncate"
              title={post.wp_post_url}
            >{post.wp_post_url}</a>
            {post.wp_post_id && <span className="text-muted">· wp #{post.wp_post_id}</span>}
            {post.published_at && <span className="text-muted">· {new Date(post.published_at).toLocaleString()}</span>}
          </div>
        )}

        {/* Surface publish failure detail when status='failed' */}
        {post.status === 'failed' && post.publish_metadata?.error && (
          <div className="mt-2 bg-[#fdf2f1] border border-[#c0392b]/30 rounded p-2 text-[10px] text-[#c0392b]">
            <b>Publish failed{post.publish_metadata.error_class ? ` (${post.publish_metadata.error_class})` : ''}:</b>{' '}
            {post.publish_metadata.error}
            {post.publish_metadata.failed_at && (
              <span className="text-muted ml-2">at {new Date(post.publish_metadata.failed_at).toLocaleString()}</span>
            )}
            {post.next_retry_at && new Date(post.next_retry_at).getTime() > Date.now() && (
              <div className="mt-1 text-[#d97706]">
                ⏱ Auto-retry scheduled at {new Date(post.next_retry_at).toLocaleString()}
                {post.publish_metadata.next_retry_in_minutes != null && (
                  <span className="text-muted"> (in {post.publish_metadata.next_retry_in_minutes}m)</span>
                )}
              </div>
            )}
            {!post.next_retry_at && post.publish_metadata.error_class === 'terminal' && (
              <div className="mt-1 text-muted">Won't auto-retry — terminal error. Fix the cause and click 🚀 Publish now.</div>
            )}
            {!post.next_retry_at && post.publish_metadata.error_class !== 'terminal' && (
              <div className="mt-1 text-muted">Retry budget exhausted. Click 🚀 Publish now to try again.</div>
            )}
          </div>
        )}

        {/* Retry history — surfaces every attempt (newest first) when
            we have any, even on successful posts. Useful for debugging
            transient WP issues retroactively. */}
        {Array.isArray(post.publish_attempts) && post.publish_attempts.length > 0 && (
          <PublishAttemptsLog attempts={post.publish_attempts} />
        )}

        {generating && (
          <div className="text-[10px] text-muted italic mt-2">
            Claude is writing the full article. ~30-90s. Internal-link candidates pulled from your indexed posts.
          </div>
        )}
        {publishing && (
          <div className="text-[10px] text-muted italic mt-2">
            Uploading {(post.images || []).length} image{(post.images || []).length === 1 ? '' : 's'} to WordPress, resolving categories + tags, posting with Yoast meta. ~20-60s.
          </div>
        )}
      </div>

      {error && (
        <div className="bg-[#fdf2f1] border border-[#c0392b]/30 rounded p-2 text-[11px] text-[#c0392b]">
          {error}
        </div>
      )}

      {/* Image upload — visible at all times, before AND after
          generation. Pre-generation uploads inform the system prompt
          (filenames + alt). Post-generation uploads can still be
          added; regenerate to have the model re-incorporate them. */}
      <ImageManager
        postId={post.id}
        images={post.images || []}
        onChange={load}
        setError={setError}
        defaultPhotoQuery={post.focus_keyword || post.title || ''}
      />

      {/* Empty-state if not yet generated */}
      {!hasBody && !generating && (
        <div className="bg-white border border-[#e5e5e5] rounded p-3 text-[11px] text-muted">
          This draft is a skeleton — title + slug only. Upload images above (their SEO filenames + alt text feed into the article-generation prompt), then click <b>Generate article</b> to produce the full body, meta tags, and internal-link picks.
          {post.topic_candidates && Number.isInteger(post.source_topic_index) && post.topic_candidates[post.source_topic_index] && (
            <details className="mt-2">
              <summary className="text-[10px] text-[#6C5CE7] cursor-pointer">Source candidate</summary>
              <SourceCandidate c={post.topic_candidates[post.source_topic_index]} />
            </details>
          )}
        </div>
      )}

      {/* Save bar — only when dirty. Sticky so it tracks the user as
          they scroll into the body field; otherwise it scrolls out of
          view and edits feel "lost" because the action is invisible. */}
      {isDirty && hasBody && (
        <div className="sticky top-0 z-20 bg-[#fff7e6] border border-[#f5a623] rounded p-2 flex items-center gap-2 text-[11px] text-[#8a4b00] shadow-md">
          <div className="flex-1 font-medium">⚠ Unsaved changes ({Object.keys(editBuf).length} field{Object.keys(editBuf).length === 1 ? '' : 's'})</div>
          <button
            type="button"
            onClick={() => setEditBuf({})}
            className="text-[11px] py-1 px-2 border border-[#e5e5e5] text-muted bg-white rounded cursor-pointer"
          >Discard</button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="text-[11px] py-1 px-3 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50 font-medium"
            title="Save (⌘S / Ctrl+S)"
          >{saving ? 'Saving…' : 'Save (⌘S)'}</button>
        </div>
      )}
      {savedFlash && (
        <div className="bg-[#f0faf4] border border-[#2D9A5E]/30 rounded p-2 text-[11px] text-[#0a4d2c]">
          ✓ Saved
        </div>
      )}

      {/* Body editor */}
      {hasBody && (
        <>
          <Section title="SEO meta">
            <Field label="Title (H1)">
              <input
                type="text"
                value={value('title') || ''}
                onChange={e => setField('title', e.target.value)}
                className="w-full text-[12px] border border-[#e5e5e5] rounded p-2"
              />
            </Field>
            <Field label="Slug">
              <input
                type="text"
                value={value('slug') || ''}
                onChange={e => setField('slug', e.target.value)}
                className="w-full text-[11px] border border-[#e5e5e5] rounded p-1.5 font-mono"
              />
            </Field>
            <Field label="Meta title (SERP)" hint={`${(value('meta_title') || '').length} / 70 chars`}>
              <input
                type="text"
                value={value('meta_title') || ''}
                onChange={e => setField('meta_title', e.target.value)}
                className="w-full text-[11px] border border-[#e5e5e5] rounded p-1.5"
              />
            </Field>
            <Field label="Meta description" hint={`${(value('meta_description') || '').length} / 160 chars`}>
              <textarea
                value={value('meta_description') || ''}
                onChange={e => setField('meta_description', e.target.value)}
                rows={2}
                className="w-full text-[11px] border border-[#e5e5e5] rounded p-1.5 resize-y"
              />
            </Field>
            <Field label="Excerpt (lede)">
              <textarea
                value={value('excerpt') || ''}
                onChange={e => setField('excerpt', e.target.value)}
                rows={2}
                className="w-full text-[11px] border border-[#e5e5e5] rounded p-1.5 resize-y"
              />
            </Field>
            <Field label="Focus keyword (Yoast)">
              <input
                type="text"
                value={value('focus_keyword') || ''}
                onChange={e => setField('focus_keyword', e.target.value)}
                className="w-full text-[11px] border border-[#e5e5e5] rounded p-1.5"
              />
            </Field>
          </Section>

          <Section title="Body (Markdown)">
            <textarea
              value={value('body_md') || ''}
              onChange={e => setField('body_md', e.target.value)}
              rows={20}
              className="w-full text-[11px] border border-[#e5e5e5] rounded p-2 font-mono leading-relaxed resize-y"
              spellCheck="true"
            />
          </Section>

          <Section title="Categories & tags">
            <Field
              label="Categories (comma-separated)"
              hint={taxonomy.categories.length > 0 ? `${taxonomy.categories.length} existing on WP — pick from those when possible` : null}
            >
              <CategoryTokensInput
                value={value('categories') || []}
                onChange={v => setField('categories', v)}
                options={taxonomy.categories}
              />
              {taxonomy.categories.length > 0 && (
                <details className="mt-1">
                  <summary className="text-[9px] text-muted cursor-pointer">Show all {taxonomy.categories.length} existing categories</summary>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {taxonomy.categories.map(c => {
                      const selected = (value('categories') || []).includes(c.name)
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => {
                            const cur = value('categories') || []
                            const next = selected
                              ? cur.filter(x => x !== c.name)
                              : [...new Set([...cur, c.name])]
                            setField('categories', next)
                          }}
                          className={`text-[9px] py-0.5 px-1.5 border rounded cursor-pointer ${
                            selected
                              ? 'bg-[#6C5CE7] text-white border-[#6C5CE7]'
                              : 'bg-white text-ink border-[#e5e5e5] hover:border-[#6C5CE7]/50'
                          }`}
                          title={c.count != null ? `${c.count} posts use this` : ''}
                        >{c.name}{c.count ? ` · ${c.count}` : ''}</button>
                      )
                    })}
                  </div>
                </details>
              )}
            </Field>
            <Field
              label="Tags (comma-separated)"
              hint={taxonomy.tags.length > 0 ? `${taxonomy.tags.length} existing on WP` : null}
            >
              <CategoryTokensInput
                value={value('tags') || []}
                onChange={v => setField('tags', v)}
                options={taxonomy.tags}
                listIdSuffix="tags"
              />
            </Field>
          </Section>

          <Section title={`Image specs (${(post.image_specs || []).length})`}>
            {(post.image_specs || []).length === 0 ? (
              <div className="text-[10px] text-muted italic">None.</div>
            ) : (
              <ul className="space-y-2">
                {(post.image_specs || []).map((s, i) => (
                  <li key={i} className="border border-[#e5e5e5] rounded p-2 text-[11px]">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-[9px] uppercase tracking-wide bg-[#f3f0ff] text-[#6C5CE7] rounded px-1.5 py-0.5">{s.role}</span>
                      <span className="font-mono text-[10px] text-muted">{s.filename}.jpg</span>
                      {s.position_after_h2_index != null && (
                        <span className="text-[9px] text-muted">after H2 #{s.position_after_h2_index}</span>
                      )}
                    </div>
                    <div className="text-[10px]"><b>Alt:</b> {s.alt_text}</div>
                    {s.caption && <div className="text-[10px]"><b>Caption:</b> {s.caption}</div>}
                    {s.prompt_or_search_terms && (
                      <div className="text-[10px] text-muted italic mt-1">{s.prompt_or_search_terms}</div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <InternalLinksManager
            post={post}
            value={value('internal_links') || []}
            onChange={v => setField('internal_links', v)}
          />

          {post.generation_metadata && (
            <details className="bg-[#fafafa] border border-[#e5e5e5] rounded p-2 text-[10px]">
              <summary className="cursor-pointer text-muted">Generation metadata</summary>
              <pre className="mt-1 text-[9px] text-ink whitespace-pre-wrap">{JSON.stringify(post.generation_metadata, null, 2)}</pre>
            </details>
          )}
        </>
      )}
    </div>
  )
}

// ── Tiny helpers ─────────────────────────────────────────────────
function Section({ title, children }) {
  return (
    <div className="bg-white border border-[#e5e5e5] rounded p-3 space-y-2">
      <h3 className="text-[12px] font-medium">{title}</h3>
      {children}
    </div>
  )
}
function Field({ label, hint, children }) {
  return (
    <div>
      <label className="text-[10px] font-medium block mb-0.5">{label}{hint && <span className="text-muted ml-1 italic">· {hint}</span>}</label>
      {children}
    </div>
  )
}
// ── Internal links manager ────────────────────────────────────────
// Shows the model-picked links + lets the user remove them, plus
// surfaces top-K candidates from the embedding retrieval that the
// model DIDN'T pick so the user can add their own. Each candidate
// shows its similarity score so the user can judge fit.
function InternalLinksManager({ post, value, onChange }) {
  const links = Array.isArray(value) ? value : []
  const [candidates, setCandidates] = useState(null)
  const [constraint, setConstraint] = useState(null)
  const [loadingCandidates, setLoadingCandidates] = useState(false)
  const [showCandidates, setShowCandidates] = useState(false)

  // URLs already linked — used to mark candidates as "already used".
  const linkedUrls = new Set(links.map(l => l.url))

  const loadCandidates = async (overrideMode = null) => {
    setLoadingCandidates(true)
    try {
      const r = await api.getLinkCandidates(post.id, 12, overrideMode)
      setCandidates(r?.candidates || [])
      setConstraint(r?.constraint || null)
      setShowCandidates(true)
    } catch (e) {
      console.warn('[link-candidates]', e?.message)
    } finally {
      setLoadingCandidates(false)
    }
  }

  const removeLink = (i) => {
    const next = links.filter((_, j) => j !== i)
    onChange(next)
  }

  const addLink = (cand) => {
    if (linkedUrls.has(cand.source_url)) return
    // Default anchor text to the candidate's title; user edits in
    // the row's input afterwards. rationale is empty for manual adds.
    const next = [...links, {
      url: cand.source_url,
      anchor_text: cand.title,
      rationale: 'Added manually',
    }]
    onChange(next)
  }

  const updateLink = (i, patch) => {
    const next = links.map((l, j) => j === i ? { ...l, ...patch } : l)
    onChange(next)
  }

  return (
    <div className="bg-white border border-[#e5e5e5] rounded p-3 space-y-2">
      <div className="flex items-center gap-2 mb-1">
        <h3 className="text-[12px] font-medium flex-1">Internal links ({links.length})</h3>
        <button
          type="button"
          onClick={() => showCandidates ? setShowCandidates(false) : loadCandidates()}
          disabled={loadingCandidates}
          className="text-[10px] py-1 px-2 border border-[#6C5CE7] text-[#6C5CE7] bg-white rounded cursor-pointer disabled:opacity-50"
        >
          {loadingCandidates ? 'Loading…' : (showCandidates ? '✕ Hide candidates' : '🔍 Browse all candidates')}
        </button>
      </div>

      {/* Active links */}
      {links.length === 0 ? (
        <div className="text-[10px] text-muted italic">
          No internal links yet. The article-generator picks 0–4 from the indexed posts; you can add more from "Browse all candidates" above.
        </div>
      ) : (
        <ul className="space-y-1.5">
          {links.map((l, i) => (
            <li key={i} className="border border-[#e5e5e5] rounded p-2 text-[11px] space-y-1">
              <div className="flex items-start gap-2">
                <input
                  type="text"
                  value={l.anchor_text || ''}
                  onChange={e => updateLink(i, { anchor_text: e.target.value })}
                  className="flex-1 text-[11px] border border-[#e5e5e5] rounded p-1"
                  placeholder="Anchor text"
                />
                <button
                  type="button"
                  onClick={() => removeLink(i)}
                  className="text-[10px] py-1 px-2 border border-[#c0392b] text-[#c0392b] bg-white rounded cursor-pointer"
                  title="Remove this link"
                >Remove</button>
              </div>
              <div className="text-[9px] text-muted font-mono break-all">
                <a href={l.url} target="_blank" rel="noopener noreferrer" className="text-[#6C5CE7]">{l.url}</a>
              </div>
              {l.rationale && <div className="text-[9px] text-muted italic">{l.rationale}</div>}
            </li>
          ))}
        </ul>
      )}

      {/* Candidate browser */}
      {showCandidates && (
        <div className="border-t border-[#e5e5e5] pt-2 mt-2">
          {/* Constraint badge + override toggle */}
          {constraint && (
            <div className="flex items-center gap-2 mb-2 text-[10px] flex-wrap">
              <span className="text-muted">Link constraint:</span>
              <span className={`font-mono rounded px-1.5 py-0.5 ${
                constraint.mode === 'match_post_categories'
                  ? 'bg-[#fef3c7] text-[#92400e]'
                  : 'bg-[#f3f0ff] text-[#6C5CE7]'
              }`}>
                {constraint.mode}
              </span>
              {constraint.mode === 'match_post_categories' && Array.isArray(constraint.applied_categories) && (
                <span className="text-muted italic">
                  filtering on: {constraint.applied_categories.join(', ') || '(none — falling back to open)'}
                </span>
              )}
              {constraint.fell_back_to_open && (
                <span className="text-[#d97706]">⚠ no draft categories — fell back to open</span>
              )}
              {/* Toggle this query between modes without changing
                  the saved override — useful for "show me what's
                  out there if I relaxed the constraint" exploration. */}
              <button
                type="button"
                onClick={() => loadCandidates(constraint.mode === 'open' ? 'match_post_categories' : 'open')}
                className="ml-auto text-[10px] py-0.5 px-2 border border-[#e5e5e5] text-muted bg-white rounded cursor-pointer"
                title="Re-run with the OTHER mode just for this view (doesn't change saved settings)"
              >
                {constraint.mode === 'open' ? 'Try match_post_categories →' : 'Try open →'}
              </button>
            </div>
          )}
          <div className="text-[10px] text-muted mb-1">
            Top-K candidates by embedding similarity. Click any unlinked candidate to add it.
          </div>
          {!candidates || candidates.length === 0 ? (
            <div className="text-[10px] text-muted italic">No candidates returned. The tenant's content index may be empty or unembedded.</div>
          ) : (
            <ul className="space-y-1">
              {candidates.map((c, i) => {
                const used = linkedUrls.has(c.source_url)
                return (
                  <li key={i} className={`border rounded p-2 text-[11px] ${used ? 'border-[#2D9A5E]/30 bg-[#f0faf4]' : 'border-[#e5e5e5] bg-white hover:border-[#6C5CE7]/50'}`}>
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          {typeof c.similarity === 'number' && (
                            <span className="text-[9px] font-mono bg-[#f3f0ff] text-[#6C5CE7] rounded px-1.5 py-0.5">
                              {(c.similarity * 100).toFixed(0)}%
                            </span>
                          )}
                          {used && <span className="text-[9px] bg-[#2D9A5E] text-white rounded px-1.5 py-0.5">linked</span>}
                          <span className="text-[11px] font-medium truncate">{c.title}</span>
                        </div>
                        {c.excerpt && <div className="text-[9px] text-muted mt-0.5 line-clamp-2">{c.excerpt.slice(0, 200)}</div>}
                        <div className="text-[9px] text-muted font-mono mt-0.5 break-all">{c.source_url}</div>
                      </div>
                      {!used && (
                        <button
                          type="button"
                          onClick={() => addLink(c)}
                          className="text-[10px] py-1 px-2 border border-[#6C5CE7] text-[#6C5CE7] bg-white rounded cursor-pointer whitespace-nowrap"
                        >+ Add</button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

// ── Categories / tags token input ─────────────────────────────────
// Comma-separated text input + a <datalist> drawn from the tenant's
// WP taxonomy. The datalist gives free-text autocomplete without
// constraining the user to existing values — they can still type
// a new category name and it'll save fine.
function CategoryTokensInput({ value, onChange, options, listIdSuffix = 'categories' }) {
  const [text, setText] = useState((value || []).join(', '))
  // Re-sync when the upstream value changes (e.g. round-trip from save).
  useEffect(() => {
    const incoming = (value || []).join(', ')
    if (incoming !== text) setText(incoming)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  const listId = `taxonomy-${listIdSuffix}`
  return (
    <>
      <input
        type="text"
        value={text}
        onChange={e => setText(e.target.value)}
        onBlur={() => {
          // Parse on blur — keeps spaces typing-friendly during edits.
          const parsed = text.split(',').map(s => s.trim()).filter(Boolean)
          onChange(parsed)
        }}
        list={listId}
        className="w-full text-[11px] border border-[#e5e5e5] rounded p-1.5"
        placeholder={listIdSuffix === 'tags' ? 'e.g. shop hop, candle bar, beginner' : 'e.g. Candle Bar, Events'}
      />
      {Array.isArray(options) && options.length > 0 && (
        <datalist id={listId}>
          {options.map(o => (
            <option key={o.id} value={o.name}>{o.count ? `${o.count} posts` : ''}</option>
          ))}
        </datalist>
      )}
    </>
  )
}

// ── Image manager ─────────────────────────────────────────────────
// Sits at the top of the BlogPostEditor body (above the Generate
// button area, when present). Lets the user upload images that the
// article-generation prompt will respect — pre-generation uploads
// flow into the system prompt as USER-UPLOADED IMAGES so the model
// references them in image_specs by filename + role.
function ImageManager({ postId, images, onChange, setError, defaultPhotoQuery = '' }) {
  const [uploading, setUploading] = useState(false)
  const [pendingFile, setPendingFile] = useState(null)
  const [pendingFilename, setPendingFilename] = useState('')
  const [pendingAlt, setPendingAlt] = useState('')
  const [pendingRole, setPendingRole] = useState('inline')
  // WP-media picker modal state. Opening it offers an alternative
  // to the file-upload path: pick an image already on the WP site
  // (already licensed, already has alt text) and skip our storage
  // entirely.
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerRole, setPickerRole] = useState('inline')
  // Free-stock photo picker (Pexels today). Same role-driven UX as
  // the WP picker; on pick, we POST to /images/from-free-photo which
  // server-downloads the bytes + stores them in our blog_post_images
  // table.
  const [freePhotoOpen, setFreePhotoOpen] = useState(false)
  const [freePhotoRole, setFreePhotoRole] = useState('inline')
  // Pre-flight check: image storage must be configured before
  // upload can succeed. Saves the user from picking a file +
  // typing alt text only to be told it doesn't work.
  const [storageOk, setStorageOk] = useState(true)
  useEffect(() => {
    api.getStorageStatus().then(s => setStorageOk(!!s?.configured))
  }, [])

  const handlePickFromWp = async (mediaItem) => {
    setPickerOpen(false)
    setError(null)
    try {
      await api.attachWpMedia(postId, mediaItem, { role: pickerRole })
      await onChange()
    } catch (e) {
      setError(e?.message || String(e))
    }
  }

  const handlePickFreePhoto = async (photo) => {
    setFreePhotoOpen(false)
    setError(null)
    try {
      await api.attachFreePhoto(postId, photo, {
        role: freePhotoRole,
        searchQuery: defaultPhotoQuery,
      })
      await onChange()
    } catch (e) {
      setError(e?.message || String(e))
    }
  }

  const reset = () => {
    setPendingFile(null)
    setPendingFilename('')
    setPendingAlt('')
    setPendingRole('inline')
  }

  const handleFileSelected = (file) => {
    if (!file) return
    setPendingFile(file)
    // Seed filename from original (without extension), slugified.
    const base = (file.name || '').replace(/\.[a-z0-9]+$/i, '')
    setPendingFilename(base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80))
  }

  const handleUpload = async () => {
    if (!pendingFile) return
    if (!pendingAlt.trim()) {
      setError('Alt text is required (accessibility + SEO).')
      return
    }
    setUploading(true)
    setError(null)
    try {
      await api.uploadBlogImage(postId, pendingFile, {
        filename: pendingFilename || undefined,
        alt_text: pendingAlt,
        role: pendingRole,
      })
      reset()
      await onChange()
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="bg-white border border-[#e5e5e5] rounded p-3 space-y-3">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <h3 className="text-[12px] font-medium">Images ({images.length})</h3>
          <p className="text-[10px] text-muted leading-snug">
            Upload your images BEFORE generating the article. SEO filenames + alt text feed into the writer's prompt, so the article references the right images at the right positions. You can still upload after generating; click Regenerate to have the article incorporate the new images.
          </p>
        </div>
      </div>

      {/* Pick from WP library — always available, even when our
          storage isn't configured. Best path for users with images
          already on the WP site. */}
      <div className="flex items-center gap-2 text-[11px] flex-wrap">
        <span className="text-muted">Quick add:</span>
        <button
          type="button"
          onClick={() => { setPickerRole('featured'); setPickerOpen(true) }}
          className="text-[10px] py-1 px-2 border border-[#6C5CE7] text-[#6C5CE7] bg-white rounded cursor-pointer"
          title="Pick a featured (hero) image from your existing WP media library"
        >📚 Pick featured from WP</button>
        <button
          type="button"
          onClick={() => { setPickerRole('inline'); setPickerOpen(true) }}
          className="text-[10px] py-1 px-2 border border-[#6C5CE7] text-[#6C5CE7] bg-white rounded cursor-pointer"
          title="Pick an inline image from your existing WP media library"
        >📚 Pick inline from WP</button>
        <button
          type="button"
          onClick={() => { setFreePhotoRole('featured'); setFreePhotoOpen(true) }}
          className="text-[10px] py-1 px-2 border border-[#0a4d2c] text-[#0a4d2c] bg-white rounded cursor-pointer"
          title="Search Pexels for a free-to-use featured (hero) photo. Pre-fills with this draft's focus keyword."
        >🌐 Featured from Pexels</button>
        <button
          type="button"
          onClick={() => { setFreePhotoRole('inline'); setFreePhotoOpen(true) }}
          className="text-[10px] py-1 px-2 border border-[#0a4d2c] text-[#0a4d2c] bg-white rounded cursor-pointer"
          title="Search Pexels for a free-to-use inline photo. Pre-fills with this draft's focus keyword."
        >🌐 Inline from Pexels</button>
      </div>

      <WpMediaPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={handlePickFromWp}
        title={`Pick ${pickerRole === 'featured' ? 'a featured (hero)' : 'an inline'} image`}
      />

      <FreePhotosPicker
        open={freePhotoOpen}
        onClose={() => setFreePhotoOpen(false)}
        onPick={handlePickFreePhoto}
        defaultQuery={defaultPhotoQuery}
        defaultOrientation={freePhotoRole === 'featured' ? 'landscape' : null}
        title={`Find ${freePhotoRole === 'featured' ? 'a featured (hero)' : 'an inline'} photo (free for commercial use)`}
      />

      {/* Storage-not-configured warning. Note: "📚 Pick from WP"
          above STILL WORKS without storage — only file upload here
          requires Supabase. */}
      {!storageOk && (
        <div className="bg-[#fff7e6] border border-[#f5a623] rounded p-2 text-[11px] text-[#8a4b00]">
          <b>File upload disabled.</b> Image storage isn't configured locally — add <code className="font-mono text-[10px] bg-white px-1 rounded">SUPABASE_URL</code> and <code className="font-mono text-[10px] bg-white px-1 rounded">SUPABASE_SERVICE_KEY</code> to <code className="font-mono text-[10px] bg-white px-1 rounded">folderly-backend/.env</code> for fresh uploads. The "📚 Pick from WP" buttons above still work — they reference your existing WP media library and skip our storage entirely.
        </div>
      )}

      {/* Upload form */}
      <div className="border border-dashed border-[#e5e5e5] rounded p-2 space-y-2">
        <div className="flex items-center gap-2">
          <input
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/webp,image/gif,image/avif"
            onChange={e => handleFileSelected(e.target.files?.[0] || null)}
            disabled={uploading || !storageOk}
            className="text-[11px] flex-1"
          />
          {pendingFile && (
            <button
              type="button"
              onClick={reset}
              className="text-[10px] py-1 px-2 border border-[#e5e5e5] text-muted bg-white rounded cursor-pointer"
              disabled={uploading}
            >Cancel</button>
          )}
        </div>
        {pendingFile && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[9px] font-medium block mb-0.5">SEO filename (slug, no extension)</label>
              <input
                type="text"
                value={pendingFilename}
                onChange={e => setPendingFilename(e.target.value)}
                className="w-full text-[11px] border border-[#e5e5e5] rounded p-1.5 font-mono"
                placeholder="e.g. macrame-keychain-shop-hop"
                disabled={uploading}
              />
            </div>
            <div>
              <label className="text-[9px] font-medium block mb-0.5">Role</label>
              <select
                value={pendingRole}
                onChange={e => setPendingRole(e.target.value)}
                className="w-full text-[11px] border border-[#e5e5e5] rounded p-1.5"
                disabled={uploading}
              >
                <option value="inline">Inline</option>
                <option value="featured">Featured (hero)</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="text-[9px] font-medium block mb-0.5">Alt text *</label>
              <input
                type="text"
                value={pendingAlt}
                onChange={e => setPendingAlt(e.target.value)}
                className="w-full text-[11px] border border-[#e5e5e5] rounded p-1.5"
                placeholder="Describe what's visible. Don't keyword-stuff. <125 chars."
                maxLength={125}
                disabled={uploading}
              />
              <div className="text-[9px] text-muted">{pendingAlt.length} / 125</div>
            </div>
            <div className="col-span-2">
              <button
                type="button"
                onClick={handleUpload}
                disabled={uploading || !pendingAlt.trim()}
                className="text-[11px] py-1.5 px-3 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50 font-medium"
              >
                {uploading ? 'Uploading…' : '⬆ Upload'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Existing images list */}
      {images.length > 0 && (
        <ul className="space-y-2">
          {images.map(img => (
            <ImageRow
              key={img.id}
              postId={postId}
              image={img}
              onChange={onChange}
              setError={setError}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function ImageRow({ postId, image, onChange, setError }) {
  const [editing, setEditing] = useState(false)
  const [filename, setFilename] = useState(image.filename)
  const [alt, setAlt] = useState(image.alt_text || '')
  const [caption, setCaption] = useState(image.caption || '')
  const [role, setRole] = useState(image.role)
  const [position, setPosition] = useState(image.position_after_h2_index ?? '')
  const [busy, setBusy] = useState(false)

  // Re-sync local state if the image prop changes (e.g. after a save
  // round-trip from elsewhere).
  useEffect(() => {
    setFilename(image.filename)
    setAlt(image.alt_text || '')
    setCaption(image.caption || '')
    setRole(image.role)
    setPosition(image.position_after_h2_index ?? '')
  }, [image.id, image.filename, image.alt_text, image.caption, image.role, image.position_after_h2_index])

  const handleSave = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.updateBlogImage(postId, image.id, {
        filename,
        alt_text: alt,
        caption: caption || null,
        role,
        position_after_h2_index: position === '' ? null : Number(position),
      })
      setEditing(false)
      await onChange()
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm(`Delete "${image.filename}"? This removes the storage file and can't be undone.`)) return
    setBusy(true)
    setError(null)
    try {
      await api.deleteBlogImage(postId, image.id)
      await onChange()
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="border border-[#e5e5e5] rounded p-2 flex gap-2">
      <div className="flex-shrink-0 w-20 h-20 bg-[#fafafa] border border-[#e5e5e5] rounded overflow-hidden flex items-center justify-center">
        {image.public_url
          ? <img src={image.public_url} alt={image.alt_text || ''} className="w-full h-full object-cover" />
          : <span className="text-[8px] text-muted">no preview</span>
        }
      </div>
      <div className="flex-1 min-w-0">
        {editing ? (
          <div className="space-y-1.5 text-[11px]">
            <input
              type="text"
              value={filename}
              onChange={e => setFilename(e.target.value)}
              className="w-full border border-[#e5e5e5] rounded p-1 font-mono text-[11px]"
              placeholder="filename"
            />
            <input
              type="text"
              value={alt}
              onChange={e => setAlt(e.target.value)}
              className="w-full border border-[#e5e5e5] rounded p-1 text-[11px]"
              placeholder="alt text"
              maxLength={125}
            />
            <input
              type="text"
              value={caption}
              onChange={e => setCaption(e.target.value)}
              className="w-full border border-[#e5e5e5] rounded p-1 text-[11px]"
              placeholder="caption (optional)"
            />
            <div className="flex gap-1">
              <select
                value={role}
                onChange={e => setRole(e.target.value)}
                className="flex-1 border border-[#e5e5e5] rounded p-1 text-[11px]"
              >
                <option value="inline">Inline</option>
                <option value="featured">Featured</option>
              </select>
              <input
                type="number"
                value={position}
                onChange={e => setPosition(e.target.value)}
                className="w-24 border border-[#e5e5e5] rounded p-1 text-[11px]"
                placeholder="after H2 #"
                min="0"
              />
            </div>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={handleSave}
                disabled={busy}
                className="text-[10px] py-1 px-2 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50"
              >Save</button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                disabled={busy}
                className="text-[10px] py-1 px-2 border border-[#e5e5e5] text-muted bg-white rounded cursor-pointer"
              >Cancel</button>
            </div>
          </div>
        ) : (
          <div className="text-[11px]">
            <div className="flex items-center gap-1.5">
              <span className={`text-[9px] uppercase tracking-wide rounded px-1.5 py-0.5 ${
                image.role === 'featured'
                  ? 'bg-[#fef3c7] text-[#92400e]'
                  : 'bg-[#f3f0ff] text-[#6C5CE7]'
              }`}>{image.role}</span>
              <span className="font-mono text-[10px] text-muted truncate" title={image.filename}>
                {image.filename}
              </span>
              {image.position_after_h2_index != null && (
                <span className="text-[9px] text-muted">after H2 #{image.position_after_h2_index}</span>
              )}
            </div>
            <div className="text-[10px] text-ink mt-0.5">{image.alt_text || <i className="text-[#c0392b]">missing alt text</i>}</div>
            {image.caption && <div className="text-[10px] text-muted italic">{image.caption}</div>}
            <div className="flex gap-1 mt-1">
              <button
                type="button"
                onClick={() => setEditing(true)}
                disabled={busy}
                className="text-[10px] py-0.5 px-1.5 border border-[#e5e5e5] text-muted bg-white rounded cursor-pointer disabled:opacity-50"
              >Edit</button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={busy}
                className="text-[10px] py-0.5 px-1.5 border border-[#c0392b] text-[#c0392b] bg-white rounded cursor-pointer disabled:opacity-50"
              >Delete</button>
            </div>
          </div>
        )}
      </div>
    </li>
  )
}

function SourceCandidate({ c }) {
  return (
    <div className="mt-1 text-[10px] space-y-1">
      <div><b>Hook:</b> {c.audience_hook}</div>
      <div><b>Angle:</b> {c.angle}</div>
      {Array.isArray(c.suggested_h2s) && c.suggested_h2s.length > 0 && (
        <div>
          <b>Suggested H2s:</b>
          <ul className="list-disc list-inside ml-2">
            {c.suggested_h2s.map((h, i) => <li key={i}>{h}</li>)}
          </ul>
        </div>
      )}
      {c.rationale && <div><b>Why:</b> {c.rationale}</div>}
    </div>
  )
}

// Collapsible publish-attempts log. Shows up under the failure block on
// failed posts and under the published banner on successful posts so
// you can see retry history retroactively.
function PublishAttemptsLog({ attempts }) {
  const [open, setOpen] = useState(false)
  // Newest first.
  const ordered = [...attempts].reverse()
  const failed = ordered.filter(a => a && a.ok === false).length
  const ok = ordered.filter(a => a && a.ok === true).length
  return (
    <div className="mt-2 text-[10px]">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="text-muted underline cursor-pointer bg-transparent border-none p-0"
      >
        {open ? '▼' : '▶'} Publish history ({ordered.length} attempt{ordered.length === 1 ? '' : 's'} · {ok} ok / {failed} failed)
      </button>
      {open && (
        <ul className="mt-1 space-y-1 border border-[#e5e5e5] rounded p-2 bg-[#fafafa]">
          {ordered.map((a, i) => (
            <li key={i} className="flex items-start gap-2 font-mono text-[10px]">
              <span className={a.ok ? 'text-[#2D9A5E]' : 'text-[#c0392b]'}>{a.ok ? '✓' : '✕'}</span>
              <div className="flex-1 min-w-0">
                <div>
                  {new Date(a.attempted_at).toLocaleString()}
                  {a.kind && <span className="text-muted ml-1">[{a.kind}]</span>}
                  {a.duration_ms != null && <span className="text-muted ml-1">{a.duration_ms}ms</span>}
                  {a.http_status && <span className="text-muted ml-1">HTTP {a.http_status}</span>}
                </div>
                {!a.ok && (
                  <div className="text-[#c0392b] truncate" title={a.error_message}>
                    {a.error_class || a.error_reason || ''}
                    {a.error_message ? `: ${a.error_message}` : ''}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// Regenerate button with style-hint dropdown. The first-generate path
// is just a plain button (no dropdown — there's nothing to refine yet).
// Once a body exists, this menu lets the user pick a style override
// to apply on top of the standard guidelines.
function RegenerateMenu({ disabled, generating, hasFlaggedSentences, onPick }) {
  const [open, setOpen] = useState(false)
  const [customOpen, setCustomOpen] = useState(false)
  const [customText, setCustomText] = useState('')

  const presets = [
    { key: null,                       label: '✨ Regenerate (default)',     hint: 'Re-run with the standard prompt.' },
    { key: 'more_conversational',      label: '🗣 More conversational',       hint: 'Like a friend explaining over coffee. Heavy on contractions.' },
    { key: 'more_concise',             label: '✂️ More concise',              hint: 'Cut ~25%. Same info, fewer words.' },
    { key: 'more_specific',            label: '🎯 More specific',             hint: 'Replace generalities with concrete details and numbers.' },
  ]

  const handlePick = (key) => {
    setOpen(false)
    if (key === '__fix_flagged') {
      onPick({ styleHint: 'fix_flagged_sentences', useFlaggedSentences: true })
    } else {
      onPick({ styleHint: key })
    }
  }

  const handleCustom = (e) => {
    e?.preventDefault()
    if (!customText.trim()) return
    setOpen(false); setCustomOpen(false)
    onPick({ styleHint: customText.trim() })
    setCustomText('')
  }

  return (
    <div className="relative">
      <div className="flex">
        <button
          type="button"
          onClick={() => onPick({})}
          disabled={disabled}
          className="text-[11px] py-1.5 px-3 bg-[#6C5CE7] text-white border-none rounded-l cursor-pointer disabled:opacity-50 font-medium whitespace-nowrap flex-1"
          title="Re-run article generation with the standard prompt"
        >
          {generating ? 'Generating…' : '✨ Regenerate'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          disabled={disabled}
          className="text-[11px] py-1.5 px-2 bg-[#6C5CE7] text-white border-none rounded-r border-l border-l-white/30 cursor-pointer disabled:opacity-50 font-medium"
          title="Pick a style override"
        >▾</button>
      </div>
      {open && (
        <div
          className="absolute right-0 mt-1 w-[280px] bg-white border border-[#e5e5e5] rounded shadow-lg z-10"
          onMouseLeave={() => setOpen(false)}
        >
          <div className="px-2 py-1 text-[9px] uppercase tracking-wide text-muted border-b border-[#e5e5e5]">
            Regenerate with style override
          </div>
          {presets.map(p => (
            <button
              key={String(p.key)}
              type="button"
              onClick={() => handlePick(p.key)}
              className="block w-full text-left px-3 py-1.5 text-[11px] hover:bg-[#fafafa] cursor-pointer bg-white border-none border-b border-b-[#f5f5f5] last:border-b-0"
            >
              <div className="font-medium text-ink">{p.label}</div>
              <div className="text-[9px] text-muted">{p.hint}</div>
            </button>
          ))}
          {hasFlaggedSentences && (
            <button
              type="button"
              onClick={() => handlePick('__fix_flagged')}
              className="block w-full text-left px-3 py-1.5 text-[11px] hover:bg-[#fdf2f1] cursor-pointer bg-white border-none border-t border-t-[#c0392b]/30"
            >
              <div className="font-medium text-[#c0392b]">🔦 Fix AI-flagged sentences</div>
              <div className="text-[9px] text-muted">Use the saved ZeroGPT flags. Claude rewrites each flagged sentence specifically.</div>
            </button>
          )}
          <button
            type="button"
            onClick={() => { setCustomOpen(true); setOpen(false) }}
            className="block w-full text-left px-3 py-1.5 text-[11px] hover:bg-[#fafafa] cursor-pointer bg-white border-none border-t border-t-[#e5e5e5]"
          >
            <div className="font-medium text-ink">📝 Custom hint…</div>
            <div className="text-[9px] text-muted">Paste a critique from another AI or your own notes.</div>
          </button>
        </div>
      )}
      {customOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setCustomOpen(false)}>
          <form
            onSubmit={handleCustom}
            onClick={e => e.stopPropagation()}
            className="bg-white rounded-lg shadow-2xl w-full max-w-[500px] p-4 space-y-3"
          >
            <div>
              <div className="text-[13px] font-medium mb-1">Custom regenerate hint</div>
              <div className="text-[10px] text-muted">
                What should the model do differently? Plain English. Examples: "Make it sound less corporate.", "Add more first-person details.", "Drop the second H2 entirely — it's redundant."
              </div>
            </div>
            <textarea
              autoFocus
              value={customText}
              onChange={e => setCustomText(e.target.value)}
              rows={5}
              maxLength={1000}
              className="w-full text-[11px] border border-[#e5e5e5] rounded p-2 font-mono"
              placeholder="Type your critique / instruction…"
            />
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-muted">{customText.length}/1000</span>
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => { setCustomOpen(false); setCustomText('') }}
                className="text-[11px] py-1 px-3 border border-[#e5e5e5] text-muted bg-white rounded cursor-pointer"
              >Cancel</button>
              <button
                type="submit"
                disabled={!customText.trim()}
                className="text-[11px] py-1 px-3 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50 font-medium"
              >✨ Regenerate with hint</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

// Prominent ZeroGPT score panel. Always visible when the draft has a
// body. Mirrors V2's ResultCard surfacing of flagged sentences but at
// hero-card prominence rather than inline-text — the user wanted this
// loud, visible from across the room, color-coded.
//
// States:
//   - score >= 60   → red band, "Looks AI-generated. Rewrite needed."
//   - score 30-59   → amber band, "Mixed. Tighten the AI tells."
//   - score < 30    → green band, "Looks human."
//   - no score yet  → neutral band, "Not scored yet — click Recheck"
function ZeroGptPanel({ score, checkedAt, metadata, threshold, body, onRecheck, recheckDisabled }) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState('inline') // 'inline' | 'list'
  const sentences = Array.isArray(metadata?.sentences) ? metadata.sentences : []
  const hasScore = typeof score === 'number'

  // Color band + label per score range. Threshold-aware copy when the
  // tenant configured one — "exceeds your X% threshold" reads better
  // than a generic "high".
  let band, headline, sub, label
  if (!hasScore) {
    band = { bg: '#f5f5f5', border: '#e5e5e5', text: '#6b7280', accent: '#9ca3af' }
    headline = 'Not scored yet'
    sub = 'Click Recheck to score this draft against ZeroGPT.'
    label = '—'
  } else if (score >= 60) {
    band = { bg: '#fdf2f1', border: '#c0392b', text: '#8a1f15', accent: '#c0392b' }
    headline = 'Looks AI-generated'
    sub = threshold != null && score > threshold
      ? `Above your ${threshold}% threshold. Rewrite the flagged sentences before publishing.`
      : 'Strong AI signals. Rewrite the flagged sentences before publishing.'
    label = `${score.toFixed(0)}%`
  } else if (score >= 30) {
    band = { bg: '#fff7e6', border: '#d97706', text: '#7c4a00', accent: '#d97706' }
    headline = 'Mixed signal'
    sub = 'Some AI tells. Use the regenerate dropdown or rewrite flagged sentences to push this lower.'
    label = `${score.toFixed(0)}%`
  } else {
    band = { bg: '#ecfdf5', border: '#0a4d2c', text: '#064e3b', accent: '#0a4d2c' }
    headline = 'Looks human'
    sub = threshold != null
      ? `Under your ${threshold}% threshold. Safe to schedule / publish.`
      : 'Low AI signal. Safe to schedule / publish.'
    label = `${score.toFixed(0)}%`
  }

  return (
    <div
      className="mt-2 rounded border-l-4 border border-[#e5e5e5] bg-white overflow-hidden"
      style={{ borderLeftColor: band.accent }}
    >
      <div className="flex items-stretch">
        {/* Left: big score */}
        <div
          className="flex flex-col items-center justify-center px-4 py-3 text-center"
          style={{ background: band.bg, color: band.text, minWidth: 120 }}
        >
          <div className="text-[9px] uppercase tracking-wide font-medium">ZeroGPT score</div>
          <div className="text-[28px] font-bold font-mono leading-tight" style={{ color: band.accent }}>
            {label}
          </div>
          <div className="text-[9px] uppercase tracking-wide" style={{ color: band.text }}>AI likely</div>
        </div>
        {/* Right: headline + sub + actions */}
        <div className="flex-1 px-3 py-2 flex flex-col gap-1 justify-center min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[12px] font-semibold" style={{ color: band.text }}>{headline}</span>
            {checkedAt && (
              <span className="text-[9px] text-muted">checked {new Date(checkedAt).toLocaleString()}</span>
            )}
          </div>
          <div className="text-[10px] text-ink leading-snug">{sub}</div>
          <div className="flex items-center gap-1.5 flex-wrap mt-1">
            <button
              type="button"
              onClick={onRecheck}
              disabled={recheckDisabled}
              className="text-[10px] py-1 px-2 border border-[#e5e5e5] text-ink bg-white rounded cursor-pointer disabled:opacity-50 font-medium"
              title="Re-run ZeroGPT against the current body"
            >↻ Recheck</button>
            {sentences.length > 0 && (
              <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className="text-[10px] py-1 px-2 border rounded cursor-pointer font-medium"
                style={{ borderColor: band.accent, color: band.accent, background: band.bg }}
                title="Sentences ZeroGPT identified as AI-likely. These are the lines to rewrite."
              >🔦 {open ? 'Hide' : 'Show'} flagged ({sentences.length})</button>
            )}
            {hasScore && sentences.length === 0 && metadata && Object.keys(metadata).length > 0 && (
              <span
                className="text-[9px] text-muted italic"
                title="ZeroGPT returned a score but no per-sentence flags. May happen on shorter bodies or when AI-likeness is spread thinly across the whole article."
              >· no per-sentence flags from this check</span>
            )}
            {hasScore && (!metadata || Object.keys(metadata).length === 0) && (
              <span
                className="text-[9px] text-muted italic"
                title="The score predates the sentence-capture feature. Click ↻ Recheck for a fresh score that includes per-sentence flags."
              >· click ↻ Recheck to get per-sentence flags</span>
            )}
          </div>
        </div>
      </div>
      {open && sentences.length > 0 && (
        <div className="border-t bg-[#fdf2f1] p-3 space-y-2" style={{ borderColor: band.border }}>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-[10px] uppercase tracking-wide text-[#8a1f15] flex-1">
              {sentences.length} sentence{sentences.length === 1 ? '' : 's'} flagged as AI-generated. Edit them in the body field above, or use <b>🔦 Fix AI-flagged sentences</b> from the regenerate dropdown.
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[9px] text-muted">View:</span>
              <button
                type="button"
                onClick={() => setView('inline')}
                className={`text-[9px] py-0.5 px-1.5 rounded border cursor-pointer ${
                  view === 'inline' ? 'bg-[#c0392b] text-white border-[#c0392b]' : 'bg-white text-muted border-[#c0392b]/30'
                }`}
                title="Show the article body with flagged sentences highlighted in context"
              >📖 In context</button>
              <button
                type="button"
                onClick={() => setView('list')}
                className={`text-[9px] py-0.5 px-1.5 rounded border cursor-pointer ${
                  view === 'list' ? 'bg-[#c0392b] text-white border-[#c0392b]' : 'bg-white text-muted border-[#c0392b]/30'
                }`}
                title="Compact list of just the flagged sentences"
              >📋 List</button>
            </div>
          </div>
          {view === 'inline' && body && (
            <BodyWithHighlights body={body} flaggedSentences={sentences} />
          )}
          {view === 'list' && (
            <ul className="space-y-1.5">
              {sentences.map((s, i) => (
                <li key={i} className="text-[11px] bg-white border border-[#c0392b]/30 rounded p-2">
                  <mark className="bg-[#fce4ec] text-[#c0392b] px-1 rounded">{s}</mark>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

// Render the article body as plain-readable text with each flagged
// sentence wrapped in <mark>. Strategy: walk through the flagged
// sentences and progressively split the body into [unflagged, flagged,
// unflagged, ...] segments. Renders inside a whitespace-preserving
// container so paragraph breaks survive (markdown ## and ** chars are
// kept as-is — readable enough; user has the textarea above for
// actual editing).
function BodyWithHighlights({ body, flaggedSentences }) {
  if (!body) return null
  if (!flaggedSentences || flaggedSentences.length === 0) {
    return (
      <div className="bg-white border border-[#e5e5e5] rounded p-3 text-[12px] leading-relaxed font-sans whitespace-pre-wrap">
        {body}
      </div>
    )
  }

  // Build list of segments. Each iteration splits all current "unflagged"
  // segments on the next flagged sentence. Sentences may not appear
  // verbatim if they spanned a markdown link; in that case the segment
  // stays unflagged. Showing some flags inline is still strictly better
  // than showing none.
  let segments = [{ text: body, isFlagged: false }]
  for (const sentence of flaggedSentences) {
    const trimmed = sentence.trim()
    if (!trimmed) continue
    const next = []
    for (const seg of segments) {
      if (seg.isFlagged) { next.push(seg); continue }
      const idx = seg.text.indexOf(trimmed)
      if (idx === -1) { next.push(seg); continue }
      if (idx > 0) next.push({ text: seg.text.slice(0, idx), isFlagged: false })
      next.push({ text: trimmed, isFlagged: true })
      const rest = seg.text.slice(idx + trimmed.length)
      if (rest) next.push({ text: rest, isFlagged: false })
    }
    segments = next
  }

  const matchedCount = segments.filter(s => s.isFlagged).length
  const unmatchedCount = flaggedSentences.length - matchedCount

  return (
    <div>
      <div className="bg-white border border-[#e5e5e5] rounded p-3 text-[12px] leading-relaxed font-sans whitespace-pre-wrap">
        {segments.map((seg, i) =>
          seg.isFlagged ? (
            <mark key={i} className="bg-[#fce4ec] text-[#c0392b] px-1 rounded" title="ZeroGPT flagged this sentence">
              {seg.text}
            </mark>
          ) : (
            <span key={i}>{seg.text}</span>
          )
        )}
      </div>
      {unmatchedCount > 0 && (
        <div className="mt-1 text-[9px] text-muted italic">
          Note: {unmatchedCount} flagged sentence{unmatchedCount === 1 ? '' : 's'} couldn't be located inline (likely altered by an edit since the last check). Switch to 📋 List view to see them, or click ↻ Recheck above to re-score the current body.
        </div>
      )}
    </div>
  )
}
