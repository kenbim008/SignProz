import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Privacy Policy - SignProz',
  description: 'SignProz privacy policy.',
}

export default function PrivacyPage() {
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
        <Link href="/" className="text-sm text-blue-600 hover:text-blue-800 mb-6 inline-block">← Back to home</Link>
        <h1 className="text-4xl font-bold text-slate-900 mb-2">Privacy Policy</h1>
        <p className="text-sm text-slate-500 mb-10">Last updated: April 22, 2026</p>
        <div className="text-slate-700 space-y-8 text-base leading-relaxed">
          <section><h2 className="text-xl font-semibold text-slate-900 mt-8 mb-3">1. Information We Collect</h2><p>SignProz collects information you provide directly, including your name, email address, and organization details when you create an account. We also collect document content you upload and metadata about your signing activities.</p></section>
          <section><h2 className="text-xl font-semibold text-slate-900 mt-8 mb-3">2. How We Use Your Information</h2><p>We use your information to provide and improve our services, process transactions, send you relevant notifications, and ensure platform security. We never sell your personal data to third parties.</p></section>
          <section><h2 className="text-xl font-semibold text-slate-900 mt-8 mb-3">3. Data Security</h2><p>SignProz uses end-to-end encryption, role-based access controls, and audit logging to protect your data. All data is encrypted in transit via TLS.</p></section>
          <section><h2 className="text-xl font-semibold text-slate-900 mt-8 mb-3">4. Cookies</h2><p>We use cookies and similar technologies to maintain sessions, remember your preferences, and analyze platform usage. You can manage your cookie preferences in your account settings.</p></section>
          <section><h2 className="text-xl font-semibold text-slate-900 mt-8 mb-3">5. Third-Party Services</h2><p>SignProz integrates with third-party services such as cloud storage providers, CRM platforms, and payment processors. Each third party has its own privacy policy governing their use of your data.</p></section>
          <section><h2 className="text-xl font-semibold text-slate-900 mt-8 mb-3">6. Your Rights</h2><p>Depending on your jurisdiction, you may have the right to access, correct, or delete your personal data. Contact us at <a href="mailto:privacy@signproz.com" className="text-blue-600 hover:underline">privacy@signproz.com</a> to exercise these rights.</p></section>
          <section><h2 className="text-xl font-semibold text-slate-900 mt-8 mb-3">7. Changes to This Policy</h2><p>We may update this privacy policy from time to time. Any material changes will be communicated via email or a notice on the platform prior to their effective date.</p></section>
          <section><h2 className="text-xl font-semibold text-slate-900 mt-8 mb-3">8. Contact</h2><p>For privacy-related questions, contact our Data Protection Officer at <a href="mailto:privacy@signproz.com" className="text-blue-600 hover:underline">privacy@signproz.com</a>.</p></section>
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
