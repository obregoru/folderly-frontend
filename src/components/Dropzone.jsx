import { useState, useRef } from 'react'

export default function Dropzone({ onFiles }) {
  const [over, setOver] = useState(false)
  const fileRef = useRef()
  const folderRef = useRef()

  const handleDrop = e => {
    e.preventDefault()
    setOver(false)
    const fl = e.dataTransfer.files
    if (!fl.length) return
    const fp = fl[0].webkitRelativePath || ''
    const folder = fp.includes('/') ? fp.split('/')[0] : null
    onFiles(fl, folder)
  }

  const handleFileChange = (e, isFolder) => {
    const fl = e.target.files
    if (!fl.length) return
    let folder = null
    if (isFolder) {
      const fp = fl[0].webkitRelativePath || ''
      if (fp.includes('/')) folder = fp.split('/')[0]
    }
    onFiles(fl, folder)
    e.target.value = ''
  }

  return (
    <div
      className={`border-[1.5px] border-dashed rounded p-7 text-center bg-white transition-all ${over ? 'border-sage bg-sage-light' : 'border-border'}`}
      onDragOver={e => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={handleDrop}
    >
      <div className="text-2xl mb-1.5">📁</div>
      <div className="font-serif text-lg mb-1">Drop photos or a folder here</div>
      <div className="text-xs text-muted">AI reads folder name, filenames, and the image itself</div>
      <div className="mt-3 flex justify-center gap-2">
        <label className="text-xs py-[7px] px-4 border border-border rounded-sm bg-cream text-ink cursor-pointer font-sans hover:border-sage">
          Browse files
          <input ref={fileRef} type="file" multiple accept="image/*,video/*" className="hidden" onChange={e => handleFileChange(e, false)} />
        </label>
        <label className="text-xs py-[7px] px-4 border border-border rounded-sm bg-cream text-ink cursor-pointer font-sans hover:border-sage">
          Browse folder
          <input ref={folderRef} type="file" multiple webkitdirectory="" accept="image/*,video/*" className="hidden" onChange={e => handleFileChange(e, true)} />
        </label>
      </div>
    </div>
  )
}
