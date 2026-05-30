---
name: cms-wordpress-headless
description: Build a headless WordPress site — WPGraphQL for content queries, ACF custom fields, Next.js frontend with getStaticProps/ISR, and a script that exports WP posts into the workbench RAG knowledgebase
domain: cms
type: cross-cutting
triggers:
  - "WordPress"
  - "headless WordPress"
  - "WPGraphQL"
  - "ACF"
  - "WordPress API"
  - "WordPress headless"
  - "WP REST API"
---

# Headless WordPress

## When to use

Activate when the user is building a headless WordPress setup — decoupling the CMS from the frontend — or wants to ingest WordPress content (posts, pages, custom post types) into the workbench RAG knowledgebase for AI-assisted search. This skill covers WPGraphQL for efficient content fetching, ACF (Advanced Custom Fields) for structured data, a Next.js frontend, and an export script that pulls WP content into the workbench.

## Prerequisites

- A WordPress installation (local WP via LocalWP, Docker, or a hosted WP instance)
- WPGraphQL plugin installed and activated in WP Admin → Plugins
- ACF (Advanced Custom Fields) plugin + WPGraphQL for ACF plugin (for custom field queries)
- Node 20+ for the Next.js frontend
- Workbench running (`make up`) — `http://localhost:3100`
- Python 3.11+ and `requests` for the export script: `pip3 install requests`

## WPGraphQL Query Templates

### Fetch Recent Posts

```graphql
# query: get the 10 most recent posts with ACF custom fields
query GetRecentPosts($first: Int = 10, $after: String) {
  posts(first: $first, after: $after, where: { status: PUBLISH }) {
    pageInfo {
      hasNextPage
      endCursor
    }
    nodes {
      databaseId
      slug
      title
      date
      excerpt
      content
      featuredImage {
        node {
          sourceUrl
          altText
        }
      }
      categories {
        nodes {
          name
          slug
        }
      }
      tags {
        nodes {
          name
        }
      }
      # ACF custom fields (requires WPGraphQL for ACF plugin)
      # Replace "articleFields" with your ACF field group name (camelCase)
      articleFields {
        author
        readingTime
        summary
      }
    }
  }
}
```

### Fetch a Single Post by Slug

```graphql
query GetPostBySlug($slug: ID!) {
  post(id: $slug, idType: SLUG) {
    databaseId
    title
    content
    date
    modified
    excerpt
    seo {          # requires Yoast SEO + WPGraphQL for Yoast
      title
      metaDesc
    }
    articleFields {
      author
      summary
    }
  }
}
```

## Next.js GraphQL Client

```ts
// lib/wordpress.ts
const WP_GRAPHQL_ENDPOINT = process.env.NEXT_PUBLIC_WP_GRAPHQL_URL ?? 'http://localhost:8080/graphql';

async function fetchWPGraphQL<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(WP_GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    // ISR cache: revalidate every 60 seconds
    next: { revalidate: 60 },
  });

  if (!res.ok) {
    throw new Error(`WPGraphQL HTTP ${res.status}`);
  }

  const json = await res.json();
  if (json.errors) {
    throw new Error(`WPGraphQL error: ${JSON.stringify(json.errors)}`);
  }
  return json.data as T;
}

// Type definitions
export interface WPPost {
  databaseId: number;
  slug: string;
  title: string;
  date: string;
  excerpt: string;
  content: string;
  categories: { nodes: { name: string; slug: string }[] };
  tags: { nodes: { name: string }[] };
  articleFields?: {
    author?: string;
    readingTime?: number;
    summary?: string;
  };
}

export interface PostsResponse {
  posts: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: WPPost[];
  };
}

export async function getRecentPosts(first = 10, after?: string): Promise<PostsResponse> {
  return fetchWPGraphQL<PostsResponse>(GET_RECENT_POSTS_QUERY, { first, after });
}

export async function getPostBySlug(slug: string): Promise<{ post: WPPost }> {
  return fetchWPGraphQL<{ post: WPPost }>(GET_POST_BY_SLUG_QUERY, { slug });
}

// Put the GraphQL query strings here (from the templates above)
const GET_RECENT_POSTS_QUERY = `
  query GetRecentPosts($first: Int = 10, $after: String) {
    posts(first: $first, after: $after, where: { status: PUBLISH }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        databaseId slug title date excerpt content
        categories { nodes { name slug } }
        tags { nodes { name } }
        articleFields { author readingTime summary }
      }
    }
  }
`;

const GET_POST_BY_SLUG_QUERY = `
  query GetPostBySlug($slug: ID!) {
    post(id: $slug, idType: SLUG) {
      databaseId title content date modified excerpt
      articleFields { author summary }
    }
  }
