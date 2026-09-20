// What the site calls itself, in one place. The Publication — the site's record
// in the ATmosphere — is described with these same words, so it can't acquire a
// second identity that drifts from what the pages say.
//
// A plain .mjs rather than .ts so astro.config.mjs and the one-off scripts in
// scripts/ can import it under any Node the repo supports, without a
// type-stripping flag.

// The host the site is actually served from: the apex redirects here (308), so
// every og:url, absolute og:image and canonical derived from this should name
// the address that answers, not one that bounces. Origin only, no trailing
// slash — it is also the Publication's `url`.
export const SITE_URL = 'https://www.flotsam.wtf';

// The site's own name, as distinct from any one page's title. Declared once
// because Layout's title fallback and its og:site_name both need the same
// string, and the Publication is named with it too.
export const SITE_NAME = 'Flotsam';

// What a page describes itself as when it has no description of its own, and
// what the Publication says about the whole site.
export const SITE_DESCRIPTION = 'Miscellaneous or unimportant material from Tommy';

// The AT-URI of the site's Publication record. Everything that needs to refer
// to the Publication reads this one constant: today the `.well-known`
// verification endpoint, and later each Document's `site` field and the
// build-time lookup, so none of them can disagree about it.
//
// `null` until the Publication has been created. Creating it needs credentials,
// so it happens once, by hand: run `npm run init:publication`, then paste the
// AT-URI it prints here and commit. Until then everything that reads this stays
// inert rather than serving something wrong.
/** @type {string | null} */
export const PUBLICATION_AT_URI = null;
