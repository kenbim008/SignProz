import { describe, it, expect } from 'vitest'
import { ServiceError, serviceErrorToStatus } from '@/services/errors'

describe('serviceErrorToStatus (D.3 additions)', () => {
  it('maps INTEGRITY_FAILURE to 500', () => {
    expect(serviceErrorToStatus('INTEGRITY_FAILURE')).toBe(500)
  })
  it('maps BLOB_UPLOAD_FAILED to 500', () => {
    expect(serviceErrorToStatus('BLOB_UPLOAD_FAILED')).toBe(500)
  })
  it('maps CERT_NOT_FOUND to 404', () => {
    expect(serviceErrorToStatus('CERT_NOT_FOUND')).toBe(404)
  })
})
