# The share image is a generated JPEG, and its alt text is mandatory

A Post may carry an optional `image`, declared through Astro's `image()` schema helper so it resolves relative to the Post's own folder (ADR 0001), fails the build when the file is missing, and arrives with real dimensions. `og:image` does **not** point at that file. It points at a derivative generated with `getImage()`: exactly 1200×630, cover-cropped, and explicitly JPEG.

Each part of that is load-bearing, and none of it is obvious from reading the code.

**JPEG, not WebP.** Rendering the image through `<Image>` would produce WebP, which several social scrapers still decline to fetch. **A fixed 1200×630, not the original.** The author's file may be any shape and several megabytes — a photo straight off a phone routinely exceeds what the major scrapers will retrieve — and an unexpected aspect ratio gets cropped by the platform in ways nobody chose. Generating the derivative makes the output independent of whatever gets dropped into the folder. **Cover-cropped, not letterboxed**, because a card is rendered at 1.91:1 regardless, so the only question is who does the cropping and whether the result was ever looked at. The recommended input is therefore 1200×630, which makes the crop a safety net rather than something that fires in normal use.

The failure this all guards against is specific and easy to miss: a broken share card is invisible from your own site. You only discover it when someone else posts your link somewhere, if ever.

**`imageAlt` is required whenever `image` is set, and the build refuses otherwise.** This is the part most likely to be read as pointless friction and deleted by someone in a hurry — the same move ADR 0005 exists to prevent for `.strict()`. The reasoning is identical: alt text costs the author one sentence and costs nothing visible when skipped, so without enforcement it gets skipped precisely when rushed, and the person who pays is someone using a screen reader, who has no way to report it back. Deriving alt from the Post title was considered and rejected: a title describes the writing, not the picture, so it would produce confidently wrong alt text, which is worse than none. **If this refinement blocks a build, write the alt text.**

Scope deliberately excluded: Pages get no share image (a site-wide fallback covering them is tracked in #2), and nothing renders this image on the Post itself or in the post index — a post-list thumbnail is intended to reuse this same field, and is tracked separately so its design can be considered on its own.
