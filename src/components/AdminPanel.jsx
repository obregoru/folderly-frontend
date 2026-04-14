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

        {tab === 'Tenants' && <TenantsPanel tenants={tenants} isSuperAdmin={isSuperAdmin} currentUser={user} onRefresh={loadAll} error={error} setError={setError} />}
        {tab === 'Users' && <UsersPanel users={users} tenants={tenants} isSuperAdmin={isSuperAdmin} onRefresh={loadAll} error={error} setError={setError} />}
        {tab === 'Throttle' && <ThrottlePanel configs={throttle} onRefresh={loadAll} />}
        {tab === 'IP Blocklist' && <BlocklistPanel items={blocklist} onRefresh={loadAll} error={error} setError={setError} />}
      </div>
    </div>
  )
}

function TenantsPanel({ tenants, isSuperAdmin, currentUser, onRefresh, error, setError }) {
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
    setEditData({
      name: t.name, slug: t.slug, target_url: t.target_url || '',
      notify_enabled: t.notify_enabled || false, notify_email: t.notify_email || '',
      notify_minutes_before: t.notify_minutes_before || 15,
      email_provider: t.email_provider || 'smtp',
      smtp_host: t.smtp_host || '', smtp_port: t.smtp_port || 587,
      smtp_username: t.smtp_username || '', smtp_password: '',
      smtp_from_email: t.smtp_from_email || '',
      sendgrid_api_key: '', resend_api_key: '',
    })
  }

  const handleSaveEdit = async (e) => {
    e.preventDefault()
    setError('')
    try {
      // Save all fields (including notification) via admin endpoint
      const data = { ...editData }
      if (!data.smtp_password) delete data.smtp_password
      if (!data.sendgrid_api_key) delete data.sendgrid_api_key
      if (!data.resend_api_key) delete data.resend_api_key
      await api.updateTenant(editing, data)
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
                <input className={inp} value={editData.name} onChange={e => setEditData(d => ({ ...d, name: e.target.value }))} required disabled={!isSuperAdmin} />
              </div>
              <div className="mb-3">
                <label className="block text-xs font-medium text-muted mb-1">Slug</label>
                <input className={inp} value={editData.slug} onChange={e => setEditData(d => ({ ...d, slug: e.target.value }))} required disabled={!isSuperAdmin} />
                {!isSuperAdmin && <p className="text-[10px] text-muted mt-0.5">Only super admins can change the slug</p>}
              </div>
              <div className="mb-4">
                <label className="block text-xs font-medium text-muted mb-1">Target URL</label>
                <input className={inp} value={editData.target_url} onChange={e => setEditData(d => ({ ...d, target_url: e.target.value }))} placeholder="https://book.example.com" />
              </div>

              <hr className="my-4 border-border" />
              <h3 className="font-serif text-base mb-3">Email Notifications</h3>

              <div className="mb-3 flex items-center gap-2">
                <input type="checkbox" id="notify_enabled" checked={editData.notify_enabled} onChange={e => setEditData(d => ({ ...d, notify_enabled: e.target.checked }))} />
                <label htmlFor="notify_enabled" className="text-xs">Enable email reminders for scheduled posts</label>
              </div>

              {editData.notify_enabled && (
                <>
                  <div className="mb-3">
                    <label className="block text-xs font-medium text-muted mb-1">Notification email (or carrier SMS gateway)</label>
                    <input className={inp} value={editData.notify_email} onChange={e => setEditData(d => ({ ...d, notify_email: e.target.value }))} placeholder="you@example.com or 5551234567@vtext.com" />
                  </div>
                  <div className="mb-3">
                    <label className="block text-xs font-medium text-muted mb-1">Remind before</label>
                    <select className={inp} value={editData.notify_minutes_before} onChange={e => setEditData(d => ({ ...d, notify_minutes_before: parseInt(e.target.value) }))}>
                      <option value={5}>5 minutes</option>
                      <option value={10}>10 minutes</option>
                      <option value={15}>15 minutes</option>
                      <option value={30}>30 minutes</option>
                      <option value={60}>1 hour</option>
                    </select>
                  </div>
                  <div className="mb-3">
                    <label className="block text-xs font-medium text-muted mb-1">Email provider</label>
                    <select className={inp} value={editData.email_provider} onChange={e => setEditData(d => ({ ...d, email_provider: e.target.value }))}>
                      <option value="smtp">SMTP</option>
                      <option value="sendgrid">SendGrid</option>
                      <option value="resend">Resend</option>
                    </select>
                  </div>

                  {editData.email_provider === 'smtp' && (
                    <>
                      <div className="mb-2">
                        <label className="block text-xs font-medium text-muted mb-1">SMTP Host</label>
                        <input className={inp} value={editData.smtp_host} onChange={e => setEditData(d => ({ ...d, smtp_host: e.target.value }))} placeholder="smtp.gmail.com" />
                      </div>
                      <div className="mb-2 flex gap-2">
                        <div className="flex-1">
                          <label className="block text-xs font-medium text-muted mb-1">Port</label>
                          <input className={inp} type="number" value={editData.smtp_port} onChange={e => setEditData(d => ({ ...d, smtp_port: parseInt(e.target.value) }))} />
                        </div>
                        <div className="flex-1">
                          <label className="block text-xs font-medium text-muted mb-1">Username</label>
                          <input className={inp} value={editData.smtp_username} onChange={e => setEditData(d => ({ ...d, smtp_username: e.target.value }))} />
                        </div>
                      </div>
                      <div className="mb-2">
                        <label className="block text-xs font-medium text-muted mb-1">Password (leave blank to keep current)</label>
                        <input className={inp} type="password" value={editData.smtp_password} onChange={e => setEditData(d => ({ ...d, smtp_password: e.target.value }))} />
                      </div>
                      <div className="mb-3">
                        <label className="block text-xs font-medium text-muted mb-1">From email</label>
                        <input className={inp} value={editData.smtp_from_email} onChange={e => setEditData(d => ({ ...d, smtp_from_email: e.target.value }))} placeholder="noreply@yourdomain.com" />
                      </div>
                    </>
                  )}

                  {editData.email_provider === 'sendgrid' && (
                    <>
                      <div className="mb-2">
                        <label className="block text-xs font-medium text-muted mb-1">SendGrid API Key (leave blank to keep current)</label>
                        <input className={inp} type="password" value={editData.sendgrid_api_key} onChange={e => setEditData(d => ({ ...d, sendgrid_api_key: e.target.value }))} />
                      </div>
                      <div className="mb-3">
                        <label className="block text-xs font-medium text-muted mb-1">From email</label>
                        <input className={inp} value={editData.smtp_from_email} onChange={e => setEditData(d => ({ ...d, smtp_from_email: e.target.value }))} placeholder="noreply@yourdomain.com" />
                      </div>
                    </>
                  )}

                  {editData.email_provider === 'resend' && (
                    <>
                      <div className="mb-2">
                        <label className="block text-xs font-medium text-muted mb-1">Resend API Key (leave blank to keep current)</label>
                        <input className={inp} type="password" value={editData.resend_api_key} onChange={e => setEditData(d => ({ ...d, resend_api_key: e.target.value }))} />
                      </div>
                      <div className="mb-3">
                        <label className="block text-xs font-medium text-muted mb-1">From email</label>
                        <input className={inp} value={editData.smtp_from_email} onChange={e => setEditData(d => ({ ...d, smtp_from_email: e.target.value }))} placeholder="noreply@yourdomain.com" />
                      </div>
                    </>
                  )}
                  {editData.notify_email && (
                    <NotificationTestButton notifyEmail={editData.notify_email} />
                  )}
                </>
              )}

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
            <div key={t.id} className="py-2.5 px-3 border border-border rounded hover:bg-cream">
              <div className="text-[13px] font-medium">{t.name}</div>
              <div className="text-[11px] text-muted mb-2">{t.slug}</div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <a href={`/t/${t.slug}`} className="text-sage hover:text-[#3a5a40]" title={`Open /t/${t.slug}`}>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 3H3v10h10v-3M9 2h5v5M14 2L7 9" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </a>
                <Badge type={t.is_active ? 'green' : 'red'}>{t.is_active ? 'Active' : 'Inactive'}</Badge>
                {(isSuperAdmin || t.id === currentUser?.tenant_id) && (
                  <button onClick={() => startEdit(t)} className="text-[10px] py-1 px-2 border border-border rounded bg-transparent cursor-pointer font-sans hover:bg-cream">Edit</button>
                )}
                {isSuperAdmin && t.is_active && (
                  <button onClick={() => handleDeactivate(t.id)} className="text-[10px] py-1 px-2 border border-border rounded bg-transparent cursor-pointer font-sans hover:bg-cream text-[#c0392b]">Off</button>
                )}
              </div>
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
  const [editing, setEditing] = useState(null)
  const [editData, setEditData] = useState({})

  const inp = "w-full py-2 px-3 border border-[#ddd] rounded text-[13px] font-sans focus:outline-none focus:border-sage"

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

  const handleReactivate = async (id) => {
    try {
      await api.updateUser(id, { is_active: true })
      onRefresh()
    } catch (err) { setError(err.message) }
  }

  const startEditUser = (u) => {
    setEditing(u.id)
    setEditData({ email: u.email, role: u.role, tenant_id: u.tenant_id || '', password: '' })
  }

  const handleSaveUser = async (e) => {
    e.preventDefault()
    setError('')
    try {
      const data = { email: editData.email, role: editData.role }
      if (isSuperAdmin) data.tenant_id = editData.tenant_id || null
      if (editData.password) data.password = editData.password
      await api.updateUser(editing, data)
      setEditing(null)
      onRefresh()
    } catch (err) { setError(err.message) }
  }

  return (
    <>
      {/* Edit user modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div className="bg-white rounded-lg shadow-lg w-full max-w-[480px] p-6" onClick={e => e.stopPropagation()}>
            <h2 className="font-serif text-xl mb-4">Edit User</h2>
            <form onSubmit={handleSaveUser}>
              <div className="mb-3">
                <label className="block text-xs font-medium text-muted mb-1">Email</label>
                <input type="email" className={inp} value={editData.email} onChange={e => setEditData(d => ({ ...d, email: e.target.value }))} required />
              </div>
              <div className="mb-3">
                <label className="block text-xs font-medium text-muted mb-1">New password (leave blank to keep current)</label>
                <input type="password" className={inp} value={editData.password} onChange={e => setEditData(d => ({ ...d, password: e.target.value }))} minLength={8} placeholder="Enter new password" />
              </div>
              <div className="mb-3">
                <label className="block text-xs font-medium text-muted mb-1">Role</label>
                <select className={inp} value={editData.role} onChange={e => setEditData(d => ({ ...d, role: e.target.value }))}>
                  <option value="tenant_admin">Tenant Admin</option>
                  <option value="tenant_user">Tenant User</option>
                  {isSuperAdmin && <option value="super_admin">Super Admin</option>}
                </select>
              </div>
              {isSuperAdmin && (
                <div className="mb-4">
                  <label className="block text-xs font-medium text-muted mb-1">Tenant</label>
                  <select className={inp} value={editData.tenant_id || ''} onChange={e => setEditData(d => ({ ...d, tenant_id: e.target.value }))}>
                    <option value="">-- None --</option>
                    {tenants.filter(t => t.is_active).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              )}
              {error && <p className="text-[#c0392b] text-[13px] mb-3">{error}</p>}
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => setEditing(null)} className="py-2 px-4 border border-border rounded text-[13px] font-sans cursor-pointer bg-transparent hover:bg-cream">Cancel</button>
                <button type="submit" className="py-2 px-4 bg-sage text-white border-none rounded text-[13px] font-semibold cursor-pointer font-sans hover:bg-[#4a6650]">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="bg-white rounded shadow-sm border border-border p-4 md:p-6 mb-5">
        <h2 className="font-serif text-xl mb-4">Create User</h2>
        <form onSubmit={handleCreate}>
          <div className="flex gap-3 mb-3.5 flex-wrap">
            <div className="flex-1 min-w-[180px]">
              <label className="block text-xs font-medium text-muted mb-1">Email</label>
              <input type="email" className={inp} value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            <div className="flex-1 min-w-[180px]">
              <label className="block text-xs font-medium text-muted mb-1">Password</label>
              <input type="password" className={inp} value={password} onChange={e => setPassword(e.target.value)} required minLength={8} />
            </div>
          </div>
          <div className="flex gap-3 mb-3.5 flex-wrap">
            <div className="flex-1 min-w-[180px]">
              <label className="block text-xs font-medium text-muted mb-1">Role</label>
              <select className={inp} value={role} onChange={e => setRole(e.target.value)}>
                <option value="tenant_admin">Tenant Admin</option>
                <option value="tenant_user">Tenant User</option>
                {isSuperAdmin && <option value="super_admin">Super Admin</option>}
              </select>
            </div>
            <div className="flex-1 min-w-[180px]">
              <label className="block text-xs font-medium text-muted mb-1">Tenant</label>
              <select className={inp} value={tenantId} onChange={e => setTenantId(e.target.value)}>
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
                <td className="py-2.5 px-3 border-b border-[#f0ebe3] space-x-1">
                  <button onClick={() => startEditUser(u)} className="text-xs py-1 px-2.5 border border-border rounded bg-transparent cursor-pointer font-sans hover:bg-cream">Edit</button>
                  {u.is_active
                    ? <button onClick={() => handleDeactivate(u.id)} className="text-xs py-1 px-2.5 border border-border rounded bg-transparent cursor-pointer font-sans hover:bg-cream text-[#c0392b]">Deactivate</button>
                    : <button onClick={() => handleReactivate(u.id)} className="text-xs py-1 px-2.5 border border-border rounded bg-transparent cursor-pointer font-sans hover:bg-cream text-[#3a6b42]">Reactivate</button>
                  }
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

function NotificationTestButton({ notifyEmail }) {
  const [testing, setTesting] = useState(false)
  const [status, setStatus] = useState('')

  const sendTest = async () => {
    setTesting(true)
    setStatus('')
    try {
      await api.testNotificationEmail()
      setStatus(`✓ Sent to ${notifyEmail}`)
    } catch (err) {
      setStatus(`✗ ${err.message}`)
    }
    setTesting(false)
    setTimeout(() => setStatus(''), 8000)
  }

  return (
    <div className="mb-3 flex items-center gap-2 flex-wrap">
      <button
        type="button"
        onClick={sendTest}
        disabled={testing}
        className="text-xs py-1.5 px-3 border border-[#6C5CE7] text-[#6C5CE7] rounded bg-white cursor-pointer hover:bg-[#f3f0ff] disabled:opacity-50"
      >{testing ? 'Sending...' : 'Send test email'}</button>
      {status && (
        <span className={`text-xs ${status.startsWith('✓') ? 'text-[#2D9A5E]' : 'text-[#c0392b]'}`}>{status}</span>
      )}
      <span className="text-[10px] text-muted">Save settings first if you changed them</span>
    </div>
  )
}
