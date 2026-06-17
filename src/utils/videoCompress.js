// Browser-side video compression before upload.
//
// 4K source files from prosumer cameras (Sony A6500 XAVC, GoPro,
// DJI) routinely hit 100-200 MB for ~10-30 seconds of footage. The
// browser → Railway upload is the slow path; the BE compresses
// after the bytes land, but the operator still waits minutes for
// the upload itself. Compressing client-side cuts the wire payload
// 10-30× — a 150 MB Sony clip drops to ~5-15 MB at 1080p.
//
// Strategy:
//   1. Skip if file is already small (≤ SKIP_BYTES) or non-video,
//      OR if the browser lacks MediaRecorder + canvas.captureStream
//      (rare these days but possible — falls back gracefully).
//   2. Decode via a hidden <video>. Wait for metadata so we know
//      the source dimensions.
//   3. Compute target dimensions: longest edge clamped to MAX_EDGE
//      (1920 — fits the 1080p target the BE re-encodes to anyway).
//      Never upscale.
//   4. Draw frames to an off-DOM canvas in a rAF loop while the
//      video plays. Capture the canvas via captureStream() and
//      pipe through MediaRecorder at TARGET_BITRATE.
//   5. Wait for the recorder to flush, assemble the blob, return
//      it as a File so multer + the BE see a normal upload.
//   6. If the encoded blob is SMALLER than the source, return the
//      new File. Otherwise return the original.
//
// All operations swallow errors and fall through to the original
// file. A compression bug must never block an upload.

const SKIP_BYTES = 8 * 1024 * 1024;    // ≤ 8 MB → already small
const MAX_EDGE = 1920;                  // clamp longer edge (1080p)
const TARGET_FPS = 30;
const TARGET_BITRATE = 5_000_000;       // 5 Mbps — visually clean for 1080p

// Probe what mimeType MediaRecorder will actually accept. The order
// here was the source of a "tile won't preview" bug — Chrome happily
// emits webm/vp9 which is the densest option, but the resulting
// file's specific VP9 profile played back unreliably across the
// operator's browsers (Safari especially), even though the file
// was valid (ffmpeg merged it fine). MP4 + H.264 is the only codec
// combination that's universally playable in every modern browser,
// so we try it first now and fall back to webm only if MediaRecorder
// doesn't have an mp4 encoder (older Chrome). Result: every newly-
// compressed clip uploads as something every browser can render
// in the tile preview AND lightbox.
function pickMimeType() {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
  const PREFERRED_TYPES = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2', // Safari + Chrome 124+ + every preview surface
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  for (const t of PREFERRED_TYPES) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

function fileExtForMime(mimeType) {
  if (mimeType.startsWith('video/webm')) return '.webm';
  if (mimeType.startsWith('video/mp4'))  return '.mp4';
  return '.webm';
}

// Decode the source file into a <video> + wait until metadata is
// known. Returns the element ready to play; caller revokes the
// blob URL after use.
async function loadVideoElement(file) {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.src = url;
  video.muted = true;          // satisfies autoplay policy
  video.playsInline = true;
  video.preload = 'auto';
  await new Promise((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error('video decode failed'));
  });
  return { video, url };
}

