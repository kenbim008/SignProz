'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

interface Signer {
  id: string
  email: string
  name: string
  order: number
  signed_at: string | null
  status: 'pending' | 'viewed' | 'signed'
}

interface Field {
  id: string
  field_type: string
  signer_id: string | null
  position_x: number
  position_y: number
  width: number
  height: number
  value: string | null
  signed_at: string | null
  required?: boolean
  label?: string
  validation?: string
}

interface Document {
  id: string
  title: string
  status: string
  expiration_days: number | null
  signers: Signer[]
  signature_fields: Field[]
}

type ActiveTab = 'signers' | 'fields' | 'edit-signers' | 'audit'
type SigningMode = 'sequential' | 'parallel'
type RightPanelTab = 'settings' | 'expiration'

const FIELD_PALETTE = [
  // Sign & Edit
  { kind: 'signature', label: 'My Signature', icon: 'fa-signature', section: 'sign-edit', color: '#3b82f6' },
  { kind: 'initial', label: 'My Initials', icon: 'fa-font', section: 'sign-edit', color: '#8b5cf6' },
  { kind: 'text', label: 'Text', icon: 'fa-i-cursor', section: 'sign-edit', color: '#10b981' },
  { kind: 'date', label: 'Date Signed', icon: 'fa-calendar-alt', section: 'sign-edit', color: '#f59e0b' },
  { kind: 'checkmark', label: 'Checkmark', icon: 'fa-check-circle', section: 'sign-edit', color: '#06b6d4' },
  // Add Fields
  { kind: 'sig-field', label: 'Signature Field', icon: 'fa-signature', section: 'add-fields', color: '#3b82f6' },
  { kind: 'initials-field', label: 'Initials Field', icon: 'fa-font', section: 'add-fields', color: '#8b5cf6' },
  { kind: 'text-field', label: 'Text Field', icon: 'fa-align-left', section: 'add-fields', color: '#10b981' },
  { kind: 'date-signed-field', label: 'Date Signed Field', icon: 'fa-calendar-day', section: 'add-fields', color: '#f59e0b' },
  { kind: 'checkbox-field', label: 'Checkbox Field', icon: 'fa-check-square', section: 'add-fields', color: '#06b6d4' },
  { kind: 'radio-field', label: 'Radio Buttons', icon: 'fa-dot-circle', section: 'add-fields', color: '#ec4899' },
  { kind: 'dropdown-field', label: 'Dropdown Field', icon: 'fa-caret-square-down', section: 'add-fields', color: '#f97316' },
  { kind: 'attachment-field', label: 'Attachment Field', icon: 'fa-paperclip', section: 'add-fields', color: '#84cc16' },
  { kind: 'name-field', label: 'Name Field', icon: 'fa-id-card', section: 'add-fields', color: '#6366f1' },
  { kind: 'email-field', label: 'Email Field', icon: 'fa-envelope', section: 'add-fields', color: '#14b8a6' },
  { kind: 'company-field', label: 'Company Field', icon: 'fa-building', section: 'add-fields', color: '#a855f7' },
  { kind: 'title-field', label: 'Title Field', icon: 'fa-briefcase', section: 'add-fields', color: '#f43f5e' },
]

const CANVAS_WIDTH = 612
const CANVAS_HEIGHT = 792

