import { CROP_RATIOS, smartCrop, applyWatermark } from '../lib/crop'
import { getSeoName } from '../lib/export'

export default function CropStrip({ item, apiUrl }) {
  const handleCrop = async (cr) => {
    const blob = await smartCrop(item, cr)
    const wmBlob = await applyWatermark(blob, cr.wm, apiUrl)
    const a = document.createElement('a')
    a.download = getSeoName(item) + '-' + cr.label.replace(/[^a-z0-9]/gi, '-').toLowerCase() + '.jpg'
    a.href = URL.createObjectURL(wmBlob)
    a.click()
    URL.revokeObjectURL(a.href)
  }

  if (!item.isImg) return null

  return (
    <div className="flex gap-1.5 py-2 px-3.5 border-t border-border bg-cream flex-wrap items-center">
      <span className="text-[10px] font-medium text-muted uppercase tracking-wide mr-0.5">Download cropped:</span>
      {CROP_RATIOS.map(cr => (
        <button
          key={cr.label}
          onClick={() => handleCrop(cr)}
          className="text-[10px] py-0.5 px-2 border border-border rounded-full bg-white cursor-pointer font-sans text-muted hover:border-terra hover:text-terra hover:bg-terra-light"
        >
          {cr.label}
        </button>
      ))}
    </div>
  )
}
