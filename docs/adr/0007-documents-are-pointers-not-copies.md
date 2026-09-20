# A Document points at a Post; it never carries the Post

A Document (the Standard.site `site.standard.document` record that announces a Post to the ATmosphere) carries a Post's metadata and where to find it: title, published date, path, and its description and Share image when it has them. It has no canonical URL of its own, because the lexicon has no such field: a reader joins the Publication's `url` and the Document's `path`. It does **not** carry the Post's prose. The lexicon has an optional `textContent` field for it, and it is omitted; so is `tags`. `www.flotsam.wtf` remains the only place a Post is read.

**This is the decision most likely to be "fixed".** A missing `textContent` looks like an oversight, and filling it in looks like an easy improvement: the Post is right there in the repo. Don't, without accepting what the reasons below cost.

**The prose does not survive conversion.** Posts are Markdown and MDX. They embed components (a YouTube player, for one) and Mermaid diagrams, and neither has a faithful plain-text form. A Document holding the text would be a degraded second edition of the writing, one that reads as complete but silently lacks the diagram a paragraph refers to. Worse, it would exist in a place the author never looks at and has no reason to keep in step.

**A copy would have to be kept, and a pointer only has to be rebuilt.** Everything a Document says is derived from a Post, so it can be deleted and recreated from the repo at any time without losing anything (ADR 0008 relies on exactly that). Once a Document held the prose it would be a second copy of the content, with its own drift, and the repo would stop being the origin of what has been written. The ATmosphere is a place Posts are announced, never the source of truth for them.

**Readers lose nothing they were owed.** Discovery needs a title, a date, a description and a link, and a reader that wants the writing follows the link. That is the point: someone who arrives at Flotsam arrives at Flotsam. Issue #35 records that this was checked against live records and not only the documentation: `textContent` is absent from the records of the tooling's own author.

**Tags are omitted, not invented.** The lexicon supports them and Flotsam does not have the feature yet (#5, parked). A field made up to fill the slot would have to be unmade when Tags exist.

Scope this covers: what a Document holds, and that a Document is never a Post. It says nothing about when one is created or removed; that is ADR 0008.

Revisiting this means deciding that Posts with components and diagrams may be shown to readers in a lesser form, and that the resulting second copy is worth keeping honest.
