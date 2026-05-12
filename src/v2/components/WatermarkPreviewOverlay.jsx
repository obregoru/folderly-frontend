// Draggable + resizable watermark preview that sits on top of the
// merged-video <video> element inside FinalPreviewV2. Reads
// window._postyWatermark (seeded by WatermarkSection) and listens
// for 'posty-watermark-change' to stay in sync.
//
// Position model matches the BE ffmpeg overlay filter:
//   left = (W - w) * x_pct / 100
//   top  = (H - h) * y_pct / 100
// Equivalent to placing the element at left:${x_pct}% top:${y_pct}%
// then translating it by (-x_pct%, -y_pct%) — so x_pct=0 puts the
// left edge at the frame left, x_pct=100 puts the right edge at
// the frame right.
//
// Drag = pointerdown anywhere on the image. Resize = pointerdown on
// the bottom-right corner handle. Both compute deltas in pixels
// against the contained-pixel area of the <video> (object-fit:
// contain accounts for letterboxing), convert to %, clamp, and
// dispatch 'posty-watermark-update' with a partial patch which
// WatermarkSection picks up + persists.

import { useEffect, useRef, useState } from 'react'

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n))

export default function WatermarkPreviewOverlay({ videoRef, currentTime }) {
  const [wm, setWm] = useState(() => (typeof window !== 'undefined' ? window._postyWatermark : null))
  const [box, setBox] = useState(null)
  const wrapperRef = useRef(null)
  const dragRef = useRef(null)

  useEffect(() => {
    const sync = (e) => setWm(e?.detail || window._postyWatermark || null)
    window.addEventListener('posty-watermark-change', sync)
    return () => window.removeEventListener('posty-watermark-change', sync)
  }, [])

  // Recompute the contained-pixel box of the <video> element so the
  // preview tracks the video frame, not the surrounding black box.
  // Polls each animation frame while mounted — cheap, and avoids
  // having to wire up resize observers + video metadata events.
  useEffect(() => {
    let raf = 0
    let cancelled = false
    const tick = () => {
      if (cancelled) return
      const v = videoRef?.current
      if (v && v.offsetParent) {
        const elW = v.clientWidth
        const elH = v.clientHeight
        const vw = v.videoWidth || elW
        const vh = v.videoHeight || elH
        const elAR = elW / Math.max(1, elH)
        const vAR = vw / Math.max(1, vh)
        let innerW = elW, innerH = elH, offX = 0, offY = 0
        if (vAR > elAR) {
          innerH = elW / vAR
          offY = (elH - innerH) / 2
        } else if (vAR < elAR) {
          innerW = elH * vAR
          offX = (elW - innerW) / 2
        }
        const next = { left: v.offsetLeft + offX, top: v.offsetTop + offY, width: innerW, height: innerH }
        setBox(prev => {
          if (!prev || prev.left !== next.left || prev.top !== next.top || prev.width !== next.width || prev.height !== next.height) {
            return next
          }
          return prev
        })
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelled = true; cancelAnimationFrame(raf) }
  }, [videoRef])

  // Time-window gating mirrors the BE overlay enable expression so
  // the preview hides outside the [start_time, end_time] range.
  const t = Number(currentTime) || 0
  const start = Number(wm?.start_time) || 0
  const end = wm?.end_time == null ? Infinity : Number(wm.end_time)
  const inWindow = t >= start && t < end

  if (!wm?.enabled || !wm?.hasLogo || !wm?.url || !inWindow || !box) return null

  const xPct = clamp(Number(wm.x_pct) || 0, 0, 100)
  const yPct = clamp(Number(wm.y_pct) || 0, 0, 100)
  const sizePct = clamp(Number(wm.size_pct) || 15, 5, 100)
  const opacity = clamp(Number(wm.opacity) || 1, 0.05, 1)

  const onMove = (e) => {
    const d = dragRef.current
    if (!d) return
    e.preventDefault()
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    const w = d.boxW || 1
    const h = d.boxH || 1
    if (d.mode === 'move') {
      const dXPct = (dx / w) * 100
      const dYPct = (dy / h) * 100
      const nextX = clamp(d.startXPct + dXPct, 0, 100)
      const nextY = clamp(d.startYPct + dYPct, 0, 100)
      window.dispatchEvent(new CustomEvent('posty-watermark-update', {
        detail: { x_pct: Math.round(nextX * 10) / 10, y_pct: Math.round(nextY * 10) / 10 }
      }))
    } else if (d.mode === 'resize') {
      const dSizePct = ((dx / w) + (dy / h)) * 50
      const next = clamp(d.startSize + dSizePct, 5, 100)
      window.dispatchEvent(new CustomEvent('posty-watermark-update', {
        detail: { size_pct: Math.round(next * 10) / 10 }
      }))
    }
  }
  const onUp = () => {
    dragRef.current = null
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
  }
  const onDown = (mode) => (e) => {
    e.preventDefault()
    e.stopPropagation()
    dragRef.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      startSize: sizePct,
      startXPct: xPct,
      startYPct: yPct,
      boxW: box.width,
      boxH: box.height,
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // Watermark width in container px so we can position the resize
  // handle on the bottom-right corner with simple absolute pixel
  // coordinates (avoids fragile multi-translate calc()).
  const wmW = (sizePct / 100) * box.width
  // The img has height: auto so we don't know exact height upfront.
  // Use the rendered <img> via a ref and read offsetHeight for the
  // handle position. Fallback estimate: square (1:1 aspect ratio).
  const imgRef = useRef(null)
  const [imgH, setImgH] = useState(null)
  useEffect(() => {
    const el = imgRef.current
    if (!el) return
    const onLoad = () => setImgH(el.offsetHeight || null)
    onLoad()
    el.addEventListener('load', onLoad)
    return () => el.removeEventListener('load', onLoad)
  }, [wm?.url])
  // Recompute handle pos when sizePct changes (height scales with width).
  useEffect(() => {
    const el = imgRef.current
    if (!el) return
    setImgH(el.offsetHeight || null)
  }, [sizePct, box?.width, box?.height])

  const wmH = imgH || wmW // square fallback
  // Watermark's left/top in container px, computed via the same
  // (W-w)*pct/100 formula the BE overlay filter uses.
  const wmLeft = (box.width - wmW) * (xPct / 100)
  const wmTop  = (box.height - wmH) * (yPct / 100)

  return (
    <div
      ref={wrapperRef}
      style={{
        position: 'absolute',
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        pointerEvents: 'none',
        zIndex: 4,
      }}
    >
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'auto' }}>
        <img
          ref={imgRef}
          src={wm.url}
          alt="watermark preview"
          draggable={false}
          onPointerDown={onDown('move')}
          style={{
            position: 'absolute',
            left: wmLeft,
            top: wmTop,
            width: wmW,
            height: 'auto',
            opacity,
            cursor: 'move',
            userSelect: 'none',
            outline: '2px dashed rgba(108, 92, 231, 0.85)',
            outlineOffset: '2px',
            touchAction: 'none',
            zIndex: 5,
          }}
        />
        <div
          onPointerDown={onDown('resize')}
          style={{
            position: 'absolute',
            left: wmLeft + wmW - 7,
            top: wmTop + wmH - 7,
            width: 14,
            height: 14,
            background: '#6C5CE7',
            border: '2px solid white',
            borderRadius: 3,
            cursor: 'nwse-resize',
            touchAction: 'none',
            zIndex: 6,
            boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
          }}
          title="Drag to resize"
        />
      </div>
    </div>
  )
}
