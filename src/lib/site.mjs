// What the site calls itself, in one place. The Publication — the site's record
// in the ATmosphere — is described with these same words, so it can't acquire a
// second identity that drifts from what the pages say.
//
// A plain .mjs rather than .ts so the one-off scripts in scripts/ can import it
// under any Node the repo supports without a type-stripping flag.

// The site's own name, as distinct from any one page's title. Declared once
// because the title fallback below needs the same string, and two literals
// three lines apart drift the moment either is edited.
export const SITE_NAME = 'Flotsam';

// What a page describes itself as when it has no description of its own, and
// what the Publication says about the whole site.
export const SITE_DESCRIPTION = 'Miscellaneous or unimportant material from Tommy';

// The AT-URI of the site's Publication record. Everything that needs to refer
// to the Publication derives from this one constant: the `.well-known`
// verification endpoint, each Document's `site` field, and the build-time
// lookup.
//
// `null` until the Publication has been created. Creating it needs credentials,
// so it happens once, by hand: run `npm run init:publication`, then paste the
// AT-URI it prints here and commit. Until then everything that reads this stays
// inert rather than serving something wrong.
/** @type {string | null} */
export const PUBLICATION_AT_URI = null;
