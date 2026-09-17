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
A Post with `draft: true`. Builds locally but is excluded from the post index, tag pages, and search index. A staging state of a Post, not a separate content type.
_Avoid_: Unpublished post, WIP

**Share image**:
The single optional `image` field on a Post, reused as both the OG/share meta image and the post-list thumbnail. Deliberately one field, not two, to keep authoring a Post frictionless.
_Avoid_: Cover image, Thumbnail (as a separate concept from the share image — they are the same field)
