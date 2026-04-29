import { useState, useEffect, useRef, useCallback } from 'react'
import * as api from '../api'

/**
 * Hook that syncs the current editing session to the jobs API.
 * Creates a job on first meaningful action, auto-saves changes
 * with debouncing, and restores state on mount if a draft exists.
 */
export default function useJobSync({ files, setFiles, userHint, setUserHint, settings }) {
  const [jobId, setJobId] = useState(() => sessionStorage.getItem('posty_active_job') || null)
  const [jobList, setJobList] = useState([])
  const [loadingJob, setLoadingJob] = useState(false)
  const [savingJob, setSavingJob] = useState(false)
  const jobIdRef = useRef(jobId)
  const saveTimerRef = useRef(null)
  // Map frontend file IDs to DB job_file IDs
  const fileIdMapRef = useRef({}) // { frontendId: dbFileId }

  useEffect(() => { jobIdRef.current = jobId }, [jobId])

  // Load job list on mount
  useEffect(() => {
    api.listJobs().then(jobs => {
      if (Array.isArray(jobs)) setJobList(jobs)
    }).catch(() => {})
  }, [])

  // Create a job if one doesn't exist. Uses a pending promise to prevent
  // concurrent calls from creating duplicate jobs.
  const ensureJobPromiseRef = useRef(null)
  const ensureJob = useCallback(async () => {
    if (jobIdRef.current) return jobIdRef.current
    // If another call is already creating a job, wait for it
    if (ensureJobPromiseRef.current) return ensureJobPromiseRef.current
    ensureJobPromiseRef.current = (async () => {
      try {
        // Double-check after awaiting — another call may have finished first
        if (jobIdRef.current) return jobIdRef.current
        const job = await api.createJob()
        const id = job.id || job.uuid
        setJobId(id)
        jobIdRef.current = id
        sessionStorage.setItem('posty_active_job', id)
        api.listJobs().then(jobs => { if (Array.isArray(jobs)) setJobList(jobs) }).catch(() => {})
        return id
      } catch (e) {
        console.error('[useJobSync] create job failed:', e.message)
        return null
      } finally {
        ensureJobPromiseRef.current = null
      }
    })()
    return ensureJobPromiseRef.current
  }, [])

  // Save job-level fields (debounced)
  const saveJob = useCallback(async (data) => {
    const id = jobIdRef.current
    if (!id) return
    try {
      setSavingJob(true)
      await api.updateJob(id, data)
    } catch (e) {
      console.error('[useJobSync] save job failed:', e.message)
    } finally {
      setSavingJob(false)
    }
  }, [])

  // Debounced save. Accumulates pending fields into pendingSaveDataRef so
  // multiple quick edits across different fields (overlay + voiceover +
  // segments) all go out together on the next timer tick — and so the
  // explicit Save button can flush them instead of losing them.
  const pendingSaveDataRef = useRef({})
  const debouncedSaveJob = useCallback((data) => {
    Object.assign(pendingSaveDataRef.current, data)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      const pending = pendingSaveDataRef.current
      pendingSaveDataRef.current = {}
      saveTimerRef.current = null
      if (Object.keys(pending).length) saveJob(pending)
    }, 800)
  }, [saveJob])

  // Save hint when it changes
  const prevHintRef = useRef(userHint)
  useEffect(() => {
    if (userHint === prevHintRef.current) return
    prevHintRef.current = userHint
    if (!userHint && !jobIdRef.current) return // don't create job for empty hint
    if (userHint) {
      ensureJob().then(id => {
        if (id) debouncedSaveJob({ hint_text: userHint })
      })
    }
  }, [userHint, ensureJob, debouncedSaveJob])

  // Save file to job when uploaded (called from App.jsx after upload)
  const saveFileToJob = useCallback(async (file) => {
    // Skip if already saved to DB
    if (fileIdMapRef.current[file.id]) return
    const id = await ensureJob()
    if (!id) return
    try {
      const result = await api.addJobFile(id, {
        filename: file.file?.name || file.filename || file._filename,
        media_type: file.file?.type || file.media_type || file._mediaType,
        upload_key: file.uploadResult?.original_temp_path || null,
        file_order: files.indexOf(file),
        trim_start: file._trimStart || 0,
        trim_end: file._trimEnd ?? null,
      })
      if (result.id) {
        fileIdMapRef.current[file.id] = result.id
      }
    } catch (e) {
      console.error('[useJobSync] save file failed:', e.message)
    }
  }, [ensureJob, files])

  // Delete a file from the job (called when user removes a file from the grid)
  const deleteFileFromJob = useCallback(async (fileId) => {
    const id = jobIdRef.current
    const dbFileId = fileIdMapRef.current[fileId]
    if (!id || !dbFileId) return // file was never persisted
    try {
      await api.deleteJobFile(id, dbFileId)
      delete fileIdMapRef.current[fileId]
      // Refresh job list so file count updates
      api.listJobs().then(jobs => { if (Array.isArray(jobs)) setJobList(jobs) }).catch(() => {})
    } catch (e) {
      console.error('[useJobSync] delete file failed:', e.message)
    }
  }, [])

  // Save filmstrip thumbnails so draft resume is instant
  const saveFileTrimThumbs = useCallback(async (file, thumbs) => {
    const id = jobIdRef.current
    const dbFileId = fileIdMapRef.current[file.id]
    if (!id || !dbFileId || !Array.isArray(thumbs)) return
    try {
      await api.updateJobFile(id, dbFileId, { trim_thumbs: thumbs })
    } catch (e) {
      console.error('[useJobSync] save trim thumbs failed:', e.message)
    }
  }, [])

  // Save file trim changes
  const saveFileTrim = useCallback(async (file) => {
    const id = jobIdRef.current
    const dbFileId = fileIdMapRef.current[file.id]
    if (!id || !dbFileId) {
      console.warn('[useJobSync.saveFileTrim] skipping — jobId=', id, 'dbFileId=', dbFileId, 'for frontendId=', file.id)
      return
    }
    const payload = {
      trim_start: file._trimStart || 0,
      trim_end: file._trimEnd ?? null,
    }
    try {
      await api.updateJobFile(id, dbFileId, payload)
      console.log(`[useJobSync.saveFileTrim] PUT jobs/${id}/files/${dbFileId}`, payload)
    } catch (e) {
      console.error('[useJobSync] save trim failed:', e.message)
    }
  }, [])

  // Save per-clip speed multiplier (1.0 = original, 0.5 = slow-mo, 2.0 = 2x).
  // Trim is on the original timeline; speed affects only the output length.
  const saveFileSpeed = useCallback(async (file) => {
    const id = jobIdRef.current
    const dbFileId = fileIdMapRef.current[file.id]
    if (!id || !dbFileId) return
    try {
      await api.updateJobFile(id, dbFileId, {
        speed: Number(file._speed) > 0 ? Number(file._speed) : 1.0,
      })
    } catch (e) {
      console.error('[useJobSync] save speed failed:', e.message)
    }
  }, [])

  // Save the B-roll cutaway flag — when true, this clip plays VIDEO
  // ONLY during merge and the previous audio-source clip's audio
  // extends across this clip's duration. Persists to job_files
  // .use_prev_audio. The merge pipeline (lib/video.js mergeVideos)
  // composites the audio when any clip carries this flag.
  const saveFileUsePrevAudio = useCallback(async (file) => {
    const id = jobIdRef.current
    const dbFileId = fileIdMapRef.current[file.id]
    if (!id || !dbFileId) return
    try {
      await api.updateJobFile(id, dbFileId, {
        use_prev_audio: !!file._usePrevAudio,
      })
    } catch (e) {
      console.error('[useJobSync] save use_prev_audio failed:', e.message)
    }
  }, [])

  // Save Ken Burns motion for a still photo. Used when the photo is part
  // of a video merge (photo-to-video-segment). Column already exists on
  // job_files and the PUT /jobs/:id/files/:fileId handler accepts it.
  const saveFilePhotoMotion = useCallback(async (file) => {
    const id = jobIdRef.current
    const dbFileId = fileIdMapRef.current[file.id]
    if (!id || !dbFileId) return
    try {
      await api.updateJobFile(id, dbFileId, {
        photo_to_video: true,
        photo_to_video_motion: file._photoMotion || 'zoom-in',
        photo_to_video_duration: Number(file._trimEnd) > 0 ? Number(file._trimEnd) : 5,
      })
    } catch (e) {
      console.error('[useJobSync] save photo motion failed:', e.message)
    }
  }, [])

  // Save captions for a file
  const saveFileCaptions = useCallback(async (file) => {
    const id = jobIdRef.current
    if (!id) return
    let dbFileId = fileIdMapRef.current[file.id]
    // If we don't have a DB file ID yet, create the file record first
    if (!dbFileId) {
      try {
        const result = await api.addJobFile(id, {
          filename: file.file?.name || file._filename || 'file',
          media_type: file.file?.type || file._mediaType || 'video/mp4',
          upload_key: file.uploadResult?.original_temp_path || null,
          file_order: 0,
        })
        if (result.id) { dbFileId = result.id; fileIdMapRef.current[file.id] = dbFileId }
      } catch { return }
    }
    if (!dbFileId) return
    try {
      await api.updateJobFile(id, dbFileId, {
        captions: file.captions || {},
        upload_key: file.uploadResult?.original_temp_path || null,
      })
      // Also save job_name if available
      const jobName = file.job_name || file.captions?.job_name
      if (jobName) {
        await api.updateJob(id, { job_name: jobName })
      }
    } catch (e) {
      console.error('[useJobSync] save captions failed:', e.message)
    }
  }, [])

  // Save overlay settings
  const saveOverlaySettings = useCallback((overlaySettings) => {
    if (!jobIdRef.current) return
    debouncedSaveJob({ overlay_settings: overlaySettings })
  }, [debouncedSaveJob])

  // Save new file order to the server. Called after a user reorders clips.
  // file_order is the column job_files is sorted by on restore, so updating
  // it makes the order persist across refreshes.
  const saveFileOrder = useCallback(async (orderedFiles) => {
    const id = jobIdRef.current
    if (!id) return
    await Promise.all(orderedFiles.map((file, idx) => {
      const dbFileId = fileIdMapRef.current[file.id]
      if (!dbFileId) return null
      return api.updateJobFile(id, dbFileId, { file_order: idx }).catch(e => {
        console.warn('[saveFileOrder]', file.id, e?.message)
      })
    }))
  }, [])

  // Save voiceover settings
  const saveVoiceoverSettings = useCallback((voiceoverSettings) => {
    if (!jobIdRef.current) return
    debouncedSaveJob({ voiceover_settings: voiceoverSettings })
  }, [debouncedSaveJob])

  // Flush any pending debounced save to the server immediately. Called
  // after TTS generation so newly-uploaded segment audio keys never sit
  // in the 800ms debounce window — a refresh within that window would
  // otherwise drop the keys.
  const flushPendingSave = useCallback(async () => {
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null }
    if (Object.keys(pendingSaveDataRef.current).length === 0) return
    const pending = pendingSaveDataRef.current
    pendingSaveDataRef.current = {}
    await saveJob(pending)
  }, [saveJob])

  // Flush all pending saves immediately — called by explicit Save button
  const saveAll = useCallback(async () => {
    const id = await ensureJob()
    if (!id) return
    try {
      setSavingJob(true)
      // Save hint
      if (typeof window !== 'undefined') {
        const hint = document.getElementById('posty-hint')?.value
        if (hint) await api.updateJob(id, { hint_text: hint })
      }
      // Save captions for the primary file
      const primaryFile = files.find(f => f.captions)
      if (primaryFile) {
        const dbFileId = fileIdMapRef.current[primaryFile.id]
        if (dbFileId) {
          await api.updateJobFile(id, dbFileId, {
            captions: primaryFile.captions || {},
            upload_key: primaryFile.uploadResult?.original_temp_path || null,
          })
        }
        if (primaryFile.job_name || primaryFile.captions?.job_name) {
          await api.updateJob(id, { job_name: primaryFile.job_name || primaryFile.captions?.job_name })
        }
      }
      // Flush any pending debounced save (overlay/voiceover/segments) to
      // the server instead of dropping it. Without this, anything typed
      // within the 800ms debounce window before clicking Save was lost.
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      if (Object.keys(pendingSaveDataRef.current).length > 0) {
        const pending = pendingSaveDataRef.current
        pendingSaveDataRef.current = {}
        await saveJob(pending)
      }
      // Refresh job list
      const jobs = await api.listJobs()
      if (Array.isArray(jobs)) setJobList(jobs)
    } catch (e) {
      console.error('[useJobSync] saveAll failed:', e.message)
    } finally {
      setSavingJob(false)
    }
  }, [ensureJob, files])

  // Load a job by ID and reconstruct state
  const loadJob = useCallback(async (id) => {
    setLoadingJob(true)
    try {
      const job = await api.getJob(id)
      if (!job || job.error) throw new Error(job?.error || 'Job not found')

      // Set active job
      setJobId(job.uuid || job.id)
      sessionStorage.setItem('posty_active_job', job.uuid || job.id)

      // Restore hint
      if (job.hint_text) setUserHint(job.hint_text)

      // Restore files — we can't restore File objects, but we can restore
      // metadata, captions, trim, and upload keys. The UI will show
      // thumbnails via the /upload/thumbnail endpoint.
      let restoredFiles = []
      if (job.files && job.files.length > 0) {
        restoredFiles = job.files.map((f, i) => {
          const fileId = Math.random().toString(36).slice(2)
          fileIdMapRef.current[fileId] = f.id
          // Check if captions were actually saved (not just empty default {})
          const caps = f.captions && typeof f.captions === 'object' ? f.captions : null
          const hasCaps = caps && Object.keys(caps).some(k => {
            if (k === 'job_name') return false // job_name alone doesn't count
            const v = caps[k]
            return v && (typeof v === 'string' ? v.trim() : true)
          })
          return {
            id: fileId,
            file: null,
            isImg: f.media_type?.startsWith('image/'),
            parsed: { occasions: [], products: [], moments: [] },
            status: hasCaps ? 'done' : null,
            captions: hasCaps ? caps : null,
            job_name: f.captions?.job_name || job.job_name,
            uploadResult: { original_temp_path: f.upload_key, uuid: f.upload_uuid || null },
            _trimStart: f.trim_start || 0,
            _trimEnd: f.trim_end ?? null,
            _speed: Number(f.speed) > 0 ? Number(f.speed) : 1.0,
            _usePrevAudio: !!f.use_prev_audio,
            _photoMotion: f.photo_to_video_motion || null,
            _trimThumbs: Array.isArray(f.trim_thumbs) ? f.trim_thumbs : null,
            _restored: true,
            _tenantSlug: api.tenantSlug(),
            _uploadKey: f.upload_key,
            _publicUrl: f.public_url || null,
            _filename: f.filename,
            _mediaType: f.media_type,
            _overlaySettings: job.overlay_settings || {},
            // Cached AI description joined from the uploads row by the
            // backend (GET /jobs/:id LEFT JOINs uploads on file_hash).
            // When present, describeUpload sees it and skips capture.
            visual_description: f.visual_description || null,
          }
        })
        setFiles(restoredFiles)
      }

      // Download merged video + voiceover audio IN PARALLEL (not sequential)
      const tenantSlug = api.tenantSlug()
      const fetchBlob = async (url) => {
        const resp = await fetch(url)
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        const blob = await resp.blob()
        const base64 = await new Promise(resolve => {
          const r = new FileReader()
          r.onload = () => resolve(r.result.split(',')[1])
          r.readAsDataURL(blob)
        })
        return { blob, url: URL.createObjectURL(blob), base64 }
      }

      const mergeUrl = job.merged_video_url || (job.merged_video_key
        ? `${import.meta.env.VITE_API_URL || ''}/api/t/${tenantSlug}/upload/serve?key=${encodeURIComponent(job.merged_video_key)}`
        : null)
      const voUrl = job.voiceover_audio_url || (job.voiceover_audio_key
        ? `${import.meta.env.VITE_API_URL || ''}/api/t/${tenantSlug}/upload/serve?key=${encodeURIComponent(job.voiceover_audio_key)}`
        : null)

      const [mergeResult, voResult] = await Promise.allSettled([
        mergeUrl ? fetchBlob(mergeUrl) : Promise.resolve(null),
        voUrl ? fetchBlob(voUrl) : Promise.resolve(null),
      ])

      if (mergeResult.status === 'fulfilled' && mergeResult.value) {
        window._postyMergedVideo = mergeResult.value
        console.log('[useJobSync] merged video restored from', job.merged_video_key)
        // Notify VoiceoverRecorder + others so they swap monitor src to the
        // merged composition instead of videoFiles[0].
        try { window.dispatchEvent(new CustomEvent('posty-merge-change')) } catch {}
      } else if (mergeResult.status === 'rejected') {
        console.warn('[useJobSync] merged video restore failed:', mergeResult.reason?.message)
      }
      if (voResult.status === 'fulfilled' && voResult.value) {
        window._postyVoiceoverAudio = voResult.value
        for (const f of restoredFiles || []) f._voiceoverBlob = voResult.value.blob
        console.log('[useJobSync] voiceover audio restored from', job.voiceover_audio_key)
      } else if (voResult.status === 'rejected') {
        console.warn('[useJobSync] voiceover restore failed:', voResult.reason?.message)
      }

      // Return the full job so the caller can restore overlay/voiceover/merge settings
      return job
    } catch (e) {
      console.error('[useJobSync] load job failed:', e.message)
      return null
    } finally {
      setLoadingJob(false)
    }
  }, [setUserHint, setFiles])

  // Start a fresh new job
  const newJob = useCallback(async () => {
    const hadJob = !!jobIdRef.current
    setJobId(null)
    sessionStorage.removeItem('posty_active_job')
    fileIdMapRef.current = {}
    setFiles([])
    setUserHint('')
    // Refresh job list so the previous draft appears.
    // If there was an active job, the eager upload may still be finishing,
    // so refresh again after a short delay to catch the file count.
    const refresh = async () => {
      try {
        const jobs = await api.listJobs()
        if (Array.isArray(jobs)) setJobList(jobs)
      } catch {}
    }
    await refresh()
    if (hadJob) setTimeout(refresh, 2000)
  }, [setFiles, setUserHint])

  // Archive current job
  const archiveJob = useCallback(async (id) => {
    try {
      await api.deleteJob(id || jobIdRef.current)
      if (id === jobIdRef.current || !id) {
        newJob()
      }
      // Refresh list
      const jobs = await api.listJobs()
      if (Array.isArray(jobs)) setJobList(jobs)
    } catch (e) {
      console.error('[useJobSync] archive failed:', e.message)
    }
  }, [newJob])

  // Duplicate a job — server copies all files + storage objects to a new job.
  // Returns the new job's uuid so the caller can resume it. Pass
  // opts.forceHookMode=true for "Duplicate as hook".
  const duplicateJob = useCallback(async (id, opts = {}) => {
    const r = await api.duplicateJob(id, opts)
    const jobs = await api.listJobs()
    if (Array.isArray(jobs)) setJobList(jobs)
    return r
  }, [])

  // Refresh job list
  const refreshJobList = useCallback(async () => {
    try {
      const jobs = await api.listJobs()
      if (Array.isArray(jobs)) setJobList(jobs)
    } catch {}
  }, [])

  // Public helper so consumers (e.g. rename in JobList) can request a
  // fresh jobs list after a server-side mutation.
  const refreshJobs = useCallback(async () => {
    try {
      const jobs = await api.listJobs()
      if (Array.isArray(jobs)) setJobList(jobs)
    } catch (e) { console.warn('[useJobSync] refreshJobs failed:', e?.message) }
  }, [])

  return {
    jobId,
    jobList,
    refreshJobs,
    loadingJob,
    savingJob,
    ensureJob,
    saveJob,
    saveAll,
    saveFileToJob,
    saveFileTrim,
    saveFileSpeed,
    saveFileUsePrevAudio,
    saveFilePhotoMotion,
    saveFileTrimThumbs,
    saveFileCaptions,
    deleteFileFromJob,
    saveOverlaySettings,
    saveVoiceoverSettings,
    saveFileOrder,
    flushPendingSave,
    loadJob,
    newJob,
    archiveJob,
    duplicateJob,
    refreshJobList,
  }
}
