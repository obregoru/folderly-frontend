/**
 * Placeholder — will be wired to real past-posts / history endpoint in
 * a later phase.
 */
export default function HistoryV2() {
  return (
    <div className="p-3 space-y-3">
      <h1 className="text-[14px] font-medium">History</h1>
      <div className="bg-white border border-[#e5e5e5] rounded-lg p-6 text-center text-[11px] text-muted">
        Coming in a later v2 phase — the mockup shows filters by channel/status,
        engagement metrics, and retry-failed actions.
        <br /><br />
        For now, the real app's history modal still lives on <a href="/?real=1" className="text-[#6C5CE7] underline">?real=1</a>.
      </div>
    </div>
  )
}
