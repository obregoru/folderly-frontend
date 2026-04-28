// Visualization layer for the First-2-Second analyzer. Listens for
// the panel's posty-first2s-change event and draws toggleable
// overlays on top of the video preview:
//
//   - Safe zones — translucent boxes covering TikTok UI dead-zones
//     (top status bar, bottom comment/like/share row, right-side
//     button column). Helps the user spot when their hook text is
//     about to be hidden by the platform UI.
//   - Detection boxes — bounding boxes the analyzer reported,
//     positioned on the live video. Active boxes filter to those
//     whose `time` is close to the current playback position so the
//     user sees a moving annotation.
//   - Score HUD — small corner card with the verdict + sub-scores.
//     Useful for at-a-glance editing.
//   - Clarity timeline — markers along a 0-2s ruler at the bottom
//     showing where each analyzer event landed.
//
// All four are toggled independently from the panel; this component
// just consumes whatever the event hands it. Renders nothing until
// an analysis exists.

import { useEffect, useState } from 'react'

export default function First2sOverlay({ videoEl }) {
  const [state, setState] = useState({ analysis: null, overlays: null })
  // Track currentTime on the video so detection boxes that have a
  // .time field follow playback rather than all rendering at once.
  const [nowMs, setNowMs] = useState(0)

  useEffect(() => {
    if (typeof window === 'undefined') return
    // Pick up any state set before this component mounted.
    if (window._postyFirst2s) setState(window._postyFirst2s)
    const onChange = (e) => setState(e?.detail || { analysis: null, overlays: null })
    window.addEventListener('posty-first2s-change', onChange)
    return () => window.removeEventListener('posty-first2s-change', onChange)
  }, [])

  useEffect(() => {
    if (!videoEl) return
    let raf = null
    const tick = () => {
      try { setNowMs((videoEl.currentTime || 0) * 1000) } catch {}
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => { if (raf) cancelAnimationFrame(raf) }
  }, [videoEl])

  const { analysis, overlays } = state
  if (!analysis || !overlays) return null

  return (
    <>
      {overlays.safeZones && <SafeZonesLayer />}
      {overlays.detectionBoxes && (
        <DetectionsLayer detections={analysis.detections || []} nowMs={nowMs} />
      )}
      {overlays.scoreHUD && <ScoreHUDLayer score={analysis.score} timeToClarity={analysis.timeToClarity} />}
      {overlays.clarityTimeline && (
        <ClarityTimelineLayer events={analysis.events || []} nowMs={nowMs} />
      )}
    </>
  )
}

// TikTok / Reels UI dead-zones. Percentages are tuned for vertical
// 9:16 — the exact boundary varies per platform (TikTok's right
// rail is ~12% wide, Reels' bottom HUD is ~18%) but a single union
// of zones is more useful than four conflicting per-platform layers.
function SafeZonesLayer() {
  const stroke = 'rgba(255,80,80,0.5)'
  const fill = 'rgba(255,80,80,0.10)'
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 6 }}>
      {/* Top status bar (~5%). */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '5%', background: fill, borderBottom: `1px dashed ${stroke}` }} />
      {/* Right rail — like / comment / share buttons (~12% width, top-aligned to mid). */}
      <div style={{ position: 'absolute', top: '40%', right: 0, width: '14%', bottom: '18%', background: fill, borderLeft: `1px dashed ${stroke}` }} />
      {/* Bottom row — caption + creator handle + audio (~18% from bottom). */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '18%', background: fill, borderTop: `1px dashed ${stroke}` }} />
      <div style={{ position: 'absolute', bottom: '18%', right: 4, fontSize: 9, color: 'rgba(255,80,80,0.85)', background: 'rgba(0,0,0,0.45)', padding: '2px 4px', borderRadius: 2, fontFamily: 'monospace' }}>
        TikTok safe zones
      </div>
    </div>
  )
}

