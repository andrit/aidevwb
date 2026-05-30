---
name: cms-saleor
description: Integrate Saleor Commerce — Docker Compose local setup, GraphQL API client, product list query, checkout mutation flow, webhook endpoint handler, and exporting catalog data to the workbench RAG knowledgebase
domain: cms
type: cross-cutting
triggers:
  - "Saleor"
  - "saleor commerce"
  - "open source commerce"
  - "saleor storefront"
  - "saleor api"
---

# Saleor Commerce

## When to use

Activate when the user is building on Saleor Commerce — an open-source, GraphQL-first headless e-commerce platform. This skill covers local Docker Compose setup, the Saleor GraphQL API client, product listing queries, the multi-step checkout flow (create → add lines → add email → add shipping → add payment → complete), webhook handling for order events, and a script to export the Saleor catalog into the workbench RAG knowledgebase.

## Prerequisites

- Docker Desktop running
- Workbench already running (`make up`) on the same machine
- Python 3.11+ and `requests` for the export script: `pip3 install requests`
- Node 20+ for the frontend

## Docker Compose — Add Saleor to the Workbench Stack

Add this service block to `docker-compose.yml`. Saleor's official image bundles the API and worker.

```yaml
# Add to docker-compose.yml services section

  saleor-api:
    image: ghcr.io/saleor/saleor:3.20
    ports:
      - "8000:8000"
    environment:
      DATABASE_URL: postgres://saleor:saleor@saleor-db/saleor
      REDIS_URL: redis://redis:6379/1
      SECRET_KEY: changeme-use-a-real-secret-in-production
      DEBUG: "True"
      ALLOWED_HOSTS: localhost,saleor-api
      DEFAULT_FROM_EMAIL: noreply@example.com
      EMAIL_URL: console://
      ENABLE_DJANGO_SILK: "False"
      JAEGER_AGENT_HOST: ""
      DASHBOARD_URL: http://localhost:9000/
      ALLOWED_GRAPHQL_ORIGINS: "*"
    depends_on:
      saleor-db:
        condition: service_healthy
      redis:
        condition: service_started
    command: >
      sh -c "python manage.py migrate &&
             python manage.py populatedb --createsuperuser &&
             gunicorn saleor.wsgi:application --bind 0.0.0.0:8000 --workers 2"
    networks:
      - workbench

  saleor-db:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: saleor
      POSTGRES_PASSWORD: saleor
      POSTGRES_DB: saleor
    volumes:
      - saleor-db-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U saleor"]
      interval: 5s
      timeout: 5s
      retries: 5
    networks:
      - workbench

  saleor-dashboard:
    image: ghcr.io/saleor/saleor-dashboard:3.20
    ports:
      - "9000:80"
    environment:
      API_URL: http://localhost:8000/graphql/
    networks:
      - workbench

volumes:
  saleor-db-data:
```

Start Saleor alongside the workbench:

```bash
make up
# Or start only Saleor services:
docker compose up saleor-api saleor-db saleor-dashboard -d
```

API endpoint: `http://localhost:8000/graphql/`
Dashboard: `http://localhost:9000/`
Default credentials (from `populatedb`): `admin@example.com` / `admin`

## GraphQL Client Setup

```ts
// lib/saleor/client.ts
const SALEOR_API_URL = process.env.NEXT_PUBLIC_SALEOR_API_URL ?? 'http://localhost:8000/graphql/';

interface SaleorResponse<T> {
  data: T;
  errors?: { message: string; extensions?: { exception?: { code?: string } } }[];
}

export async function saleorFetch<T>(
  query: string,
  variables: Record<string, unknown> = {},
  authToken?: string
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const res = await fetch(SALEOR_API_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`Saleor API HTTP ${res.status}`);
  }

  const json: SaleorResponse<T> = await res.json();
  if (json.errors?.length) {
    const code = json.errors[0].extensions?.exception?.code;
    throw new Error(`Saleor error [${code ?? 'UNKNOWN'}]: ${json.errors[0].message}`);
  }
  return json.data;
}
```

## Product List Query

