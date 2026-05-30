---
name: marketing-digital
description: Instrument digital marketing — GA4 event tracking, Google Tag Manager, JSON-LD structured data, Core Web Vitals monitoring, A/B testing, and GDPR consent gating
domain: marketing
type: cross-cutting
triggers:
  - "Google Analytics"
  - "GA4"
  - "GTM"
  - "SEO"
  - "digital marketing"
  - "conversion tracking"
  - "A/B testing"
  - "structured data"
  - "JSON-LD"
  - "Core Web Vitals"
  - "Tag Manager"
---

# Digital Marketing Instrumentation

## When to use

When a project needs to measure user behavior, improve search ranking, or run experiments. Set up this instrumentation at project start — retroactive analytics miss critical early data. Implement in order: consent mechanism first, then Tag Manager (the single deployment point), then GA4 events, then structured data, then A/B testing.

## Prerequisites

- A deployed web app with a stable domain (GTM preview mode works on localhost)
- Google Analytics 4 property created at [analytics.google.com](https://analytics.google.com) — note your Measurement ID (`G-XXXXXXXXXX`)
- Google Tag Manager container created at [tagmanager.google.com](https://tagmanager.google.com) — note your Container ID (`GTM-XXXXXXX`)
- GDPR/privacy review completed — know which regions require explicit consent before firing analytics

## Privacy First: Consent Before Tracking

**GDPR requires explicit consent before loading analytics in the EU.** Fire GA4 only after consent is granted. Use a consent banner and gate all tags in GTM with a consent variable.

```typescript
// src/lib/consent.ts
type ConsentState = "granted" | "denied" | "pending";

interface ConsentSettings {
  analytics: ConsentState;
  marketing: ConsentState;
}

const CONSENT_KEY = "user_consent_v1";

export function getConsentSettings(): ConsentSettings {
  try {
    const stored = localStorage.getItem(CONSENT_KEY);
    return stored ? JSON.parse(stored) : { analytics: "pending", marketing: "pending" };
  } catch {
    return { analytics: "pending", marketing: "pending" };
  }
}

export function grantConsent(categories: Partial<ConsentSettings>) {
  const current = getConsentSettings();
  const updated = { ...current, ...categories };
  localStorage.setItem(CONSENT_KEY, JSON.stringify(updated));

  // Update GTM consent state
  if (typeof window !== "undefined" && window.gtag) {
    window.gtag("consent", "update", {
      analytics_storage: updated.analytics === "granted" ? "granted" : "denied",
      ad_storage: updated.marketing === "granted" ? "granted" : "denied",
    });
  }

  // Notify GTM of consent update via dataLayer
  window.dataLayer?.push({
    event: "consent_update",
    analytics_consent: updated.analytics,
    marketing_consent: updated.marketing,
  });
}

export function denyConsent() {
  grantConsent({ analytics: "denied", marketing: "denied" });
}
```

## Step 1 — Google Tag Manager (GTM) Container

GTM is the deployment point for all tracking tags. You manage GA4, conversion pixels, and custom scripts in GTM without deploying new code. Add the snippet to every page.

```html
<!-- In <head> — as high as possible -->
<script>
  // Initialize consent to denied by default (GDPR: deny-by-default)
  window.dataLayer = window.dataLayer || [];
  function gtag() { dataLayer.push(arguments); }
  gtag("consent", "default", {
    analytics_storage: "denied",
    ad_storage: "denied",
    wait_for_update: 500,   // ms to wait for consent update before firing tags
  });

  // GTM container snippet (replace GTM-XXXXXXX with your container ID)
  (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
  new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
  j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
  'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
  })(window,document,'script','dataLayer','GTM-XXXXXXX');
</script>

<!-- In <body> — immediately after opening tag (noscript fallback) -->
<noscript>
  <iframe src="https://www.googletagmanager.com/ns.html?id=GTM-XXXXXXX"
    height="0" width="0" style="display:none;visibility:hidden"></iframe>
</noscript>
```

React / Next.js — use the `@next/third-parties` package or inject via `_document.tsx`:

```tsx
// app/layout.tsx (Next.js App Router)
import Script from "next/script";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <Script id="gtm-consent-default" strategy="beforeInteractive">{`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('consent','default',{analytics_storage:'denied',ad_storage:'denied',wait_for_update:500});
        `}</Script>
        <Script
          id="gtm-script"
          strategy="afterInteractive"
          src="https://www.googletagmanager.com/gtm.js?id=GTM-XXXXXXX"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
```

## Step 2 — GA4 Custom Event Pattern

With GTM loaded, push custom events to the dataLayer. Configure a GTM trigger for each event name to fire the GA4 event tag.

```typescript
// src/lib/analytics.ts
declare global {
  interface Window {
    dataLayer: Record<string, unknown>[];
    gtag: (...args: unknown[]) => void;
  }
}

// Push a custom event to the GTM dataLayer
export function trackEvent(
  eventName: string,
  parameters: Record<string, string | number | boolean> = {}
) {
  if (typeof window === "undefined") return;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({
    event: eventName,
    ...parameters,
  });
}

// Typed event factories — define your event taxonomy here
export const analytics = {
  // E-commerce
  viewProduct: (productId: string, name: string, price: number) =>
    trackEvent("view_item", { item_id: productId, item_name: name, value: price }),

  addToCart: (productId: string, quantity: number, price: number) =>
    trackEvent("add_to_cart", { item_id: productId, quantity, value: price * quantity }),

  purchase: (orderId: string, total: number, currency = "USD") =>
    trackEvent("purchase", { transaction_id: orderId, value: total, currency }),

  // Engagement
  signUp: (method: string) =>
    trackEvent("sign_up", { method }),

  login: (method: string) =>
    trackEvent("login", { method }),

  // Content
  ctaClick: (ctaName: string, location: string) =>
    trackEvent("cta_click", { cta_name: ctaName, location }),

  formSubmit: (formName: string) =>
    trackEvent("form_submit", { form_name: formName }),

  search: (term: string, resultsCount: number) =>
    trackEvent("search", { search_term: term, results_count: resultsCount }),
};
```

Usage in React:

```tsx
import { analytics } from "@/lib/analytics";

function PricingCard({ plan }: { plan: Plan }) {
  return (
    <button
      onClick={() => {
        analytics.ctaClick("Get Started", `pricing-${plan.name}`);
        router.push(`/checkout?plan=${plan.id}`);
      }}
    >
      Get Started — {plan.name}
    </button>
  );
}
```

## Step 3 — JSON-LD Structured Data

Structured data helps Google understand page content and can unlock rich results (stars, FAQs, breadcrumbs) in search. Add JSON-LD via a `<script type="application/ld+json">` tag in the `<head>`.

```tsx
// src/components/StructuredData.tsx
interface Props {
  data: Record<string, unknown>;
}

export function StructuredData({ data }: Props) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

// Organization schema — goes on every page
export const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Acme Corp",
  url: "https://acme.com",
  logo: "https://acme.com/logo.png",
  sameAs: [
    "https://twitter.com/acmecorp",
    "https://linkedin.com/company/acmecorp",
  ],
  contactPoint: {
    "@type": "ContactPoint",
    telephone: "+1-800-555-0100",
    contactType: "customer service",
  },
};

// Product schema
export function productSchema(product: {
  name: string;
  description: string;
  image: string;
  price: number;
  currency: string;
  sku: string;
  rating?: { value: number; count: number };
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description,
    image: product.image,
    sku: product.sku,
    offers: {
      "@type": "Offer",
      price: product.price,
      priceCurrency: product.currency,
      availability: "https://schema.org/InStock",
    },
    ...(product.rating && {
      aggregateRating: {
        "@type": "AggregateRating",
        ratingValue: product.rating.value,
        reviewCount: product.rating.count,
      },
    }),
  };
}

// FAQ schema — unlocks FAQ rich results in SERP
export function faqSchema(faqs: { question: string; answer: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };
}

// BreadcrumbList schema — shows breadcrumbs in SERP
export function breadcrumbSchema(crumbs: { name: string; url: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: crumb.name,
      item: crumb.url,
    })),
  };
}
```

## Step 4 — Core Web Vitals Monitoring

```typescript
// src/lib/vitals.ts — observe and report CWV to your analytics
import { onCLS, onFID, onFCP, onLCP, onTTFB, onINP, type Metric } from "web-vitals";

function sendToAnalytics(metric: Metric) {
  // Send to GA4 via dataLayer
  window.dataLayer?.push({
    event: "web_vitals",
    metric_name: metric.name,       // CLS, FID, FCP, LCP, TTFB, INP
    metric_value: Math.round(metric.value),
    metric_rating: metric.rating,   // "good", "needs-improvement", "poor"
    metric_delta: Math.round(metric.delta),
    metric_id: metric.id,
  });
}

export function initCoreWebVitals() {
  onCLS(sendToAnalytics);    // Cumulative Layout Shift — good: <0.1
  onFID(sendToAnalytics);    // First Input Delay (legacy) — good: <100ms
  onINP(sendToAnalytics);    // Interaction to Next Paint — good: <200ms
  onFCP(sendToAnalytics);    // First Contentful Paint — good: <1.8s
  onLCP(sendToAnalytics);    // Largest Contentful Paint — good: <2.5s
  onTTFB(sendToAnalytics);   // Time to First Byte — good: <800ms
}
```

```bash
npm install web-vitals
```

Call `initCoreWebVitals()` once in the app entry point (after consent is granted).

## Step 5 — A/B Testing with Feature Flags

Simple client-side A/B test using `localStorage` for persistence. For production scale, use a proper feature flag service (LaunchDarkly, Statsig, GrowthBook).

```typescript
// src/lib/experiments.ts
interface Experiment {
  id: string;
  variants: string[];            // variant names; first = control
  weights?: number[];            // probability weights (must sum to 1); default: equal
}

const EXPERIMENTS: Experiment[] = [
  {
    id: "hero_cta_copy",
    variants: ["control", "urgency", "benefit"],
    weights: [0.5, 0.25, 0.25],
  },
  {
    id: "pricing_layout",
    variants: ["grid", "table"],
  },
];

function weightedRandom(weights: number[]): number {
  const r = Math.random();
  let cumulative = 0;
  for (let i = 0; i < weights.length; i++) {
    cumulative += weights[i];
    if (r < cumulative) return i;
  }
  return weights.length - 1;
}

export function getVariant(experimentId: string): string {
  const experiment = EXPERIMENTS.find((e) => e.id === experimentId);
  if (!experiment) return "control";

  const storageKey = `exp_${experimentId}`;
  const stored = localStorage.getItem(storageKey);
  if (stored && experiment.variants.includes(stored)) return stored;

  // Assign a variant
  const weights = experiment.weights ?? experiment.variants.map(() => 1 / experiment.variants.length);
  const index = weightedRandom(weights);
  const variant = experiment.variants[index];

  localStorage.setItem(storageKey, variant);

  // Track assignment in GA4
  window.dataLayer?.push({
    event: "experiment_assignment",
    experiment_id: experimentId,
    variant_id: variant,
  });

  return variant;
}

// React hook
import { useMemo } from "react";

export function useVariant(experimentId: string): string {
  return useMemo(() => getVariant(experimentId), [experimentId]);
}
```

Usage:

```tsx
import { useVariant } from "@/lib/experiments";

function HeroCTA() {
  const variant = useVariant("hero_cta_copy");

  const copyMap = {
    control: "Get Started",
    urgency: "Start Free Trial — Ends Sunday",
    benefit: "Build Your First App in 5 Minutes",
  };

  return (
    <button className="cta-button">
      {copyMap[variant as keyof typeof copyMap] ?? copyMap.control}
    </button>
  );
}
```

## Checklist

- [ ] GDPR consent banner implemented — analytics fires only after `grantConsent()` is called
- [ ] GTM container snippet in `<head>` with `consent default: denied` set before GTM loads
- [ ] `web-vitals` installed and `initCoreWebVitals()` called in app entry point
- [ ] Structured data validated at [search.google.com/test/rich-results](https://search.google.com/test/rich-results)
- [ ] Organization schema present on all pages; Product schema on product pages; FAQ schema on FAQ pages
- [ ] All `analytics.*` event names follow GA4 recommended event names where applicable
- [ ] A/B test variants tracked as `experiment_assignment` events in GA4
- [ ] GTM container published after adding tags/triggers (preview mode tested first)

## Files involved

| File | Action |
|------|--------|
| `src/lib/analytics.ts` | Create: typed dataLayer event factories |
| `src/lib/consent.ts` | Create: GDPR consent state management |
| `src/lib/experiments.ts` | Create: A/B test variant assignment |
| `src/lib/vitals.ts` | Create: Core Web Vitals observer |
| `src/components/StructuredData.tsx` | Create: JSON-LD schema components |
| `src/components/ConsentBanner.tsx` | Create: GDPR consent UI |
| `index.html` or `app/layout.tsx` | Update: GTM container snippet in `<head>` |

## Common mistakes

**Firing GA4 before consent in GDPR regions** — GTM's `consent default: denied` must be set before the GTM container script loads. If you set it after, GTM may have already fired tags. The `gtag("consent","default",...)` call must be inline in the `<head>` before the GTM script tag.

**Pushing events before `dataLayer` is initialized** — if `analytics.trackEvent()` is called before the GTM snippet runs, `window.dataLayer` is undefined and the push throws. Always initialize with `window.dataLayer = window.dataLayer || []` before the first push, or gate calls with a null check.

**Structured data with incorrect property types** — Google's rich results validator is strict. `ratingValue` must be a number (not a string), `price` must be a number without currency symbols, and `@type` values must exactly match the schema.org vocabulary. Validate every schema at [schema.org/validator](https://validator.schema.org) before deploying.

**A/B test variant assignment not persisted** — assigning a variant on every page load without `localStorage` persistence means users see different variants on different pages, producing noisy data. Always persist the assignment in `localStorage` and check for an existing assignment before re-assigning.

**GTM container not published after changes** — GTM has a two-environment system: Workspace (draft) and Published. Tags added to the workspace do not fire in production until the container is explicitly published. Always verify in GTM's Preview mode, then publish.
