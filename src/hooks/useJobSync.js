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

  // Create a job if one doesn't exist
  const ensureJob = useCallback(async () => {
    if (jobIdRef.current) return jobIdRef.current
    try {
      const job = await api.createJob()
      const id = job.id || job.uuid
      setJobId(id)
      sessionStorage.setItem('posty_active_job', id)
      return id
    } catch (e) {
      console.error('[useJobSync] create job failed:', e.message)
      return null
    }
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

  // Debounced save
  const debouncedSaveJob = useCallback((data) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => saveJob(data), 800)
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
    const id = await ensureJob()
    if (!id) return
    try {
      const result = await api.addJobFile(id, {
        filename: file.file?.name || file.filename,
        media_type: file.file?.type || file.media_type,
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

  // Save file trim changes
  const saveFileTrim = useCallback(async (file) => {
    const id = jobIdRef.current
    const dbFileId = fileIdMapRef.current[file.id]
    if (!id || !dbFileId) return
    try {
      await api.updateJobFile(id, dbFileId, {
        trim_start: file._trimStart || 0,
        trim_end: file._trimEnd ?? null,
      })
    } catch (e) {
      console.error('[useJobSync] save trim failed:', e.message)
    }
  }, [])

  // Save captions for a file
  const saveFileCaptions = useCallback(async (file) => {
    const id = jobIdRef.current
    const dbFileId = fileIdMapRef.current[file.id]
    if (!id || !dbFileId) return
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

  // Save voiceover settings
  const saveVoiceoverSettings = useCallback((voiceoverSettings) => {
    if (!jobIdRef.current) return
    debouncedSaveJob({ voiceover_settings: voiceoverSettings })
  }, [debouncedSaveJob])

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
      if (job.files && job.files.length > 0) {
        const restoredFiles = job.files.map((f, i) => {
          const fileId = Math.random().toString(36).slice(2)
          fileIdMapRef.current[fileId] = f.id
          return {
            id: fileId,
            file: null, // File object can't be restored
            isImg: f.media_type?.startsWith('image/'),
            parsed: { occasions: [], products: [], moments: [] },
            status: f.captions && Object.keys(f.captions).length > 0 ? 'done' : null,
            captions: f.captions || null,
            job_name: f.captions?.job_name || job.job_name,
            uploadResult: { original_temp_path: f.upload_key },
            _trimStart: f.trim_start || 0,
            _trimEnd: f.trim_end ?? null,
            _restored: true, // flag so UI knows this is a restored file
            _uploadKey: f.upload_key,
            _filename: f.filename,
            _mediaType: f.media_type,
          }
        })
        setFiles(restoredFiles)
      }

      // Return the full job so the caller can restore overlay/voiceover settings
      return job
    } catch (e) {
      console.error('[useJobSync] load job failed:', e.message)
      return null
    } finally {
      setLoadingJob(false)
    }
  }, [setUserHint, setFiles])

  // Start a fresh new job
  const newJob = useCallback(() => {
    setJobId(null)
    sessionStorage.removeItem('posty_active_job')
    fileIdMapRef.current = {}
    setFiles([])
    setUserHint('')
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

  // Refresh job list
  const refreshJobList = useCallback(async () => {
    try {
      const jobs = await api.listJobs()
      if (Array.isArray(jobs)) setJobList(jobs)
    } catch {}
  }, [])

  return {
    jobId,
    jobList,
    loadingJob,
    savingJob,
    ensureJob,
    saveJob,
    saveFileToJob,
    saveFileTrim,
    saveFileCaptions,
    saveOverlaySettings,
    saveVoiceoverSettings,
    loadJob,
    newJob,
    archiveJob,
    refreshJobList,
  }
}