```ts
// lib/saleor/products.ts
import { saleorFetch } from './client';

export interface SaleorMoney {
  amount: number;
  currency: string;
}

export interface SaleorProduct {
  id: string;
  name: string;
  slug: string;
  description: string | null;  // Saleor uses Editorjs JSON — may need parsing
  seoDescription: string | null;
  thumbnail: { url: string; alt: string | null } | null;
  pricing: {
    priceRange: {
      start: { gross: SaleorMoney };
      stop: { gross: SaleorMoney };
    };
  } | null;
  category: { name: string; slug: string } | null;
  variants: {
    id: string;
    name: string;
    sku: string | null;
    quantityAvailable: number | null;
    pricing: { price: { gross: SaleorMoney } } | null;
  }[];
}

const PRODUCT_FIELDS = `
  fragment ProductFields on Product {
    id name slug seoDescription
    description
    thumbnail { url alt }
    pricing {
      priceRange {
        start { gross { amount currency } }
        stop  { gross { amount currency } }
      }
    }
    category { name slug }
    variants {
      id name sku quantityAvailable
      pricing { price { gross { amount currency } } }
    }
  }
`;

const GET_PRODUCTS_QUERY = `
  ${PRODUCT_FIELDS}
  query GetProducts($first: Int!, $after: String, $channel: String!) {
    products(first: $first, after: $after, channel: $channel) {
      pageInfo { hasNextPage endCursor }
      edges { node { ...ProductFields } }
    }
  }
`;

const GET_PRODUCT_BY_SLUG_QUERY = `
  ${PRODUCT_FIELDS}
  query GetProductBySlug($slug: String!, $channel: String!) {
    product(slug: $slug, channel: $channel) { ...ProductFields }
  }
`;

interface ProductsResponse {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: { node: SaleorProduct }[];
  };
}

export async function getProducts(
  first = 20,
  channel = 'default-channel',
  after?: string
): Promise<SaleorProduct[]> {
  const data = await saleorFetch<ProductsResponse>(GET_PRODUCTS_QUERY, { first, channel, after });
  return data.products.edges.map((e) => e.node);
}

export async function getProductBySlug(
  slug: string,
  channel = 'default-channel'
): Promise<SaleorProduct | null> {
  const data = await saleorFetch<{ product: SaleorProduct | null }>(
    GET_PRODUCT_BY_SLUG_QUERY, { slug, channel }
  );
  return data.product;
}
```

## Checkout Mutation Flow

Saleor's checkout is a multi-step process: create → set email → set shipping → add payment → complete.

```ts
// lib/saleor/checkout.ts
import { saleorFetch } from './client';

export interface CheckoutLine {
  variantId: string;
  quantity: number;
}

export interface SaleorCheckout {
  id: string;
  token: string;
  totalPrice: { gross: { amount: number; currency: string } };
  lines: {
    id: string;
    quantity: number;
    variant: { id: string; name: string; product: { name: string } };
    totalPrice: { gross: { amount: number; currency: string } };
  }[];
  shippingAddress: object | null;
  billingAddress: object | null;
  availableShippingMethods: {
    id: string;
    name: string;
    price: { amount: number; currency: string };
  }[];
}

// Step 1: Create checkout with line items
const CHECKOUT_CREATE = `
  mutation CheckoutCreate($lines: [CheckoutLineInput!]!, $channel: String!, $email: String!) {
    checkoutCreate(input: {
      channel: $channel
      email: $email
      lines: $lines
    }) {
      checkout {
        id token
        totalPrice { gross { amount currency } }
        lines {
          id quantity
          variant { id name product { name } }
          totalPrice { gross { amount currency } }
        }
      }
      errors { field message code }
    }
  }
`;

// Step 2: Add/update shipping address
const CHECKOUT_SHIPPING_ADDRESS = `
  mutation CheckoutShippingAddress($checkoutId: ID!, $address: AddressInput!) {
    checkoutShippingAddressUpdate(checkoutId: $checkoutId, shippingAddress: $address) {
      checkout {
        id
        availableShippingMethods { id name price { amount currency } }
      }
      errors { field message code }
    }
  }
`;

// Step 3: Select shipping method
const CHECKOUT_DELIVERY_METHOD = `
  mutation CheckoutDeliveryMethod($checkoutId: ID!, $deliveryMethodId: ID!) {
    checkoutDeliveryMethodUpdate(checkoutId: $checkoutId, deliveryMethodId: $deliveryMethodId) {
      checkout { id totalPrice { gross { amount currency } } }
      errors { field message code }
    }
  }
