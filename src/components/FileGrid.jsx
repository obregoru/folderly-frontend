import { useMemo } from 'react'

export default function FileGrid({ files, onRemove }) {
  if (!files.length) return null

  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))' }}>
      {files.map(item => (
        <div key={item.id} className="border border-border rounded-sm overflow-hidden bg-white relative">
          {item.isImg ? (
            <img src={URL.createObjectURL(item.file)} className="w-full h-[78px] object-cover block" />
          ) : (
            <div className="w-full h-[78px] bg-ink flex items-center justify-center text-white text-[22px]">▶</div>
          )}
          <div className="text-[9px] text-muted py-1 px-1.5 whitespace-nowrap overflow-hidden text-ellipsis">{item.file.name}</div>
          <button
            onClick={() => onRemove(item.id)}
            className="absolute top-1 right-1 w-[18px] h-[18px] rounded-full bg-black/55 text-white text-xs flex items-center justify-center cursor-pointer border-none"
          >×</button>
          {item.status === 'loading' && <div className="absolute bottom-5 left-0 right-0 text-center text-[9px] font-medium py-0.5 bg-sage/90 text-white">Loading...</div>}
          {item.status === 'done' && <div className="absolute bottom-5 left-0 right-0 text-center text-[9px] font-medium py-0.5 bg-tk/90 text-white">Done</div>}
          {item.status === 'error' && <div className="absolute bottom-5 left-0 right-0 text-center text-[9px] font-medium py-0.5 bg-terra/90 text-white">Error</div>}
        </div>
      ))}
    </div>
  )
}
