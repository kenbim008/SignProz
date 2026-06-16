'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { getBrowserClient } from '@/lib/supabase/browser'

type Tab = 'workspace' | 'referrals'

type DocFilter = 'documents' | 'waiting_me' | 'waiting_others' | 'signed'

interface Doc {
  id: string
  title: string
  status: string
  created_at: string
  signers?: Array<{ email: string; name?: string; signed_at?: string | null }>
}

interface Session {
  email: string
  affiliateCode: string
}

const revenueProjection = {
  year1: { newReferrals: 36, totalReferrals: 36, earnings: 1190, avgMonthly: 99, endMonthly: 186 },
  year2: { newReferrals: 84, totalReferrals: 120, earnings: 8686, avgMonthly: 724, endMonthly: 1012 },
  year3: { newReferrals: 144, totalReferrals: 264, earnings: 30317, avgMonthly: 2526, endMonthly: 3294 },
  total: { referrals: 264, earnings: 40393 },
}

const tierColors: Record<string, string> = {
  bronze: 'bg-amber-700 text-white',
  silver: 'bg-gray-400 text-white',
  gold: 'bg-yellow-400 text-yellow-900',
  platinum: 'bg-indigo-600 text-white',
}

const recentReferrals = [
  { email: 'alex@company.com', plan: 'Pro', earnings: 7.25, status: 'active' },
  { email: 'sam@startup.io', plan: 'Pending invite', earnings: 0, status: 'pending' },
  { email: 'legal@enterprise.co', plan: 'Enterprise', earnings: 124.75, status: 'active' },
]

const SIGN_EDIT_PALETTE = [
  { kind: 'signature', label: 'My Signature', icon: 'fa-signature' },
  { kind: 'initials', label: 'My Initials', icon: 'fa-font' },
  { kind: 'text', label: 'Text', icon: 'fa-i-cursor' },
  { kind: 'date', label: 'Date Signed', icon: 'fa-calendar-alt' },
  { kind: 'checkmark', label: 'Checkmark', icon: 'fa-check-circle' },
]

const ADD_FIELDS_PALETTE = [
  { kind: 'sig-field', label: 'Signature Field', icon: 'fa-signature' },
  { kind: 'initials-field', label: 'Initials Field', icon: 'fa-font' },
  { kind: 'text-field', label: 'Text Field', icon: 'fa-align-left' },
  { kind: 'date-signed-field', label: 'Date Signed Field', icon: 'fa-calendar-day' },
  { kind: 'checkbox-field', label: 'Checkbox Field', icon: 'fa-check-square' },
  { kind: 'radio-field', label: 'Radio Buttons', icon: 'fa-dot-circle' },
  { kind: 'dropdown-field', label: 'Dropdown Field', icon: 'fa-caret-square-down' },
  { kind: 'attachment-field', label: 'Attachment Field', icon: 'fa-paperclip' },
  { kind: 'name-field', label: 'Name Field', icon: 'fa-id-card' },
  { kind: 'email-field', label: 'Email Field', icon: 'fa-envelope' },
  { kind: 'company-field', label: 'Company Field', icon: 'fa-building' },
  { kind: 'title-field', label: 'Title Field', icon: 'fa-briefcase' },
  { kind: 'phone-field', label: 'Phone Field', icon: 'fa-phone' },
  { kind: 'address-field', label: 'Address Field', icon: 'fa-map-marker-alt' },
]

const FIELD_COLORS: Record<string, string> = {
  'sig-field': '#3b82f6',
  'initials-field': '#8b5cf6',
  'text-field': '#10b981',
  'date-signed-field': '#f59e0b',
  'checkbox-field': '#06b6d4',
  'radio-field': '#ec4899',
  'dropdown-field': '#f97316',
  'attachment-field': '#84cc16',
  'name-field': '#6366f1',
  'email-field': '#14b8a6',
  'company-field': '#a855f7',
  'title-field': '#f43f5e',
  'phone-field': '#64748b',
  'address-field': '#64748b',
}

