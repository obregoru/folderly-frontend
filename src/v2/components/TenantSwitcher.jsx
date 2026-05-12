// Super-admin tenant switcher. Only renders when the logged-in
// user.role === 'super_admin'. Picking a tenant fires a HARD
// navigation to `/t/<slug>` which re-fires /me, re-fetches the
// jobs list, refreshes settings, and resets every in-memory
// useState across the app — equivalent to a fresh login for that
// tenant, which is what the operator wants when context-switching
// between clients.
//
// The BE side already supports this:
//   - users.role = 'super_admin' bypasses the
//     "user.tenant_id !== req.tenant.id" guard in requireTenant
//   - middleware/tenant.js: when a super_admin's request carries a
//     slug, resolveTenant pulls THAT tenant row, not the user's
//     home tenant
//   - api.tenantSlug() reads the slug from the URL first, then
//     falls back to localStorage — so `/t/<new-slug>` immediately
//     starts scoping calls correctly

import { useEffect, useRef, useState } from 'react'
import * as api from '../../api'

export default function TenantSwitcher({ user }) {
  const [tenants, setTenants] = useState(null)
  const [open, setOpen] = useState(false)
  const [err, setErr] = useState(null)
  const containerRef = useRef(null)
  const currentSlug = api.tenantSlug()
  const isSuperAdmin = user?.role === 'super_admin'

  // Fetch tenants on mount (only when super admin — tenant_admin
  // can also call /api/admin/tenants but it returns only their own,
  // which makes the switcher pointless for them).
  useEffect(() => {
    if (!isSuperAdmin) return
    let cancelled = false
    api.getTenants().then(rows => {
      if (cancelled) return
      // Admin endpoint returns each tenant with id remapped to its
      // uuid in the response — but we only care about slug + name.
      const list = Array.isArray(rows) ? rows : []
      setTenants(list.filter(t => t && t.slug && t.is_active !== false))
    }).catch(e => {
      if (cancelled) return
      setErr(e?.message || String(e))
    })
    return () => { cancelled = true }
  }, [isSuperAdmin])

  // Close on outside click. Skipped when the panel isn't open so we
  // don't add a listener for the common case.
  useEffect(() => {
    if (!open) return
    const onClick = (e) => {
      if (!containerRef.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  if (!isSuperAdmin) return null

  const switchTo = (slug) => {
    if (!slug) return
    if (slug === currentSlug) { setOpen(false); return }
    // Persist before navigating so the post-reload tenantSlug() read
    // matches the URL — defense-in-depth in case the URL pattern
    // detection fails (e.g. when the router rewrites the path).
    api.setTenantSlug(slug)
    // Hard navigation. Drops every useState in memory, kicks /me +
    // jobs list fetch with the new slug context. The user explicitly
    // asked for "a full login as if the tenant user actually logged
    // in" — this is the cleanest way to get there without manually
    // invalidating every cache point.
    window.location.assign(`/t/${slug}`)
  }

  const currentLabel = (() => {
    if (!tenants) return currentSlug || 'select tenant'
    const me = tenants.find(t => t.slug === currentSlug)
    return me?.name || currentSlug || 'select tenant'
  })()

  return (
    <div ref={containerRef} className="relative flex-shrink-0">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="text-[10px] py-1 px-2 border border-[#f59e0b] bg-[#fffbeb] text-[#92400e] rounded cursor-pointer flex items-center gap-1 whitespace-nowrap"
        title="Super admin — switch tenant context (reloads the app as that tenant)"
      >
        <span className="leading-none">🦸</span>
        <span className="font-medium max-w-[110px] truncate">{currentLabel}</span>
        <span className="text-[8px]">▾</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-white border border-[#e5e5e5] rounded shadow-lg z-30 min-w-[200px] max-h-[60vh] overflow-y-auto">
          <div className="px-2 py-1 text-[9px] text-muted uppercase tracking-wide border-b border-[#e5e5e5]">
            Switch tenant
          </div>
          {!tenants && !err && (
            <div className="px-2 py-2 text-[10px] text-muted italic">Loading tenants…</div>
          )}
          {err && (
            <div className="px-2 py-2 text-[10px] text-[#c0392b]">{err}</div>
          )}
          {Array.isArray(tenants) && tenants.length === 0 && (
            <div className="px-2 py-2 text-[10px] text-muted italic">No tenants found.</div>
          )}
          {Array.isArray(tenants) && tenants.map(t => {
            const active = t.slug === currentSlug
            return (
              <button
                key={t.slug}
                type="button"
                onClick={() => switchTo(t.slug)}
                disabled={active}
                className={`block w-full text-left text-[11px] py-1.5 px-2 border-none cursor-pointer ${
                  active ? 'bg-[#f3f0ff] text-[#6C5CE7] font-medium' : 'bg-white text-ink hover:bg-[#fafafa]'
                }`}
                title={active ? 'Current tenant' : `Switch to ${t.name} — reloads the app`}
              >
                <div className="flex items-center gap-1.5">
                  {active && <span className="text-[10px] leading-none">●</span>}
                  <span className="flex-1 truncate">{t.name || t.slug}</span>
                  <span className="text-[9px] text-muted font-mono">{t.slug}</span>
                </div>
              </button>
            )
          })}
          <div className="border-t border-[#e5e5e5] px-2 py-1.5 text-[9px] text-muted italic">
            Picking a tenant fully reloads the app as if that tenant user logged in.
          </div>
        </div>
      )}
    </div>
  )
}
