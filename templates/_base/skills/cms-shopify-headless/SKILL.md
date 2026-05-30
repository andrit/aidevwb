---
name: cms-shopify-headless
description: Build a headless Shopify storefront — Storefront API GraphQL client, product queries, cart mutations, checkout URL generation, and webhook handling for order events
domain: cms
type: cross-cutting
triggers:
  - "Shopify"
  - "headless Shopify"
  - "Storefront API"
  - "Hydrogen"
  - "e-commerce"
  - "Shopify storefront"
  - "Shopify cart"
  - "shopify product"
---

# Headless Shopify Storefront

## When to use

Activate when the user is building a custom Shopify storefront frontend, using the Shopify Storefront API, implementing cart and checkout flows, or handling Shopify webhooks. This skill covers the Storefront API GraphQL client (vanilla fetch — no Hydrogen required), product queries, cart create/add mutations, checkout URL generation, and a webhook handler for order events. Hydrogen (Shopify's React meta-framework) is noted as an alternative where relevant.

## Prerequisites

- A Shopify store (development store is free via the Shopify Partner Dashboard)
- A Storefront API access token: Shopify Admin → Settings → Apps and sales channels → Develop apps → Create app → Configure Storefront API scopes (minimum: `unauthenticated_read_product_listings`, `unauthenticated_write_checkouts`)
- Node 20+ for the frontend
- For webhooks: an HTTPS endpoint (use ngrok in development: `ngrok http 3000`)

## Environment Variables

```bash
# .env.local
NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN=your_storefront_token
SHOPIFY_WEBHOOK_SECRET=your_webhook_secret   # from Shopify Admin → Notifications → Webhooks
```

## Storefront API Client

```ts
// lib/shopify/client.ts
const STOREFRONT_API_VERSION = '2024-07';

const endpoint = `https://${process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN}/api/${STOREFRONT_API_VERSION}/graphql.json`;
const accessToken = process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN!;

interface ShopifyResponse<T> {
  data: T;
  errors?: { message: string }[];
}

export async function storefrontFetch<T>(
  query: string,
  variables: Record<string, unknown> = {},
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Storefront-Access-Token': accessToken,
    },
    body: JSON.stringify({ query, variables }),
    ...options,
  });

  if (!res.ok) {
    throw new Error(`Shopify Storefront API HTTP ${res.status}`);
  }

  const json: ShopifyResponse<T> = await res.json();
  if (json.errors?.length) {
    throw new Error(`Storefront API error: ${json.errors[0].message}`);
  }
  return json.data;
}
```

## Product Query Template

```ts
// lib/shopify/products.ts
import { storefrontFetch } from './client';

// Shopify types
export interface Money {
  amount: string;
  currencyCode: string;
}

export interface ProductVariant {
  id: string;
  title: string;
  availableForSale: boolean;
  price: Money;
  selectedOptions: { name: string; value: string }[];
}

export interface Product {
  id: string;
  handle: string;
  title: string;
  description: string;
  descriptionHtml: string;
  priceRange: { minVariantPrice: Money };
  featuredImage: { url: string; altText: string | null } | null;
  variants: { nodes: ProductVariant[] };
  tags: string[];
  productType: string;
}

export interface ProductConnection {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: Product[];
  };
}

const PRODUCT_FRAGMENT = `
  fragment ProductFields on Product {
    id
    handle
    title
    description
    descriptionHtml
    tags
    productType
    priceRange { minVariantPrice { amount currencyCode } }
    featuredImage { url altText }
    variants(first: 10) {
      nodes {
        id
        title
        availableForSale
        price { amount currencyCode }
        selectedOptions { name value }
      }
    }
  }
`;

const GET_PRODUCTS_QUERY = `
  ${PRODUCT_FRAGMENT}
  query GetProducts($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query, sortKey: BEST_SELLING) {
      pageInfo { hasNextPage endCursor }
      nodes { ...ProductFields }
    }
  }
`;

const GET_PRODUCT_BY_HANDLE_QUERY = `
  ${PRODUCT_FRAGMENT}
  query GetProductByHandle($handle: String!) {
    product(handle: $handle) { ...ProductFields }
  }
`;

export async function getProducts(
  first = 20,
  after?: string,
  query?: string
): Promise<ProductConnection> {
  return storefrontFetch<ProductConnection>(GET_PRODUCTS_QUERY, { first, after, query });
}

export async function getProductByHandle(handle: string): Promise<{ product: Product | null }> {
  return storefrontFetch<{ product: Product | null }>(GET_PRODUCT_BY_HANDLE_QUERY, { handle });
}
```

## Cart Create + Add Mutation

```ts
// lib/shopify/cart.ts
import { storefrontFetch } from './client';

export interface CartLine {
  id: string;
  quantity: number;
  merchandise: {
    id: string;
    title: string;
    product: { title: string; handle: string };
    price: { amount: string; currencyCode: string };
  };
}