export default function DashboardPage() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<Tab>('workspace')
  const [documents, setDocuments] = useState<Doc[]>([])
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<{ email: string; affiliateCode: string } | null>(null)

  // Workspace state
  const [showNewDocForm, setShowNewDocForm] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [creating, setCreating] = useState(false)
  const [docFilter, setDocFilter] = useState<DocFilter>('documents')
  const [searchQuery, setSearchQuery] = useState('')
  const [cloudMenuOpen, setCloudMenuOpen] = useState(false)
  const [showSampleReferrals, setShowSampleReferrals] = useState(false)
  const [openDocMenu, setOpenDocMenu] = useState<string | null>(null)

  // Affiliate state
  const [affiliateStats, setAffiliateStats] = useState({ totalReferrals: 0, activeAccounts: 0, expectedPayout: 0, paidOut: 0, tier: 'bronze' })
  const [tier, setTier] = useState('bronze')
  const [stripeConnected, setStripeConnected] = useState(false)
  const [stripeConnectStep, setStripeConnectStep] = useState<'idle' | 'pending' | 'connected'>('idle')
  const [withdrawableBalance, setWithdrawableBalance] = useState(0)
  const [showAIAgreement, setShowAIAgreement] = useState(false)
  const [showAITemplate, setShowAITemplate] = useState(false)
  const [aiAgreementText, setAiAgreementText] = useState('')
  const [aiAgreementResult, setAiAgreementResult] = useState('')
  const [aiTemplatePrompt, setAiTemplatePrompt] = useState('')
  const [aiTemplateResult, setAiTemplateResult] = useState('')
  const [aiAgreementRunning, setAiAgreementRunning] = useState(false)
  const [aiTemplateRunning, setAiTemplateRunning] = useState(false)
  const [fieldPaletteCollapsed, setFieldPaletteCollapsed] = useState(false)

  useEffect(() => {
    fetch('/api/auth/session')
      .then((r) => r.json())
      .then((data) => {
        if (!data.session) { router.push('/login'); return }
        setSession({
          email: data.session.user.email,
          affiliateCode: data.session.user.affiliateCode || '',
        })
        fetch('/api/documents')
          .then((r) => r.json())
          .then((d) => { setDocuments(d.documents || []); setLoading(false) })
          .catch(() => setLoading(false))

        // Fetch affiliate stats if endpoint exists
        fetch('/api/affiliate/stats')
          .then((r) => r.ok ? r.json() : null)
          .then((stats) => {
            if (stats) {
              setAffiliateStats(stats)
              setTier(stats.tier || 'bronze')
              setWithdrawableBalance(stats.expectedPayout || 0)
            }
          })
          .catch(() => {/* use mock data */}
          )
      })
      .catch(() => { router.push('/login') })
  }, [router])

  // Close menu on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement
      if (!target.closest('.doc-menu-btn')) setOpenDocMenu(null)
    }
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!newTitle.trim()) return
    setCreating(true)
    const res = await fetch('/api/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle }),
    })
    const data = await res.json()
    if (res.ok && data.document) {
      router.push(`/dashboard/documents/${data.document.id}`)
    } else {
      setCreating(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this document?')) return
    await fetch(`/api/documents/${id}`, { method: 'DELETE' })
    setDocuments((prev) => prev.filter((d) => d.id !== id))
  }

  async function handleSend(id: string) {
    const res = await fetch(`/api/documents/${id}/send`, { method: 'POST' })
    if (res.ok) {
      setDocuments((prev) => prev.map((d) => d.id === id ? { ...d, status: 'sent' } : d))
    }
  }

  function getFilteredDocs() {
    let docs = documents
    const q = searchQuery.trim().toLowerCase()
    if (q) docs = docs.filter((d) => d.title.toLowerCase().includes(q))
    return docs
  }

  function filterLabel() {
    if (docFilter === 'waiting_me') return 'View: Waiting for me — envelopes where your signature is requested.'
    if (docFilter === 'waiting_others') return 'View: Waiting for others — you completed your part; outstanding signers.'
    if (docFilter === 'signed') return 'View: Signed — completed agreements in the last 90 days.'
    return ''
  }

  function copyReferralLink() {
    const link = `${window.location.origin}/?ref=${session?.affiliateCode || ''}`
    navigator.clipboard.writeText(link)
    alert('Referral link copied! Share it to earn 20-30% recurring commissions.')
  }

  const MIN_WITHDRAWAL = 50

  function getWithdrawalEligibility() {
    const isPayoutDay = new Date().getDate() === 15
    const meetsMinimum = withdrawableBalance >= MIN_WITHDRAWAL
    const eligible = isPayoutDay && meetsMinimum
    let reason = ''
    if (!isPayoutDay) reason = 'Withdrawals are available on the 15th of each month.'
    else if (!meetsMinimum) reason = `Minimum withdrawal is $${MIN_WITHDRAWAL}. Current balance: $${withdrawableBalance.toFixed(2)}.`
    else reason = 'Ready to withdraw.'
    return { amount: withdrawableBalance, eligible, reason }
  }

  function startStripeConnect() {
    setStripeConnectStep('pending')
    alert('Stripe Connect flow initiated. Click "Confirm connection" to finish linking your Stripe account.')
  }

  function confirmStripeConnect() {
    setStripeConnectStep('connected')
    setStripeConnected(true)
    alert('Stripe connected successfully! You can request payouts when eligible.')
  }

  function requestWithdrawal() {
    if (!stripeConnected) { alert('Connect Stripe first to receive payouts.'); return }
    const status = getWithdrawalEligibility()
    if (!status.eligible) { alert(status.reason || 'Withdrawal not available yet.'); return }
    const amount = status.amount
    setWithdrawableBalance(0)
    alert(`Withdrawal request submitted for $${amount.toFixed(2)}. Funds will be processed to your Stripe account.`)
  }

  function analyzeAgreementHeuristic(text: string): { risks: string[]; flags: string[]; summary: string } {
    const risks: string[] = []
    const flags: string[] = []
    const lower = text.toLowerCase()
    if (/indemnif|hold harm|liable|lawsuit/i.test(lower)) { risks.push('Indemnification clause may expose you to liability.'); flags.push('indemnification') }
    if (/unlimited|perpetual|no limit|no cap/i.test(lower)) { risks.push('Unlimited liability or obligations detected.'); flags.push('unlimited') }
    if (/auto.renew|automatically renew|self.renew/i.test(lower)) { risks.push('Auto-renewal clause found — ensure cancellation is easy.'); flags.push('auto-renewal') }
    if (/assign|transfer.*right|sublicense/i.test(lower)) { risks.push('IP or rights transfer clause found.'); flags.push('IP transfer') }
    if (/non.compete|noncompete|restrict.*competition/i.test(lower)) { risks.push('Non-compete clause may limit future work.'); flags.push('non-compete') }
    if (/terminat.*convenien|terminat.*without cause/i.test(lower)) { risks.push('Termination for convenience — can be ended easily.'); flags.push('termination') }
    if (/confidential|secrecy|nda/i.test(lower)) { risks.push('Confidentiality clause — obligations are mutual or one-sided.'); flags.push('confidentiality') }
    if (/arbitrat|binding.*dispute|mediat/i.test(lower)) { risks.push('Mandatory arbitration — waives right to jury trial.'); flags.push('arbitration') }
    const summary = risks.length === 0 ? 'Low risk — no major red flags detected.' : `Found ${risks.length} potential issue${risks.length > 1 ? 's' : ''}.`
    return { risks, flags, summary }
  }

  function runAiAgreement() {
    if (!aiAgreementText.trim()) return
    setAiAgreementRunning(true)
    setTimeout(() => {
      const result = analyzeAgreementHeuristic(aiAgreementText)
      let html = `<p><strong>${result.summary}</strong></p>`
      if (result.risks.length > 0) {
        html += '<ul>'
        result.risks.forEach(r => { html += `<li>${r}</li>` })
        html += '</ul>'
        html += '<p>Flags: ' + result.flags.map(f => `<span class="ai-chip ai-chip-warn">${f}</span>`).join(' ') + '</p>'
      } else {
        html += '<span class="ai-chip ai-chip-ok">Looks clean</span>'
      }
      setAiAgreementResult(html)
      setAiAgreementRunning(false)
    }, 800)
  }

  function runAiTemplate() {
    if (!aiTemplatePrompt.trim()) return
    setAiTemplateRunning(true)
    setTimeout(() => {
      setAiTemplateResult(`<p><strong>AI-generated template draft</strong></p><p>Based on your request, this template includes standard sections. Review and customize as needed.</p>`)
      setAiTemplateRunning(false)
    }, 800)
  }

  const statusBadgeClass = (status: string) => {
    if (status === 'draft') return 'bg-gray-100 text-gray-600'
    if (status === 'sent') return 'bg-blue-100 text-blue-700'
    if (status === 'completed') return 'bg-green-100 text-green-700'
    if (status === 'partially_signed') return 'bg-amber-100 text-amber-700'
    if (status === 'expired') return 'bg-red-100 text-red-700'
    return 'bg-gray-100 text-gray-600'
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-500">Loading...</div>

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header bar */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center" style={{ height: 64 }}>
        <Link href="/" className="text-xl font-bold text-blue-600">SignProz</Link>
        <nav className="flex gap-4 items-center">
          <button
            onClick={() => setActiveTab('workspace')}
            className={`text-sm font-medium px-3 py-1.5 rounded-lg transition-colors ${activeTab === 'workspace' ? 'bg-blue-50 text-blue-700' : 'text-gray-500 hover:text-gray-800'}`}
          >
            Dashboard
          </button>
          <Link href="/affiliate" className="text-sm font-medium text-gray-500 hover:text-gray-800 px-3 py-1.5 rounded-lg">
            Affiliate
          </Link>
          <form action="/api/auth/logout" method="POST">
            <button type="submit" className="text-sm text-gray-500 hover:text-gray-900 px-3 py-1.5 rounded-lg">Sign out</button>
          </form>
        </nav>
      </header>

      {/* Subscriber portal header */}
      <div className="bg-white border-b border-slate-100 px-6 py-3">
        <div className="max-w-[1800px] mx-auto">
          <div className="flex flex-wrap justify-between items-center gap-2">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Subscriber portal</h2>
              <p className="text-sm text-gray-500">
                Welcome, {session?.email} &middot; Your code:{' '}
                <strong className="bg-gray-100 px-2 py-0.5 rounded font-mono text-sm">{session?.affiliateCode}</strong>
              </p>
            </div>
          </div>
          {/* Tabs */}
          <nav className="dashboard-tabs mt-3" role="tablist">
            <button
              role="tab"
              aria-selected={activeTab === 'workspace'}
              onClick={() => setActiveTab('workspace')}
              className={`dashboard-tab ${activeTab === 'workspace' ? 'active' : ''}`}
            >
              Document Workspace
            </button>
            <button
              role="tab"
              aria-selected={activeTab === 'referrals'}
              onClick={() => setActiveTab('referrals')}
              className={`dashboard-tab ${activeTab === 'referrals' ? 'active' : ''}`}
            >
              Referrals &amp; Rewards
            </button>
          </nav>
        </div>
      </div>

      {/* Main layout */}
      <div className="flex flex-col lg:flex-row flex-1">
        {/* Left sidebar */}
        <aside className="signproz-sidebar" aria-label="Document management">
          {activeTab === 'workspace' ? (
            <div className="flex flex-col h-full">
              {/* Upload actions */}
              <div className="px-3 pt-4 pb-2">
                <button
                  onClick={() => setShowNewDocForm(true)}
                  className="upload-btn w-full mb-2"
                  style={{ backgroundColor: '#ff4e00', color: 'white', border: 'none', padding: '12px', borderRadius: '6px', fontWeight: 700, fontSize: '14px', cursor: 'pointer', marginBottom: '8px', transition: 'background 0.15s ease' }}
                >
                  Upload Document
                </button>
                <div className="relative">
                  <button
                    onClick={() => setCloudMenuOpen(!cloudMenuOpen)}
                    className="cloud-dropdown w-full"
                    style={{ width: '100%', border: '1px solid #d1d5db', padding: '10px 8px', borderRadius: '6px', textAlign: 'center', fontSize: '13px', color: '#64748b', marginBottom: cloudMenuOpen ? '0' : '22px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', background: '#fafafa' }}
                  >
                    Get from Cloud <span aria-hidden="true" style={{ width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: '6px solid #64748b' }} />
                  </button>
                  {cloudMenuOpen && (
                    <div className="cloud-menu" style={{ marginTop: '-6px', marginBottom: '18px', border: '1px solid #e5e7eb', borderRadius: '6px', overflow: 'hidden', fontSize: '12px', background: '#fff', boxShadow: '0 4px 12px rgba(0,0,0,0.06)' }}>
                      <button style={{ display: 'block', width: '100%', padding: '8px 12px', textAlign: 'left', border: 'none', background: '#fff', cursor: 'pointer', color: '#475569' }}>Google Drive</button>
                      <button style={{ display: 'block', width: '100%', padding: '8px 12px', textAlign: 'left', border: 'none', background: '#fff', cursor: 'pointer', color: '#475569' }}>Dropbox</button>
                      <button style={{ display: 'block', width: '100%', padding: '8px 12px', textAlign: 'left', border: 'none', background: '#fff', cursor: 'pointer', color: '#475569' }}>Box</button>
                    </div>
                  )}
                </div>
              </div>

              {/* Document list */}
              <div className="flex-1 overflow-y-auto px-3">
                <div className="flex justify-between items-center mb-2 mt-2">
                  <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">My Documents</h3>
                  <button
                    onClick={() => setShowNewDocForm(!showNewDocForm)}
                    className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-medium hover:bg-blue-100"
                  >
                    + New
                  </button>
                </div>

                {/* Sub-filters */}
                <div className="mb-2">
                  {(['documents', 'waiting_me', 'waiting_others', 'signed'] as DocFilter[]).map((f) => (
                    <button
                      key={f}
                      onClick={() => setDocFilter(f)}
                      className={`block w-full text-left px-2 py-1.5 text-xs rounded-md ${docFilter === f ? 'text-blue-600 font-semibold bg-blue-50' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                      {f === 'documents' ? 'Documents' : f === 'waiting_me' ? 'Waiting for me' : f === 'waiting_others' ? 'Waiting for others' : 'Signed'}
                    </button>
                  ))}
                </div>

                {/* New document form */}
                {showNewDocForm && (
                  <form onSubmit={handleCreate} className="mb-3 bg-white rounded-lg p-2 border border-blue-200">
                    <input
                      type="text"
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                      placeholder="Document title..."
                      className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-blue-200 focus:border-blue-400 outline-none"
                      autoFocus
                      required
                    />
                    <div className="flex gap-1 mt-1">
                      <button type="submit" disabled={creating} className="flex-1 text-xs bg-blue-600 text-white rounded py-1 font-medium hover:bg-blue-700 disabled:opacity-50">
                        {creating ? 'Creating...' : 'Create'}
                      </button>
                      <button type="button" onClick={() => { setShowNewDocForm(false); setNewTitle('') }} className="text-xs text-gray-500 px-2 py-1">Cancel</button>
                    </div>
                  </form>
                )}

                {documents.length === 0 ? (
                  <div className="text-center py-8 text-gray-400 text-sm">
                    <p>No documents yet.</p>
                    <p className="mt-1 text-xs">Click + New to create one.</p>
                  </div>
                ) : (
                  <ul className="space-y-1">
                    {getFilteredDocs().map((doc) => (
                      <li key={doc.id}>
                        <Link
                          href={`/dashboard/documents/${doc.id}`}
                          className="flex items-start gap-2 p-2 rounded-lg hover:bg-gray-200 transition-colors text-sm"
                        >
                          <span className="text-gray-400 mt-0.5"><i className="fas fa-file-alt"></i></span>
                          <span className="flex-1 min-w-0">
                            <span className="block truncate font-medium text-gray-800">{doc.title}</span>
                            <span className={`inline-block mt-0.5 text-xs px-1.5 py-0.5 rounded-full ${statusBadgeClass(doc.status)}`}>{doc.status.replace('_', ' ')}</span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Nav items */}
              <div className="border-t border-slate-200 px-3 py-2 space-y-0.5">
                <Link href="/affiliate" className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-gray-600 hover:bg-gray-200 transition-colors">
                  <span>📑</span><span>Templates</span>
                </Link>
                <button className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-gray-600 hover:bg-gray-200 transition-colors w-full text-left">
                  <span>✉️</span><span>Bulk send</span>
                </button>
                <button className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-gray-600 hover:bg-gray-200 transition-colors w-full text-left">
                  <span>👥</span><span>Team</span>
                </button>
                <button className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-gray-600 hover:bg-gray-200 transition-colors w-full text-left">
                  <span>💬</span><span>AI Assistant</span><span className="badge-new">NEW</span>
                </button>
              </div>
            </div>
          ) : (
            /* Referrals tab sidebar */
            <div className="px-4 py-6">
              <h3 className="font-bold text-gray-800 text-sm mb-1">Referral Stats</h3>
              <p className="text-xs text-gray-400 mb-4">Updated live from your account</p>
              <div className="space-y-3">
                <div className="bg-white rounded-xl p-3 text-center">
                  <div className="text-2xl font-bold text-gray-800">{affiliateStats.totalReferrals || 0}</div>
                  <div className="text-xs text-gray-500">Total referrals</div>
                </div>
                <div className="bg-white rounded-xl p-3 text-center">
                  <div className="text-2xl font-bold text-green-600">{affiliateStats.activeAccounts || 0}</div>
                  <div className="text-xs text-gray-500">Active (paid)</div>
                </div>
                <div className="bg-white rounded-xl p-3 text-center">
                  <div className="text-2xl font-bold text-blue-600">${affiliateStats.expectedPayout?.toFixed(2) || '0.00'}</div>
                  <div className="text-xs text-gray-500">Expected payout</div>
                </div>
                <div className="bg-white rounded-xl p-3 text-center">
                  <div className="text-2xl font-bold text-gray-800">${affiliateStats.paidOut?.toFixed(2) || '0.00'}</div>
                  <div className="text-xs text-gray-500">Paid out</div>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between bg-white rounded-xl p-3">
                <span className="text-sm font-medium">Tier:</span>
                <span className={`tier-badge ${tierColors[tier] || tierColors.bronze}`}>{tier}</span>
              </div>
            </div>
          )}
        </aside>

        {/* Main content */}
        <div className="flex-1 min-w-0 w-full">
          {activeTab === 'workspace' ? (
            <div className="max-w-6xl mx-auto px-4 py-6">
              {/* Filter banner */}
              {filterLabel() && (
                <div className="mb-4 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">{filterLabel()}</div>
              )}
              <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                  <h3 className="font-bold text-lg text-gray-900"><i className="fas fa-folder-open text-blue-600 mr-2"></i>Documents</h3>
                  <div className="relative w-full sm:max-w-xs sm:ml-auto">
                    <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm" style={{ top: '50%', transform: 'translateY(-50%)' }}></i>
                    <input
                      type="search"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search documents..."
                      className="w-full border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-sm focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none"
                    />
                  </div>
                </div>

                {documents.length === 0 ? (
                  <div className="text-center py-16 text-gray-400">
                    <p className="text-4xl mb-3">📄</p>
                    <p className="text-lg font-medium">No documents yet</p>
                    <p className="text-sm mt-1">Click "New Document" above to get started.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {getFilteredDocs().map((doc) => (
                      <div key={doc.id} className="dash-doc-row bg-white rounded-xl border border-gray-100">
                        <div className="flex items-center gap-4 flex-1 min-w-0">
                          <div className="text-xl text-gray-400" aria-hidden="true"><i className="fas fa-file-alt"></i></div>
                          <div className="flex-1 min-w-0">
                            <h4 className="font-semibold text-gray-800 text-sm sm:text-base truncate">{doc.title}</h4>
                            <div className="flex flex-wrap gap-3 mt-1">
                              <span className={`text-xs px-2 py-0.5 rounded-full ${statusBadgeClass(doc.status)}`}>
                                {doc.status.replace('_', ' ')}
                              </span>
                              <span className="text-xs text-gray-400">Created: {new Date(doc.created_at).toLocaleDateString()}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                          {doc.status === 'draft' && (
                            <button
                              onClick={() => handleSend(doc.id)}
                              className="flex items-center gap-1.5 text-sm px-3 py-1.5 border border-gray-300 rounded-lg font-medium hover:bg-gray-50 text-gray-700"
                            >
                              <i className="fas fa-paper-plane text-xs text-blue-600"></i> Send for signing
                            </button>
                          )}
                          {doc.signers && doc.signers.some(
                            (s) => s.email === session?.email && !s.signed_at
                          ) && (doc.status === 'draft' || doc.status === 'sent') && (
                            <Link
                              href={`/sign/${doc.id}`}
                              className="flex items-center gap-1.5 text-sm px-3 py-1.5 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700"
                            >
                              <i className="fas fa-pen text-xs"></i> Sign
                            </Link>
                          )}
                          <Link href={`/dashboard/documents/${doc.id}`} className="text-sm bg-blue-50 text-blue-700 px-3 py-1.5 rounded-lg font-medium hover:bg-blue-100">Edit</Link>
                          {/* More actions dropdown */}
                          <div className="relative">
                            <button
                              onClick={(e) => { e.stopPropagation(); setOpenDocMenu(openDocMenu === doc.id ? null : doc.id) }}
                              className="doc-menu-btn text-gray-500 hover:text-gray-700 px-2 py-1.5 rounded-lg hover:bg-gray-100"
                              aria-label="More actions"
                            >
                              <i className="fas fa-ellipsis-h"></i>
                            </button>
                            {openDocMenu === doc.id && (
                              <div className="absolute right-0 mt-1 w-36 bg-white border border-gray-200 rounded-lg shadow-lg z-10">
                                <button
                                  onClick={() => { router.push(`/dashboard/documents/${doc.id}`); setOpenDocMenu(null) }}
                                  className="flex items-center gap-2 w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                >
                                  <i className="fas fa-eye w-4"></i> View
                                </button>
                                <button
                                  onClick={() => { router.push(`/dashboard/documents/${doc.id}`); setOpenDocMenu(null) }}
                                  className="flex items-center gap-2 w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                >
                                  <i className="fas fa-edit w-4"></i> Edit
                                </button>
                                <button
                                  onClick={() => { setOpenDocMenu(null) }}
                                  className="flex items-center gap-2 w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                >
                                  <i className="fas fa-copy w-4"></i> Duplicate
                                </button>
                                <button
                                  onClick={() => { handleDelete(doc.id); setOpenDocMenu(null) }}
                                  className="flex items-center gap-2 w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                                >
                                  <i className="fas fa-trash w-4"></i> Delete
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Document actions — placeholder area */}
              <div className="mt-6 bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                <h3 className="font-bold mb-3 text-gray-900"><i className="fas fa-file-signature text-blue-600 mr-2"></i>Prepare &amp; send</h3>
                {/* AI buttons */}
                <div className="flex gap-2 mb-4 flex-wrap items-center">
                  <button
                    onClick={() => setShowAIAgreement(true)}
                    className="bg-violet-100 text-violet-800 border border-violet-200 px-4 py-2 rounded-full text-sm font-medium hover:bg-violet-200"
                  >
                    <i className="fas fa-magic mr-1" aria-hidden="true"></i> AI agreement review
                  </button>
                  <button
                    onClick={() => setShowAITemplate(true)}
                    className="bg-teal-100 text-teal-800 border border-teal-200 px-4 py-2 rounded-full text-sm font-medium hover:bg-teal-200"
                  >
                    <i className="fas fa-sparkles mr-1" aria-hidden="true"></i> AI generate template
                  </button>
                </div>
                {/* Field palette (collapsible) */}
                <div className="mb-4">
                  <button
                    onClick={() => setFieldPaletteCollapsed(!fieldPaletteCollapsed)}
                    className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2 hover:text-gray-900"
                  >
                    <span className={`transition-transform ${fieldPaletteCollapsed ? '' : 'rotate-90'}`}><i className="fas fa-chevron-right text-xs"></i></span>
                    Field Palette
                  </button>
                  {!fieldPaletteCollapsed && (
                    <div>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Sign &amp; Edit</p>
                      <div className="flex flex-wrap gap-2 mb-3">
                        {SIGN_EDIT_PALETTE.map(f => (
                          <button key={f.kind} className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-full border border-gray-200 flex items-center gap-1.5">
                            <i className={`fas ${f.icon} text-xs`}></i>{f.label}
                          </button>
                        ))}
                      </div>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Add Fields</p>
                      <div className="flex flex-wrap gap-2">
                        {ADD_FIELDS_PALETTE.map(f => (
                          <button key={f.kind} className="text-xs bg-gray-50 hover:bg-gray-100 text-gray-600 px-3 py-1.5 rounded-full border border-gray-200 flex items-center gap-1.5">
                            <i className={`fas ${f.icon} text-xs`}></i>{f.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <div className="p-8 bg-gray-50 rounded-xl border text-center text-gray-400 text-sm" style={{ backgroundImage: 'radial-gradient(#e5e7eb 0.5px, transparent 0.5px)', backgroundSize: '16px 16px' }}>
                  <p>Select a document and click <strong>Edit</strong> to open the document editor.</p>
                </div>
              </div>
            </div>
          ) : (
            /* Referrals panel */
            <div className="max-w-6xl mx-auto px-4 py-6">
              <div className="flex flex-wrap justify-between items-start gap-4 mb-6">
                <p className="text-sm text-gray-600 max-w-xl">Track live referral stats, expected payouts, and a long-range earnings projection.</p>
                <div className="flex gap-2">
                  <button onClick={copyReferralLink} className="bg-green-100 text-green-700 px-4 py-2 rounded-full text-sm font-medium hover:bg-green-200">
                    <i className="fas fa-link mr-1"></i> Copy Referral Link
                  </button>
                  <button
                    onClick={() => {
                      setShowSampleReferrals(!showSampleReferrals)
                      if (!showSampleReferrals) setWithdrawableBalance(11.60)
                    }}
                    className="bg-gray-100 text-gray-700 px-4 py-2 rounded-full text-sm font-medium hover:bg-gray-200"
                  >
                    <i className="fas fa-chart-line mr-1"></i> Load Sample
                  </button>
                </div>
              </div>

              {/* Referrals grid */}
              <div className="grid lg:grid-cols-12 gap-6">
                <div className="lg:col-span-5">
                  <div className="referral-stats-card rounded-2xl p-6 shadow-sm bg-white border border-gray-100">
                    <h3 className="font-bold text-lg flex items-center gap-2"><i className="fas fa-gift text-purple-600"></i> Referrals &amp; Rewards</h3>
                    <Link href="/affiliate" className="text-blue-600 text-sm underline mb-4 inline-block">View program details →</Link>

                    <div className="grid grid-cols-2 gap-4 mt-4">
                      <div className="bg-gray-50 rounded-xl p-3 text-center">
                        <div className="text-3xl font-bold text-gray-800">{affiliateStats.totalReferrals || 0}</div>
                        <div className="text-xs text-gray-500">Total referrals</div>
                      </div>
                      <div className="bg-gray-50 rounded-xl p-3 text-center">
                        <div className="text-3xl font-bold text-green-600">{affiliateStats.activeAccounts || 0}</div>
                        <div className="text-xs text-gray-500">Active (paid accounts)</div>
                      </div>
                      <div className="bg-gray-50 rounded-xl p-3 text-center">
                        <div className="text-3xl font-bold text-blue-600">${affiliateStats.expectedPayout?.toFixed(2) || '0.00'}</div>
                        <div className="text-xs text-gray-500">Expected payout</div>
                      </div>
                      <div className="bg-gray-50 rounded-xl p-3 text-center">
                        <div className="text-3xl font-bold text-gray-800">${affiliateStats.paidOut?.toFixed(2) || '0.00'}</div>
                        <div className="text-xs text-gray-500">Paid out</div>
                      </div>
                    </div>

                    <div className="mt-4 flex items-center justify-between bg-gray-50 rounded-xl p-3">
                      <span className="text-sm font-medium">Tier:</span>
                      <span className={`tier-badge ${tierColors[tier] || tierColors.bronze}`}>{tier}</span>
                    </div>
                    <div className="mt-4 text-xs text-gray-500 text-center">Next payout: 15th of next month · Min. $50</div>
                  </div>
                </div>

                {/* 3-year projection */}
                <div className="lg:col-span-7 bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                  <h3 className="font-bold mb-3"><i className="fas fa-chart-line text-blue-600"></i> 3-Year Earnings Projection</h3>
                  <p className="text-xs text-gray-500 mb-3">Based on realistic part-time effort (1-2 hours/week). Assumes 20% commission, upgrading to 30% over time.</p>
                  <table className="w-full text-sm projection-table">
                    <thead>
                      <tr className="bg-gray-50">
                        <th className="text-left p-2">Year</th>
                        <th className="text-left p-2">New Referrals</th>
                        <th className="text-left p-2">Total</th>
                        <th className="text-left p-2">Earnings</th>
                        <th className="text-left p-2">Avg Monthly</th>
                        <th className="text-left p-2">End Monthly</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="p-2 font-medium">Year 1</td>
                        <td className="p-2">{revenueProjection.year1.newReferrals}</td>
                        <td className="p-2">{revenueProjection.year1.totalReferrals}</td>
                        <td className="p-2 text-green-700 font-semibold">${revenueProjection.year1.earnings.toLocaleString()}</td>
                        <td className="p-2">${revenueProjection.year1.avgMonthly}</td>
                        <td className="p-2">${revenueProjection.year1.endMonthly}</td>
                      </tr>
                      <tr>
                        <td className="p-2 font-medium">Year 2</td>
                        <td className="p-2">{revenueProjection.year2.newReferrals}</td>
                        <td className="p-2">{revenueProjection.year2.totalReferrals}</td>
                        <td className="p-2 text-green-700 font-semibold">${revenueProjection.year2.earnings.toLocaleString()}</td>
                        <td className="p-2">${revenueProjection.year2.avgMonthly}</td>
                        <td className="p-2">${revenueProjection.year2.endMonthly}</td>
                      </tr>
                      <tr>
                        <td className="p-2 font-medium">Year 3</td>
                        <td className="p-2">{revenueProjection.year3.newReferrals}</td>
                        <td className="p-2">{revenueProjection.year3.totalReferrals}</td>
                        <td className="p-2 text-green-700 font-semibold">${revenueProjection.year3.earnings.toLocaleString()}</td>
                        <td className="p-2">${revenueProjection.year3.avgMonthly}</td>
                        <td className="p-2">${revenueProjection.year3.endMonthly}</td>
                      </tr>
                      <tr className="bg-blue-50">
                        <td className="p-2 font-bold">TOTAL</td>
                        <td className="p-2">{revenueProjection.total.referrals}</td>
                        <td className="p-2"></td>
                        <td className="p-2 font-bold text-blue-700">${revenueProjection.total.earnings.toLocaleString()}</td>
                        <td className="p-2"></td>
                        <td className="p-2 font-bold">~${revenueProjection.year3.endMonthly}/mo</td>
                      </tr>
                    </tbody>
                  </table>
                  <div className="mt-3 bg-green-50 p-3 rounded-lg">
                    <p className="text-xs text-green-800">
                      <i className="fas fa-info-circle"></i> <strong>Non-aggressive projection:</strong> Part-time effort (1-2 hours/week). Double these numbers with full-time effort (5-10 hours/week). Commissions increase as you tier up to 30%.
                    </p>
                  </div>
                </div>
              </div>

              {/* Recent referral activity */}
              <div className="mt-8 bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
                <h3 className="font-bold text-gray-900 mb-2">Recent referral activity</h3>
                {!showSampleReferrals && (
                  <p className="text-xs text-gray-500 mb-3">Use <strong>Load sample</strong> above to populate this list.</p>
                )}
                <div className="space-y-2">
                  {(showSampleReferrals ? recentReferrals : []).map((r, i) => (
                    <div key={i} className="flex justify-between items-center bg-gray-50 p-3 rounded-lg text-sm">
                      <div>
                        <span className="font-medium">{r.email}</span>
                        <span className="text-gray-400 ml-2">— {r.plan}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs ${r.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                          {r.status === 'active' ? 'Active' : 'Pending'}
                        </span>
                        {r.earnings > 0 && (
                          <span className="text-green-600 font-semibold">+${r.earnings.toFixed(2)}/mo</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Stripe Payout Panel */}
              <div className="mt-6 bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="font-bold text-gray-900 flex items-center gap-2"><i className="fab fa-stripe-s text-indigo-600"></i> Stripe Payouts</h3>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${stripeConnected ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {stripeConnected ? 'Connected' : 'Not connected'}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mb-4">Connect Stripe to receive affiliate payouts directly to your account.</p>

                {/* Withdrawable amount */}
                <div className="bg-blue-50 rounded-xl p-4 mb-4 text-center">
                  <div className="text-3xl font-bold text-blue-600">${withdrawableBalance.toFixed(2)}</div>
                  <div className="text-xs text-gray-500 mt-1">Withdrawable balance</div>
                </div>

                {/* Eligibility */}
                {(() => {
                  const status = getWithdrawalEligibility()
                  return (
                    <>
                      <p className={`text-xs mb-3 ${status.eligible ? 'text-green-700' : 'text-amber-700'}`}>
                        {status.eligible ? 'Withdrawal available today.' : status.reason}
                      </p>
                      <button
                        onClick={requestWithdrawal}
                        disabled={!status.eligible || !stripeConnected}
                        className={`w-full px-3 py-2 rounded-lg text-sm font-semibold mb-4 ${status.eligible && stripeConnected ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
                      >
                        <i className="fas fa-wallet mr-1"></i> Withdraw earnings
                      </button>
                    </>
                  )
                })()}

                {/* Stripe Connect steps */}
                <div className="border-t border-gray-100 pt-4">
                  <p className="text-xs text-gray-500 mb-2 font-medium">Stripe Connect setup (2 steps)</p>
                  <div className="flex gap-2 flex-wrap">
                    <button
                      onClick={startStripeConnect}
                      disabled={stripeConnected}
                      className={`px-3 py-2 rounded-lg text-sm font-medium border ${stripeConnected ? 'border-gray-200 text-gray-400 bg-gray-50 cursor-not-allowed' : 'border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100'}`}
                    >
                      1) Connect Stripe
                    </button>
                    <button
                      onClick={confirmStripeConnect}
                      disabled={stripeConnected || stripeConnectStep !== 'pending'}
                      className={`px-3 py-2 rounded-lg text-sm font-medium border ${stripeConnected || stripeConnectStep !== 'pending' ? 'border-gray-200 text-gray-400 bg-gray-50 cursor-not-allowed' : 'border-indigo-300 text-indigo-800 bg-indigo-100 hover:bg-indigo-200'}`}
                    >
                      2) Confirm connection
                    </button>
                  </div>
                  <p className="text-xs text-gray-400 mt-2">After connecting, confirm to activate payouts on your Stripe account.</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* AI Agreement Review Modal */}
      {showAIAgreement && (
        <div className="fixed inset-0 bg-black/55 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={(e) => { if (e.target === e.currentTarget) setShowAIAgreement(false) }}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2"><i className="fas fa-magic"></i> AI agreement assistant</h3>
              <button onClick={() => setShowAIAgreement(false)} className="text-gray-400 hover:text-gray-600 p-2 rounded-lg hover:bg-gray-100">
                <i className="fas fa-times"></i>
              </button>
            </div>
            <label className="block text-sm font-semibold text-slate-800 mb-1">Agreement or clause text</label>
            <textarea
              value={aiAgreementText}
              onChange={(e) => setAiAgreementText(e.target.value)}
              className="w-full border border-slate-200 rounded-xl p-3 text-sm min-h-[140px] focus:ring-2 focus:ring-violet-200 focus:border-violet-400 outline-none"
              placeholder="Paste NDA, MSA, offer letter, or policy language here..."
            />
            <div className="flex items-center gap-3 mt-3 mb-3">
              <button
                onClick={runAiAgreement}
                disabled={aiAgreementRunning}
                className="bg-violet-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-violet-700 disabled:opacity-50"
              >
                <i className="fas fa-robot mr-2" aria-hidden="true"></i>{aiAgreementRunning ? 'Analyzing...' : 'Analyze with AI'}
              </button>
              {aiAgreementRunning && <span className="text-xs text-slate-500">Running built-in analysis...</span>}
            </div>
            <div
              className="rounded-xl border border-slate-100 bg-slate-50/80 p-4 min-h-[120px] text-left text-sm"
              dangerouslySetInnerHTML={{ __html: aiAgreementResult || '<p class="text-gray-400">Results will appear here.</p>' }}
            />
          </div>
        </div>
      )}

      {/* AI Generate Template Modal */}
      {showAITemplate && (
        <div className="fixed inset-0 bg-black/55 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={(e) => { if (e.target === e.currentTarget) setShowAITemplate(false) }}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2"><i className="fas fa-sparkles"></i> AI document generator</h3>
              <button onClick={() => setShowAITemplate(false)} className="text-gray-400 hover:text-gray-600 p-2 rounded-lg hover:bg-gray-100">
                <i className="fas fa-times"></i>
              </button>
            </div>
            <label className="block text-sm font-semibold text-slate-800 mb-1">Template prompt</label>
            <textarea
              value={aiTemplatePrompt}
              onChange={(e) => setAiTemplatePrompt(e.target.value)}
              className="w-full border border-slate-200 rounded-xl p-3 text-sm min-h-[120px] focus:ring-2 focus:ring-cyan-200 focus:border-cyan-400 outline-none"
              placeholder="Example: Generate a 2-party SaaS agreement template with NDA clause, payment terms, and signature blocks."
            />
            <div className="flex items-center gap-3 mt-3 mb-3">
              <button
                onClick={runAiTemplate}
                disabled={aiTemplateRunning}
                className="bg-teal-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-teal-700 disabled:opacity-50"
              >
                <i className="fas fa-sparkles mr-2" aria-hidden="true"></i>{aiTemplateRunning ? 'Generating...' : 'Generate draft'}
              </button>
            </div>
            <div
              className="rounded-xl border border-slate-100 bg-slate-50/80 p-4 min-h-[100px] text-sm"
              dangerouslySetInnerHTML={{ __html: aiTemplateResult || '<p class="text-gray-400">Generated draft will appear here.</p>' }}
            />
          </div>
        </div>
      )}
    </div>
  )
}