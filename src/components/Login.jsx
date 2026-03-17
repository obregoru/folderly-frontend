import { useState } from 'react'
import * as api from '../api'

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const data = await api.login(email, password)
      if (data.error) {
        setError(data.error)
      } else {
        onLogin(data)
      }
    } catch (err) {
      setError('Login failed')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-cream">
      <div className="bg-white rounded p-12 w-full max-w-[400px] shadow-[0_2px_16px_rgba(0,0,0,.08)]">
        <h1 className="font-serif text-[28px] text-center mb-2">Posty Posty</h1>
        <p className="text-muted text-sm text-center mb-8">Sign in to your account</p>

        {error && (
          <div className="bg-[#fdeaea] text-[#c0392b] py-2.5 px-3.5 rounded text-[13px] mb-4">{error}</div>
        )}

        <form onSubmit={handleSubmit}>
          <label className="block text-[13px] font-medium text-[#555] mb-1.5">Email</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            autoComplete="email"
            className="w-full py-2.5 px-3.5 border border-[#ddd] rounded text-sm font-sans mb-5 focus:outline-none focus:border-sage"
          />

          <label className="block text-[13px] font-medium text-[#555] mb-1.5">Password</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            className="w-full py-2.5 px-3.5 border border-[#ddd] rounded text-sm font-sans mb-5 focus:outline-none focus:border-sage"
          />

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-sage text-white border-none rounded text-[15px] font-semibold cursor-pointer font-sans hover:bg-[#4a6650] disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
