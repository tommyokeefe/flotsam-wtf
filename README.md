# Flotsam

A small personal blog, built with [Astro](https://astro.build) and themed with
[Sakura](https://github.com/oxalorg/sakura) (the `sakura-vader` variant). Lives at
[flotsam.wtf](https://flotsam.wtf).

## Local development

Needs Node `>=22.12.0`.

```
npm install
npm run dev      # dev server, drafts visible
npm run build    # production build into dist/
npm run preview  # serve the built site
```

## Writing a post

A post is a **folder** under `src/content/posts/`, containing a file named
`index.md` or `index.mdx`:

```
src/content/posts/
└── my-post/
    ├── index.md        ← the post
    └── diagram.png     ← images live beside it
```

The folder name becomes the URL: `src/content/posts/my-post/` is served at
`/posts/my-post`. Only a file named `index` is treated as a post, so a scratch
file left in the folder is ignored rather than published at a URL you didn't
intend.

Frontmatter is validated at build time, so a missing or malformed **required**
field fails the build rather than rendering something broken. Unknown keys are a
different story — see the warning under [Drafts](#drafts).

| Field | Required | Notes |
|---|---|---|
| `title` | yes | Rendered as the page's heading; don't repeat it as an `#` heading in the body |
| `date` | yes | `YYYY-MM-DD`. When it was published *here*, not when it was written |
| `description` | no | Used for `<meta name="description">` and the share text |
| `draft` | no | Defaults to `false`. See below |

### Drafts

Set `draft: true` to keep a post out of the live site:

```yaml
---
title: Something unfinished
date: '2026-09-17'
draft: true
---
```

A draft is readable on the dev server and in Vercel preview deployments, where
it's listed and rendered like any other post but visibly marked. Production
never builds it at all, so it has no URL on the live site. Remove the field (or
set it to `false`) to publish.

> **Spell it correctly.** The schema ignores keys it doesn't recognize rather
> than rejecting them, so `draf: true` is silently discarded and the post
> publishes as if you'd never marked it. Confirm the post shows its `DRAFT`
> marker in the index before trusting that it's held back.

## Adding a page

A page is a `.md` or `.mdx` file directly in `src/pages/`, and the filename
determines the route — `src/pages/what.md` is served at `/what`. Unlike posts,
pages declare their own layout:

```yaml
---
layout: ../layouts/Layout.astro
title: What
---
```

Pages don't appear in the site navigation automatically. To add one, extend the
`nav` array in `src/layouts/Layout.astro`.

## Styling

Sakura's classless defaults (`public/sakura-vader.css`) cover most elements.
Anything beyond that uses Astro's per-component scoped `<style>` blocks, with
`public/global.css` holding the few genuinely global utilities. There's no
utility framework — see ADR 0002 for why.

## Where the reasoning lives

- **`CONTEXT.md`** — the domain glossary. What "Post", "Page", "Draft" and "Tag"
  mean here, and which words to avoid.
- **`docs/adr/`** — architecture decision records. Consult these before undoing
  something that looks odd; several of them exist specifically because the
  deliberate choice looks like a mistake.
- **`AGENTS.md`** — conventions for agents working in this repo.