export interface Cart {
  id: string;
  checkoutUrl: string;
  totalQuantity: number;
  cost: {
    subtotalAmount: { amount: string; currencyCode: string };
    totalAmount: { amount: string; currencyCode: string };
  };
  lines: { nodes: CartLine[] };
}

const CART_FRAGMENT = `
  fragment CartFields on Cart {
    id
    checkoutUrl
    totalQuantity
    cost {
      subtotalAmount { amount currencyCode }
      totalAmount { amount currencyCode }
    }
    lines(first: 50) {
      nodes {
        id
        quantity
        merchandise {
          ... on ProductVariant {
            id
            title
            price { amount currencyCode }
            product { title handle }
          }
        }
      }
    }
  }
`;

const CREATE_CART_MUTATION = `
  ${CART_FRAGMENT}
  mutation CartCreate($lines: [CartLineInput!]) {
    cartCreate(input: { lines: $lines }) {
      cart { ...CartFields }
      userErrors { field message }
    }
  }
`;

const ADD_LINES_MUTATION = `
  ${CART_FRAGMENT}
  mutation CartLinesAdd($cartId: ID!, $lines: [CartLineInput!]!) {
    cartLinesAdd(cartId: $cartId, lines: $lines) {
      cart { ...CartFields }
      userErrors { field message }
    }
  }
`;

const REMOVE_LINES_MUTATION = `
  ${CART_FRAGMENT}
  mutation CartLinesRemove($cartId: ID!, $lineIds: [ID!]!) {
    cartLinesRemove(cartId: $cartId, lineIds: $lineIds) {
      cart { ...CartFields }
      userErrors { field message }
    }
  }
`;

export interface CartLineInput {
  merchandiseId: string;  // variant GID: "gid://shopify/ProductVariant/123"
  quantity: number;
}

interface CartCreateResponse {
  cartCreate: { cart: Cart; userErrors: { field: string; message: string }[] };
}

interface CartLinesAddResponse {
  cartLinesAdd: { cart: Cart; userErrors: { field: string; message: string }[] };
}

interface CartLinesRemoveResponse {
  cartLinesRemove: { cart: Cart; userErrors: { field: string; message: string }[] };
}

export async function createCart(lines: CartLineInput[] = []): Promise<Cart> {
  const data = await storefrontFetch<CartCreateResponse>(CREATE_CART_MUTATION, { lines });
  if (data.cartCreate.userErrors.length) {
    throw new Error(data.cartCreate.userErrors[0].message);
  }
  return data.cartCreate.cart;
}

export async function addToCart(cartId: string, lines: CartLineInput[]): Promise<Cart> {
  const data = await storefrontFetch<CartLinesAddResponse>(ADD_LINES_MUTATION, { cartId, lines });
  if (data.cartLinesAdd.userErrors.length) {
    throw new Error(data.cartLinesAdd.userErrors[0].message);
  }
  return data.cartLinesAdd.cart;
}

export async function removeFromCart(cartId: string, lineIds: string[]): Promise<Cart> {
  const data = await storefrontFetch<CartLinesRemoveResponse>(REMOVE_LINES_MUTATION, { cartId, lineIds });
  if (data.cartLinesRemove.userErrors.length) {
    throw new Error(data.cartLinesRemove.userErrors[0].message);
  }
  return data.cartLinesRemove.cart;
}

// Checkout URL is already on the Cart object — just redirect to it
export function redirectToCheckout(cart: Cart): void {
  window.location.href = cart.checkoutUrl;
}
```

## React Cart Hook

```tsx
// hooks/useCart.ts
import { useState, useCallback } from 'react';
import { Cart, CartLineInput, createCart, addToCart, removeFromCart } from '../lib/shopify/cart';

export function useCart() {
  const [cart, setCart] = useState<Cart | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addItem = useCallback(async (merchandiseId: string, quantity = 1) => {
    setLoading(true);
    setError(null);
    try {
      const lines: CartLineInput[] = [{ merchandiseId, quantity }];
      if (!cart) {
        const newCart = await createCart(lines);
        setCart(newCart);
      } else {
        const updatedCart = await addToCart(cart.id, lines);
        setCart(updatedCart);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cart error');
    } finally {
      setLoading(false);
    }
  }, [cart]);

  const removeItem = useCallback(async (lineId: string) => {
    if (!cart) return;
    setLoading(true);
    try {
      const updatedCart = await removeFromCart(cart.id, [lineId]);
      setCart(updatedCart);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cart error');
    } finally {
      setLoading(false);
    }
  }, [cart]);

  const checkout = useCallback(() => {
    if (cart) window.location.href = cart.checkoutUrl;
  }, [cart]);

  return {
    cart,
    loading,
    error,
    addItem,
    removeItem,
    checkout,
    itemCount: cart?.totalQuantity ?? 0,
  };
}
```

## Webhook Handler for Order Events

```ts
// app/api/webhooks/shopify/route.ts  (Next.js App Router)
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

const WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET!;

function verifyShopifyWebhook(body: string, hmacHeader: string): boolean {
  const digest = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(body, 'utf8')
    .digest('base64');
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmacHeader));
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const hmac = req.headers.get('x-shopify-hmac-sha256') ?? '';
  const topic = req.headers.get('x-shopify-topic') ?? '';

  if (!verifyShopifyWebhook(body, hmac)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const payload = JSON.parse(body);

  switch (topic) {
    case 'orders/create':
      await handleOrderCreated(payload);
      break;
    case 'orders/paid':
      await handleOrderPaid(payload);
      break;
    case 'orders/cancelled':
      await handleOrderCancelled(payload);
      break;
    case 'products/update':
      await handleProductUpdated(payload);
      break;
    default:
      console.log(`Unhandled webhook topic: ${topic}`);
  }

  return NextResponse.json({ received: true });
}