export default function DocumentEditorPage() {
  const params = useParams()
  const id = params.id as string

  const [activeTab, setActiveTab] = useState<ActiveTab>('signers')
  const [document, setDocument] = useState<Document | null>(null)
  const [signers, setSigners] = useState<Signer[]>([])
  const [fields, setFields] = useState<Field[]>([])
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [addingSigner, setAddingSigner] = useState(false)
  const [signerName, setSignerName] = useState('')
  const [signerEmail, setSignerEmail] = useState('')
  const [signerOrder, setSignerOrder] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [placingFieldType, setPlacingFieldType] = useState<string | null>(null)
  const [activeSignerId, setActiveSignerId] = useState<string | null>(null)
  const [signingMode, setSigningMode] = useState<SigningMode>('sequential')
  const [expirationDays, setExpirationDays] = useState(30)
  const [toast, setToast] = useState<string | null>(null)
  const [apiNotice, setApiNotice] = useState<string | null>(null)
  const [showAIAgreement, setShowAIAgreement] = useState(false)
  const [showAITemplate, setShowAITemplate] = useState(false)
  const [aiAgreementText, setAiAgreementText] = useState('')
  const [aiAgreementResult, setAiAgreementResult] = useState('')
  const [aiTemplatePrompt, setAiTemplatePrompt] = useState('')
  const [aiTemplateResult, setAiTemplateResult] = useState('')
  const [aiAgreementRunning, setAiAgreementRunning] = useState(false)
  const [aiTemplateRunning, setAiTemplateRunning] = useState(false)
  const [signerDropdownOpen, setSignerDropdownOpen] = useState(false)
  const [fieldPaletteCollapsed, setFieldPaletteCollapsed] = useState(false)
  const [auditLogs, setAuditLogs] = useState<{ timestamp: string; action: string; actor: string; ip: string }[]>([])
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>('settings')
  const [expirationReminder, setExpirationReminder] = useState<'none' | '1' | '3' | '7'>('none')
  const [expirationDate, setExpirationDate] = useState<Date | null>(null)
  const [expirationCountdown, setExpirationCountdown] = useState<string>('')
  const [bulkSendOpen, setBulkSendOpen] = useState(false)
  const [bulkDocs, setBulkDocs] = useState<{ id: string; title: string; status: string; selected: boolean }[]>([])
  const [bulkMessage, setBulkMessage] = useState('')
  const [bulkSending, setBulkSending] = useState(false)

  // Field move/resize state
  const [draggingFieldId, setDraggingFieldId] = useState<string | null>(null)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [resizingFieldId, setResizingFieldId] = useState<string | null>(null)
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, w: 0, h: 0 })
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [pdfDragOver, setPdfDragOver] = useState(false)

  // Mouse move/up handlers for field drag/resize — attached to window
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (draggingFieldId) {
        setFields(prev => prev.map(f => {
          if (f.id !== draggingFieldId) return f
          return { ...f, position_x: Math.round(((e.clientX - dragOffset.x) / CANVAS_WIDTH) * 10000) / 100, position_y: Math.round(((e.clientY - dragOffset.y) / CANVAS_HEIGHT) * 10000) / 100 }
        }))
      }
      if (resizingFieldId) {
        setFields(prev => prev.map(f => {
          if (f.id !== resizingFieldId) return f
          const deltaW = e.clientX - resizeStart.x
          const deltaH = e.clientY - resizeStart.y
          const newPixelWidth = Math.max(80, resizeStart.w + deltaW)
          const newPixelHeight = Math.max(30, resizeStart.h + deltaH)
          return { ...f, width: Math.round((newPixelWidth / CANVAS_WIDTH) * 10000) / 100, height: Math.round((newPixelHeight / CANVAS_HEIGHT) * 10000) / 100 }
        }))
      }
    }
    function onMouseUp() {
      setDraggingFieldId(null)
      setResizingFieldId(null)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [draggingFieldId, resizingFieldId, dragOffset, resizeStart])

  // Drag state for palette drag-over
  const [paletteDragKind, setPaletteDragKind] = useState<string | null>(null)

  // Load document, signers, fields, audit logs on mount
  useEffect(() => {
    loadDocument()
    loadAuditLogs()
    loadBulkDocuments()
  }, [id])

  async function loadAuditLogs() {
    try {
      const res = await fetch(`/api/documents/${id}`)
      if (res.ok) {
        const data = await res.json()
        if (data.document?.audit_logs && Array.isArray(data.document.audit_logs)) {
          setAuditLogs(data.document.audit_logs)
        } else {
          const entries: { timestamp: string; action: string; actor: string; ip: string }[] = []
          signers.forEach(s => {
            if (s.status === 'signed' && s.signed_at) {
              entries.push({ timestamp: s.signed_at, action: 'Document signed', actor: s.email, ip: '—' })
            }
          })
          if (document?.status === 'sent' || document?.status === 'completed') {
            entries.push({ timestamp: new Date().toLocaleString(), action: 'Document sent', actor: 'you@signproz.com', ip: '—' })
          }
          setAuditLogs(entries.reverse())
        }
      }
    } catch { /* silent */ }
  }

  async function loadBulkDocuments() {
    try {
      const res = await fetch('/api/documents')
      if (res.ok) {
        const data = await res.json()
        const docs = (data.documents || data.data || []).map((d: any) => ({
          id: d.id, title: d.title, status: d.status, selected: false,
        }))
        setBulkDocs(docs)
      } else {
        setBulkDocs([])
      }
    } catch { setBulkDocs([]) }
  }

  // Expiration countdown
  useEffect(() => {
    if (!expirationDate) return
    const tick = () => {
      const diff = expirationDate.getTime() - Date.now()
      if (diff <= 0) { setExpirationCountdown('Expired'); return }
      const d = Math.floor(diff / 86400000)
      const h = Math.floor((diff % 86400000) / 3600000)
      const m = Math.floor((diff % 3600000) / 60000)
      setExpirationCountdown(`${d}d ${h}h ${m}m remaining`)
    }
    tick()
    const id = setInterval(tick, 60000)
    return () => clearInterval(id)
  }, [expirationDate])

  // Set expiration date from expiration_days
  useEffect(() => {
    if (document?.status === 'draft') {
      const d = new Date()
      d.setDate(d.getDate() + expirationDays)
      setExpirationDate(d)
    }
  }, [expirationDays, document?.status])

  // When signers change, set active signer
  useEffect(() => {
    if (signers.length > 0 && !activeSignerId) {
      setActiveSignerId(signers[0].id)
    }
  }, [signers, activeSignerId])

  function showToast(msg: string, duration = 3000) {
    setToast(msg)
    setTimeout(() => setToast(null), duration)
  }

  async function loadDocument() {
    setLoading(true)
    setApiNotice(null)

    // Load document
    const docRes = await fetch(`/api/documents/${id}`)
    const docData = await docRes.json()

    if (!docRes.ok || !docData.document) {
      showToast(docData.error || 'Failed to load document')
      setLoading(false)
      return
    }

    const doc = docData.document
    setDocument(doc)
    setNewTitle(doc.title)
    setExpirationDays(doc.expiration_days ?? 30)

    // Load signers via separate endpoint
    const signerRes = await fetch(`/api/documents/${id}/signers`)
    if (signerRes.ok) {
      const signerData = await signerRes.json()
      setSigners(signerData.signers || [])
    } else {
      setSigners(doc.signers || [])
      setApiNotice('Note: Signers API not yet wired — using document data')
    }

    // Load fields via separate endpoint
    const fieldRes = await fetch(`/api/documents/${id}/fields`)
    if (fieldRes.ok) {
      const fieldData = await fieldRes.json()
      setFields(fieldData.fields || [])
    } else {
      setFields(doc.signature_fields || [])
    }

    setLoading(false)
  }

  async function handleAddSigner(e: React.FormEvent) {
    e.preventDefault()
    if (!signerEmail.trim() || !signerName.trim()) return
    setAddingSigner(true)

    const res = await fetch(`/api/documents/${id}/signers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: signerEmail, name: signerName, order: signerOrder }),
    })

    if (res.ok) {
      const data = await res.json()
      setSigners((prev) => [...prev, data.signer])
      setSignerEmail('')
      setSignerName('')
      setSignerOrder((o) => o + 1)
    } else {
      const data = await res.json()
      showToast(data.error || 'Failed to add signer')
    }

    setAddingSigner(false)
  }

  async function handleRemoveSigner(signerId: string) {
    if (!confirm('Remove this signer?')) return

    const res = await fetch(`/api/documents/${id}/signers/${signerId}`, {
      method: 'DELETE',
    })

    if (res.ok) {
      setSigners((prev) => prev.filter((s) => s.id !== signerId))
      setFields((prev) =>
        prev.map((f) => (f.signer_id === signerId ? { ...f, signer_id: null } : f))
      )
    } else {
      const data = await res.json()
      showToast(data.error || 'Failed to remove signer')
    }
  }

  async function handleSaveDocument() {
    if (!document) return
    setSaving(true)

    const res = await fetch(`/api/documents/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: newTitle,
        expiration_days: expirationDays,
      }),
    })

    if (res.ok) {
      const data = await res.json()
      setDocument((prev) => (prev ? { ...prev, title: data.document.title, expiration_days: data.document.expiration_days } : prev))
      showToast('Document saved')
    } else {
      const data = await res.json()
      showToast(data.error || 'Failed to save')
    }

    setSaving(false)
  }

  async function handleSendDocument() {
    if (!document) return
    if (signers.length === 0) {
      showToast('Add at least one signer before sending')
      return
    }
    if (!confirm('Send this document to all signers?')) return
    setSending(true)

    const res = await fetch(`/api/documents/${id}/send`, { method: 'POST' })

    if (res.ok) {
      showToast('Document sent to signers')
      loadDocument()
    } else {
      const data = await res.json()
      showToast(data.error || 'Failed to send document')
    }

    setSending(false)
  }

  function getPreviewDropPosition(e: React.DragEvent | React.MouseEvent, containerRef: HTMLDivElement | null): { x: number; y: number } | null {
    if (!containerRef) return null
    const rect = containerRef.getBoundingClientRect()
    const xPct = ((e.clientX - rect.left) / rect.width) * 100
    const yPct = ((e.clientY - rect.top) / rect.height) * 100
    if (xPct < -2 || xPct > 102 || yPct < -2 || yPct > 102) return null
    return { x: xPct, y: yPct }
  }

  function handlePlaceField(e: React.MouseEvent<HTMLDivElement>) {
    if (!placingFieldType || !activeSignerId) return
    if (document?.status !== 'draft') return

    const container = e.currentTarget
    const pos = getPreviewDropPosition(e, container)
    if (!pos) return

    setFields((prev) => [
      ...prev,
      {
        id: `local-${Date.now()}`,
        field_type: placingFieldType,
        signer_id: activeSignerId,
        position_x: pos.x,
        position_y: pos.y,
        width: Math.round((200 / CANVAS_WIDTH) * 10000) / 100,
        height: Math.round((60 / CANVAS_HEIGHT) * 10000) / 100,
        value: null,
        signed_at: null,
      },
    ])

    setPlacingFieldType(null)
  }

  function handlePaletteDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    const rawKind = e.dataTransfer.getData('application/x-signproz-field')
    if (!rawKind || !activeSignerId) return
    if (document?.status !== 'draft') return

    const container = e.currentTarget as HTMLDivElement
    const pos = getPreviewDropPosition(e, container)
    if (!pos) return

    setFields((prev) => [
      ...prev,
      {
        id: `local-${Date.now()}`,
        field_type: rawKind,
        signer_id: activeSignerId,
        position_x: pos.x,
        position_y: pos.y,
        width: Math.round((200 / CANVAS_WIDTH) * 10000) / 100,
        height: Math.round((60 / CANVAS_HEIGHT) * 10000) / 100,
        value: null,
        signed_at: null,
      },
    ])

    setPlacingFieldType(null)
    setPaletteDragKind(null)
  }

  function handlePdfDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    e.stopPropagation()
    const file = e.dataTransfer.files[0]
    if (file && file.type === 'application/pdf') {
      setPdfFile(file)
      showToast(`Uploaded: ${file.name}`)
    } else {
      showToast('Only PDF files are supported')
    }
    setPdfDragOver(false)
  }

  function handlePdfFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) {
      setPdfFile(file)
      showToast(`Uploaded: ${file.name}`)
    }
  }

  function handleDeleteSelectedField() {
    if (!selectedFieldId) return
    if (!selectedFieldId.startsWith('local-')) {
      // API call needed
      fetch(`/api/documents/${id}/fields/${selectedFieldId}`, { method: 'DELETE' })
        .then((res) => {
          if (res.ok) {
            setFields((prev) => prev.filter((f) => f.id !== selectedFieldId))
          } else {
            showToast('Failed to remove field')
          }
        })
    } else {
      setFields((prev) => prev.filter((f) => f.id !== selectedFieldId))
    }
    setSelectedFieldId(null)
  }

  // Keyboard shortcut for Delete
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedFieldId) {
        const tag = (e.target as HTMLElement).tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
        handleDeleteSelectedField()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [selectedFieldId, id])

  const isDraft = document?.status === 'draft'

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500">
        <span>Loading document...</span>
      </div>
    )
  }

  if (!document) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-500 font-medium mb-2">Document not found</p>
          <Link href="/dashboard" className="text-blue-600 hover:underline text-sm">
            Back to dashboard
          </Link>
        </div>
      </div>
    )
  }

  const statusBadgeClass =
    document.status === 'draft'
      ? 'bg-gray-100 text-gray-600'
      : document.status === 'sent'
      ? 'bg-blue-100 text-blue-700'
      : document.status === 'completed'
      ? 'bg-green-100 text-green-700'
      : 'bg-amber-100 text-amber-700'

  const signerStatusClass = (status: string) => {
    if (status === 'signed') return 'bg-green-100 text-green-700'
    if (status === 'viewed') return 'bg-blue-100 text-blue-700'
    return 'bg-gray-100 text-gray-600'
  }

  const signerStatus = (signer: { signed_at: string | null; status?: string }) => {
    if (signer.signed_at) return 'signed'
    if (signer.status === 'viewed') return 'viewed'
    return 'pending'
  }

  const fieldTypeIcon = (type: string) => {
    const icons: Record<string, string> = {
      signature: 'fa-signature',
      initial: 'fa-font',
      text: 'fa-i-cursor',
      date: 'fa-calendar-alt',
      checkbox: 'fa-check-square',
      radio: 'fa-dot-circle',
      dropdown: 'fa-caret-square-down',
      attachment: 'fa-paperclip',
      name: 'fa-id-card',
      email: 'fa-envelope',
    }
    return icons[type] || 'fa-square'
  }

  const FIELD_COLORS: Record<string, string> = {
    signature: '#3b82f6',
    initial: '#8b5cf6',
    text: '#10b981',
    date: '#f59e0b',
    checkmark: '#06b6d4',
    checkbox: '#06b6d4',
    radio: '#ec4899',
    dropdown: '#f97316',
    attachment: '#84cc16',
    name: '#6366f1',
    email: '#14b8a6',
    company: '#a855f7',
    title: '#f43f5e',
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
    if (!aiAgreementText.trim()) { showToast('Enter agreement text first'); return }
    setAiAgreementRunning(true)
    // Try API first, fall back to heuristic
    fetch('/api/agreement-analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: aiAgreementText }),
    })
      .then(res => {
        if (!res.ok) throw new Error('API not available')
        return res.json()
      })
      .then(data => {
        let html = `<p><strong>${data.summary || 'Analysis complete.'}</strong></p>`
        if (data.risks?.length > 0) {
          html += '<ul>'
          data.risks.forEach((r: string) => { html += `<li>${r}</li>` })
          html += '</ul>'
          if (data.flags) html += `<p>Flags: ${data.flags.map((f: string) => `<span class="ai-chip ai-chip-warn">${f}</span>`).join(' ')}</p>`
        } else {
          html += '<span class="ai-chip ai-chip-ok">Looks clean</span>'
        }
        setAiAgreementResult(html)
        setAiAgreementRunning(false)
      })
      .catch(() => {
        // Fall back to built-in heuristic
        const result = analyzeAgreementHeuristic(aiAgreementText)
        let html = `<p><strong>${result.summary}</strong></p>`
        if (result.risks.length > 0) {
          html += '<ul>'
          result.risks.forEach(r => { html += `<li>${r}</li>` })
          html += '</ul>'
          html += `<p>Flags: ${result.flags.map(f => `<span class="ai-chip ai-chip-warn">${f}</span>`).join(' ')}</p>`
        } else {
          html += '<span class="ai-chip ai-chip-ok">Looks clean</span>'
        }
        setAiAgreementResult(html)
        setAiAgreementRunning(false)
      })
  }

  function runAiTemplate() {
    if (!aiTemplatePrompt.trim()) { showToast('Enter a template prompt first'); return }
    setAiTemplateRunning(true)
    setAiTemplateResult(`<p class="text-gray-400"><i class="fas fa-spinner fa-spin mr-1"></i> Generating your document template...</p>`)
    fetch('/api/generate-template', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: aiTemplatePrompt }),
    })
      .then(res => {
        if (!res.ok) throw new Error('API not available')
        return res.json()
      })
      .then(data => {
        setAiTemplateResult(data.template || data.content || data.text || `<p><strong>Template generated:</strong></p><pre class="whitespace-pre-wrap text-xs bg-slate-100 rounded p-3">${data.result || JSON.stringify(data, null, 2)}</pre>`)
        setAiTemplateRunning(false)
      })
      .catch(() => {
        // Fall back to placeholder result
        setAiTemplateResult(`<p><strong>AI-generated template draft</strong></p><p>Based on your request: "${aiTemplatePrompt.slice(0, 60)}..."</p><p>This template includes standard sections. Connect a template generation API to see full results.</p>`)
        setAiTemplateRunning(false)
      })
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-4">
        <Link
          href="/dashboard"
          className="text-gray-500 hover:text-gray-700 text-sm flex items-center gap-1"
        >
          <span aria-hidden="true">&larr;</span> Back
        </Link>

        <div className="w-px h-6 bg-gray-200" />

        {editingTitle && isDraft ? (
          <div className="flex items-center gap-2">
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="border border-gray-300 rounded px-3 py-1 text-base font-bold outline-none focus:border-blue-400 w-64"
              autoFocus
            />
            <button
              onClick={() => {
                setDocument((prev) => (prev ? { ...prev, title: newTitle } : prev))
                setEditingTitle(false)
              }}
              className="bg-blue-600 text-white px-3 py-1 rounded text-sm font-medium hover:bg-blue-700"
            >
              Save
            </button>
            <button
              onClick={() => {
                setNewTitle(document.title)
                setEditingTitle(false)
              }}
              className="text-gray-500 px-2 py-1 text-sm"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold text-gray-900">{document.title}</h1>
            {isDraft && (
              <button
                onClick={() => setEditingTitle(true)}
                className="text-sm text-blue-600 hover:underline"
              >
                Edit
              </button>
            )}
          </div>
        )}

        <div className="ml-auto flex items-center gap-3">
          <span className={`text-xs px-2.5 py-1 rounded-full font-medium capitalize ${statusBadgeClass}`}>
            {document.status}
          </span>
          <button
            onClick={handleSaveDocument}
            disabled={saving}
            className="bg-white border border-gray-300 text-gray-700 px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </header>

      {/* API notice */}
      {apiNotice && (
        <div className="bg-amber-50 border-b border-amber-100 px-4 py-2 text-xs text-amber-700">
          {apiNotice}
        </div>
      )}

      {/* Main editor grid */}
      <main className="editor-grid flex-1 overflow-hidden">
        {/* Left sidebar — Signers & Fields */}
        <aside className="bg-white border-r border-gray-200 flex flex-col overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-gray-200">
            <button
              onClick={() => setActiveTab('signers')}
              className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                activeTab === 'signers'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Signers
            </button>
            <button
              onClick={() => setActiveTab('fields')}
              className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                activeTab === 'fields'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Fields
            </button>
            <button
              onClick={() => setActiveTab('audit')}
              className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                activeTab === 'audit'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Audit Log
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {/* Signers tab */}
            {activeTab === 'signers' && (
              <div>
                {signers.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-6">No signers added yet.</p>
                ) : (
                  <ul className="space-y-1 mb-3">
                    {signers.map((signer) => (
                      <li key={signer.id} className="signer-row group">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{signer.name}</p>
                          <p className="text-xs text-gray-400 truncate">{signer.email}</p>
                          <span className={`text-xs px-1.5 py-0.5 rounded-full mt-0.5 inline-block ${signerStatusClass(signerStatus(signer))}`}>
                            {signerStatus(signer)}
                          </span>
                        </div>
                        {isDraft && (
                          <button
                            onClick={() => handleRemoveSigner(signer.id)}
                            className="text-red-400 text-xs opacity-0 group-hover:opacity-100 hover:text-red-600 transition-opacity"
                          >
                            <i className="fas fa-times" aria-hidden="true" />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {isDraft && (
                  <form onSubmit={handleAddSigner} className="space-y-2">
                    <input
                      type="text"
                      placeholder="Name"
                      value={signerName}
                      onChange={(e) => setSignerName(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400"
                      required
                    />
                    <input
                      type="email"
                      placeholder="Email"
                      value={signerEmail}
                      onChange={(e) => setSignerEmail(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400"
                      required
                    />
                    <input
                      type="number"
                      placeholder="Order (optional)"
                      value={signerOrder}
                      onChange={(e) => setSignerOrder(Number(e.target.value))}
                      min={0}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400"
                    />
                    <button
                      type="submit"
                      disabled={addingSigner}
                      className="w-full bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                    >
                      {addingSigner ? 'Adding...' : 'Add Signer'}
                    </button>
                  </form>
                )}
              </div>
            )}

            {/* Fields tab */}
            {activeTab === 'fields' && (
              <div>
                {/* Signer selector with Edit Signers link */}
                <div className="mb-3 flex items-center gap-2 flex-wrap">
                  <select
                    value={activeSignerId || ''}
                    onChange={(e) => setActiveSignerId(e.target.value || null)}
                    className="flex-1 min-w-[120px] border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400"
                  >
                    <option value="">— Select signer —</option>
                    {signers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => setActiveTab('edit-signers')}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    Edit Signers
                  </button>
                </div>

                {/* Field type palette */}
                <div className="mb-4">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                    Sign &amp; Edit
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {FIELD_PALETTE.filter(f => f.section === 'sign-edit').map((f) => (
                      <button
                        key={f.kind}
                        draggable={isDraft}
                        onDragStart={(e) => {
                          if (!activeSignerId) { showToast('Select a signer first'); e.preventDefault(); return }
                          e.dataTransfer.setData('application/x-signproz-field', f.kind)
                          e.dataTransfer.effectAllowed = 'copy'
                          setPaletteDragKind(f.kind)
                          setPlacingFieldType(f.kind)
                        }}
                        onDragEnd={() => setPaletteDragKind(null)}
                        onClick={() => {
                          if (!activeSignerId) { showToast('Select a signer first'); return }
                          setPlacingFieldType(f.kind)
                        }}
                        className={`field-chip capitalize text-xs ${placingFieldType === f.kind || paletteDragKind === f.kind ? 'bg-blue-50 border-blue-400 text-blue-700' : 'text-gray-700'}`}
                        style={{ borderColor: placingFieldType === f.kind || paletteDragKind === f.kind ? '#3b82f6' : '#e5e7eb' }}
                      >
                        <i className={`fas ${f.icon} text-xs`} aria-hidden="true" />
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mb-4">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                    Add Fields
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {FIELD_PALETTE.filter(f => f.section === 'add-fields').map((f) => (
                      <button
                        key={f.kind}
                        draggable={isDraft}
                        onDragStart={(e) => {
                          if (!activeSignerId) { showToast('Select a signer first'); e.preventDefault(); return }
                          e.dataTransfer.setData('application/x-signproz-field', f.kind)
                          e.dataTransfer.effectAllowed = 'copy'
                          setPaletteDragKind(f.kind)
                          setPlacingFieldType(f.kind)
                        }}
                        onDragEnd={() => setPaletteDragKind(null)}
                        onClick={() => {
                          if (!activeSignerId) { showToast('Select a signer first'); return }
                          setPlacingFieldType(f.kind)
                        }}
                        className={`field-chip capitalize text-xs ${placingFieldType === f.kind || paletteDragKind === f.kind ? 'bg-blue-50 border-blue-400 text-blue-700' : 'text-gray-700'}`}
                        style={{ borderColor: placingFieldType === f.kind || paletteDragKind === f.kind ? '#3b82f6' : '#e5e7eb' }}
                      >
                        <i className={`fas ${f.icon} text-xs`} aria-hidden="true" />
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Placed fields list */}
                {fields.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-4">
                    No fields placed yet.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {fields.map((field) => {
                      const signer = signers.find((s) => s.id === field.signer_id)
                      return (
                        <li
                          key={field.id}
                          onClick={() => setSelectedFieldId(field.id)}
                          className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer text-sm transition-colors ${
                            selectedFieldId === field.id
                              ? 'bg-blue-50 border border-blue-200'
                              : 'hover:bg-gray-50'
                          }`}
                        >
                          <span
                            className="w-3 h-3 rounded-full flex-shrink-0"
                            style={{ backgroundColor: FIELD_COLORS[field.field_type] || '#6b7280' }}
                            aria-hidden="true"
                          />
                          <span className="flex-1 min-w-0">
                            <span className="capitalize font-medium text-gray-800">
                              {field.field_type.replace(/-/g, ' ')}
                            </span>
                            <br />
                            <span className="text-xs text-gray-400 truncate">
                              {signer ? signer.name : 'Unassigned'}
                            </span>
                            {field.required && (
                              <span className="ml-1 text-xs text-red-400">*</span>
                            )}
                          </span>
                          {isDraft && selectedFieldId === field.id && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleDeleteSelectedField()
                              }}
                              className="text-red-400 text-xs hover:text-red-600 flex-shrink-0"
                            >
                              <i className="fas fa-trash-alt" aria-hidden="true" />
                            </button>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}

                {/* Placing hint */}
                {placingFieldType && (
                  <div className="mt-3 p-2 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-700">
                    Click on the document to place a <strong>{placingFieldType.replace(/-/g, ' ')}</strong> field.
                    <button
                      onClick={() => setPlacingFieldType(null)}
                      className="ml-2 text-blue-600 underline"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Edit Signers tab */}
            {activeTab === 'edit-signers' && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Signers</h3>
                  <button onClick={() => setActiveTab('signers')} className="text-xs text-blue-600 hover:underline">
                    Back
                  </button>
                </div>
                {signers.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-6">No signers added yet.</p>
                ) : (
                  <ul className="space-y-1 mb-3">
                    {signers.map((signer) => (
                      <li key={signer.id} className="signer-row group">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{signer.name}</p>
                          <p className="text-xs text-gray-400 truncate">{signer.email}</p>
                          <span className={`text-xs px-1.5 py-0.5 rounded-full mt-0.5 inline-block ${signerStatusClass(signerStatus(signer))}`}>
                            {signerStatus(signer)}
                          </span>
                        </div>
                        {isDraft && (
                          <button
                            onClick={() => handleRemoveSigner(signer.id)}
                            className="text-red-400 text-xs opacity-0 group-hover:opacity-100 hover:text-red-600 transition-opacity"
                          >
                            <i className="fas fa-times" aria-hidden="true" />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {isDraft && (
                  <form onSubmit={handleAddSigner} className="space-y-2">
                    <input
                      type="text"
                      placeholder="Name"
                      value={signerName}
                      onChange={(e) => setSignerName(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400"
                      required
                    />
                    <input
                      type="email"
                      placeholder="Email"
                      value={signerEmail}
                      onChange={(e) => setSignerEmail(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400"
                      required
                    />
                    <input
                      type="number"
                      placeholder="Order (optional)"
                      value={signerOrder}
                      onChange={(e) => setSignerOrder(Number(e.target.value))}
                      min={0}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400"
                    />
                    <button
                      type="submit"
                      disabled={addingSigner}
                      className="w-full bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                    >
                      {addingSigner ? 'Adding...' : 'Add Signer'}
                    </button>
                  </form>
                )}
              </div>
            )}
          {/* Audit Log tab */}
            {activeTab === 'audit' && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Activity</h3>
                  <button onClick={() => loadAuditLogs()} className="text-xs text-blue-600 hover:underline">
                    Refresh
                  </button>
                </div>
                {auditLogs.length === 0 ? (
                  <div className="text-center py-8">
                    <i className="fas fa-clipboard-list text-gray-300 text-2xl mb-2 block"></i>
                    <p className="text-sm text-gray-400">No activity yet.</p>
                    <p className="text-xs text-gray-300 mt-1">Events will appear here as the document progresses.</p>
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {auditLogs.map((log, i) => (
                      <li key={i} className="border-l-2 border-blue-400 pl-3 py-1">
                        <p className="text-xs font-medium text-gray-800">{log.action}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{log.actor}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-gray-300">{log.timestamp}</span>
                          {log.ip && log.ip !== '—' && (
                            <span className="text-xs text-gray-300">IP: {log.ip}</span>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </aside>

        {/* Center — Document preview area */}
        <div className="flex flex-col bg-slate-100 overflow-hidden">
          {/* Toolbar */}
          <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center gap-2 flex-wrap">
            {placingFieldType ? (
              <span className="text-sm text-blue-600 font-medium">
                Click on document to place <strong>{placingFieldType.replace(/-/g, ' ')}</strong> field
              </span>
            ) : (
              <span className="text-sm text-gray-500">
                Select a field type from the left panel, then click here to place it.
              </span>
            )}
            {selectedFieldId && isDraft && (
              <button
                onClick={handleDeleteSelectedField}
                className="ml-auto text-xs text-red-500 hover:text-red-700 border border-red-200 rounded px-2 py-1"
              >
                <i className="fas fa-trash-alt mr-1" aria-hidden="true" />
                Delete selected
              </button>
            )}
            <button
              onClick={() => setBulkSendOpen(true)}
              className="text-xs bg-amber-100 text-amber-800 border border-amber-200 px-3 py-1.5 rounded-full font-medium hover:bg-amber-200"
            >
              <i className="fas fa-paper-plane mr-1" aria-hidden="true" /> Bulk Send
            </button>
            <button
              onClick={() => setShowAIAgreement(true)}
              className="text-xs bg-violet-100 text-violet-800 border border-violet-200 px-3 py-1.5 rounded-full font-medium hover:bg-violet-200"
            >
              <i className="fas fa-magic mr-1" aria-hidden="true" /> AI agreement review
            </button>
            <button
              onClick={() => setShowAITemplate(true)}
              className="text-xs bg-teal-100 text-teal-800 border border-teal-200 px-3 py-1.5 rounded-full font-medium hover:bg-teal-200"
            >
              <i className="fas fa-sparkles mr-1" aria-hidden="true" /> AI generate template
            </button>
          </div>

          {/* Document preview */}
          <div className="flex-1 overflow-auto p-8 flex items-start justify-center">
            <div
              className={`relative bg-white shadow-xl rounded overflow-hidden select-none ${
                placingFieldType ? 'cursor-crosshair' : ''
              } ${paletteDragKind ? 'document-drop-target' : ''} ${pdfDragOver ? 'pdf-drop-active' : ''}`}
              style={{ width: 612, minHeight: 792 }}
              onClick={handlePlaceField}
              onDragOver={(e) => {
                e.preventDefault()
                e.dataTransfer.dropEffect = 'copy'
                if (!paletteDragKind) setPaletteDragKind(e.dataTransfer.types.includes('application/x-signproz-field') ? 'pending' : 'pdf')
              }}
              onDragLeave={() => setPaletteDragKind(null)}
              onDrop={(e) => {
                e.preventDefault()
                if (e.dataTransfer.files[0]?.type === 'application/pdf') {
                  handlePdfDrop(e)
                } else {
                  handlePaletteDrop(e)
                }
                setPaletteDragKind(null)
              }}
            >
              {/* PDF upload placeholder */}
              {pdfFile ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-50 z-10">
                  <i className="fas fa-file-pdf text-4xl text-red-400 mb-3"></i>
                  <p className="text-sm font-medium text-gray-700">{pdfFile.name}</p>
                  <p className="text-xs text-gray-400 mt-1">PDF document loaded</p>
                  <button
                    onClick={(e) => { e.stopPropagation(); setPdfFile(null); showToast('Document removed') }}
                    className="mt-3 text-xs text-red-500 hover:text-red-700 border border-red-200 px-3 py-1 rounded"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <>
                  {/* Placeholder document content */}
                  <div className="p-12 text-gray-400 text-sm">
                    <div className="space-y-3">
                      <div className="h-4 bg-gray-100 rounded w-3/4" />
                      <div className="h-4 bg-gray-100 rounded w-full" />
                      <div className="h-4 bg-gray-100 rounded w-5/6" />
                      <div className="h-4 bg-gray-100 rounded w-full" />
                      <div className="h-4 bg-gray-100 rounded w-2/3" />
                      <div className="mt-6 h-4 bg-gray-100 rounded w-full" />
                      <div className="h-4 bg-gray-100 rounded w-full" />
                      <div className="h-4 bg-gray-100 rounded w-4/5" />
                      <div className="h-4 bg-gray-100 rounded w-full" />
                      <div className="mt-6 h-4 bg-gray-100 rounded w-full" />
                      <div className="h-4 bg-gray-100 rounded w-3/4" />
                      <div className="h-4 bg-gray-100 rounded w-full" />
                      <div className="h-4 bg-gray-100 rounded w-5/6" />
                    </div>
                  </div>

                  {/* Rendered fields */}
                  {fields.map((field) => {
                    const color = FIELD_COLORS[field.field_type] || '#6b7280'
                    const isSelected = selectedFieldId === field.id
                    const isDragging = draggingFieldId === field.id
                    return (
                      <div
                        key={field.id}
                        className={`signature-field ${isSelected ? 'selected' : ''} ${isDragging ? 'opacity-50' : ''}`}
                        style={{
                          left: (field.position_x / 100) * CANVAS_WIDTH,
                          top: (field.position_y / 100) * CANVAS_HEIGHT,
                          width: (field.width / 100) * CANVAS_WIDTH,
                          height: (field.height / 100) * CANVAS_HEIGHT,
                          color,
                          borderColor: color,
                          borderStyle: field.value ? 'solid' : 'dashed',
                        }}
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelectedFieldId(field.id)
                        }}
                        onMouseDown={(e) => {
                          if (!isDraft || !isSelected) return
                          e.stopPropagation()
                          e.preventDefault()
                          setDraggingFieldId(field.id)
                          setDragOffset({ x: e.clientX - (field.position_x / 100) * CANVAS_WIDTH, y: e.clientY - (field.position_y / 100) * CANVAS_HEIGHT })
                        }}
                        title={`${field.field_type} — ${signers.find((s) => s.id === field.signer_id)?.name || 'Unassigned'}`}
                      >
                        <span className="capitalize">{field.field_type.replace('_', ' ')}</span>
                        {isSelected && isDraft && (
                          <>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDeleteSelectedField() }}
                              className="absolute -top-2 -right-2 w-4 h-4 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600"
                            >
                              <i className="fas fa-times" aria-hidden="true" />
                            </button>
                            <div
                              className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize text-gray-400 hover:text-gray-600"
                              onMouseDown={(e) => {
                                e.stopPropagation()
                                e.preventDefault()
                                setResizingFieldId(field.id)
                                setResizeStart({ x: e.clientX, y: e.clientY, w: (field.width / 100) * CANVAS_WIDTH, h: (field.height / 100) * CANVAS_HEIGHT })
                              }}
                            >
                              <i className="fas fa-expand-arrows-alt text-[8px]" aria-hidden="true" />
                            </div>
                          </>
                        )}
                      </div>
                    )
                  })}
                </>
              )}
            </div>
          </div>
          {/* PDF upload button — shown below preview */}
          <div className="bg-white border-t border-gray-100 px-4 py-2 flex items-center gap-2">
            <label className="text-xs text-gray-500 cursor-pointer flex items-center gap-1 hover:text-blue-600">
              <i className="fas fa-file-pdf text-red-400" aria-hidden="true" />
              <input type="file" accept="application/pdf" className="hidden" onChange={handlePdfFileInput} />
              <span className="underline">{pdfFile ? pdfFile.name : 'Upload PDF'}</span>
            </label>
            {pdfFile && (
              <button
                onClick={() => setPdfFile(null)}
                className="text-xs text-red-400 hover:text-red-600"
              >
                <i className="fas fa-times" aria-hidden="true" />
              </button>
            )}
            <span className="text-xs text-gray-300 ml-auto">Drop PDF here or click to upload</span>
          </div>
        </div>

        {/* Right sidebar — Document settings */}
        <aside className="bg-white border-l border-gray-200 overflow-y-auto">
          <div className="p-4 space-y-5">
            <div>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
                Document Settings
              </h3>
            </div>

            {/* Title */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Title</label>
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400"
              />
            </div>

            {/* Status */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
              <span className={`text-xs px-2.5 py-1 rounded-full font-medium capitalize ${statusBadgeClass}`}>
                {document.status}
              </span>
            </div>

            {/* Expiration days */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Expires in
              </label>
              <select
                value={expirationDays}
                onChange={(e) => setExpirationDays(Number(e.target.value))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400"
                disabled={!isDraft}
              >
                {[7, 14, 30, 60].map((d) => (
                  <option key={d} value={d}>
                    {d} days
                  </option>
                ))}
              </select>
              {expirationDate && (
                <div className="mt-1.5 text-xs text-amber-600 flex items-center gap-1">
                  <i className="fas fa-clock" aria-hidden="true"></i>
                  {expirationCountdown || 'Calculating...'}
                </div>
              )}
            </div>

            {/* Expiration reminder */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Reminder
              </label>
              <select
                value={expirationReminder}
                onChange={(e) => setExpirationReminder(e.target.value as 'none' | '1' | '3' | '7')}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400"
              >
                <option value="none">No reminder</option>
                <option value="1">1 day before expiry</option>
                <option value="3">3 days before expiry</option>
                <option value="7">7 days before expiry</option>
              </select>
            </div>

            {/* Signing mode */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-2">
                Signing order
              </label>
              <div className="space-y-1.5">
                {(['sequential', 'parallel'] as SigningMode[]).map((mode) => (
                  <label
                    key={mode}
                    className="flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors text-sm"
                    style={{
                      borderColor: signingMode === mode ? '#3b82f6' : '#e5e7eb',
                      backgroundColor: signingMode === mode ? '#eff6ff' : 'transparent',
                    }}
                  >
                    <input
                      type="radio"
                      name="signingMode"
                      value={mode}
                      checked={signingMode === mode}
                      onChange={() => setSigningMode(mode)}
                      className="accent-blue-600"
                    />
                    <span className="capitalize font-medium text-gray-700">
                      {mode}
                    </span>
                    <span className="text-xs text-gray-400 ml-auto">
                      {mode === 'sequential' ? 'One at a time' : 'All at once'}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* Field validation rules — shown when a field is selected */}
            {selectedFieldId && isDraft && (
              <div className="pt-3 border-t border-gray-100">
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                  Field Settings
                </h4>
                {(() => {
                  const field = fields.find(f => f.id === selectedFieldId)
                  if (!field) return null
                  return (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Field type</label>
                        <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-700 capitalize">
                          {field.field_type.replace(/-/g, ' ')}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id="field-required"
                          checked={field.required || false}
                          onChange={(e) => {
                            setFields(prev => prev.map(f =>
                              f.id === selectedFieldId ? { ...f, required: e.target.checked } : f
                            ))
                          }}
                          className="accent-red-500"
                        />
                        <label htmlFor="field-required" className="text-sm text-gray-700 cursor-pointer">
                          Required
                        </label>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Label</label>
                        <input
                          type="text"
                          value={field.label || ''}
                          onChange={(e) => {
                            setFields(prev => prev.map(f =>
                              f.id === selectedFieldId ? { ...f, label: e.target.value } : f
                            ))
                          }}
                          className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-blue-400"
                          placeholder="Optional label"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Width</label>
                        <input
                          type="number"
                          value={field.width}
                          onChange={(e) => {
                            setFields(prev => prev.map(f =>
                              f.id === selectedFieldId ? { ...f, width: Number(e.target.value) } : f
                            ))
                          }}
                          min={8}
                          max={82}
                          className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-blue-400"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Height</label>
                        <input
                          type="number"
                          value={field.height}
                          onChange={(e) => {
                            setFields(prev => prev.map(f =>
                              f.id === selectedFieldId ? { ...f, height: Number(e.target.value) } : f
                            ))
                          }}
                          min={4}
                          max={25}
                          className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-blue-400"
                        />
                      </div>
                    </div>
                  )
                })()}
              </div>
            )}

            {/* Send for signing */}
            <div className="pt-2 border-t border-gray-100">
              <button
                onClick={handleSendDocument}
                disabled={sending || signers.length === 0 || !isDraft}
                className="w-full bg-blue-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sending ? 'Sending...' : 'Send for Signing'}
              </button>
              {signers.length === 0 && isDraft && (
                <p className="text-xs text-amber-600 mt-1.5 text-center">
                  Add at least one signer first.
                </p>
              )}
            </div>
          </div>
        </aside>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 px-4 py-3 flex items-center gap-3">
        <button
          onClick={handleSaveDocument}
          disabled={saving}
          className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button
          onClick={handleSendDocument}
          disabled={sending || signers.length === 0 || !isDraft}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {sending ? 'Sending...' : 'Send / Preview'}
        </button>
      </footer>

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

      {/* Bulk Send Modal */}
      {bulkSendOpen && (
        <div className="fixed inset-0 bg-black/55 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={(e) => { if (e.target === e.currentTarget) setBulkSendOpen(false) }}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2"><i className="fas fa-paper-plane text-amber-500"></i> Bulk Send</h3>
              <button onClick={() => setBulkSendOpen(false)} className="text-gray-400 hover:text-gray-600 p-2 rounded-lg hover:bg-gray-100">
                <i className="fas fa-times"></i>
              </button>
            </div>
            <p className="text-sm text-gray-500 mb-3">Select documents to send to signers at once.</p>
            {bulkDocs.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">No documents found. Create documents first.</p>
            ) : (
              <ul className="space-y-2 max-h-48 overflow-y-auto mb-4 border border-gray-100 rounded-lg p-2">
                {bulkDocs.map((doc) => (
                  <li key={doc.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={doc.selected}
                      onChange={() => setBulkDocs(prev => prev.map(d => d.id === doc.id ? { ...d, selected: !d.selected } : d))}
                      className="accent-blue-600"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{doc.title}</p>
                      <p className="text-xs text-gray-400 capitalize">{doc.status}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-600 mb-1">Custom message (optional)</label>
              <textarea
                value={bulkMessage}
                onChange={(e) => setBulkMessage(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400"
                placeholder="Add a personal note to all recipients..."
                rows={3}
              />
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={async () => {
                  const selected = bulkDocs.filter(d => d.selected)
                  if (selected.length === 0) { showToast('Select at least one document'); return }
                  if (!confirm(`Send ${selected.length} document(s) to their signers?`)) return
                  setBulkSending(true)
                  let sent = 0
                  for (const doc of selected) {
                    const res = await fetch(`/api/documents/${doc.id}/send`, { method: 'POST' })
                    if (res.ok) sent++
                  }
                  setBulkSending(false)
                  showToast(`Sent ${sent}/${selected.length} document(s)`)
                  setBulkSendOpen(false)
                  // Reset selection
                  setBulkDocs(prev => prev.map(d => ({ ...d, selected: false })))
                }}
                disabled={bulkSending || bulkDocs.filter(d => d.selected).length === 0}
                className="flex-1 bg-amber-600 text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-amber-700 disabled:opacity-50"
              >
                <i className="fas fa-paper-plane mr-2" aria-hidden="true"></i>{bulkSending ? 'Sending...' : `Send ${bulkDocs.filter(d => d.selected).length || ''} document${bulkDocs.filter(d => d.selected).length !== 1 ? 's' : ''}`}
              </button>
              <button
                onClick={() => setBulkSendOpen(false)}
                className="px-4 py-2.5 rounded-xl text-sm text-gray-500 hover:bg-gray-100"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-sm px-4 py-2 rounded-lg shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  )
}
