import { useState, useEffect, useRef } from 'react'

export default function HelpTip({ text }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('click', close, true)
    return () => document.removeEventListener('click', close, true)
  }, [open])
  return (
    <span ref={ref} className="relative inline-flex ml-1">
      <button onClick={(e) => { e.stopPropagation(); setOpen(!open) }} className="w-[14px] h-[14px] rounded-full bg-[#e0e0e0] text-[#666] text-[9px] font-bold flex items-center justify-center cursor-pointer border-none leading-none hover:bg-[#ccc]" aria-label="Help">?</button>
      {open && (
        <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-[200px] bg-ink text-white text-[10px] leading-snug rounded-md px-2.5 py-2 shadow-lg" style={{ maxWidth: 'calc(100vw - 40px)' }}>
          {text}
          <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-[5px] border-r-[5px] border-t-[5px] border-l-transparent border-r-transparent border-t-ink" />
        </div>
      )}
    </span>
  )
}
