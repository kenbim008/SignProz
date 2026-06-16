'use client'

import { useState, useRef, useEffect } from 'react'
import { Modal } from './Modal'

export interface AiFaqModalProps {
  isOpen: boolean
  onClose: () => void
}

export interface FaqMessage {
  id: string
  role: 'user' | 'ai'
  text: string
}

const QUICK_QUESTIONS = [
  'How does affiliate commission work?',
  'What API and integrations are supported?',
  'How do I send documents in bulk?',
  'What security measures do you have in place?',
]

export function AiFaqModal({ isOpen, onClose }: AiFaqModalProps) {
  const [messages, setMessages] = useState<FaqMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const sendMessage = async (question: string) => {
    if (!question.trim()) return

    const userMsg: FaqMessage = { id: Date.now().toString(), role: 'user', text: question }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/ai/faq?question=${encodeURIComponent(question)}`)
      if (!res.ok) throw new Error('Failed to get response')
      const data = await res.json()
      const aiMsg: FaqMessage = { id: (Date.now() + 1).toString(), role: 'ai', text: data.answer }
      setMessages((prev) => [...prev, aiMsg])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get response')
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="SignProz AI FAQ Assistant" maxWidth="max-w-2xl">
      {/* Message list */}
      <div className="max-h-96 overflow-y-auto flex-1 flex flex-col gap-2 mb-4">
        {messages.length === 0 && !loading && (
          <p className="text-sm text-slate-400 text-center py-8">
            Ask about plans, API, integrations, compliance, and signing flow.
          </p>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={msg.role === 'user' ? 'faq-msg-user' : 'faq-msg-bot'}
          >
            {msg.role === 'ai' && (
              <div className="flex items-center gap-1.5 mb-1">
                <div className="w-5 h-5 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold flex-shrink-0">AI</div>
                <span className="text-xs text-slate-500">SignProz Assistant</span>
              </div>
            )}
            <span className="whitespace-pre-wrap">{msg.text}</span>
          </div>
        ))}
        {loading && (
          <div className="faq-msg-bot">
            <div className="flex items-center gap-1.5 mb-1">
              <div className="w-5 h-5 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold flex-shrink-0">AI</div>
              <span className="text-xs text-slate-500">SignProz Assistant</span>
            </div>
            <span className="text-slate-400 animate-pulse">Typing...</span>
          </div>
        )}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
            {error}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick questions */}
      <div className="flex flex-wrap gap-2 mb-3">
        {QUICK_QUESTIONS.map((q) => (
          <button
            key={q}
            onClick={() => sendMessage(q)}
            className="text-xs bg-slate-100 text-slate-700 px-2.5 py-1 rounded-full hover:bg-slate-200"
          >
            {q}
          </button>
        ))}
      </div>

      {/* Input */}
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask SignProz a question..."
          className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-200 outline-none"
        />
        <button
          onClick={() => sendMessage(input)}
          disabled={loading || !input.trim()}
          className="bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Send
        </button>
      </div>
    </Modal>
  )
}