async function handleOrderCreated(order: Record<string, unknown>) {
  console.log('Order created:', order['id'], order['email']);
  // Add business logic: send confirmation, update inventory, notify fulfillment
}

async function handleOrderPaid(order: Record<string, unknown>) {
  console.log('Order paid:', order['id']);
}

async function handleOrderCancelled(order: Record<string, unknown>) {
  console.log('Order cancelled:', order['id']);
}

async function handleProductUpdated(product: Record<string, unknown>) {
  console.log('Product updated:', product['id'], product['title']);
}
```

Register the webhook in Shopify Admin → Settings → Notifications → Webhooks, pointing to `https://your-domain.com/api/webhooks/shopify`.

## Hydrogen Alternative (when preferred)

Shopify's Hydrogen is a React meta-framework built on Remix that provides built-in cart, session, and Storefront API hooks. Use Hydrogen when:
- Building a pure Shopify storefront (not mixing with another CMS)
- You want `useCart`, `<CartForm>`, and `<Money>` components out of the box
- You want Shopify-managed CDN edge caching

```bash
# Scaffold a Hydrogen app
npm create @shopify/hydrogen@latest
# Choose: Hydrogen template → JavaScript or TypeScript → Deploy to Oxygen or local
```

Use the vanilla fetch approach (this skill) when: you're integrating Shopify into an existing Next.js app, mixing with other content sources, or don't want the Hydrogen/Remix dependency.

## Checklist

- [ ] Storefront API access token has required scopes: `unauthenticated_read_product_listings`, `unauthenticated_write_checkouts`
- [ ] `NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN` and `NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN` in `.env.local`
- [ ] API version in client matches the current stable Shopify API version (update quarterly)
- [ ] Cart IDs persisted in `localStorage` or a cookie (cart is lost on refresh without this)
- [ ] Webhook handler verifies HMAC signature before processing
- [ ] Checkout URL redirects to Shopify-hosted checkout (custom checkout requires Shopify Plus)
- [ ] Product GIDs are full GIDs: `"gid://shopify/ProductVariant/123"` not just `"123"`

## Files involved

| File | Action |
|------|--------|
| `lib/shopify/client.ts` | Create: Storefront API fetch wrapper |
| `lib/shopify/products.ts` | Create: product queries + TypeScript types |
| `lib/shopify/cart.ts` | Create: cart create/add/remove mutations |
| `hooks/useCart.ts` | Create: React cart state hook |
| `app/api/webhooks/shopify/route.ts` | Create: webhook handler with HMAC verification |
| `.env.local` | Modify: add Shopify store domain and access token |

## Common mistakes

**Using the Admin API access token instead of the Storefront API token** — the Admin API token is secret and must never be exposed in the browser. The Storefront API token is a separate, intentionally public token with limited read-only scope. Create a Headless app in Shopify Admin → Settings → Apps → Develop apps to get the correct Storefront token.

**Passing variant IDs as plain integers** — the Storefront API expects Global IDs (GIDs) in the format `"gid://shopify/ProductVariant/123456789"`, not plain numeric strings. Using a plain ID in a mutation returns a `Variable $merchandiseId of type ID! was provided invalid value` error. Encode IDs with `btoa('gid://shopify/ProductVariant/' + numericId)` if needed for URL params.

**Not persisting the cart ID** — `cartCreate` returns a cart ID that must be stored (localStorage or cookie) and passed to subsequent `cartLinesAdd` calls. Without persistence, a new empty cart is created on every page load. Store the cart ID and check for it before calling `createCart`.

**Forgetting to verify the webhook HMAC** — any HTTP client can POST to a public webhook endpoint. Without HMAC verification using `SHOPIFY_WEBHOOK_SECRET`, malicious requests can fake order events. Always verify with `crypto.timingSafeEqual` (constant-time comparison); using `===` is vulnerable to timing attacks.

**Assuming checkout URL works forever** — Shopify checkout URLs expire after a period of inactivity (typically 24 hours). Always call `cartCreate` fresh at checkout time or re-query the cart to get a fresh `checkoutUrl`, rather than storing the URL for later use.
