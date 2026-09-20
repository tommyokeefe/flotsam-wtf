import type { APIRoute } from 'astro';
import { PUBLICATION_AT_URI } from '../../lib/site.mjs';

// Standard.site's proof that this domain owns its Publication: a plain-text
// file at this path whose whole body is the Publication's AT-URI. A reader or
// aggregator follows the Publication record's `url` to here and checks the two
// agree.
//
// Until the Publication exists there is nothing true to say, so this returns an
// empty body, which Astro's static build turns into no file at all (the host
// then answers 404) rather than an empty or placeholder one: a verifier treats
// an absent file as "unverified", but could mistake a wrong one for a claim.
export const GET: APIRoute = () => {
	if (!PUBLICATION_AT_URI) return new Response(null, { status: 404 });

	return new Response(PUBLICATION_AT_URI, {
		headers: { 'Content-Type': 'text/plain; charset=utf-8' },
	});
};
