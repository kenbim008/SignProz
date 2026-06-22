import { EvidenceService } from '@/services'
import type { Metadata } from 'next'

interface PageProps {
  params: Promise<{ certificateId: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { certificateId } = await params
  return {
    title: `Certificate ${certificateId.slice(0, 8)} — SignProz Verification`,
    robots: 'noindex',
  }
}

export default async function VerifyPage({ params }: PageProps) {
  const { certificateId } = await params
  const result = await EvidenceService.verifyCertificate(certificateId)

  return (
    <main style={{ maxWidth: 720, margin: '40px auto', padding: 24, fontFamily: 'system-ui' }}>
      <h1>Certificate Verification</h1>
      <p>Certificate ID: <code>{certificateId}</code></p>

      {result.valid && (
        <div style={{ background: '#d4edda', padding: 16, borderRadius: 8, marginTop: 16 }}>
          <h2 style={{ color: '#155724', margin: 0 }}>✓ Valid</h2>
          <p>All integrity checks passed.</p>
          <ul>
            <li>Audit chain: ✓</li>
            <li>Transparency log: ✓</li>
            <li>TSA timestamp: {result.tsaOk ? '✓' : '⏳ Pending'}</li>
          </ul>
          <h3>{result.manifest.documentTitle}</h3>
          <p>Completed: {result.manifest.completedAt}</p>
          <h4>Signers</h4>
          <ul>
            {result.manifest.signers.map((s, i) => (
              <li key={i}>{s.name || s.email} &lt;{s.email}&gt; — signed {s.signedAt}</li>
            ))}
          </ul>
        </div>
      )}

      {!result.valid && (
        <div style={{ background: '#f8d7da', padding: 16, borderRadius: 8, marginTop: 16 }}>
          <h2 style={{ color: '#721c24', margin: 0 }}>✗ Invalid</h2>
          <p>Failure: <strong>{result.failure}</strong></p>
          {result.details && <p>Details: {result.details}</p>}
        </div>
      )}
    </main>
  )
}
