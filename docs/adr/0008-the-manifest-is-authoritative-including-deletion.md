# The manifest is authoritative, and that includes deleting Documents

Publishing to the ATmosphere is a reconcile, not an append. The build emits a manifest of every Visible Post (`/posts.json`, ADR 0004), and publishing makes the PDS match it: a Post with no Document gets one, a Post whose metadata changed has its Document updated, and **a Document whose Post is no longer in the manifest is deleted.** That deletion is deliberate, and it is meant to be done by CI (#43). The planner that decides all of this is `scripts/plan-documents.mjs`; the executor that carries it out is `scripts/publish-documents.mjs`.

**It only makes sense from a production-mode build.** A Visible Post includes Drafts in a preview build, and a Draft never has a Document. The planner has no Draft rule of its own, on purpose (ADR 0004 gives that rule one owner), so it trusts the manifest it is handed, and CI builds in an environment where `getVisiblePosts()` excludes Drafts. `npm run audit:manifest` is the check that this holds.

**Why deletion is part of it.** Nothing may outlive the thing it points at. A Post that is deleted, or turned back into a Draft, has to stop being announced: a Draft is never public, and that guarantee has to hold outside this site as well as on it, or "pulling a Post back" only pulls it back on flotsam.wtf. An append-only publisher cannot retract anything, so it would fail exactly when the failure matters most.

**"CI deletes records" is meant to look alarming, and removing the step is the wrong response.** Without it, Documents would drift permanently away from the Posts they point at, with nobody able to tell which were stale. The risk is real but it is a risk of a *bad plan*, so it is controlled where plans are made, not by giving up the ability to delete. The planner is a pure function and the only place anything destructive is decided; the executor just runs what it is handed. It refuses, and writes nothing, when:

- the manifest is empty, because a build bug that emits nothing must never read as "the archive has been deleted";
- the plan would delete more than a few Documents at once (`MAX_DELETIONS` in the planner) or more than half of what exists, whichever is fewer. The second half matters at this size: with three Posts, a flat cap of three would let a truncated manifest unpublish the whole archive without noticing. Retracting a Post or two is ordinary, so one deletion is always allowed; a larger clear-out has to be a deliberate act;
- the manifest has an entry with a hole in it (including a date that can't be read) or lists a path twice, or the PDS holds two Documents for one path, or one of them can't be attributed to a Publication, since each would make a write or a delete a guess.

A refusal is meant to be a failure to publish and never a failure to deploy (#43): the site still ships and simply lacks the reference until the next run.

**A larger clear-out is a deliberate act, and here is how.** The planner takes an explicit `maxDeletions` for one run, which is used as given and replaces the default, and the publish command exposes it as `--max-deletions <n>`, so a bigger clear-out is a flag someone has to type and that shows in the command that ran it. The other way is to retract in steps, one run each.

**The planner only considers this Publication's Documents.** An account can hold several Publications and the PDS lists all of their Documents together. Anything belonging to another Publication is neither updated nor deleted.

**The PDS is the source of truth for what has been published, and the repo for what exists.** Nothing about publishing is stored in the repo: no AT-URI in frontmatter (ADR 0005 keeps that schema strict) and no committed state file for a bot to update. That keeps the history a person's, and means no committed file can drift from reality.

**What is compared.** Every field a Document is written with, not only the title and description: a changed published date or Share image also produces an update. (Not a canonical URL: a Document has none, since a reader derives it from the Publication's `url` and the Document's `path`, so comparing one would rewrite every Document on every run.) Dates compare as instants and the Share image as the CID of its bytes, so a notation difference doesn't rewrite a Document forever and a swapped picture isn't missed.

**Two consequences to accept.** Retraction is best-effort: a deletion propagates through the firehose but cannot purge a third party's cache or archive. And a Document is matched to its Post by `path` while its key is a TID assigned by the PDS, so **renaming a Post's slug is a retraction plus a republication**: the old Document is deleted and a new one with a new identity is created, and anything that referenced the old AT-URI does not follow. That is acceptable, because slugs are not expected to change, but it should be a conscious act.

Revisiting this means deciding that a Document may outlive its Post, for example to keep an archive that flotsam.wtf has dropped. That is a different feature, with its own answer to what "published" means, and it would remove the guarantee that pulling a Post back pulls it back everywhere.
