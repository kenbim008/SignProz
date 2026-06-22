# Stage 4 — Product Completion

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Align marketing claims with shipped functionality. Remove or mark placeholder features. Implement critical missing pieces (document filtering, duplication) while removing or labeling mock behavior (Stripe, cloud integrations, referral samples).

**Architecture:** Audit the home page, pricing page, FAQ, and dashboard for unsupported claims. Either implement or relabel each. Replace mock/sample data with real API responses.

**Tech Stack:** Next.js, TypeScript, Tailwind CSS

---

### Task 4.1: Audit and fix marketing claims on home page

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Review home page for unsupported claims**

Search for these terms: `HIPAA`, `400+ integrations`, `Microsoft 365`, `CRM`, `Payments`, `Bulk sending`, `Workflow automation`, `Mobile app`, `AES-256`, `BAA`

- [ ] **Step 2: Replace or remove each unsupported claim**

Replace `HIPAA compliant` → `Privacy compliant`
Replace `400+ integrations` → `API access`
Replace `Microsoft 365, CRM, Payments, Bulk sending` → `Coming soon` badges or remove

Add a small disclaimer: *"Features marked as 'Coming soon' are in development and not yet available."*

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "fix: trim marketing claims to match shipped functionality"
```

---

### Task 4.2: Audit and fix FAQ page

**Files:**
- Modify: `src/app/(site)/faq/page.tsx` or `src/components/faq.tsx` (if exists)

- [ ] **Step 1: Find and fix all FAQ claims**

Search for: `AES-256`, `HIPAA-ready`, `BAA`, `Slack`, `CSV upload`, `API bulk send`

Remove or replace each with accurate statements.

- [ ] **Step 2: Commit**

```bash
git add src/app/faq/page.tsx
git commit -m "fix: align FAQ claims with current implementation"
```

---

### Task 4.3: Replace mock/sample referral data with real API

**Files:**
- Modify: `src/app/dashboard/page.tsx`

- [ ] **Step 1: Remove hard-coded sample referrals**

Delete the `recentReferrals` constant and the `showSampleReferrals` state.

- [ ] **Step 2: Fetch real data from the referrals API**

Replace:
```typescript
fetch('/api/affiliate/stats')
  .then((r) => r.ok ? r.json() : null)
  .then((stats) => {
    if (stats) {
      setAffiliateStats(stats)
      setTier(stats.tier || 'bronze')
      setWithdrawableBalance(stats.expectedPayout || 0)
    }
  })
  .catch(() => {/* use mock data */})
```

With proper fallback to zeros (not mock data):
```typescript
fetch('/api/affiliate/stats')
  .then((r) => r.ok ? r.json() : { totalReferrals: 0, activeAccounts: 0, expectedPayout: 0, paidOut: 0, tier: 'bronze' })
  .then((stats) => {
    setAffiliateStats(stats)
    setTier(stats.tier || 'bronze')
    setWithdrawableBalance(stats.expectedPayout || 0)
  })
  .catch(() => {
    setAffiliateStats({ totalReferrals: 0, activeAccounts: 0, expectedPayout: 0, paidOut: 0, tier: 'bronze' })
  })
```

- [ ] **Step 3: Remove the "Load Sample" button and related UI**

Delete the button and the `showSampleReferrals` conditional rendering block.

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/page.tsx
git commit -m "fix: replace mock referral data with real API fallback"
```

---

### Task 4.4: Label or remove Stripe mock UI

**Files:**
- Modify: `src/app/dashboard/page.tsx`

- [ ] **Step 1: Add "Coming soon" label to Stripe section**

Wrap the Stripe Payouts panel content with a clear indicator:

```typescript
{/* Stripe Payouts — Coming Soon */}
<div className="mt-6 bg-white rounded-2xl border border-gray-100 p-5 shadow-sm opacity-60">
  <div className="flex items-center justify-between mb-1">
    <h3 className="font-bold text-gray-900 flex items-center gap-2">
      <i className="fab fa-stripe-s text-indigo-600"></i> Stripe Payouts
    </h3>
    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700">
      Coming Soon
    </span>
  </div>
  <p className="text-xs text-gray-500">
    Stripe Connect integration is in development. You'll be able to receive affiliate payouts directly.
  </p>
</div>
```

- [ ] **Step 2: Remove the simulated Stripe connect flow**

Delete `startStripeConnect`, `confirmStripeConnect`, `requestWithdrawal` functions and related state.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/page.tsx
git commit -m "fix: replace mock Stripe flow with coming-soon notice"
```

---

### Task 4.5: Label cloud import buttons as coming soon

**Files:**
- Modify: `src/app/dashboard/page.tsx`

- [ ] **Step 1: Add coming-soon badges to cloud import buttons**

```typescript
<button style={{ display: 'block', width: '100%', padding: '8px 12px', textAlign: 'left', border: 'none', background: '#fff', cursor: 'pointer', color: '#475569' }}>
  Google Drive <span className="text-xs text-amber-600">(Coming soon)</span>
</button>
```

- [ ] **Step 2: Commit**

```bash
git add src/app/dashboard/page.tsx
git commit -m "fix: label cloud import as coming soon"
```

---

### Task 4.6: Implement document status filtering

**Files:**
- Modify: `src/app/dashboard/page.tsx`

- [ ] **Step 1: Fix the doc filter to actually filter by status**

Replace the current `getFilteredDocs()` function:

```typescript
function getFilteredDocs() {
  let docs = documents
  const q = searchQuery.trim().toLowerCase()
  if (q) docs = docs.filter((d) => d.title.toLowerCase().includes(q))

  // Apply status filter
  if (docFilter === 'waiting_me') {
    docs = docs.filter(d => d.status === 'sent' || d.status === 'partially_signed')
  } else if (docFilter === 'waiting_others') {
    docs = docs.filter(d => d.status === 'sent' || d.status === 'partially_signed')
  } else if (docFilter === 'signed') {
    docs = docs.filter(d => d.status === 'completed')
  }

  return docs
}
```

Also update the filter labels to be accurate:
```
'waiting_me' → 'Sent'
'waiting_others' → 'In Progress'
'signed' → 'Completed'
```

- [ ] **Step 2: Commit**

```bash
git add src/app/dashboard/page.tsx
git commit -m "fix: implement document status filtering"
```

---

### Task 4.7: Fix AI agreement and template labels

**Files:**
- Modify: `src/app/dashboard/page.tsx`

- [ ] **Step 1: Label AI features as heuristic/demo**

For the agreement review:
```typescript
<button ...>
  <i className="fas fa-magic mr-1"></i> Agreement review (heuristic)
</button>
```

For the AI template generator:
```typescript
<button ...>
  <i className="fas fa-sparkles mr-1"></i> Template demo
</button>
```

- [ ] **Step 2: Commit**

```bash
git add src/app/dashboard/page.tsx
git commit -m "fix: label AI features as heuristic/demo to set expectations"
```

---

### Verification Checklist (Stage 4)

- [ ] No unsupported HIPAA / compliance claims on home page
- [ ] No unsupported integration claims (400+, Microsoft 365, CRM, etc.)
- [ ] FAQ doesn't claim AES-256, BAA, or Slack integration
- [ ] Referral section shows real API data, not hardcoded samples
- [ ] "Load Sample" button removed
- [ ] Stripe section labeled "Coming Soon", mock connect flow removed
- [ ] Cloud import buttons labeled "Coming soon"
- [ ] Document status filters actually filter by status
- [ ] AI features labeled as heuristic/demo