// Public API. Returns { file, originalSize, compressedSize, skipped,
// reason }. `file` is always a File the caller can hand to FormData.
export async function compressVideoForUpload(file, opts = {}) {
  const result = {
    file,
    originalSize: file?.size || 0,
    compressedSize: file?.size || 0,
    skipped: true,
    reason: 'no-op',
  };
  if (!file || !file.size) return result;
  if (!(file.type || '').startsWith('video/')) {
    result.reason = `non-video mime ${file.type}`;
    return result;
  }
  if (file.size <= SKIP_BYTES) {
    result.reason = 'already small';
    return result;
  }
  if (typeof MediaRecorder === 'undefined' || typeof HTMLCanvasElement === 'undefined') {
    result.reason = 'MediaRecorder/canvas not available';
    return result;
  }
  const mimeType = pickMimeType();
  if (!mimeType) {
    result.reason = 'no supported MediaRecorder mime';
    return result;
  }

  const targetMaxEdge = opts.maxEdge || MAX_EDGE;
  const targetBitrate = opts.bitrate || TARGET_BITRATE;
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;

  let blobUrl = null;
  try {
    const { video, url } = await loadVideoElement(file);
    blobUrl = url;
    const srcW = video.videoWidth;
    const srcH = video.videoHeight;
    const srcDur = video.duration;
    if (!srcW || !srcH || !Number.isFinite(srcDur)) {
      result.reason = 'no source dimensions';
      return result;
    }

    // Compute target dimensions — never upscale. Round to even
    // for codec friendliness.
    let dstW = srcW, dstH = srcH;
    const longer = Math.max(srcW, srcH);
    if (longer > targetMaxEdge) {
      const ratio = targetMaxEdge / longer;
      dstW = Math.round(srcW * ratio / 2) * 2;
      dstH = Math.round(srcH * ratio / 2) * 2;
    }

    const canvas = document.createElement('canvas');
    canvas.width = dstW;
    canvas.height = dstH;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) {
      result.reason = 'no 2d context';
      return result;
    }

    // Stream: canvas video track + (optional) original audio. The
    // canvas track captures whatever we draw via the rAF loop.
    const canvasStream = canvas.captureStream(TARGET_FPS);
    const combinedTracks = canvasStream.getVideoTracks();
    try {
      // captureStream() on a video element pulls the original audio.
      // We splice that audio onto our canvas stream so the recorder
      // emits a single video+audio mux.
      const vidStream = video.captureStream ? video.captureStream() : (video.mozCaptureStream ? video.mozCaptureStream() : null);
      if (vidStream) {
        for (const t of vidStream.getAudioTracks()) combinedTracks.push(t);
      }
    } catch { /* audio splice failed; recorder emits video-only */ }
    const recorderStream = new MediaStream(combinedTracks);

    const chunks = [];
    const recorder = new MediaRecorder(recorderStream, {
      mimeType,
      videoBitsPerSecond: targetBitrate,
    });
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const recordingDone = new Promise((resolve, reject) => {
      recorder.onstop = () => resolve();
      recorder.onerror = (e) => reject(e?.error || new Error('recorder error'));
    });
    recorder.start(250);

    // rAF loop draws frames while the video plays. Stop when the
    // video ends OR when paused (defensive — some Safari paths
    // pause on background).
    let rafId = null;
    const tick = () => {
      try { ctx.drawImage(video, 0, 0, dstW, dstH); } catch { /* swallow */ }
      if (onProgress && srcDur > 0) {
        try { onProgress(Math.max(0, Math.min(1, video.currentTime / srcDur))); } catch {}
      }
      if (!video.ended && !video.paused) {
        rafId = requestAnimationFrame(tick);
      }
    };
    await video.play();
    rafId = requestAnimationFrame(tick);
    await new Promise((resolve, reject) => {
      const onEnded = () => { video.removeEventListener('ended', onEnded); video.removeEventListener('error', onError); resolve(); };
      const onError = () => { video.removeEventListener('ended', onEnded); video.removeEventListener('error', onError); reject(new Error('video playback error')); };
      video.addEventListener('ended', onEnded);
      video.addEventListener('error', onError);
    });
    if (rafId != null) cancelAnimationFrame(rafId);
    recorder.stop();
    await recordingDone;

    let blob = new Blob(chunks, { type: mimeType });
    if (!blob.size) {
      result.reason = 'recorder produced empty blob';
      return result;
    }
    // Patch the WebM Duration field. MediaRecorder doesn't write the
    // Matroska SegmentInfo Duration element because it doesn't know
    // the final length at start. ffprobe + browser <video> elements
    // then read NaN duration, which breaks trim UI + ffmpeg `-t` in
    // the merge pipeline ("Invalid duration specification: NaN").
    //
    // We use the ACTUAL encoded duration from a probe load of the
    // blob — not the source's `video.duration` — because MediaRecorder
    // occasionally encodes slightly less than the source playback
    // time (dropped final frame, tab throttling, etc). If we patched
    // with srcDur on a stream that actually ends earlier, the merge's
    // input -ss could seek past end-of-stream and produce a 0×0
    // output → concat-filter fails with "matches no streams."
    if (mimeType.startsWith('video/webm')) {
      try {
        // Step 1: probe the produced blob's real duration. Browsers
        // can report Infinity for live-recorded WebM until they fully
        // scan the file via a seek-to-large-time + seekback hack.
        let actualSec = srcDur
        try {
          const probeUrl = URL.createObjectURL(blob)
          const pv = document.createElement('video')
          pv.src = probeUrl
          pv.preload = 'metadata'
          pv.muted = true
          await new Promise((resolve) => {
            const finish = () => resolve()
            pv.addEventListener('loadedmetadata', () => {
              if (Number.isFinite(pv.duration) && pv.duration > 0) {
                actualSec = pv.duration
                finish()
              } else {
                // Trigger Chrome's hidden duration-resolution path
                pv.currentTime = 1e10
                pv.addEventListener('durationchange', () => {
                  if (Number.isFinite(pv.duration) && pv.duration > 0) {
                    actualSec = pv.duration
                    finish()
                  }
                })
                setTimeout(finish, 3000)
              }
            })
            pv.addEventListener('error', finish)
            setTimeout(finish, 3000)
          })
          try { URL.revokeObjectURL(probeUrl) } catch {}
        } catch {
          // probe failed — fall back to srcDur
        }
        const { default: ysFixWebmDuration } = await import('fix-webm-duration')
        const durationMs = Math.max(1, Math.round(actualSec * 1000))
        blob = await ysFixWebmDuration(blob, durationMs, { logger: false })
        console.log(`[videoCompress] WebM duration patched: src=${srcDur.toFixed(2)}s actual=${actualSec.toFixed(2)}s`)
      } catch (e) {
        console.warn('[videoCompress] WebM duration patch failed — falling back to BE 60s default:', e?.message || e)
      }
    }
    // Inflation guard.
    if (blob.size >= file.size) {
      result.reason = `compressed (${blob.size}) ≥ original (${file.size})`;
      return result;
    }
    const baseName = (file.name || 'video').replace(/\.[^.]+$/, '');
    const newName = `${baseName}-c${fileExtForMime(mimeType)}`;
    // Strip codec parameters from the mime before File construction.
    // Multer/busboy parses the multipart Content-Type header, and a
    // value like `video/webm;codecs=vp9,opus` is technically valid but
    // some parsers / browsers normalize it inconsistently — the
    // server-side filter saw mimetypes that didn't startsWith('video/')
    // and rejected the upload. The bare `video/webm` is unambiguous
    // and ffmpeg auto-detects the codec from the bytes anyway.
    const cleanMime = mimeType.split(';')[0].trim();
    const compressed = new File([blob], newName, { type: cleanMime });
    return {
      file: compressed,
      originalSize: file.size,
      compressedSize: compressed.size,
      skipped: false,
      reason: `${srcW}×${srcH} → ${dstW}×${dstH}, ${mimeType}, ${(targetBitrate/1_000_000).toFixed(1)}Mbps`,
    };
  } catch (e) {
    result.reason = `error: ${e?.message || e}`;
    return result;
  } finally {
    if (blobUrl) {
      try { URL.revokeObjectURL(blobUrl); } catch {}
    }
  }
}
