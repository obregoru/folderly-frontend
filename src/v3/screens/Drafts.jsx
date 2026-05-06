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
          <div className="flex flex-col gap-1 self-start">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating}
              className="text-[11px] py-1.5 px-3 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50 font-medium whitespace-nowrap"
            >
              {generating ? 'Generating…' : (hasBody ? '✨ Regenerate' : '✨ Generate article')}
            </button>
            {hasBody && (
              <button
                type="button"
                onClick={handleStatusToggle}
                disabled={saving}
                className={`text-[10px] py-1 px-2 border rounded cursor-pointer disabled:opacity-50 font-medium whitespace-nowrap ${
                  post.status === 'ready'
                    ? 'border-[#d97706] text-[#d97706] bg-white'
                    : 'border-[#2D9A5E] bg-[#2D9A5E] text-white'
                }`}
              >
                {post.status === 'ready' ? '↩ Mark drafting' : '✓ Mark ready'}
              </button>
            )}
          </div>
        </div>
        {generating && (
          <div className="text-[10px] text-muted italic mt-2">
            Claude is writing the full article. ~30-90s. Internal-link candidates pulled from your indexed posts.
          </div>
        )}
      </div>

      {error && (
        <div className="bg-[#fdf2f1] border border-[#c0392b]/30 rounded p-2 text-[11px] text-[#c0392b]">
          {error}
        </div>
      )}

      {/* Empty-state if not yet generated */}
      {!hasBody && !generating && (
        <div className="bg-white border border-[#e5e5e5] rounded p-3 text-[11px] text-muted">
          This draft is a skeleton — title + slug only. Click <b>Generate article</b> above to produce the full body, meta tags, image specs, and internal-link picks.
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
