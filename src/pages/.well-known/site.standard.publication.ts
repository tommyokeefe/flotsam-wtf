import type { APIRoute } from 'astro';
import { PUBLICATION_AT_URI } from '../../lib/site.mjs';

// The shape of a Publication's AT-URI: `at://<did>/site.standard.publication/<rkey>`.
// A typo in the committed constant would otherwise be served as though it were
// proof, so a malformed one is treated as no answer at all.
const PUBLICATION_URI = /^at:\/\/did:[a-z0-9]+:[A-Za-z0-9._:%-]+\/site\.standard\.publication\/[A-Za-z0-9._~:-]+$/;

// Standard.site's proof that this domain owns its Publication: a plain-text
// file at this path whose whole body is the Publication's AT-URI. A reader or
// aggregator follows the Publication record's `url` to here and checks the two
// agree.
//
// Until the Publication exists there is nothing true to say, so this returns a
// 404 with no body, which Astro's static build turns into no file at all (the
// host then answers 404) rather than an empty or placeholder one: a verifier
// treats an absent file as "unverified", but could mistake a wrong one for a
// claim.
//
// The Content-Type below only applies to the dev server. Once built this is a
// static file and the host picks the type from its extension, which is why
// vercel.json sets it for this path.
export const GET: APIRoute = () => {
	if (!PUBLICATION_AT_URI) return new Response(null, { status: 404 });

	if (!PUBLICATION_URI.test(PUBLICATION_AT_URI)) {
		console.warn(
			`PUBLICATION_AT_URI in src/lib/site.mjs isn't a Publication AT-URI (${PUBLICATION_AT_URI}); not serving it.`,
		);
		return new Response(null, { status: 404 });
	}

	return new Response(PUBLICATION_AT_URI, {
		headers: { 'Content-Type': 'text/plain; charset=utf-8' },
	});
};
