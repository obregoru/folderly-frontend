import { useState } from 'react'
import { CROP_RATIOS, smartCrop, applyWatermark } from '../lib/crop'
import { getSeoName } from '../lib/export'

function CropPreview({ blob, crop, onClose }) {
  const url = URL.createObjectURL(blob)
  const aspect = crop.w / crop.h
  // Fit within viewport
  const maxW = Math.min(crop.w, window.innerWidth * 0.9)
  const maxH = Math.min(crop.h, window.innerHeight * 0.8)
  let displayW, displayH
  if (maxW / maxH > aspect) {
    displayH = maxH
    displayW = maxH * aspect
  } else {
    displayW = maxW
    displayH = maxW / aspect
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex flex-col items-center justify-center p-4" onClick={onClose}>
      <div className="relative" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-white text-ink text-lg flex items-center justify-center shadow cursor-pointer border-none z-10">&times;</button>
        <img
          src={url}
          style={{ width: displayW, height: displayH }}
          className="rounded object-cover"
          onLoad={() => URL.revokeObjectURL(url)}
        />
      </div>
      <div className="mt-2 text-white text-[11px] font-sans">{crop.label} ({crop.w}&times;{crop.h})</div>
    </div>
  )
}

export default function CropStrip({ item, apiUrl }) {
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(null)

  const handleCrop = async (cr) => {
    const blob = await smartCrop(item, cr)
    const wmBlob = await applyWatermark(blob, cr.wm, apiUrl)
    const a = document.createElement('a')
    a.download = getSeoName(item) + '-' + cr.label.replace(/[^a-z0-9]/gi, '-').toLowerCase() + '.jpg'
    a.href = URL.createObjectURL(wmBlob)
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const handlePreview = async (cr) => {
    setLoading(cr.label)
    try {
      const blob = await smartCrop(item, cr)
      const wmBlob = await applyWatermark(blob, cr.wm, apiUrl)
      setPreview({ blob: wmBlob, crop: cr })
    } catch (err) {
      console.error('Preview error:', err)
    }
    setLoading(null)
  }

  if (!item.isImg) return null

  return (
    <>
      {preview && <CropPreview blob={preview.blob} crop={preview.crop} onClose={() => setPreview(null)} />}
      <div className="flex gap-1.5 py-2 px-3.5 border-t border-border bg-cream flex-wrap items-center">
        <span className="text-[10px] font-medium text-muted uppercase tracking-wide mr-0.5">Crops:</span>
        {CROP_RATIOS.map(cr => (
          <div key={cr.label} className="flex items-center gap-0.5">
            <button
              onClick={() => handlePreview(cr)}
              className={`text-[10px] py-0.5 px-2 border border-border rounded-l-full bg-white cursor-pointer font-sans text-muted hover:border-sage hover:text-sage hover:bg-sage-light ${loading === cr.label ? 'opacity-50' : ''}`}
            >
              {loading === cr.label ? '...' : cr.label}
            </button>
            <button
              onClick={() => handleCrop(cr)}
              className="text-[9px] py-0.5 px-1.5 border border-border border-l-0 rounded-r-full bg-white cursor-pointer font-sans text-muted hover:border-terra hover:text-terra"
              title="Download"
            >
              ↓
            </button>
          </div>
        ))}
      </div>
    </>
  )
}
