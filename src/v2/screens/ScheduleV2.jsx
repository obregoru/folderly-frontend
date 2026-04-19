/**
 * Placeholder — will be wired to real scheduled posts endpoint in a later
 * phase. For now this is a notice so the nav item works.
 */
export default function ScheduleV2() {
  return (
    <div className="p-3 space-y-3">
      <h1 className="text-[14px] font-medium">Schedule</h1>
      <div className="bg-white border border-[#e5e5e5] rounded-lg p-6 text-center text-[11px] text-muted">
        Coming in a later v2 phase — the mockup shows List / Week / Month views
        with drag-to-reschedule and inline caption edits.
        <br /><br />
        For now, the real app's calendar still lives on <a href="/?real=1" className="text-[#6C5CE7] underline">?real=1</a>.
      </div>
    </div>
  )
}