`;

// Step 4: Complete checkout (for payment gateway integration, use checkoutPaymentCreate first)
const CHECKOUT_COMPLETE = `
  mutation CheckoutComplete($checkoutId: ID!) {
    checkoutComplete(checkoutId: $checkoutId) {
      order {
        id
        number
        status
        total { gross { amount currency } }
      }
      errors { field message code }
    }
  }
`;

interface AddressInput {
  firstName: string;
  lastName: string;
  streetAddress1: string;
  city: string;
  country: string;
  postalCode: string;
}

export async function createCheckout(
  lines: CheckoutLine[],
  email: string,
  channel = 'default-channel'
): Promise<SaleorCheckout> {
  const data = await saleorFetch<{
    checkoutCreate: { checkout: SaleorCheckout; errors: { field: string; message: string }[] }
  }>(CHECKOUT_CREATE, { lines, email, channel });

  if (data.checkoutCreate.errors.length) {
    throw new Error(data.checkoutCreate.errors[0].message);
  }
  return data.checkoutCreate.checkout;
}

export async function setShippingAddress(
  checkoutId: string,
  address: AddressInput
): Promise<string[]> {
  const data = await saleorFetch<{
    checkoutShippingAddressUpdate: {
      checkout: { id: string; availableShippingMethods: { id: string; name: string }[] };
      errors: { field: string; message: string }[];
    }
  }>(CHECKOUT_SHIPPING_ADDRESS, { checkoutId, address });

  if (data.checkoutShippingAddressUpdate.errors.length) {
    throw new Error(data.checkoutShippingAddressUpdate.errors[0].message);
  }
  return data.checkoutShippingAddressUpdate.checkout.availableShippingMethods.map((m) => m.id);
}

export async function completeCheckout(checkoutId: string): Promise<{ id: string; number: string }> {
  const data = await saleorFetch<{
    checkoutComplete: {
      order: { id: string; number: string };
      errors: { field: string; message: string }[];
    }
  }>(CHECKOUT_COMPLETE, { checkoutId });

  if (data.checkoutComplete.errors.length) {
    throw new Error(data.checkoutComplete.errors[0].message);
  }
  return data.checkoutComplete.order;
}
```

## Webhook Endpoint Handler

```ts
// app/api/webhooks/saleor/route.ts  (Next.js App Router)
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

// Saleor signs webhooks with a JWS (JSON Web Signature).
// For simplicity in development, verify by checking a shared secret header.
// In production, verify the JWS signature using Saleor's public key endpoint.
const WEBHOOK_SECRET_KEY = process.env.SALEOR_WEBHOOK_SECRET_KEY ?? '';

export async function POST(req: NextRequest) {
  const saleorEvent = req.headers.get('saleor-event') ?? '';
  const saleorDomain = req.headers.get('saleor-domain') ?? '';
  const signature = req.headers.get('saleor-signature') ?? '';

  const body = await req.text();

  // Basic HMAC verification (replace with full JWS verification for production)
  if (WEBHOOK_SECRET_KEY) {
    const expected = crypto
      .createHmac('sha256', WEBHOOK_SECRET_KEY)
      .update(body)
      .digest('hex');
    if (signature !== expected) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
  }

  const payload = JSON.parse(body);
  console.log(`Saleor webhook [${saleorEvent}] from ${saleorDomain}`);

  switch (saleorEvent) {
    case 'ORDER_CREATED':
      await handleOrderCreated(payload);
      break;
    case 'ORDER_FULLY_PAID':
      await handleOrderPaid(payload);
      break;
    case 'ORDER_CANCELLED':
      await handleOrderCancelled(payload);
      break;
    case 'PRODUCT_UPDATED':
      await handleProductUpdated(payload);
      break;
    default:
      console.log(`Unhandled Saleor event: ${saleorEvent}`);
  }

  return NextResponse.json({ received: true });
}

async function handleOrderCreated(payload: Record<string, unknown>) {
  const order = payload['order'] as Record<string, unknown>;
  console.log('Order created:', order?.['number'], order?.['userEmail']);
}

async function handleOrderPaid(payload: Record<string, unknown>) {
  const order = payload['order'] as Record<string, unknown>;
  console.log('Order paid:', order?.['number']);
}

async function handleOrderCancelled(payload: Record<string, unknown>) {
  console.log('Order cancelled:', (payload['order'] as Record<string, unknown>)?.['number']);
}

async function handleProductUpdated(payload: Record<string, unknown>) {
  console.log('Product updated:', (payload['product'] as Record<string, unknown>)?.['name']);
}
```

