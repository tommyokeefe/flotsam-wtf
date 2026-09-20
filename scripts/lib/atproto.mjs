// The few AT Protocol calls the one-off scripts need, over plain fetch.
//
// Deliberately not the AT Protocol SDK: the repo has no runtime dependencies and
// a couple of scripts aren't a reason to add a large one. What lives here is
// what both init-publication.mjs and publish-documents.mjs need, so the
// credential handling below exists once.
//
// Nothing here ends the process. A failure throws `UserError`, whose message is
// written to be shown as-is, and the script decides how to exit.

// An expected failure: bad input, an unreachable host, a server saying no. The
// message never contains anything from the request, so it is safe to print.
export class UserError extends Error {}

const PUBLIC_APPVIEW = "https://public.api.bsky.app";

// A network failure becomes a `UserError` that says only which host couldn't be
// reached, never anything from the request.
async function request(url, init) {
	try {
		return await fetch(url, init);
	} catch (error) {
		throw new UserError(
			`couldn't reach ${new URL(url).host}: ${error.cause?.code ?? error.message}`,
		);
	}
}

// One XRPC call. `body` is sent as JSON; `bytes` with `contentType` is sent raw
// (a blob upload). Errors carry the endpoint and status, and nothing from the
// request, so a failure can't echo a credential into a terminal or a log.
export async function xrpc(
	base,
	nsid,
	{ method = "GET", params, body, bytes, contentType, token } = {},
) {
	// A call is either JSON or raw bytes, and raw bytes need a type. Neither is
	// something the data can cause, so a wrong combination is a bug in the caller.
	if (body && bytes) throw new TypeError("xrpc takes a body or bytes, not both.");
	if (bytes && !contentType) throw new TypeError("xrpc needs a contentType for bytes.");

	const url = new URL(`/xrpc/${nsid}`, base);
	for (const [key, value] of Object.entries(params ?? {})) {
		url.searchParams.set(key, value);
	}
	const response = await request(url, {
		method,
		headers: {
			...(body && { "Content-Type": "application/json" }),
			...(bytes && { "Content-Type": contentType }),
			...(token && { Authorization: `Bearer ${token}` }),
		},
		body: bytes ?? (body && JSON.stringify(body)),
	});
	const payload = (await response.json().catch(() => null)) ?? {};
	if (!response.ok) {
		throw new UserError(
			`${nsid} failed (${response.status}${payload.error ? ` ${payload.error}` : ""}): ${payload.message ?? "no detail"}`,
		);
	}
	return payload;
}

export async function resolveDid(handleOrDid) {
	if (handleOrDid.startsWith("did:")) return handleOrDid;
	const { did } = await xrpc(PUBLIC_APPVIEW, "com.atproto.identity.resolveHandle", {
		params: { handle: handleOrDid },
	});
	return did;
}

// Where the account's repo actually lives, read from its DID document rather
// than assumed to be bsky.social, so this works for a self-hosted PDS too.
// did:plc only: that's what an account created through Bluesky or a standard
// PDS gets, and it is Tommy's.
export async function resolvePds(did) {
	if (!did.startsWith("did:plc:")) {
		throw new UserError(`only did:plc accounts are supported, not ${did}.`);
	}
	const response = await request(`https://plc.directory/${did}`);
	if (!response.ok) {
		throw new UserError(`couldn't fetch the DID document for ${did} (${response.status}).`);
	}
	const didDocument = await response.json();
	const endpoint = didDocument.service?.find(
		(service) => service.id === "#atproto_pds",
	)?.serviceEndpoint;
	if (!endpoint) throw new UserError(`${did}'s DID document names no PDS.`);
	// A password is about to be sent here, so it must not go in clear.
	if (!URL.canParse(endpoint) || new URL(endpoint).protocol !== "https:") {
		throw new UserError(
			`${did}'s PDS is ${endpoint}, which isn't https; refusing to send a password to it.`,
		);
	}
	return endpoint;
}

// `at://<did>/<collection>/<rkey>` taken apart. Anything else is a `UserError`,
// so a malformed URI is never used to address a record.
export function parseAtUri(uri) {
	const match = /^at:\/\/(did:[a-z0-9]+:[A-Za-z0-9._:%-]+)\/([A-Za-z0-9.-]+)\/([A-Za-z0-9._~:-]+)$/.exec(
		String(uri),
	);
	if (!match) throw new UserError(`not an AT-URI for a record: ${String(uri)}`);
	const [, did, collection, rkey] = match;
	return { did, collection, rkey };
}