`;
```

## Next.js Page with getStaticProps (Pages Router)

```tsx
// pages/blog/[slug].tsx
import type { GetStaticPaths, GetStaticProps, NextPage } from 'next';
import { getPostBySlug, getRecentPosts, WPPost } from '../../lib/wordpress';

interface Props {
  post: WPPost;
}

const PostPage: NextPage<Props> = ({ post }) => (
  <article>
    <h1 dangerouslySetInnerHTML={{ __html: post.title }} />
    <time dateTime={post.date}>{new Date(post.date).toLocaleDateString()}</time>
    {post.articleFields?.author && <p>By {post.articleFields.author}</p>}
    <div dangerouslySetInnerHTML={{ __html: post.content }} />
  </article>
);

export const getStaticPaths: GetStaticPaths = async () => {
  const data = await getRecentPosts(100);
  const paths = data.posts.nodes.map((post) => ({
    params: { slug: post.slug },
  }));
  return { paths, fallback: 'blocking' };
};

export const getStaticProps: GetStaticProps<Props> = async ({ params }) => {
  const slug = params?.slug as string;
  const data = await getPostBySlug(slug);

  if (!data.post) return { notFound: true };

  return {
    props: { post: data.post },
    revalidate: 60,  // ISR: regenerate page every 60s
  };
};

export default PostPage;
```

## App Router Version (Next.js 13+)

```tsx
// app/blog/[slug]/page.tsx
import { getPostBySlug, getRecentPosts } from '../../../lib/wordpress';
import { notFound } from 'next/navigation';

export async function generateStaticParams() {
  const data = await getRecentPosts(100);
  return data.posts.nodes.map((post) => ({ slug: post.slug }));
}

export default async function PostPage({ params }: { params: { slug: string } }) {
  const data = await getPostBySlug(params.slug);
  if (!data.post) notFound();
  const { post } = data;

  return (
    <article>
      <h1 dangerouslySetInnerHTML={{ __html: post.title }} />
      <div dangerouslySetInnerHTML={{ __html: post.content }} />
    </article>
  );
}
```

## WordPress → Workbench RAG Export Script

Run this script to pull all published posts from the WP REST API and ingest them into the workbench knowledgebase.

```python
#!/usr/bin/env python3
# export_wp_to_workbench.py
"""
Exports WordPress posts via WP REST API and ingests them into the workbench RAG.
No plugins required — uses the built-in WP REST API.
Usage: python3 export_wp_to_workbench.py --wp-url http://localhost:8080 --project myproject
"""
import argparse
import re
import time
import logging
import requests

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)


def strip_html(html: str) -> str:
    """Remove HTML tags from WordPress content."""
    text = re.sub(r'<[^>]+>', ' ', html)
    text = re.sub(r'\s+', ' ', text)
    return text.strip()


def fetch_all_posts(wp_url: str) -> list[dict]:
    """Paginate through the WP REST API to fetch all published posts."""
    posts = []
    page = 1
    per_page = 100

    while True:
        url = f'{wp_url}/wp-json/wp/v2/posts'
        params = {'status': 'publish', 'per_page': per_page, 'page': page, '_embed': '1'}
        r = requests.get(url, params=params, timeout=30)

        if r.status_code == 400:  # WordPress returns 400 when page exceeds total
            break
        r.raise_for_status()

        batch = r.json()
        if not batch:
            break

        posts.extend(batch)
        total_pages = int(r.headers.get('X-WP-TotalPages', 1))
        logger.info('Fetched page %d/%d (%d posts so far)', page, total_pages, len(posts))

        if page >= total_pages:
            break
        page += 1

    return posts


def ingest_post(wb_url: str, project: str, post: dict) -> bool:
    """Ingest a single WP post into the workbench RAG API."""
    title = strip_html(post.get('title', {}).get('rendered', 'Untitled'))
    content = strip_html(post.get('content', {}).get('rendered', ''))
    excerpt = strip_html(post.get('excerpt', {}).get('rendered', ''))

    if not content:
        logger.warning('Skipping post %d — empty content', post['id'])
        return False

    # Build a clean document: title + excerpt + full content
    document = f"# {title}\n\n{excerpt}\n\n{content}".strip()

    # Extract category names from _embedded
    categories = [
        term['name']
        for term_list in post.get('_embedded', {}).get('wp:term', [])
        for term in term_list
        if term.get('taxonomy') == 'category'
    ]

    payload = {
        'content': document,
        'title': title,
        'metadata': {
            'source': 'wordpress',
            'wp_id': str(post['id']),
            'slug': post.get('slug', ''),
            'date': post.get('date', ''),
            'categories': ', '.join(categories),
            'link': post.get('link', ''),
        },
    }

    r = requests.post(
        f'{wb_url}/api/projects/{project}/rag/ingest',
        json=payload,
        timeout=30,
    )
    if r.ok:
        data = r.json()
        logger.info('Ingested "%s" → %s chunks', title[:60], data.get('chunk_count', '?'))
        return True
    else:
        logger.error('Ingest failed for post %d: %d %s', post['id'], r.status_code, r.text[:200])
        return False


def main():
    parser = argparse.ArgumentParser(description='Export WordPress posts to workbench RAG')
    parser.add_argument('--wp-url', default='http://localhost:8080', help='WordPress base URL')
    parser.add_argument('--wb-url', default='http://localhost:3100', help='Workbench API URL')
    parser.add_argument('--project', default='default', help='Workbench project name')
    parser.add_argument('--delay', type=float, default=0.5, help='Seconds between ingest calls')
    args = parser.parse_args()

    logger.info('Fetching posts from %s', args.wp_url)
    posts = fetch_all_posts(args.wp_url)
    logger.info('Found %d published posts', len(posts))

    success, failed = 0, 0
    for post in posts:
        if ingest_post(args.wb_url, args.project, post):
            success += 1
        else:
            failed += 1
        time.sleep(args.delay)  # be polite to the workbench API

    logger.info('Done: %d ingested, %d failed', success, failed)


if __name__ == '__main__':
    main()
```

