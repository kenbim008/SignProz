import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'About Us - SignProz',
  description: 'Learn about SignProz and our mission.',
}

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <header className="bg-white/80 backdrop-blur-md border-b sticky top-0 z-30">
        <nav className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap justify-between items-center gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Link href="/" className="flex items-center gap-2 cursor-pointer">
              <div className="bg-gradient-to-r from-blue-600 to-indigo-700 w-9 h-9 rounded-xl flex items-center justify-center shadow">
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </div>
              <span className="font-bold text-xl tracking-tight"><span className="text-blue-600">Sign</span><span className="text-indigo-600">Proz</span></span>
            </Link>
            <Link href="/affiliate" className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full hover:bg-green-200 font-medium">Affiliate Program</Link>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <Link href="/" className="text-gray-600 hover:text-blue-600 text-sm font-medium">Home</Link>
            <Link href="/pricing" className="text-gray-600 hover:text-blue-600 text-sm font-medium">Pricing</Link>
            <Link href="/templates" className="text-gray-600 hover:text-blue-600 text-sm font-medium">Templates</Link>
            <Link href="/login" className="text-gray-600 hover:text-blue-600 text-sm font-medium">Sign In</Link>
            <Link href="/signup" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">Start Free</Link>
          </div>
        </nav>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-16">
        <h1 className="text-4xl font-bold text-slate-900 mb-8">About SignProz</h1>
        <div className="prose prose-slate max-w-none space-y-6 text-slate-600">
          <p className="text-lg leading-relaxed">SignProz is a modern eSignature platform built for teams who need to send, sign, and track agreements at scale — without the enterprise complexity.</p>
          <p>We believe signing should be effortless. Whether you&apos;re a freelancer sending an NDA or a sales team closing deals, SignProz gives you the tools to move faster while staying compliant.</p>
          <p>Our affiliate program lets anyone earn recurring commissions by referring new users. It&apos;s our way of growing together.</p>
          <h2 className="text-2xl font-bold text-slate-900 mt-10 mb-4">Our values</h2>
          <ul className="space-y-3">
            <li className="flex items-start gap-3">
              <svg className="w-5 h-5 text-blue-600 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              <span><strong>Security first</strong> — end-to-end encryption, audit trails, and data encryption for sensitive workflows.</span>
            </li>
            <li className="flex items-start gap-3">
              <svg className="w-5 h-5 text-blue-600 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              <span><strong>Fair pricing</strong> — transparent tiers, no surprise charges. Start free, scale as you grow.</span>
            </li>
            <li className="flex items-start gap-3">
              <svg className="w-5 h-5 text-blue-600 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              <span><strong>Partner-first</strong> — our affiliate program pays 20-30% recurring. When you win, we win.</span>
            </li>
            <li className="flex items-start gap-3">
              <svg className="w-5 h-5 text-blue-600 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              <span><strong>Built for integrations</strong> — 400+ integrations, native PDF editing, and an affordable API.</span>
            </li>
          </ul>
          <h2 className="text-2xl font-bold text-slate-900 mt-10 mb-4">Contact</h2>
          <p>Questions? Reach us at <a href="mailto:support@signproz.com" className="text-blue-600 hover:underline">support@signproz.com</a></p>
        </div>
      </main>

      <footer className="bg-white border-t mt-12">
        <div className="max-w-7xl mx-auto px-4 py-6 text-xs text-gray-500 flex flex-col sm:flex-row flex-wrap justify-between items-start sm:items-center gap-4">
          <div>© 2026 SignProz Inc. | Earn 20-30% recurring affiliate commissions</div>
          <nav className="flex flex-wrap gap-x-5 gap-y-2 items-center" aria-label="Footer">
            <Link href="/affiliate" className="text-blue-600 font-medium hover:text-blue-800">Affiliate program</Link>
            <Link href="/demo" className="text-blue-600 font-medium hover:text-blue-800">Demo</Link>
            <span className="hidden sm:inline text-gray-300" aria-hidden="true">|</span>
            <Link href="/about" className="hover:text-blue-600">About Us</Link>
            <Link href="/privacy" className="hover:text-blue-600">Privacy Policy</Link>
            <Link href="/terms" className="hover:text-blue-600">Terms &amp; Conditions</Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}
