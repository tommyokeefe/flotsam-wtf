# Flotsam

A low-stakes personal blog. The site's own value proposition is minimizing friction to publish, so the domain model stays deliberately thin.

## Language

**Post**:
A dated, optionally-tagged piece of writing published at `/posts/<slug>`. Lives in its own folder with colocated images (cover/share art, inline post images). A Post's date is when it was **published here**, not when it was written — re-publishing older writing under a current date is expected, and any "originally written in…" framing belongs in the Post's own prose.
_Avoid_: Article, Entry, Blog post

**Page**:
Static, non-chronological content outside the posts collection (e.g. `/what`, `/who`). Not tagged, not dated, not listed in the post index or search-by-tag views.
_Avoid_: Static page (redundant), Post (Pages are never Posts)

**Tag**:
A freeform, unmoderated label attached to a Post to aid browsing. No controlled vocabulary or registry — near-duplicate tags (e.g. "css" vs "CSS") are an accepted low-stakes cost, not a bug.
_Avoid_: Category, Topic

**Draft**:
A Post with `draft: true`. A staging state of a Post, not a separate content type. A Draft is never public: it has no URL on the live site and appears in no index, tag page, or search result there. It is readable only outside production, where it is listed alongside published Posts and visibly marked as a Draft.
_Avoid_: Unpublished post, WIP

**Visible Post**:
A Post that exists in the current environment: every published Post, plus Drafts outside production. The set the post index and the post routes are built from.
_Avoid_: Published post (a Draft in a preview deployment is visible but not published)

**Share image**:
The optional `image` field on a Post, colocated with it, used as the image on the card that renders when the Post is shared. Always paired with `imageAlt`, which describes it for anyone who meets the Post as a card rather than a page — a Post carrying one without the other is rejected.
_Avoid_: Cover image (the Share image is never rendered on the Post itself)

**Publication**:
The record describing Flotsam itself in the ATmosphere, in the [Standard.site](https://standard.site) `site.standard.publication` lexicon: the site's name, description and URL, and its opt-in to discovery. It lives on Tommy's Personal Data Server, not in this repo, and there is exactly one for the site. Its AT-URI is held in one constant, `PUBLICATION_AT_URI` in `src/lib/site.mjs`, from which the `.well-known` verification endpoint, every Document's `site` field and the build-time lookup all derive. It reuses the words the site already uses for itself (`SITE_NAME`, `SITE_DESCRIPTION`), so it has no second identity. Not a place anything is read: `www.flotsam.wtf` is.
_Avoid_: Blog, Feed, Site (the site is the website; the Publication is its record)

**Document**:
The record that points at one Visible Post in the ATmosphere (`site.standard.document`): the Post's title, published date, path, canonical URL, and its description and Share image when it has them. **A Document is not the Post it points at.** The Post is writing, lives in this repo, and is read only at `www.flotsam.wtf`; the Document is a derived pointer to it, carries none of its prose, and can be deleted and rebuilt from the Posts without losing anything. Deleting a Document never deletes a Post, while removing a Post removes its Document. Documents are matched to Posts by `path`; their keys are assigned by the PDS and can't be derived from a slug.
_Avoid_: Post (a Document isn't one), Copy, Mirror (it carries no body), Cover image (the Share image is the Post's; `coverImage` is only the Document field it's uploaded into)