// Bounding boxes from analyzer.detections. Each one carries a `time`
// (seconds into the clip); we show only boxes whose time is within a
// 0.4s window of the current playback position so the annotation
// follows the video.
function DetectionsLayer({ detections, nowMs }) {
  const t = nowMs / 1000
  const visible = detections.filter(d => Math.abs((d.time ?? 0) - t) <= 0.4 && d?.box)
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 7 }}>
      {visible.map((d, i) => {
        const color = d.type === 'face' ? '#22c55e'
          : d.type === 'group' ? '#f59e0b'
          : d.type === 'person' ? '#3b82f6'
          : d.type === 'text' ? '#a855f7'
          : '#6b7280'
        return (
          <div key={i}>
            <div
              style={{
                position: 'absolute',
                left: `${(d.box.x || 0) * 100}%`,
                top: `${(d.box.y || 0) * 100}%`,
                width: `${(d.box.width || 0) * 100}%`,
                height: `${(d.box.height || 0) * 100}%`,
                border: `2px solid ${color}`,
                borderRadius: 2,
              }}
            />
            <div
              style={{
                position: 'absolute',
                left: `${(d.box.x || 0) * 100}%`,
                top: `calc(${(d.box.y || 0) * 100}% - 16px)`,
                fontSize: 10,
                color,
                background: 'rgba(0,0,0,0.55)',
                padding: '1px 4px',
                borderRadius: 2,
                fontFamily: 'monospace',
                whiteSpace: 'nowrap',
              }}
            >
              {d.type}{d.label ? `: ${d.label}` : ''} {Math.round((d.confidence || 0) * 100)}%
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Compact scorecard pinned to the top-left. Color follows the same
// thresholds the panel uses so it feels consistent.
function ScoreHUDLayer({ score, timeToClarity }) {
  if (!score) return null
  const total = Number(score.totalScore) || 0
  const color = total >= 85 ? '#2D9A5E'
    : total >= 70 ? '#16a34a'
    : total >= 50 ? '#d97706'
    : '#c0392b'
  return (
    <div
      style={{
        position: 'absolute',
        top: 6,
        left: 6,
        background: 'rgba(0,0,0,0.7)',
        color: 'white',
        padding: '6px 8px',
        borderRadius: 6,
        fontFamily: 'monospace',
        fontSize: 10,
        lineHeight: 1.3,
        zIndex: 8,
        pointerEvents: 'none',
        minWidth: 120,
      }}
    >
      <div style={{ fontSize: 8, opacity: 0.7, textTransform: 'uppercase' }}>First 2s</div>
      <div style={{ fontSize: 18, fontWeight: 700, color, lineHeight: 1, marginTop: 2 }}>
        {Math.round(total)}<span style={{ fontSize: 10, opacity: 0.7 }}>/100</span>
      </div>
      <div style={{ fontSize: 10, color, marginTop: 1 }}>{score.verdict}</div>
      {score.categoryScores && (
        <div style={{ marginTop: 4, fontSize: 9, opacity: 0.85 }}>
          <div>ctx {score.categoryScores.contextClarity}/25</div>
          <div>mot {score.categoryScores.visualEngagement}/25</div>
          <div>foc {score.categoryScores.focalClarity}/15</div>
          <div>txt {score.categoryScores.textEffectiveness}/15</div>
          <div>cur {score.categoryScores.curiosityGap}/15</div>
        </div>
      )}
      {timeToClarity && (
        <div style={{ marginTop: 4, fontSize: 9, opacity: 0.7 }}>
          ttc {Number(timeToClarity.seconds || 0).toFixed(1)}s
        </div>
      )}
    </div>
  )
}

// Bottom strip — 0-2s ruler with event markers. The current playhead
// shows up as a vertical line so you can see which event is being
// played. Events with severity:'critical' get a red dot.
function ClarityTimelineLayer({ events, nowMs }) {
  if (!events.length) return null
  const t = Math.max(0, Math.min(2, nowMs / 1000))
  return (
    <div
      style={{
        position: 'absolute',
        left: 6,
        right: 6,
        bottom: 6,
        height: 22,
        background: 'rgba(0,0,0,0.6)',
        borderRadius: 4,
        zIndex: 8,
        pointerEvents: 'none',
        fontFamily: 'monospace',
      }}
    >
      {/* Tick marks at 0, 0.5, 1, 1.5, 2s. */}
      {[0, 0.5, 1, 1.5, 2].map(tick => (
        <div
          key={tick}
          style={{
            position: 'absolute',
            left: `${(tick / 2) * 100}%`,
            top: 0,
            bottom: 0,
            width: 1,
            background: 'rgba(255,255,255,0.2)',
          }}
        />
      ))}
      {/* Playhead. */}
      <div
        style={{
          position: 'absolute',
          left: `${(t / 2) * 100}%`,
          top: -2,
          bottom: -2,
          width: 2,
          background: '#fff',
          boxShadow: '0 0 4px rgba(255,255,255,0.6)',
        }}
      />
      {/* Event dots + label of the closest one. */}
      {events.map((ev, i) => {
        const x = Math.max(0, Math.min(2, Number(ev.time) || 0)) / 2
        const color = ev.severity === 'critical' ? '#ef4444'
          : ev.severity === 'warning' ? '#f59e0b'
          : '#22c55e'
        return (
          <div
            key={i}
            title={`${ev.time?.toFixed?.(2)}s ${ev.type} — ${ev.label}`}
            style={{
              position: 'absolute',
              left: `calc(${x * 100}% - 4px)`,
              top: 4,
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: color,
              border: '1px solid rgba(0,0,0,0.4)',
            }}
          />
        )
      })}
      <div style={{ position: 'absolute', left: 4, bottom: 1, fontSize: 8, color: 'rgba(255,255,255,0.7)' }}>0s</div>
      <div style={{ position: 'absolute', right: 4, bottom: 1, fontSize: 8, color: 'rgba(255,255,255,0.7)' }}>2s</div>
    </div>
  )
}
