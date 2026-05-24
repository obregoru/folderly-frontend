// Render the 5-dim competitive gap analysis findings produced by
// lib/landing-gap-analysis.js. Used in two places:
//   1. SitemapWizard SlotEditor — pre-content analysis using slot's
//      strategy hint vs competitor URL
//   2. LandingPages PageWorkspace — buffered-version analysis using
//      the latest ai-suggested / human-edited body vs competitor
// Same shape, same rendering. Top recommendations always expanded;
// each dimension is a collapsible <details> showing gaps + our
// strengths + recommendations side-by-side.
export default function GapFindings({ findings }) {
  if (!findings || typeof findings !== 'object') return null
  const dims = [
    { key: 'seo', label: 'SEO' },
    { key: 'eeat', label: 'E-E-A-T' },
    { key: 'geo', label: 'GEO (generative engines)' },
    { key: 'aeo', label: 'AEO (answer engines)' },
    { key: 'content', label: 'Content quality' },
  ]
  return (
    <div className="bg-white border border-[#e5e5e5] rounded p-2 space-y-2 text-[10px]">
      {findings.summary && (
        <div className="text-[10px] text-ink italic">{findings.summary}</div>
      )}
      {Array.isArray(findings.top_recommendations) && findings.top_recommendations.length > 0 && (
        <div className="space-y-1">
          <div className="text-[9px] uppercase tracking-wide text-muted font-medium">Highest-impact moves</div>
          <ul className="space-y-0.5">
            {findings.top_recommendations.map((r, i) => (
              <li key={i} className="text-[10px] pl-2 border-l-2 border-[#6C5CE7]/40">{r}</li>
            ))}
          </ul>
        </div>
      )}
      {dims.map(d => {
        const f = findings[d.key]
        if (!f) return null
        const gaps = (f.gaps_to_close || []).filter(Boolean)
        const strengths = (f.our_strengths || []).filter(Boolean)
        const recs = (f.recommendations || []).filter(Boolean)
        if (gaps.length === 0 && strengths.length === 0 && recs.length === 0) return null
        return (
          <details key={d.key} className="border-t border-[#f0f0f0] pt-1">
            <summary className="cursor-pointer text-[10px] font-medium">
              {d.label}
              <span className="text-[9px] text-muted ml-2">
                {gaps.length} gap{gaps.length === 1 ? '' : 's'}, {recs.length} rec{recs.length === 1 ? '' : 's'}
              </span>
            </summary>
            <div className="pl-2 pt-1 space-y-1.5">
              {gaps.length > 0 && (
                <div>
                  <div className="text-[9px] uppercase tracking-wide text-[#c0392b]/80 font-medium mb-0.5">Gaps to close</div>
                  <ul className="space-y-0.5">
                    {gaps.map((g, i) => <li key={i} className="text-[10px]">• {g}</li>)}
                  </ul>
                </div>
              )}
              {strengths.length > 0 && (
                <div>
                  <div className="text-[9px] uppercase tracking-wide text-[#15803d] font-medium mb-0.5">Our strengths</div>
                  <ul className="space-y-0.5">
                    {strengths.map((s, i) => <li key={i} className="text-[10px]">• {s}</li>)}
                  </ul>
                </div>
              )}
              {recs.length > 0 && (
                <div>
                  <div className="text-[9px] uppercase tracking-wide text-[#6C5CE7] font-medium mb-0.5">Recommendations</div>
                  <ul className="space-y-0.5">
                    {recs.map((r, i) => <li key={i} className="text-[10px]">• {r}</li>)}
                  </ul>
                </div>
              )}
            </div>
          </details>
        )
      })}
    </div>
  )
}
