import { useState } from 'react'

function MediaLightbox({ file, isImg, onClose }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={onClose}>
      <div className="relative max-w-[90vw] max-h-[85vh]" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-white text-ink text-lg flex items-center justify-center shadow cursor-pointer border-none z-10">&times;</button>
        {isImg ? (
          <img src={URL.createObjectURL(file)} className="max-w-full max-h-[80vh] rounded object-contain" />
        ) : (
          <video src={URL.createObjectURL(file)} controls autoPlay playsInline className="max-w-full max-h-[80vh] rounded" />
        )}
      </div>
    </div>
  )
}

export default function FileGrid({ files, onRemove }) {
  const [previewItem, setPreviewItem] = useState(null)

  if (!files.length) return null

  return (
    <>
      {previewItem && (
        <MediaLightbox file={previewItem.file} isImg={previewItem.isImg} onClose={() => setPreviewItem(null)} />
      )}
      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))' }}>
        {files.map(item => (
          <div key={item.id} className="border border-border rounded-sm overflow-hidden bg-white relative">
            {item.isImg ? (
              <img
                src={URL.createObjectURL(item.file)}
                onClick={() => setPreviewItem(item)}
                className="w-full h-[78px] object-cover block cursor-pointer hover:opacity-80"
              />
            ) : (
              <div
                onClick={() => setPreviewItem(item)}
                className="w-full h-[78px] bg-ink flex items-center justify-center text-white text-[22px] cursor-pointer hover:bg-[#333]"
              >▶</div>
            )}
            <div className="text-[9px] text-muted py-1 px-1.5 whitespace-nowrap overflow-hidden text-ellipsis">{item.file.name}</div>
            <button
              onClick={() => onRemove(item.id)}
              className="absolute top-1 right-1 w-[18px] h-[18px] rounded-full bg-black/55 text-white text-xs flex items-center justify-center cursor-pointer border-none"
            >&times;</button>
            {item.status === 'loading' && <div className="absolute bottom-5 left-0 right-0 text-center text-[9px] font-medium py-0.5 bg-sage/90 text-white">Loading...</div>}
            {item.status === 'done' && <div className="absolute bottom-5 left-0 right-0 text-center text-[9px] font-medium py-0.5 bg-tk/90 text-white">Done</div>}
            {item.status === 'error' && <div className="absolute bottom-5 left-0 right-0 text-center text-[9px] font-medium py-0.5 bg-terra/90 text-white">Error</div>}
          </div>
        ))}
      </div>
    </>
  )
}
