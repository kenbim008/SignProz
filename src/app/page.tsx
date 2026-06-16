'use client'

import { useState } from 'react'
import Link from 'next/link'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCheckCircle, faFileSignature, faRobot, faHandHoldingUsd, faScaleBalanced, faLayerGroup, faComments, faCommentDots } from '@fortawesome/free-solid-svg-icons'
import { AiFaqModal } from '@/components/modals'

const keyFeatures = [
  'Document Workspace',
  'Recurring Affiliate Rewards (20-30%)',
  'Custom Branding',
  'Signing Links',
  'Privacy & Compliance',
  'API Access',
  'AI-Assisted Agreements',
  'SMS Delivery',
  'Native PDF Editing',
  'Microsoft 365 (Coming soon)',
  'Mobile App (Coming soon)',
  'CRM Integration (Coming soon)',
  'Interactive Pricing Tables',
  'Payments (Coming soon)',
  'Bulk Sending (Coming soon)',
  'Workflow Automation (Coming soon)',
  'Affordable API',
]

export default function HomePage() {
  const [faqOpen, setFaqOpen] = useState(false)

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-gray-100 font-sans">
      {/* Navigation */}
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
            <Link href="/login" className="text-gray-700 text-sm font-medium">Sign In</Link>
            <Link href="/signup" className="bg-blue-600 text-white px-4 py-1.5 rounded-full text-sm shadow hover:bg-blue-700">Start Free</Link>
          </div>
        </nav>
      </header>

      <main>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
          {/* Hero Section */}
          <section className="rounded-3xl border border-indigo-100 bg-gradient-to-br from-indigo-900 via-blue-900 to-slate-900 text-white p-8 sm:p-12 shadow-2xl">
            <div className="grid lg:grid-cols-12 gap-8 items-center">
              <div className="lg:col-span-7">
                <p className="text-xs uppercase tracking-[0.16em] text-indigo-200 font-semibold mb-3">Secure eSignature platform</p>
                <h1 className="text-4xl sm:text-5xl font-extrabold leading-tight tracking-tight">Professional agreement workflows for modern teams</h1>
                <p className="text-indigo-100 text-sm sm:text-base mt-4 max-w-2xl">SignProz helps you prepare, send, sign, and track agreements at scale while offering partner rewards and API-ready automation.</p>
                <div className="mt-7 flex flex-wrap gap-3">
                  <Link href="/signup" className="bg-white text-indigo-800 px-5 py-2.5 rounded-xl font-semibold text-sm shadow hover:bg-indigo-50">Start free trial</Link>
                  <Link href="/pricing" className="border border-white/30 bg-white/10 text-white px-5 py-2.5 rounded-xl font-semibold text-sm hover:bg-white/20">View pricing</Link>
                  <Link href="/templates" className="border border-white/30 bg-white/10 text-white px-5 py-2.5 rounded-xl font-semibold text-sm hover:bg-white/20">Explore templates</Link>
                  <button type="button" onClick={() => setFaqOpen(true)} className="border border-cyan-200/60 bg-cyan-400/20 text-cyan-50 px-5 py-2.5 rounded-xl font-semibold text-sm hover:bg-cyan-400/30">AI FAQ Chat</button>
                </div>
              </div>
              <div className="lg:col-span-5">
                <div className="rounded-2xl bg-white/10 border border-white/15 p-5">
                  <h3 className="font-semibold text-white mb-4">At a glance</h3>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-xl bg-white/10 p-3">
                      <p className="text-indigo-200 text-xs">Integrations</p>
                      <p className="font-bold text-lg">API</p>
                    </div>
                    <div className="rounded-xl bg-white/10 p-3">
                      <p className="text-indigo-200 text-xs">Affiliate reward</p>
                      <p className="font-bold text-lg">20-30%</p>
                    </div>
                    <div className="rounded-xl bg-white/10 p-3">
                      <p className="text-indigo-200 text-xs">Sending modes</p>
                      <p className="font-bold text-lg">SMS</p>
                    </div>
                    <div className="rounded-xl bg-white/10 p-3">
                      <p className="text-indigo-200 text-xs">Security</p>
                      <p className="font-bold text-lg">Privacy-first</p>
                    </div>
                  </div>
                  <p className="text-[11px] text-indigo-100 mt-4">Designed for sales, legal operations, HR, and customer onboarding teams.</p>
                </div>
              </div>
            </div>
          </section>

          {/* 3 Feature Cards */}
          <section className="mt-10 grid md:grid-cols-3 gap-4">
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
              <div className="w-9 h-9 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center">
                <FontAwesomeIcon icon={faFileSignature} className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-slate-900 mt-3">Document Workspace</h3>
              <p className="text-sm text-slate-600 mt-1">Build, route, and manage agreement packets with reusable templates and signing links.</p>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
              <div className="w-9 h-9 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center">
                <FontAwesomeIcon icon={faRobot} className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-slate-900 mt-3">AI-Assisted Agreements</h3>
              <p className="text-sm text-slate-600 mt-1">Speed up reviews and drafting with AI assistance for clauses, summaries, and templates.</p>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
              <div className="w-9 h-9 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center">
                <FontAwesomeIcon icon={faHandHoldingUsd} className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-slate-900 mt-3">Recurring Affiliate Rewards</h3>
              <p className="text-sm text-slate-600 mt-1">Earn ongoing commissions with transparent tiering and built-in referral analytics.</p>
            </div>
          </section>

          {/* Feature Comparison Table */}
          <section className="mt-10 bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
              <h2 className="text-xl font-bold text-slate-900">
                <span className="text-indigo-600 mr-2"><FontAwesomeIcon icon={faScaleBalanced} className="w-4 h-4" /></span>
                SignProz vs Popular eSignature Platforms
              </h2>
              <span className="text-xs text-slate-500">Feature and pricing comparison (high-level)</span>
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[860px] text-sm">
                <thead>
                  <tr className="bg-slate-50 text-slate-700">
                    <th className="p-3 text-left font-semibold">Platform</th>
                    <th className="p-3 text-left font-semibold">Entry pricing</th>
                    <th className="p-3 text-left font-semibold">AI assistance</th>
                    <th className="p-3 text-left font-semibold">Integrations</th>
                    <th className="p-3 text-left font-semibold">API access</th>
                    <th className="p-3 text-left font-semibold">Affiliate rewards</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr className="bg-blue-50/50">
                    <td className="p-3 font-semibold text-blue-800">SignProz</td>
                    <td className="p-3">$10/mo annual Pro ($20 monthly) &middot; Premium $39.95/mo annual</td>
                    <td className="p-3">Built-in AI agreement review + AI template generation</td>
                    <td className="p-3">API access</td>
                    <td className="p-3">Affordable API tiers</td>
                    <td className="p-3 text-emerald-700 font-semibold">20-30% recurring</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-medium">DocuSign</td>
                    <td className="p-3">Generally higher SMB entry plans</td>
                    <td className="p-3">Available in selected plans/add-ons</td>
                    <td className="p-3">Broad enterprise ecosystem</td>
                    <td className="p-3">Yes</td>
                    <td className="p-3">Not core positioning</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-medium">Dropbox Sign (HelloSign)</td>
                    <td className="p-3">Mid-market monthly tiers</td>
                    <td className="p-3">Limited AI-first positioning</td>
                    <td className="p-3">Strong SMB integrations</td>
                    <td className="p-3">Yes</td>
                    <td className="p-3">Not standard</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-medium">Adobe Acrobat Sign</td>
                    <td className="p-3">Enterprise-oriented pricing</td>
                    <td className="p-3">Adobe AI capabilities in broader suite</td>
                    <td className="p-3">Adobe + Microsoft ecosystem</td>
                    <td className="p-3">Yes</td>
                    <td className="p-3">Not standard</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-medium">PandaDoc</td>
                    <td className="p-3">Document workflow focused tiers</td>
                    <td className="p-3">Template/content automation features</td>
                    <td className="p-3">Sales-focused integrations</td>
                    <td className="p-3">Yes</td>
                    <td className="p-3">Partner program varies</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-medium">SignNow</td>
                    <td className="p-3">Competitive SMB pricing bands</td>
                    <td className="p-3">Automation-centric, lighter AI focus</td>
                    <td className="p-3">Business app connectors</td>
                    <td className="p-3">Yes</td>
                    <td className="p-3">Not core positioning</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-slate-500 mt-3">Note: competitor details are directional and can vary by edition, region, and contract terms.</p>
          </section>

          {/* Key Features Grid */}
          <section className="mt-10 bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
              <h2 className="text-xl font-bold text-slate-900">
                <span className="text-indigo-600 mr-2"><FontAwesomeIcon icon={faLayerGroup} className="w-4 h-4" /></span>
                Key Features
              </h2>
              <span className="text-xs text-slate-500">Production-ready capabilities</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {keyFeatures.map((f) => (
                <span key={f} className="feature-pill">
                  <FontAwesomeIcon icon={faCheckCircle} className="w-3.5 h-3.5" />
                  {f}
                </span>
              ))}
            </div>
          </section>

          {/* AI FAQ Section */}
          <section className="mt-10 bg-gradient-to-r from-indigo-50 to-blue-50 border border-indigo-100 rounded-2xl p-6 shadow-sm">
            <div className="flex flex-wrap justify-between gap-4 items-start">
              <div>
                <h3 className="text-lg font-bold text-slate-900 mb-1">
                  <span className="text-indigo-600 mr-2"><FontAwesomeIcon icon={faComments} className="w-4 h-4" /></span>
                  AI Assisted Chatbot FAQ
                </h3>
                <p className="text-sm text-slate-600 max-w-2xl">Get quick, practical answers about integrations, compliance, API usage, pricing, and signing workflows.</p>
              </div>
              <button type="button" onClick={() => setFaqOpen(true)} className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-indigo-700">Open AI FAQ</button>
            </div>
          </section>
        </div>

        {/* AI FAQ Floating Bubble */}
        <button type="button" onClick={() => setFaqOpen(true)} className="home-faq-bubble">
          <FontAwesomeIcon icon={faCommentDots} className="w-3.5 h-3.5" style={{ display: 'inline', verticalAlign: 'middle', marginRight: '0.3rem' }} />
          AI FAQ
        </button>
      </main>

      <footer className="bg-white border-t mt-12">
        <div className="max-w-7xl mx-auto px-4 py-6 text-xs text-gray-500 flex flex-col sm:flex-row flex-wrap justify-between items-start sm:items-center gap-4">
          <div>&copy; 2026 SignProz Inc. | Earn 20-30% recurring affiliate commissions</div>
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
      <AiFaqModal isOpen={faqOpen} onClose={() => setFaqOpen(false)} />
    </div>
  )
}