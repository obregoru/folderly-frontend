import { useState, useEffect } from 'react'
import * as api from '../api'

const TABS = ['Tenants', 'Users', 'Throttle', 'IP Blocklist']

function Badge({ type, children }) {
  const cls = type === 'green' ? 'bg-[#e8efe9] text-[#3a6b42]' : type === 'red' ? 'bg-[#fdeaea] text-[#c0392b]' : 'bg-[#e8f0fe] text-[#2c5aa0]'
  return <span className={`inline-block py-0.5 px-2.5 rounded-full text-[11px] font-semibold ${cls}`}>{children}</span>
}

function fmtDate(s) {
  if (!s) return '--'
  const d = new Date(s)
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function AdminPanel({ user, onBack, onLogout }) {
  const [tab, setTab] = useState('Tenants')
  const [tenants, setTenants] = useState([])
  const [users, setUsers] = useState([])
  const [throttle, setThrottle] = useState([])
  const [blocklist, setBlocklist] = useState([])
  const [error, setError] = useState('')

  const isSuperAdmin = user.role === 'super_admin'

  const visibleTabs = isSuperAdmin ? TABS : ['Tenants', 'Users']

  useEffect(() => { loadAll() }, [])

  const loadAll = () => {
    api.getTenants().then(d => { if (Array.isArray(d)) setTenants(d) }).catch(() => {})
    api.getUsers().then(d => { if (Array.isArray(d)) setUsers(d) }).catch(() => {})
    if (isSuperAdmin) {
      api.getThrottleConfig().then(d => { if (Array.isArray(d)) setThrottle(d) }).catch(() => {})
      api.getIpBlocklist().then(d => { if (Array.isArray(d)) setBlocklist(d) }).catch(() => {})
    }
  }

  return (
    <div className="min-h-screen bg-cream">
      {/* Top bar */}
      <div className="bg-white border-b border-border py-3 px-4 md:px-8 flex items-center justify-between sticky top-0 z-10 flex-wrap gap-2">
        <h1 className="font-serif text-[20px] md:text-[22px]">Posty Posty Admin</h1>
        <div className="flex gap-2 items-center flex-wrap">
          <span className="text-[12px] text-muted hidden sm:inline">{user.email}</span>
          {onBack && <button onClick={onBack} className="text-[12px] py-1 px-3 border border-border rounded bg-transparent cursor-pointer font-sans hover:bg-cream">Back to app</button>}
          <button onClick={onLogout} className="text-[12px] py-1 px-3 border border-border rounded bg-transparent cursor-pointer font-sans hover:bg-cream">Sign out</button>
        </div>
      </div>

      <div className="max-w-[1100px] mx-auto py-4 md:py-8 px-3 md:px-6">
        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b-2 border-border">
          {visibleTabs.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`py-2.5 px-5 text-sm font-medium cursor-pointer border-none bg-transparent font-sans border-b-2 -mb-[2px] transition-colors ${tab === t ? 'text-sage border-sage' : 'text-muted border-transparent hover:text-ink'}`}
            >{t}</button>
          ))}
        </div>

        {tab === 'Tenants' && <TenantsPanel tenants={tenants} isSuperAdmin={isSuperAdmin} onRefresh={loadAll} error={error} setError={setError} />}
        {tab === 'Users' && <UsersPanel users={users} tenants={tenants} isSuperAdmin={isSuperAdmin} onRefresh={loadAll} error={error} setError={setError} />}
        {tab === 'Throttle' && <ThrottlePanel configs={throttle} onRefresh={loadAll} />}
        {tab === 'IP Blocklist' && <BlocklistPanel items={blocklist} onRefresh={loadAll} error={error} setError={setError} />}
      </div>
    </div>
  )
}

