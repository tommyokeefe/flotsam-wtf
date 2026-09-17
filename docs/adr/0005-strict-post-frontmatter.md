# Post frontmatter is strict: an unrecognized key fails the build

Zod object schemas strip keys they don't know about rather than rejecting them, so until now a typo in a Post's frontmatter was not an error of any kind. For a required field that was harmless — misspelling `title` drops `title`, and the build fails loudly on the missing field. For an optional one it was not: `draf: true` was discarded, `draft` fell back to its `false` default, and the Post was built and published exactly as though it had never been marked. No error, no warning, and the failure mode was silent publication of something meant to be held back.

That defeated the guarantee ADR 0004 is built on. The environment predicate there fails closed, which is worth nothing if the field never reaches the schema at all. The posts schema is therefore `.strict()`: an unrecognized key is now an `InvalidContentEntryDataError` naming the collection, the entry, the offending key and the file, and the build stops. Verified in both directions — the existing Posts build unchanged, and a fixture carrying `draf: true` fails with exit 1 and emits no page.

**The cost is real, and it will be felt before the benefit is.** Any frontmatter key not in the schema now breaks the build instead of being ignored, including one added in good faith ahead of the feature that reads it — writing `tags:` on a Post today fails until the `tags` field lands (#5). That is the intended behaviour rather than a bug to work around: the point is that the schema is the single declaration of what a Post may carry.

**If a build fails on an unrecognized key, add the field to the schema or remove it from the frontmatter — do not remove `.strict()`.** Removing it restores the silent-publish hole this exists to close, and nothing will make it obvious that it has been restored.

Astro injects nothing of its own into frontmatter data, so strictness costs nothing at the framework level. That was confirmed by building the real site, not assumed.