Register webhooks in Saleor Dashboard → Settings → Webhooks, or via the API:

```graphql
mutation {
  webhookCreate(input: {
    app: "YOUR_APP_ID"
    name: "order-events"
    targetUrl: "https://your-domain.com/api/webhooks/saleor"
    events: [ORDER_CREATED, ORDER_FULLY_PAID, ORDER_CANCELLED, PRODUCT_UPDATED]
  }) {
    webhook { id }
    errors { field message }
  }
}
```

## Saleor Catalog → Workbench RAG Export Script

```python
#!/usr/bin/env python3
# export_saleor_to_workbench.py
"""
Exports Saleor product catalog via GraphQL and ingests it into the workbench RAG.
Usage: python3 export_saleor_to_workbench.py --saleor-url http://localhost:8000/graphql/ --project myproject
"""
import argparse
import json
import logging
import time
import requests

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)

GET_PRODUCTS_QUERY = """
query GetProducts($first: Int!, $after: String, $channel: String!) {
  products(first: $first, after: $after, channel: $channel) {
    pageInfo { hasNextPage endCursor }
    edges {
      node {
        id name slug seoDescription
        description
        category { name }
        variants { id name sku quantityAvailable pricing { price { gross { amount currency } } } }
      }
    }
  }
}
"""


def graphql_request(url: str, query: str, variables: dict, token: str | None = None) -> dict:
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    r = requests.post(url, json={'query': query, 'variables': variables}, headers=headers, timeout=30)
    r.raise_for_status()
    data = r.json()
    if data.get('errors'):
        raise RuntimeError(f"GraphQL error: {data['errors'][0]['message']}")
    return data['data']


def fetch_all_products(saleor_url: str, channel: str, token: str | None = None) -> list[dict]:
    products = []
    after = None
    page = 1

    while True:
        data = graphql_request(
            saleor_url,
            GET_PRODUCTS_QUERY,
            {'first': 100, 'after': after, 'channel': channel},
            token
        )
        edges = data['products']['edges']
        products.extend(e['node'] for e in edges)
        page_info = data['products']['pageInfo']
        logger.info('Fetched page %d (%d products so far)', page, len(products))

        if not page_info['hasNextPage']:
            break
        after = page_info['endCursor']
        page += 1

    return products


def parse_editorjs_description(description_json: str | None) -> str:
    """
    Saleor stores product descriptions as Editorjs JSON blocks.
    Extract plain text from the blocks.
    """
    if not description_json:
        return ''
    try:
        data = json.loads(description_json)
        blocks = data.get('blocks', [])
        lines = []
        for block in blocks:
            block_data = block.get('data', {})
            text = block_data.get('text', '') or block_data.get('caption', '')
            if text:
                # Strip basic HTML tags that Editorjs may include
                import re
                text = re.sub(r'<[^>]+>', '', text)
                lines.append(text)
        return '\n'.join(lines)
    except (json.JSONDecodeError, KeyError):
        return description_json or ''


def ingest_product(wb_url: str, project: str, product: dict) -> bool:
    description = parse_editorjs_description(product.get('description'))
    seo_desc = product.get('seoDescription') or ''
    category = (product.get('category') or {}).get('name', 'Uncategorized')
    variants = product.get('variants', [])

    variant_lines = [
        f"  - {v['name']}: {v.get('sku', 'no-sku')}, "
        f"qty={v.get('quantityAvailable', '?')}, "
        f"price={v.get('pricing', {}).get('price', {}).get('gross', {}).get('amount', '?')}"
        for v in variants
    ]

    content = (
        f"# {product['name']}\n\n"
        f"Category: {category}\n"
        f"{seo_desc}\n\n"
        f"{description}\n\n"
        f"Variants:\n" + '\n'.join(variant_lines)
    ).strip()

    payload = {
        'content': content,
        'title': product['name'],
        'metadata': {
            'source': 'saleor',
            'saleor_id': product['id'],
            'slug': product.get('slug', ''),
            'category': category,
        }
    }

    r = requests.post(
        f'{wb_url}/api/projects/{project}/rag/ingest',
        json=payload,
        timeout=30
    )
    if r.ok:
        data = r.json()
        logger.info('Ingested "%s" → %s chunks', product['name'][:60], data.get('chunk_count', '?'))
        return True
    else:
        logger.error('Ingest failed for %s: %d %s', product['id'], r.status_code, r.text[:200])
        return False


def main():
    parser = argparse.ArgumentParser(description='Export Saleor catalog to workbench RAG')
    parser.add_argument('--saleor-url', default='http://localhost:8000/graphql/')
    parser.add_argument('--wb-url', default='http://localhost:3100')
    parser.add_argument('--project', default='default')
    parser.add_argument('--channel', default='default-channel')
    parser.add_argument('--token', default=None, help='Saleor auth token (optional for public channels)')
    parser.add_argument('--delay', type=float, default=0.5)
    args = parser.parse_args()

    logger.info('Fetching products from %s (channel: %s)', args.saleor_url, args.channel)
    products = fetch_all_products(args.saleor_url, args.channel, args.token)
    logger.info('Found %d products', len(products))

    success, failed = 0, 0
    for product in products:
        if ingest_product(args.wb_url, args.project, product):
            success += 1
        else:
            failed += 1
        time.sleep(args.delay)

    logger.info('Done: %d ingested, %d failed', success, failed)


if __name__ == '__main__':
    main()
```

