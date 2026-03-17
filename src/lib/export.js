import JSZip from 'jszip'
import { CROP_RATIOS, smartCrop, applyWatermark } from './crop'

export function slugify(s) {
  return s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
}

export function getSeoName(item) {
  if (item.uploadResult && item.uploadResult.seo_filename) {
    return item.uploadResult.seo_filename.replace(/\.[^.]+$/, '')
  }
  return slugify(item.file.name.replace(/\.[^.]+$/, ''))
}

function capText(c) {
  return typeof c === 'object' ? c.text : c
}

function downloadBlob(blob, filename) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

export function exportSeoPhotos(files, apiUrl) {
  let count = 0
  files.forEach(item => {
    if (!item.isImg) return
    const seoName = getSeoName(item)
    let ext = item.file.name.match(/\.[^.]+$/)
    ext = ext ? ext[0].toLowerCase() : '.jpg'
    const filename = seoName + ext
    setTimeout(() => {
      applyWatermark(item.file, 'bottom-right', apiUrl).then(blob => downloadBlob(blob, filename))
    }, count * 200)
    count++
  })
}

export async function exportAll(files, tenantSlug, apiUrl) {
  const zip = new JSZip()
  const zipName = `export-${tenantSlug}-${new Date().toISOString().slice(0, 10)}.zip`
  const promises = []

  files.forEach((item, idx) => {
    if (!item.captions) return
    const seoName = getSeoName(item)
    const folderName = `photo-${idx + 1}-${seoName}`
    const folder = zip.folder(folderName)

    // Caption text
    let out = ''
    const { tiktok: tk, instagram: ig, facebook: fb, twitter: tw, google: gb, blog: bl } = item.captions
    if (tk) out += 'TIKTOK:\n' + capText(tk) + '\n\n'
    if (ig) out += 'INSTAGRAM:\n' + capText(ig) + '\n\n'
    if (fb) out += 'FACEBOOK:\n' + capText(fb) + '\n\n'
    if (tw) out += 'X/TWITTER:\n' + capText(tw) + '\n\n'
    if (gb) out += 'GOOGLE BUSINESS:\n' + capText(gb) + '\n\n'
    if (bl) out += 'BLOG POST:\n' + capText(bl) + '\n\n'
    folder.file(seoName + '.txt', out)

    if (item.isImg) {
      let ext = item.file.name.match(/\.[^.]+$/)
      ext = ext ? ext[0].toLowerCase() : '.jpg'
      promises.push(
        applyWatermark(item.file, 'bottom-right', apiUrl).then(wmBlob => folder.file(seoName + ext, wmBlob))
      )
      CROP_RATIOS.forEach(cr => {
        promises.push(
          smartCrop(item, cr)
            .then(blob => applyWatermark(blob, cr.wm, apiUrl))
            .then(wmBlob => {
              const cropName = seoName + '-' + cr.label.replace(/[^a-z0-9]/gi, '-').toLowerCase() + '.jpg'
              folder.file(cropName, wmBlob)
            })
        )
      })
    }
  })

  await Promise.all(promises)
  const blob = await zip.generateAsync({ type: 'blob' })
  downloadBlob(blob, zipName)
}
