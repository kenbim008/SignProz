'use client'

import { useState } from 'react'
import Link from 'next/link'

const plans = [
  {
    name: 'Free',
    price: 0,
    description: 'For individuals just getting started',
    color: 'white',
    borderColor: 'border-slate-200',
    iconBg: 'bg-blue-50',
    iconColor: 'text-blue-500',
    icon: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
      </svg>
    ),
    features: ['5 documents/month', '1 sender', 'Email notifications', 'Basic templates', 'Community support'],
    cta: 'Get started free',
    ctaHref: '/signup',
    ctaStyle: 'bg-slate-100 text-slate-900 hover:bg-slate-200',
  },
  {
    name: 'Pro',
    price: { monthly: 20, yearly: 10 },
    description: 'For growing teams and professionals',
    color: 'gradient',
    borderColor: 'border-indigo-200',
    iconBg: 'bg-indigo-50',
    iconColor: 'text-indigo-600',
    badge: 'Most Popular',
    icon: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
    features: ['Unlimited documents', '5 senders', 'Sequential & parallel signing', 'AI-assisted drafting', 'Bulk sending', 'Custom branding', 'Priority support'],
    cta: 'Start free trial',
    ctaHref: '/signup',
    ctaStyle: 'bg-blue-600 text-white hover:bg-blue-700',
    highlight: true,
  },
  {
    name: 'Premium',
    price: { monthly: 59.95, yearly: 39.95 },
    description: 'For organizations that need it all',
    color: 'white',
    borderColor: 'border-slate-200',
    iconBg: 'bg-pink-50',
    iconColor: 'text-pink-600',
    icon: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
      </svg>
    ),
    features: ['Everything in Pro', 'Unlimited senders', 'Data encryption (TLS)', '400+ integrations', 'Sales CRM integration', 'Microsoft 365 integration', 'Dedicated support', 'API access (affordable tiers)'],
    cta: 'Start free trial',
    ctaHref: '/signup',
    ctaStyle: 'bg-fuchsia-600 text-white hover:bg-fuchsia-700',
  },
  {
    name: 'Enterprise',
    price: 499,
    description: 'Advanced scale and compliance for larger teams',
    color: 'dark',
    borderColor: 'border-transparent',
    iconBg: 'bg-purple-900',
    iconColor: 'text-purple-300',
    icon: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
      </svg>
    ),
    features: ['Unlimited documents', 'Unlimited senders and team roles', 'SLA + SSO', 'White-labeling & custom branding', 'API and webhook support', 'Priority onboarding and support', 'Security controls and audit exports', 'Dedicated account management'],
    cta: 'Contact sales',
    ctaHref: '/signup',
    ctaStyle: 'bg-white text-purple-900 hover:bg-slate-100',
  },
]

export default function PricingClient() {
  const [isYearly, setIsYearly] = useState(true)

  return (
    <>
      {/* Billing cycle toggle */}
      <div className="flex items-center justify-center mb-12">
        <div className="inline-flex gap-2 rounded-full bg-slate-100 p-1">
          <button
            onClick={() => setIsYearly(true)}
            className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-all ${isYearly ? 'bg-blue-600 text-white shadow' : 'bg-white text-slate-600 border border-slate-200'}`}
          >
            Yearly billing
          </button>
          <button
            onClick={() => setIsYearly(false)}
            className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-all ${!isYearly ? 'bg-blue-600 text-white shadow' : 'bg-white text-slate-600 border border-slate-200'}`}
          >
            Monthly billing
          </button>
        </div>
      </div>

      {/* Plans grid */}
      <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-6">
        {plans.map((plan) => {
          const displayPrice = typeof plan.price === 'number'
            ? plan.price
            : isYearly ? plan.price.yearly : plan.price.monthly
          const perMonth = typeof plan.price !== 'number' && isYearly
            ? `$${plan.price.yearly} / month`
            : null

          return (
            <div
              key={plan.name}
              className={`rounded-2xl p-6 border-2 ${plan.borderColor} ${plan.color === 'gradient' ? 'bg-gradient-to-br from-indigo-50 to-blue-50' : plan.color === 'dark' ? 'bg-gradient-to-br from-purple-900 to-indigo-900 text-white' : 'bg-white'}`}
            >
              {plan.badge && (
                <div className="relative -top-3 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-xs font-bold px-3 py-1 rounded-full inline-block">
                  {plan.badge}
                </div>
              )}

              <div className={`inline-flex p-3 rounded-xl ${plan.iconBg} mb-4`}>
                <div className={plan.iconColor}>{plan.icon}</div>
              </div>

              <h2 className={`text-2xl font-bold ${plan.color === 'dark' ? 'text-white' : 'text-slate-900'}`}>{plan.name}</h2>
              <p className={`text-sm mt-1 ${plan.color === 'dark' ? 'text-purple-200' : 'text-slate-500'}`}>{plan.description}</p>

              <div className={`mt-6 mb-4 ${plan.color === 'dark' ? 'text-white' : ''}`}>
                <span className={`text-4xl font-extrabold ${plan.color === 'dark' ? 'text-white' : 'text-slate-900'}`}>${displayPrice}</span>
                {perMonth ? (
                  <p className="text-xs text-slate-400 mt-1">{perMonth}</p>
                ) : (
                  <span className="text-slate-500">/month</span>
                )}
              </div>

              {typeof plan.price !== 'number' && (
                <p className={`text-xs mb-4 ${plan.color === 'dark' ? 'text-purple-200' : 'text-slate-400'}`}>
                  {isYearly
                    ? `Billed annually (save ${Math.round((1 - plan.price.yearly / plan.price.monthly) * 100)}%)`
                    : `Billed monthly`}
                </p>
              )}

              <Link
                href={plan.ctaHref}
                className={`block text-center font-semibold py-3 rounded-xl mt-4 transition-colors ${plan.ctaStyle}`}
              >
                {plan.cta}
              </Link>

              <ul className={`mt-6 space-y-3 ${plan.color === 'dark' ? 'text-purple-100' : ''}`}>
                {plan.features.map((f) => (
                  <li key={f} className={`flex items-center gap-2 text-sm ${plan.color === 'dark' ? 'text-purple-100' : 'text-slate-600'}`}>
                    <svg className={`w-4 h-4 flex-shrink-0 ${plan.color === 'dark' ? 'text-purple-300' : 'text-blue-500'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>
    </>
  )
}