Run it:

```bash
python3 export_saleor_to_workbench.py \
  --saleor-url http://localhost:8000/graphql/ \
  --wb-url http://localhost:3100 \
  --project my-shop \
  --channel default-channel
```

## Checklist

- [ ] Saleor services start cleanly: `docker compose ps` shows saleor-api as healthy
- [ ] Dashboard accessible at `http://localhost:9000/` with `admin@example.com` / `admin`
- [ ] GraphQL API responding: `curl -X POST http://localhost:8000/graphql/ -H 'Content-Type: application/json' -d '{"query":"{ shop { name } }"}'`
- [ ] Channel name in queries matches an existing channel (Dashboard → Channels)
- [ ] Checkout flow tested end-to-end: create → shipping address → delivery method → complete
- [ ] Webhook handler verifies signature before processing any payload
- [ ] Editorjs JSON descriptions parsed to plain text before RAG ingest
- [ ] Export script runs: `python3 export_saleor_to_workbench.py --saleor-url ... --project ...`

## Files involved

| File | Action |
|------|--------|
| `docker-compose.yml` | Modify: add saleor-api, saleor-db, saleor-dashboard services and saleor-db-data volume |
| `lib/saleor/client.ts` | Create: GraphQL fetch wrapper |
| `lib/saleor/products.ts` | Create: product queries + TypeScript types |
| `lib/saleor/checkout.ts` | Create: checkout mutation flow |
| `app/api/webhooks/saleor/route.ts` | Create: webhook handler |
| `export_saleor_to_workbench.py` | Create: Saleor catalog → workbench RAG export script |

## Common mistakes

**Querying products without specifying a channel** — Saleor requires a `channel` argument on product queries and checkout mutations. Without it, the query returns null or an error. Create at least one channel in the Dashboard (Dashboard → Channels → Create Channel) and use its slug in all queries.

**Not parsing Editorjs JSON in product descriptions** — Saleor stores product descriptions as Editorjs block JSON (`{"blocks":[{"type":"paragraph","data":{"text":"..."}}]}`), not plain text or HTML. Ingesting raw JSON into the RAG produces unusable chunks. Always parse the Editorjs structure to extract plain text before ingesting.

**`checkoutComplete` returning errors for unpaid orders** — Saleor's checkout requires a valid payment before `checkoutComplete` succeeds. In development, use the "dummy" payment gateway (enabled by default via `PLUGINS`): call `checkoutPaymentCreate` with `gateway: "mirumee.payments.dummy"` and `token: "not-charged"` before calling complete.

**saleor-api failing to start due to missing migrations** — the Docker image does not auto-migrate. Always run `python manage.py migrate` at startup (include it in the `command` in `docker-compose.yml` before the gunicorn command). If the container starts before the database is ready, the migration fails silently — use `depends_on` with `condition: service_healthy`.

**Webhook signature verification using string equality** — comparing HMAC digests with `==` is vulnerable to timing attacks. Use `crypto.timingSafeEqual()` in Node.js or `hmac.compare_digest()` in Python. This matters even for internal development webhooks because the habit of safe comparison must carry to production.
