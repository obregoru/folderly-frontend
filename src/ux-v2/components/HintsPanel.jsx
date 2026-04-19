import { useState } from 'react'

/**
 * Hints panel — the shared creative brief. Everything downstream
 * (voiceover, overlays, captions) reads from this. On desktop we can
 * supplement with filename/folder hints; on mobile those aren't useful
 * so the description carries the weight.
 *
 * Contents:
 *   - Extracted frames: visual reference for the AI and the user.
 *     Pulled from the merge pipeline's existing frame-capture step.
 *   - Metadata: filenames / folders shown when we have them.
 *   - Description: what the video is about, plain-language.
 *   - Hook angles: things to communicate / hooks to try.
 *   - Discussion: lightweight chat with AI for brainstorming before
 *     committing.
 */
export default function HintsPanel({ hasMerge }) {
  const [description, setDescription] = useState('')
  const [hookAngles, setHookAngles] = useState('')
  const [discussion, setDiscussion] = useState([
    { role: 'ai', text: 'What\'s the key thing you want someone to take away from this video?' },
  ])
  const [chatInput, setChatInput] = useState('')

  // Fake extracted frames — in real impl these come from merge's frame
  // capture step. Cached per-job so they don't re-capture on every open.
  const extractedFrames = [
    { key: 'f1', ts: '0:00', url: 'https://picsum.photos/seed/h1/160/280' },
    { key: 'f2', ts: '0:02', url: 'https://picsum.photos/seed/h2/160/280' },
    { key: 'f3', ts: '0:05', url: 'https://picsum.photos/seed/h3/160/280' },
    { key: 'f4', ts: '0:08', url: 'https://picsum.photos/seed/h4/160/280' },
    { key: 'f5', ts: '0:11', url: 'https://picsum.photos/seed/h5/160/280' },
    { key: 'f6', ts: '0:14', url: 'https://picsum.photos/seed/h6/160/280' },
  ]

  const sendMessage = () => {
    if (!chatInput.trim()) return
    const userMsg = chatInput.trim()
    setDiscussion(prev => [...prev, { role: 'user', text: userMsg }])
    setChatInput('')
    // Fake AI response
    setTimeout(() => {
      setDiscussion(prev => [...prev, {
        role: 'ai',
        text: `Got it — "${userMsg.slice(0, 40)}${userMsg.length > 40 ? '…' : ''}". Want me to draft three hook options based on that? Or generate caption styles?`,
      }])
    }, 600)
  }

  return (
    <div className="space-y-3">
      <div className="text-[12px] font-medium">Hints — the brief downstream tools use</div>
      <div className="text-[10px] text-muted">
        Everything below (voiceover, overlays, captions) reads from this. Describe what the video's about, what angles to explore, and chat with AI to refine before writing.
      </div>

      {/* Extracted frames — visual reference for both user and AI. */}
      {hasMerge ? (
        <div>
          <div className="text-[11px] font-medium mb-1">Frames pulled from the merged video</div>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {extractedFrames.map(f => (
              <div key={f.key} className="flex-shrink-0 text-center">
                <img
                  src={f.url}
                  alt={f.ts}
                  className="w-[60px] h-[90px] object-cover rounded border border-[#e5e5e5]"
                />
                <div className="text-[8px] text-muted mt-0.5 font-mono">{f.ts}</div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="text-[10px] text-muted italic bg-[#f8f7f3] rounded p-2">
          Merge your clips first — frames will be extracted automatically so AI can see what's in the video.
        </div>
      )}

      {/* Description — plain language about the video. */}
      <div>
        <label className="text-[11px] font-medium">What's this video about?</label>
        <div className="text-[9px] text-muted mb-1">Plain language. E.g. "teen birthday party at a perfume studio, 5 girls making their own scents."</div>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="teen birthday party at a perfume studio, 5 girls making their own scents. each picks notes, mixes, pours, leaves with a bottle they'll actually wear for months…"
          rows={4}
          className="w-full text-[11px] border border-[#e5e5e5] rounded p-2 bg-white resize-y min-h-[80px]"
        />
      </div>

      {/* Hook angles — what do we want to communicate? */}
      <div>
        <label className="text-[11px] font-medium">What should the hooks / captions emphasize?</label>
        <div className="text-[9px] text-muted mb-1">Angles to explore, things the AI should lean into. Multiple lines welcome.</div>
        <textarea
          value={hookAngles}
          onChange={e => setHookAngles(e.target.value)}
          placeholder={`- longevity — they still wear it months later\n- not a party favor, an actual signature scent\n- the group moment (5 friends, each picked their own)\n- birthday context but also girls' night / bestie date`}
          rows={5}
          className="w-full text-[11px] border border-[#e5e5e5] rounded p-2 bg-white resize-y min-h-[100px] font-mono"
        />
      </div>

      {/* Discussion thread — brainstorm with AI before tools commit. */}
      <div>
        <div className="text-[11px] font-medium mb-1">Discuss with AI 💬</div>
        <div className="border border-[#e5e5e5] rounded bg-white">
          <div className="max-h-[220px] overflow-y-auto p-2 space-y-1.5">
            {discussion.map((m, i) => (
              <div
                key={i}
                className={`text-[11px] rounded px-2 py-1.5 ${m.role === 'user' ? 'bg-[#6C5CE7]/10 text-ink ml-6' : 'bg-[#f8f7f3] text-ink mr-6'}`}
              >
                <span className={`text-[9px] font-medium block mb-0.5 ${m.role === 'user' ? 'text-[#6C5CE7]' : 'text-muted'}`}>
                  {m.role === 'user' ? 'You' : 'AI'}
                </span>
                {m.text}
              </div>
            ))}
          </div>
          <div className="border-t border-[#e5e5e5] p-1.5 flex gap-1">
            <input
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') sendMessage() }}
              placeholder="Ask AI about angles, hooks, tone…"
              className="flex-1 text-[11px] border-none p-1 bg-transparent outline-none"
            />
            <button
              onClick={sendMessage}
              className="text-[10px] py-1 px-2.5 bg-[#6C5CE7] text-white border-none rounded cursor-pointer"
            >Send</button>
          </div>
        </div>
      </div>

      {/* Save / apply — makes the hints active for downstream tools. */}
      <button className="w-full py-2 bg-[#2D9A5E] text-white text-[11px] font-medium border-none rounded cursor-pointer">
        Save hints (used by voice / overlays / captions)
      </button>
    </div>
  )
}
