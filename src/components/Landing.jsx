import { useState, useRef } from 'react'
import { Helmet } from 'react-helmet-async'
import * as api from '../api'

export default function Landing({ onSignIn }) {
  const [email, setEmail] = useState('')
  const [plan, setPlan] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState(null)
  const signupRef = useRef(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    const trimmed = email.trim()
    if (!trimmed) { setError('Please enter your email.'); return }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError('Please enter a valid email address.')
      return
    }
    setSubmitting(true)
    try {
      const r = await api.publicSignup(trimmed, plan || undefined)
      if (r.error) {
        setError(r.error)
      } else {
        setSubmitted(true)
      }
    } catch (err) {
      setError('Something went wrong. Please try again.')
    }
    setSubmitting(false)
  }

  const scrollToSignup = (selectedPlan) => {
    if (selectedPlan) setPlan(selectedPlan)
    if (signupRef.current) {
      signupRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
      // Focus the email input after the scroll
      setTimeout(() => {
        const input = signupRef.current?.querySelector('input[type="email"]')
        if (input) input.focus()
      }, 500)
    }
  }

  return (
    <>
      <Helmet>
        <title>Postyposty – Social Media Automation for Local Businesses</title>
        <meta name="description" content="Postyposty helps local businesses streamline their social media presence across every major platform. Save time, stay consistent, and grow your reach." />
        <link rel="canonical" href="https://postyposty.com" />
        <meta property="og:title" content="Postyposty – Social Media Automation for Local Businesses" />
        <meta property="og:description" content="Streamline your social media across every major platform. Built for local businesses that want to save time and stay consistent." />
        <meta property="og:url" content="https://postyposty.com" />
        <meta property="og:type" content="website" />
        <meta property="og:image" content="https://postyposty.com/icons/icon-192.svg" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Postyposty – Social Media Automation for Local Businesses" />
        <meta name="twitter:description" content="Streamline your social media across every major platform." />
      </Helmet>

      <div className="bg-cream text-ink min-h-screen flex flex-col">
        {/* ── Header / Nav ── */}
        <header className="border-b border-border bg-white">
          <nav className="max-w-6xl mx-auto px-5 md:px-8 py-4 flex items-center justify-between" aria-label="Main navigation">
            <a href="/" className="flex items-center gap-2 no-underline">
              <img src="/icons/icon-192.svg" alt="Postyposty logo" className="w-8 h-8" />
              <span className="font-serif text-xl text-ink">Postyposty</span>
            </a>
            <ul className="hidden md:flex items-center gap-8 text-sm text-muted list-none m-0 p-0">
              <li><a href="#how-it-works" className="text-muted hover:text-ink no-underline">How It Works</a></li>
              <li><a href="#pricing" className="text-muted hover:text-ink no-underline">Pricing</a></li>
              <li><a href="mailto:hello@postyposty.com" className="text-muted hover:text-ink no-underline">Contact</a></li>
            </ul>
            <button
              onClick={onSignIn}
              className="text-xs md:text-sm py-2 px-4 bg-ink text-white border-none rounded-sm cursor-pointer font-sans font-medium hover:bg-[#333]"
            >
              Sign in
            </button>
          </nav>
        </header>

        <main className="flex-1">
          {/* ── Hero ── */}
          <section className="max-w-5xl mx-auto px-5 md:px-8 py-16 md:py-24 text-center" aria-labelledby="hero-heading">
            <h1 id="hero-heading" className="font-serif text-4xl md:text-6xl leading-tight text-ink mb-4">
              Social media automation for local businesses
            </h1>
            <p className="text-base md:text-lg text-muted max-w-2xl mx-auto mb-8 leading-relaxed">
              Postyposty helps local businesses stay consistent across every major social platform. One tool. Every account. Less time.
            </p>

            {/* Signup form — inline in hero */}
            <div ref={signupRef} className="max-w-md mx-auto" id="signup">
              {submitted ? (
                <div className="bg-white border border-sage rounded-sm p-5 text-center" role="status" aria-live="polite">
                  <div className="w-10 h-10 rounded-full bg-sage-light text-sage flex items-center justify-center mx-auto mb-2 text-xl">✓</div>
                  <p className="font-serif text-xl text-ink mb-1">You're on the list!</p>
                  <p className="text-sm text-muted">We'll email you shortly at <strong>{email}</strong>.</p>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2" aria-labelledby="signup-label">
                  <label htmlFor="signup-email" id="signup-label" className="sr-only">Email address</label>
                  <input
                    id="signup-email"
                    type="email"
                    required
                    value={email}
                    onChange={e => { setEmail(e.target.value); setError(null) }}
                    placeholder="Your email address"
                    className="flex-1 py-3 px-4 border border-border rounded-sm bg-white text-sm focus:outline-none focus:border-sage"
                    autoComplete="email"
                  />
                  <button
                    type="submit"
                    disabled={submitting}
                    className="py-3 px-6 bg-sage text-white border-none rounded-sm cursor-pointer font-sans font-medium hover:bg-[#4a6450] disabled:opacity-50 text-sm whitespace-nowrap"
                  >
                    {submitting ? 'Submitting...' : 'Get Started'}
                  </button>
                </form>
              )}
              {error && <p className="text-[#c0392b] text-xs mt-2">{error}</p>}
              {!submitted && plan && <p className="text-xs text-sage mt-2">Selected plan: <strong>{plan}</strong></p>}
            </div>
          </section>

          {/* ── How It Works ── */}
          <section id="how-it-works" className="bg-white border-y border-border py-16 md:py-20" aria-labelledby="how-heading">
            <div className="max-w-5xl mx-auto px-5 md:px-8">
              <h2 id="how-heading" className="font-serif text-3xl md:text-4xl text-center text-ink mb-12">
                How It Works
              </h2>
              <div className="grid md:grid-cols-3 gap-8">
                <article className="text-center">
                  <div className="w-12 h-12 rounded-full bg-sage-light text-sage flex items-center justify-center mx-auto mb-4 text-xl font-serif">1</div>
                  <h3 className="font-serif text-xl text-ink mb-2">Connect your accounts</h3>
                  <p className="text-sm text-muted leading-relaxed">
                    Link your social media profiles in a few clicks. We support the platforms local businesses rely on most.
                  </p>
                </article>
                <article className="text-center">
                  <div className="w-12 h-12 rounded-full bg-sage-light text-sage flex items-center justify-center mx-auto mb-4 text-xl font-serif">2</div>
                  <h3 className="font-serif text-xl text-ink mb-2">Upload your content</h3>
                  <p className="text-sm text-muted leading-relaxed">
                    Add your photos and videos. Postyposty helps you prepare everything for sharing.
                  </p>
                </article>
                <article className="text-center">
                  <div className="w-12 h-12 rounded-full bg-sage-light text-sage flex items-center justify-center mx-auto mb-4 text-xl font-serif">3</div>
                  <h3 className="font-serif text-xl text-ink mb-2">Publish everywhere</h3>
                  <p className="text-sm text-muted leading-relaxed">
                    Post to all your platforms at once, or schedule for later. Stay consistent without the manual work.
                  </p>
                </article>
              </div>
            </div>
          </section>

          {/* ── Pricing ── */}
          <section id="pricing" className="py-16 md:py-20" aria-labelledby="pricing-heading">
            <div className="max-w-5xl mx-auto px-5 md:px-8">
              <h2 id="pricing-heading" className="font-serif text-3xl md:text-4xl text-center text-ink mb-3">
                Simple Pricing
              </h2>
              <p className="text-center text-muted text-base mb-12">Choose the plan that fits your business.</p>
              <div className="grid md:grid-cols-3 gap-6">
                {/* Starter */}
                <article className="bg-white border border-border rounded-sm p-8 flex flex-col text-center">
                  <h3 className="font-serif text-2xl text-ink mb-2">Starter</h3>
                  <div className="mb-6">
                    <span className="font-serif text-5xl text-ink">$19</span>
                    <span className="text-muted text-sm">/mo</span>
                  </div>
                  <button
                    onClick={() => scrollToSignup('Starter')}
                    className="mt-auto py-2.5 px-4 border border-border bg-white text-ink rounded-sm cursor-pointer font-sans font-medium hover:bg-cream text-sm"
                  >
                    Get Started
                  </button>
                </article>

                {/* Growth */}
                <article className="bg-white border-2 border-sage rounded-sm p-8 flex flex-col text-center relative md:-mt-3 md:mb-[-12px]">
                  <span className="absolute top-0 right-0 bg-sage text-white text-[10px] font-medium px-2 py-1 rounded-bl-sm rounded-tr-sm">POPULAR</span>
                  <h3 className="font-serif text-2xl text-ink mb-2">Growth</h3>
                  <div className="mb-6">
                    <span className="font-serif text-5xl text-ink">$49</span>
                    <span className="text-muted text-sm">/mo</span>
                  </div>
                  <button
                    onClick={() => scrollToSignup('Growth')}
                    className="mt-auto py-2.5 px-4 bg-sage text-white border-none rounded-sm cursor-pointer font-sans font-medium hover:bg-[#4a6450] text-sm"
                  >
                    Get Started
                  </button>
                </article>

                {/* Agency */}
                <article className="bg-white border border-border rounded-sm p-8 flex flex-col text-center">
                  <h3 className="font-serif text-2xl text-ink mb-2">Agency</h3>
                  <div className="mb-6">
                    <span className="font-serif text-5xl text-ink">$99</span>
                    <span className="text-muted text-sm">/mo</span>
                  </div>
                  <button
                    onClick={() => scrollToSignup('Agency')}
                    className="mt-auto py-2.5 px-4 border border-border bg-white text-ink rounded-sm cursor-pointer font-sans font-medium hover:bg-cream text-sm"
                  >
                    Get Started
                  </button>
                </article>
              </div>
            </div>
          </section>

          {/* ── CTA ── */}
          <section className="bg-white border-y border-border py-16" aria-labelledby="cta-heading">
            <div className="max-w-3xl mx-auto px-5 md:px-8 text-center">
              <h2 id="cta-heading" className="font-serif text-3xl md:text-4xl text-ink mb-4">Ready to get started?</h2>
              <p className="text-muted mb-8">Join local businesses already saving hours every week.</p>
              <button
                onClick={() => scrollToSignup('')}
                className="text-sm py-3 px-8 bg-sage text-white border-none rounded-sm cursor-pointer font-sans font-medium hover:bg-[#4a6450]"
              >
                Get Started
              </button>
            </div>
          </section>
        </main>

        {/* ── Footer ── */}
        <footer className="bg-cream border-t border-border">
          <div className="max-w-6xl mx-auto px-5 md:px-8 py-8 md:py-10">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <img src="/icons/icon-192.svg" alt="Postyposty logo" className="w-6 h-6" />
                  <span className="font-serif text-lg text-ink">Postyposty</span>
                </div>
                <address className="text-xs text-muted not-italic leading-relaxed">
                  16687 Church Street<br />
                  Menomonee Falls, WI 53051<br />
                  <a href="mailto:hello@postyposty.com" className="text-muted hover:text-ink no-underline">hello@postyposty.com</a>
                </address>
              </div>
              <nav aria-label="Footer navigation">
                <ul className="flex flex-col md:flex-row gap-3 md:gap-6 text-xs list-none m-0 p-0">
                  <li><a href="#how-it-works" className="text-muted hover:text-ink no-underline">How It Works</a></li>
                  <li><a href="#pricing" className="text-muted hover:text-ink no-underline">Pricing</a></li>
                  <li><a href="mailto:hello@postyposty.com" className="text-muted hover:text-ink no-underline">Contact</a></li>
                  <li><a href="/privacy.html" className="text-muted hover:text-ink no-underline">Privacy</a></li>
                  <li><a href="/terms.html" className="text-muted hover:text-ink no-underline">Terms</a></li>
                </ul>
              </nav>
            </div>
            <div className="mt-6 pt-6 border-t border-border text-xs text-muted text-center">
              Postyposty | 16687 Church Street, Menomonee Falls, WI 53051 | <a href="mailto:hello@postyposty.com" className="text-muted hover:text-ink no-underline">hello@postyposty.com</a>
            </div>
            <p className="mt-4 text-center text-[10px] text-muted">© {new Date().getFullYear()} Postyposty. All rights reserved.</p>
          </div>
        </footer>
      </div>
    </>
  )
}
