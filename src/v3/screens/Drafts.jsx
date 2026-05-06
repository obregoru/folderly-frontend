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
                  <div className="text-[9px] text-muted whitespace-nowrap text-right">
                    {p.generated_at ? new Date(p.generated_at).toLocaleDateString() : 'not generated'}
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

  const value = (field) => editBuf[field] !== undefined ? editBuf[field] : post?.[field]
  const setField = (field, v) => setEditBuf(prev => ({ ...prev, [field]: v }))
  const isDirty = Object.keys(editBuf).length > 0

  const flashSaved = () => { setSavedFlash(true); setTimeout(() => setSavedFlash(false), 1500) }

  const handleGenerate = async () => {
    if (!post) return
    setGenerating(true)
    setError(null)
    try {
      const updated = await api.generateBlogPost(post.id, { targetWordCount: 900 })
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
            {/* Generate is always visible (Generate / Regenerate) */}
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating || publishing}
              className="text-[11px] py-1.5 px-3 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50 font-medium whitespace-nowrap"
            >
              {generating ? 'Generating…' : (hasBody ? '✨ Regenerate' : '✨ Generate article')}
            </button>

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

            {/* Publish flow — only when 'ready' or 'failed' + has body */}
            {hasBody && (post.status === 'ready' || post.status === 'failed') && (
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
                  title={isDirty ? 'Save your edits before publishing' : 'Push to WordPress with full SEO fields + images'}
                >
                  {publishing ? 'Publishing…' : '🚀 Publish to WordPress'}
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
            <b>Publish failed:</b> {post.publish_metadata.error}
            {post.publish_metadata.failed_at && (
              <span className="text-muted ml-2">at {new Date(post.publish_metadata.failed_at).toLocaleString()}</span>
            )}
          </div>
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

      {/* Save bar — only when dirty */}
      {isDirty && hasBody && (
        <div className="bg-[#fff7e6] border border-[#f5a623] rounded p-2 flex items-center gap-2 text-[11px] text-[#8a4b00]">
          <div className="flex-1">Unsaved changes ({Object.keys(editBuf).length} field{Object.keys(editBuf).length === 1 ? '' : 's'})</div>
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
          >{saving ? 'Saving…' : 'Save'}</button>
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
            <Field label="Categories (comma-separated)">
              <input
                type="text"
                value={(value('categories') || []).join(', ')}
                onChange={e => setField('categories', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                className="w-full text-[11px] border border-[#e5e5e5] rounded p-1.5"
              />
            </Field>
            <Field label="Tags (comma-separated)">
              <input
                type="text"
                value={(value('tags') || []).join(', ')}
                onChange={e => setField('tags', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                className="w-full text-[11px] border border-[#e5e5e5] rounded p-1.5"
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

          <Section title={`Internal links (${(post.internal_links || []).length})`}>
            {(post.internal_links || []).length === 0 ? (
              <div className="text-[10px] text-muted italic">No internal links suggested.</div>
            ) : (
              <ul className="space-y-1">
                {(post.internal_links || []).map((l, i) => (
                  <li key={i} className="border border-[#e5e5e5] rounded p-2 text-[11px]">
                    <div>
                      <a href={l.url} target="_blank" rel="noopener noreferrer" className="text-[#6C5CE7] underline">
                        {l.anchor_text}
                      </a>
                      <span className="ml-2 text-[9px] text-muted font-mono">{l.url}</span>
                    </div>
                    {l.rationale && <div className="text-[10px] text-muted italic mt-0.5">{l.rationale}</div>}
                  </li>
                ))}
              </ul>
            )}
          </Section>

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
// ── Image manager ─────────────────────────────────────────────────
// Sits at the top of the BlogPostEditor body (above the Generate
// button area, when present). Lets the user upload images that the
// article-generation prompt will respect — pre-generation uploads
// flow into the system prompt as USER-UPLOADED IMAGES so the model
// references them in image_specs by filename + role.
function ImageManager({ postId, images, onChange, setError }) {
  const [uploading, setUploading] = useState(false)
  const [pendingFile, setPendingFile] = useState(null)
  const [pendingFilename, setPendingFilename] = useState('')
  const [pendingAlt, setPendingAlt] = useState('')
  const [pendingRole, setPendingRole] = useState('inline')

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

      {/* Upload form */}
      <div className="border border-dashed border-[#e5e5e5] rounded p-2 space-y-2">
        <div className="flex items-center gap-2">
          <input
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/webp,image/gif,image/avif"
            onChange={e => handleFileSelected(e.target.files?.[0] || null)}
            disabled={uploading}
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