function TenantsPanel({ tenants, isSuperAdmin, onRefresh, error, setError }) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [targetUrl, setTargetUrl] = useState('')
  const [editing, setEditing] = useState(null)
  const [editData, setEditData] = useState({})

  const handleCreate = async (e) => {
    e.preventDefault()
    setError('')
    try {
      await api.createTenant({ name, slug, target_url: targetUrl || null })
      setName(''); setSlug(''); setTargetUrl('')
      onRefresh()
    } catch (err) { setError(err.message) }
  }

  const handleDeactivate = (id) => {
    if (!confirm('Deactivate this tenant?')) return
    api.deactivateTenant(id).then(onRefresh)
  }

  const startEdit = (t) => {
    setEditing(t.id)
    setEditData({ name: t.name, slug: t.slug, target_url: t.target_url || '' })
  }

  const handleSaveEdit = async (e) => {
    e.preventDefault()
    setError('')
    try {
      await api.updateTenant(editing, editData)
      setEditing(null)
      onRefresh()
    } catch (err) { setError(err.message) }
  }

  const inp = "w-full py-2 px-3 border border-[#ddd] rounded text-[13px] font-sans focus:outline-none focus:border-sage"

  return (
    <>
      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div className="bg-white rounded-lg shadow-lg w-full max-w-[480px] p-6" onClick={e => e.stopPropagation()}>
            <h2 className="font-serif text-xl mb-4">Edit Tenant</h2>
            <form onSubmit={handleSaveEdit}>
              <div className="mb-3">
                <label className="block text-xs font-medium text-muted mb-1">Name</label>
                <input className={inp} value={editData.name} onChange={e => setEditData(d => ({ ...d, name: e.target.value }))} required />
              </div>
              <div className="mb-3">
                <label className="block text-xs font-medium text-muted mb-1">Slug</label>
                <input className={inp} value={editData.slug} onChange={e => setEditData(d => ({ ...d, slug: e.target.value }))} required />
              </div>
              <div className="mb-4">
                <label className="block text-xs font-medium text-muted mb-1">Target URL</label>
                <input className={inp} value={editData.target_url} onChange={e => setEditData(d => ({ ...d, target_url: e.target.value }))} placeholder="https://book.example.com" />
              </div>
              {error && <p className="text-[#c0392b] text-[13px] mb-3">{error}</p>}
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => setEditing(null)} className="py-2 px-4 border border-border rounded text-[13px] font-sans cursor-pointer bg-transparent hover:bg-cream">Cancel</button>
                <button type="submit" className="py-2 px-4 bg-sage text-white border-none rounded text-[13px] font-semibold cursor-pointer font-sans hover:bg-[#4a6650]">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isSuperAdmin && (
        <div className="bg-white rounded shadow-sm border border-border p-4 md:p-6 mb-5">
          <h2 className="font-serif text-xl mb-4">Create Tenant</h2>
          <form onSubmit={handleCreate}>
            <div className="flex gap-3 mb-3.5 flex-wrap">
              <div className="flex-1 min-w-[180px]">
                <label className="block text-xs font-medium text-muted mb-1">Name</label>
                <input className={inp} value={name} onChange={e => setName(e.target.value)} required />
              </div>
              <div className="flex-1 min-w-[180px]">
                <label className="block text-xs font-medium text-muted mb-1">Slug</label>
                <input className={inp} value={slug} onChange={e => setSlug(e.target.value)} required placeholder="lowercase-with-hyphens" />
              </div>
              <div className="flex-1 min-w-[180px]">
                <label className="block text-xs font-medium text-muted mb-1">Target URL</label>
                <input className={inp} value={targetUrl} onChange={e => setTargetUrl(e.target.value)} placeholder="https://book.example.com" />
              </div>
            </div>
            <button type="submit" className="py-2 px-4 bg-sage text-white border-none rounded text-[13px] font-semibold cursor-pointer font-sans hover:bg-[#4a6650]">Create Tenant</button>
            {error && <p className="text-[#c0392b] text-[13px] mt-2">{error}</p>}
          </form>
        </div>
      )}

      <div className="bg-white rounded shadow-sm border border-border p-4 md:p-6">
        <h2 className="font-serif text-xl mb-4">All Tenants</h2>
        {tenants.length === 0 && <p className="text-muted text-[13px]">No tenants yet</p>}
        <div className="flex flex-col gap-2">
          {tenants.map(t => (
            <div key={t.id} className="flex items-center justify-between gap-3 py-2.5 px-3 border border-border rounded hover:bg-cream">
              <div className="flex items-center gap-2.5 min-w-0">
                <a href={`/t/${t.slug}`} className="text-sage hover:text-[#3a5a40] flex-shrink-0" title={`Open /t/${t.slug}`}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 3H3v10h10v-3M9 2h5v5M14 2L7 9" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </a>
                <div className="min-w-0">
                  <div className="text-[13px] font-medium truncate">{t.name}</div>
                  <div className="text-[11px] text-muted truncate">{t.slug}</div>
                </div>
                <Badge type={t.is_active ? 'green' : 'red'}>{t.is_active ? 'Active' : 'Inactive'}</Badge>
              </div>
              {isSuperAdmin && (
                <div className="flex gap-1 flex-shrink-0">
                  <button onClick={() => startEdit(t)} className="text-[10px] py-1 px-2 border border-border rounded bg-transparent cursor-pointer font-sans hover:bg-cream">Edit</button>
                  {t.is_active && <button onClick={() => handleDeactivate(t.id)} className="text-[10px] py-1 px-2 border border-border rounded bg-transparent cursor-pointer font-sans hover:bg-cream text-[#c0392b]">Off</button>}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

function UsersPanel({ users, tenants, isSuperAdmin, onRefresh, error, setError }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('tenant_admin')
  const [tenantId, setTenantId] = useState('')

  const handleCreate = async (e) => {
    e.preventDefault()
    setError('')
    if (role !== 'super_admin' && !tenantId) { setError('Select a tenant'); return }
    try {
      await api.createUser({ email, password, role, tenant_id: role === 'super_admin' ? null : tenantId })
      setEmail(''); setPassword(''); setRole('tenant_admin'); setTenantId('')
      onRefresh()
    } catch (err) { setError(err.message) }
  }

  const handleDeactivate = (id) => {
    if (!confirm('Deactivate this user?')) return
    api.deactivateUser(id).then(onRefresh)
  }

  return (
    <>
      <div className="bg-white rounded shadow-sm border border-border p-4 md:p-6 mb-5">
        <h2 className="font-serif text-xl mb-4">Create User</h2>
        <form onSubmit={handleCreate}>
          <div className="flex gap-3 mb-3.5 flex-wrap">
            <div className="flex-1 min-w-[180px]">
              <label className="block text-xs font-medium text-muted mb-1">Email</label>
              <input type="email" className="w-full py-2 px-3 border border-[#ddd] rounded text-[13px] font-sans focus:outline-none focus:border-sage" value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            <div className="flex-1 min-w-[180px]">
              <label className="block text-xs font-medium text-muted mb-1">Password</label>
              <input type="password" className="w-full py-2 px-3 border border-[#ddd] rounded text-[13px] font-sans focus:outline-none focus:border-sage" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} />
            </div>
          </div>
          <div className="flex gap-3 mb-3.5 flex-wrap">
            <div className="flex-1 min-w-[180px]">
              <label className="block text-xs font-medium text-muted mb-1">Role</label>
              <select className="w-full py-2 px-3 border border-[#ddd] rounded text-[13px] font-sans focus:outline-none focus:border-sage" value={role} onChange={e => setRole(e.target.value)}>
                <option value="tenant_admin">Tenant Admin</option>
                <option value="tenant_user">Tenant User</option>
                {isSuperAdmin && <option value="super_admin">Super Admin</option>}
              </select>
            </div>
            <div className="flex-1 min-w-[180px]">
              <label className="block text-xs font-medium text-muted mb-1">Tenant</label>
              <select className="w-full py-2 px-3 border border-[#ddd] rounded text-[13px] font-sans focus:outline-none focus:border-sage" value={tenantId} onChange={e => setTenantId(e.target.value)}>
                <option value="">-- Select --</option>
                {tenants.filter(t => t.is_active).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          </div>
          <button type="submit" className="py-2 px-4 bg-sage text-white border-none rounded text-[13px] font-semibold cursor-pointer font-sans hover:bg-[#4a6650]">Create User</button>
          {error && <p className="text-[#c0392b] text-[13px] mt-2">{error}</p>}
        </form>
      </div>

      <div className="bg-white rounded shadow-sm p-4 md:p-6 overflow-x-auto">
        <h2 className="font-serif text-xl mb-4">All Users</h2>
        <table className="w-full text-[13px] min-w-[500px]">
          <thead>
            <tr>
              <th className="text-left py-2.5 px-3 border-b-2 border-border text-muted font-medium text-xs uppercase tracking-wide">Email</th>
              <th className="text-left py-2.5 px-3 border-b-2 border-border text-muted font-medium text-xs uppercase tracking-wide">Role</th>
              <th className="text-left py-2.5 px-3 border-b-2 border-border text-muted font-medium text-xs uppercase tracking-wide">Tenant</th>
              <th className="text-left py-2.5 px-3 border-b-2 border-border text-muted font-medium text-xs uppercase tracking-wide">Status</th>
              <th className="text-left py-2.5 px-3 border-b-2 border-border text-muted font-medium text-xs uppercase tracking-wide">Last Login</th>
              <th className="py-2.5 px-3 border-b-2 border-border"></th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && <tr><td colSpan={6} className="py-3 px-3 text-muted">No users</td></tr>}
            {users.map(u => (
              <tr key={u.id} className="hover:bg-cream">
                <td className="py-2.5 px-3 border-b border-[#f0ebe3]">{u.email}</td>
                <td className="py-2.5 px-3 border-b border-[#f0ebe3]"><Badge type="blue">{u.role}</Badge></td>
                <td className="py-2.5 px-3 border-b border-[#f0ebe3]">{u.tenant_name || '--'}</td>
                <td className="py-2.5 px-3 border-b border-[#f0ebe3]"><Badge type={u.is_active ? 'green' : 'red'}>{u.is_active ? 'Active' : 'Inactive'}</Badge></td>
                <td className="py-2.5 px-3 border-b border-[#f0ebe3]">{u.last_login ? fmtDate(u.last_login) : 'Never'}</td>
                <td className="py-2.5 px-3 border-b border-[#f0ebe3]">
                  {u.is_active && <button onClick={() => handleDeactivate(u.id)} className="text-xs py-1 px-2.5 border border-border rounded bg-transparent cursor-pointer font-sans hover:bg-cream">Deactivate</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function ThrottlePanel({ configs, onRefresh }) {
  const [values, setValues] = useState({})

  useEffect(() => {
    const v = {}
    configs.forEach(c => { v[c.id] = { window_ms: c.window_ms, max_requests: c.max_requests, block_duration_ms: c.block_duration_ms } })
    setValues(v)
  }, [configs])

  const handleSave = (id) => {
    api.updateThrottle(id, values[id]).then(onRefresh)
  }

  return (
    <div className="bg-white rounded shadow-sm border border-border p-4 md:p-6">
      <h2 className="font-serif text-xl mb-4">Rate Limiting</h2>
      {configs.length === 0 && <p className="text-muted">No throttle config found</p>}
      {configs.map(c => (
        <div key={c.id} className="flex gap-4 items-end flex-wrap mb-4">
          <div className="min-w-[140px]">
            <label className="block text-xs font-medium text-muted mb-1">{c.scope === 'global' ? 'Global Default' : 'Tenant Override'}</label>
            <input disabled value={c.scope === 'global' ? 'All tenants' : 'Tenant: ' + c.tenant_id} className="w-full py-2 px-3 border border-[#ddd] rounded text-[13px] font-sans bg-cream" />
          </div>
          <div className="min-w-[120px]">
            <label className="block text-xs font-medium text-muted mb-1">Window (ms)</label>
            <input type="number" className="w-full py-2 px-3 border border-[#ddd] rounded text-[13px] font-sans focus:outline-none focus:border-sage" value={values[c.id]?.window_ms || ''} onChange={e => setValues(v => ({ ...v, [c.id]: { ...v[c.id], window_ms: parseInt(e.target.value) } }))} />
          </div>
          <div className="min-w-[120px]">
            <label className="block text-xs font-medium text-muted mb-1">Max Requests</label>
            <input type="number" className="w-full py-2 px-3 border border-[#ddd] rounded text-[13px] font-sans focus:outline-none focus:border-sage" value={values[c.id]?.max_requests || ''} onChange={e => setValues(v => ({ ...v, [c.id]: { ...v[c.id], max_requests: parseInt(e.target.value) } }))} />
          </div>
          <div className="min-w-[120px]">
            <label className="block text-xs font-medium text-muted mb-1">Block (ms)</label>
            <input type="number" className="w-full py-2 px-3 border border-[#ddd] rounded text-[13px] font-sans focus:outline-none focus:border-sage" value={values[c.id]?.block_duration_ms || ''} onChange={e => setValues(v => ({ ...v, [c.id]: { ...v[c.id], block_duration_ms: parseInt(e.target.value) } }))} />
          </div>
          <button onClick={() => handleSave(c.id)} className="py-2 px-4 bg-sage text-white border-none rounded text-[13px] font-semibold cursor-pointer font-sans hover:bg-[#4a6650]">Save</button>
        </div>
      ))}
    </div>
  )
}

function BlocklistPanel({ items, onRefresh, error, setError }) {
  const [ip, setIp] = useState('')
  const [reason, setReason] = useState('')

  const handleBlock = async (e) => {
    e.preventDefault()
    setError('')
    if (!ip) return
    try {
      await api.blockIp({ ip_address: ip, reason: reason || null })
      setIp(''); setReason('')
      onRefresh()
    } catch (err) { setError(err.message) }
  }

  const handleUnblock = (id) => {
    if (!confirm('Remove this IP block?')) return
    api.unblockIp(id).then(onRefresh)
  }

  return (
    <>
      <div className="bg-white rounded shadow-sm border border-border p-4 md:p-6 mb-5">
        <h2 className="font-serif text-xl mb-4">Block an IP</h2>
        <form onSubmit={handleBlock}>
          <div className="flex gap-3 mb-3.5 flex-wrap">
            <div className="flex-1 min-w-[180px]">
              <label className="block text-xs font-medium text-muted mb-1">IP Address</label>
              <input className="w-full py-2 px-3 border border-[#ddd] rounded text-[13px] font-sans focus:outline-none focus:border-sage" value={ip} onChange={e => setIp(e.target.value)} required placeholder="192.168.1.1" />
            </div>
            <div className="flex-1 min-w-[180px]">
              <label className="block text-xs font-medium text-muted mb-1">Reason</label>
              <input className="w-full py-2 px-3 border border-[#ddd] rounded text-[13px] font-sans focus:outline-none focus:border-sage" value={reason} onChange={e => setReason(e.target.value)} placeholder="Optional" />
            </div>
          </div>
          <button type="submit" className="py-2 px-4 bg-terra text-white border-none rounded text-[13px] font-semibold cursor-pointer font-sans hover:bg-[#a8604a]">Block IP</button>
          {error && <p className="text-[#c0392b] text-[13px] mt-2">{error}</p>}
        </form>
      </div>

      <div className="bg-white rounded shadow-sm border border-border p-4 md:p-6">
        <h2 className="font-serif text-xl mb-4">Blocked IPs</h2>
        <table className="w-full text-[13px]">
          <thead>
            <tr>
              <th className="text-left py-2.5 px-3 border-b-2 border-border text-muted font-medium text-xs uppercase tracking-wide">IP</th>
              <th className="text-left py-2.5 px-3 border-b-2 border-border text-muted font-medium text-xs uppercase tracking-wide">Reason</th>
              <th className="text-left py-2.5 px-3 border-b-2 border-border text-muted font-medium text-xs uppercase tracking-wide">Blocked By</th>
              <th className="text-left py-2.5 px-3 border-b-2 border-border text-muted font-medium text-xs uppercase tracking-wide">Created</th>
              <th className="text-left py-2.5 px-3 border-b-2 border-border text-muted font-medium text-xs uppercase tracking-wide">Expires</th>
              <th className="py-2.5 px-3 border-b-2 border-border"></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={6} className="py-3 px-3 text-muted">No blocked IPs</td></tr>}
            {items.map(b => (
              <tr key={b.id} className="hover:bg-cream">
                <td className="py-2.5 px-3 border-b border-[#f0ebe3]">{String(b.ip_address)}</td>
                <td className="py-2.5 px-3 border-b border-[#f0ebe3]">{b.reason || '--'}</td>
                <td className="py-2.5 px-3 border-b border-[#f0ebe3]">{b.blocked_by_email || '--'}</td>
                <td className="py-2.5 px-3 border-b border-[#f0ebe3]">{fmtDate(b.created_at)}</td>
                <td className="py-2.5 px-3 border-b border-[#f0ebe3]">{b.expires_at ? fmtDate(b.expires_at) : 'Permanent'}</td>
                <td className="py-2.5 px-3 border-b border-[#f0ebe3]">
                  <button onClick={() => handleUnblock(b.id)} className="text-xs py-1 px-2.5 border border-border rounded bg-transparent cursor-pointer font-sans hover:bg-cream">Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