Run it:

```bash
python3 export_wp_to_workbench.py \
  --wp-url http://localhost:8080 \
  --wb-url http://localhost:3100 \
  --project my-blog
```

Then query the content with `/query what are the main topics covered?`

## .env.local for Next.js

```bash
# .env.local
NEXT_PUBLIC_WP_GRAPHQL_URL=http://localhost:8080/graphql
NEXT_PUBLIC_WP_REST_URL=http://localhost:8080/wp-json
```

## Checklist

- [ ] WPGraphQL plugin installed and active in WP Admin → Plugins
- [ ] WPGraphQL endpoint accessible: `curl http://localhost:8080/graphql -d '{"query":"{posts{nodes{title}}}"}'`
- [ ] ACF field group set to "Show in GraphQL" (toggle in ACF → Field Groups → Edit)
- [ ] `NEXT_PUBLIC_WP_GRAPHQL_URL` set in `.env.local`
- [ ] Export script runs successfully: `python3 export_wp_to_workbench.py`
- [ ] ISR `revalidate` value set appropriately (60s for news, 3600s for evergreen content)
- [ ] HTML stripped from exported content before workbench ingest
- [ ] Images served from WP media library URL, not relative paths

## Files involved

| File | Action |
|------|--------|
| `lib/wordpress.ts` | Create: WPGraphQL client + type definitions |
| `pages/blog/[slug].tsx` | Create: static page with getStaticProps (Pages Router) |
| `app/blog/[slug]/page.tsx` | Create: async server component (App Router) |
| `export_wp_to_workbench.py` | Create: WP REST API → workbench ingest script |
| `.env.local` | Modify: add WP GraphQL URL |

## Common mistakes

**ACF fields not appearing in WPGraphQL** — every ACF field group must have "Show in GraphQL" enabled and a "GraphQL Field Name" set (in the field group settings). Fields are invisible to WPGraphQL until this is turned on. Changing it requires saving and flushing WordPress permalinks (Settings → Permalinks → Save).

**WPGraphQL endpoint returning 404** — the WPGraphQL endpoint (`/graphql`) requires WordPress pretty permalinks to be enabled. Go to Settings → Permalinks, select any option other than "Plain", and save. The `/?graphql` fallback URL also works if permalinks can't be changed.

**Ingesting raw HTML into the RAG** — WordPress `content.rendered` contains full HTML with inline styles, shortcode output, and block markup. Embedding raw HTML produces low-quality chunks full of tag noise. Always strip HTML with a regex or `html.parser` before ingesting.

**`getStaticPaths` returning too many paths** — with thousands of posts, generating all static paths at build time makes the Next.js build very slow. Limit `getStaticPaths` to the most recent 100–200 posts and use `fallback: 'blocking'` so the rest are generated on-demand and cached.

**CORS blocking the GraphQL request from the browser** — WPGraphQL does not set CORS headers by default. For client-side fetching (not Next.js server-side), add the WPGraphQL CORS plugin, or configure the WP server to emit `Access-Control-Allow-Origin: *` for the `/graphql` route. Server-side rendering (getStaticProps, Server Components) avoids this entirely.
