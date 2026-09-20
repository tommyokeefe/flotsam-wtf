# The manifest is authoritative, and that includes deleting Documents

Publishing to the ATmosphere is a reconcile, not an append. The build emits a manifest of every Visible Post (`/posts.json`, ADR 0004), and the publish step makes the PDS match it: a Post with no Document gets one, a Post whose metadata changed has its Document updated, and **a Document whose Post is no longer in the manifest is deleted.** That deletion is deliberate, and it is done by CI.

**Why deletion is part of it.** Nothing may outlive the thing it points at. A Post that is deleted, or turned back into a Draft, has to stop being announced: a Draft is never public, and that guarantee has to hold outside this site as well as on it, or "pulling a Post back" only pulls it back on flotsam.wtf. An append-only publisher cannot retract anything, so it would fail exactly when the failure matters most.

**"CI deletes records" is meant to look alarming, and removing the step is the wrong response.** Without it, Documents would drift permanently away from the Posts they point at, with nobody able to tell which were stale. The risk is real but it is a risk of a *bad plan*, so it is controlled where plans are made, not by giving up the ability to delete. The planner (`scripts/plan-documents.mjs`) is a pure function and the only place anything destructive is decided; the executor just runs what it is handed. It refuses, and writes nothing, when:

- the manifest is empty, because a build bug that emits nothing must never read as "the archive has been deleted";
- the plan would delete more than three Documents at once, because a subtle regression in the Visible Post rule would otherwise quietly unpublish the archive. Retracting a Post or two is ordinary; a larger clear-out has to be a deliberate act;
- the manifest has an entry with a hole in it or lists a path twice, or the PDS holds two Documents for one path, since each would make a write or a delete a guess.

A refusal is meant to be a failure to publish and never a failure to deploy (#43): the site still ships and simply lacks the reference until the next run.

**The planner only considers this Publication's Documents.** An account can hold several Publications and the PDS lists all of their Documents together. Anything belonging to another Publication is neither updated nor deleted.

**The PDS is the source of truth for what has been published, and the repo for what exists.** Nothing about publishing is stored in the repo: no AT-URI in frontmatter (ADR 0005 keeps that schema strict) and no committed state file for a bot to update. That keeps the history a person's, and means no committed file can drift from reality.

**What is compared.** Every field a Document is written with, not only the title and description: a changed canonical URL, published date or Share image also produces an update. Dates compare as instants and the Share image as the CID of its bytes, so a notation difference doesn't rewrite a Document forever and a swapped picture isn't missed.

**Two consequences to accept.** Retraction is best-effort: a deletion propagates through the firehose but cannot purge a third party's cache or archive. And a Document is matched to its Post by `path` while its key is a TID assigned by the PDS, so **renaming a Post's slug is a retraction plus a republication**: the old Document is deleted and a new one with a new identity is created, and anything that referenced the old AT-URI does not follow. That is acceptable, because slugs are not expected to change, but it should be a conscious act.
