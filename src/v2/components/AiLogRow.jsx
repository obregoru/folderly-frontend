import { useState } from 'react'

/**
 * Shared AI-log row + expandable detail panel. Used by the tenant-wide
 * log in SettingsDrawerV2 and by the per-draft JobAiLog in EditorV2.
 */
export default function AiLogRow({ row, showJob = false }) {
  const [expanded, setExpanded] = useState(false)
  const when = row.created_at
    ? new Date(row.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '—'
  const preview = (row.response_text || row.error || '').slice(0, 120).replace(/\s+/g, ' ')
  const dur = row.duration_ms != null ? `${Math.round(row.duration_ms)}ms` : ''
  const tokens = (row.tokens_in || row.tokens_out) ? `${row.tokens_in || 0}→${row.tokens_out || 0}` : ''
  const copy = (text) => { try { navigator.clipboard.writeText(text || '') } catch {} }
  // Pull out flags the user cares about at a glance — these come from
  // per-endpoint metadata (critique_chars, has_voiceover_script, etc.)
  const md = row.metadata || {}
  const critiqueChars = Number(md.critique_chars) || 0
  const badges = [
    critiqueChars > 0 ? { label: `🎯 critique (${critiqueChars})`, bg: '#fef3c7', fg: '#92400e', border: '#d97706' } : null,
    md.has_voiceover_script ? { label: 'VO ctx', bg: '#f3f0ff', fg: '#6C5CE7', border: '#6C5CE7' } : null,
    md.has_captions_script ? { label: 'CC ctx', bg: '#f0faf4', fg: '#2D9A5E', border: '#2D9A5E' } : null,
    md.off_topic ? { label: 'off-topic', bg: '#fdeaea', fg: '#c0392b', border: '#c0392b' } : null,
    md.overrides_active ? { label: 'overrides', bg: '#f3f0ff', fg: '#6C5CE7', border: '#6C5CE7' } : null,
  ].filter(Boolean)

  return (
    <div className={`border rounded bg-white ${row.error ? 'border-[#c0392b]/30' : 'border-[#e5e5e5]'}`}>
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full text-left p-2 bg-transparent border-none cursor-pointer"
      >
        <div className="flex items-center gap-2 text-[10px]">
          <span className="font-mono text-muted flex-shrink-0">{when}</span>
          <span className="font-medium text-ink truncate flex-1">{row.endpoint}</span>
          {tokens && <span className="text-muted font-mono text-[9px]">{tokens}</span>}
          {dur && <span className="text-muted font-mono text-[9px]">{dur}</span>}
          <span className="text-muted">{expanded ? '▾' : '▸'}</span>
        </div>
        {showJob && row.job_name && (
          <div className="text-[9px] text-[#6C5CE7] mt-0.5 truncate">→ {row.job_name}</div>
        )}
        {badges.length > 0 && (
          <div className="flex items-center gap-1 mt-1 flex-wrap">
            {badges.map((b, i) => (
              <span
                key={i}
                className="text-[9px] rounded-full px-1.5 py-0.5 border"
                style={{ background: b.bg, color: b.fg, borderColor: b.border + '66' }}
              >{b.label}</span>
            ))}
          </div>
        )}
        <div className="text-[9px] text-muted mt-0.5 line-clamp-1 font-mono">
          {row.error ? `ERR: ${row.error.slice(0, 140)}` : preview}
        </div>
      </button>
      {expanded && (
        <div className="border-t border-[#e5e5e5] p-2 space-y-2 text-[10px] bg-[#fafafa]">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-muted">{row.model || 'model unknown'}</span>
            <span className="font-mono text-muted">{row.kind || 'anthropic'}</span>
            {row.metadata && Object.keys(row.metadata).length > 0 && (
              <span className="font-mono text-[9px] text-muted truncate max-w-full">{JSON.stringify(row.metadata)}</span>
            )}
          </div>

          {row.system_prompt && <LogBlock label="System prompt" text={row.system_prompt} onCopy={copy} />}
          {row.user_content  && <LogBlock label="User message"  text={row.user_content}  onCopy={copy} />}
          {row.response_text && <LogBlock label="Assistant response" text={row.response_text} onCopy={copy} />}
          {row.error && (
            <div className="border border-[#c0392b]/30 bg-[#fdf2f1] rounded p-1.5">
              <div className="text-[9px] text-[#c0392b] font-medium mb-1">Error</div>
              <div className="text-[10px] font-mono whitespace-pre-wrap">{row.error}</div>
            </div>
          )}
          <button
            onClick={() => {
              const combined = [
                `# ${row.endpoint}`,
                `model: ${row.model}`,
                '',
                row.system_prompt ? `## System\n${row.system_prompt}` : '',
                row.user_content ? `## User\n${row.user_content}` : '',
                row.response_text ? `## Response\n${row.response_text}` : '',
              ].filter(Boolean).join('\n\n')
              copy(combined)
            }}
            className="w-full text-[9px] py-1 px-2 border border-[#6C5CE7] text-[#6C5CE7] bg-white rounded cursor-pointer"
          >Copy entire interaction (paste into ChatGPT / Gemini for comparison)</button>
        </div>
      )}
    </div>
  )
}

function LogBlock({ label, text, onCopy }) {
  return (
    <div>
      <div className="flex items-center gap-1 text-[9px] text-muted mb-1">
        <span className="font-medium uppercase tracking-wide">{label}</span>
        <button
          onClick={() => onCopy(text)}
          className="ml-auto text-[9px] py-0 px-1.5 border border-[#e5e5e5] bg-white rounded cursor-pointer"
        >copy</button>
      </div>
      <pre className="text-[10px] font-mono whitespace-pre-wrap bg-white border border-[#e5e5e5] rounded p-1.5 max-h-40 overflow-auto">{text}</pre>
    </div>
  )
}
