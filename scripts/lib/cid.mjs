import { createHash } from "node:crypto";

// The CID a PDS gives a blob it stores: CIDv1, the `raw` codec, sha2-256, in
// lowercase unpadded base32 with the multibase prefix `b`. Worked out here so an
// image can be recognised by its bytes without asking the PDS, and without a
// dependency. The CID of no bytes at all is
// `bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku`.
export function cidOfBytes(bytes) {
	const VERSION = 0x01;
	const RAW = 0x55;
	const SHA2_256 = 0x12;
	const DIGEST_LENGTH = 0x20;
	const cid = Buffer.concat([
		Buffer.from([VERSION, RAW, SHA2_256, DIGEST_LENGTH]),
		createHash("sha256").update(bytes).digest(),
	]);

	const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
	let out = "";
	let buffered = 0;
	let bits = 0;
	for (const byte of cid) {
		buffered = (buffered << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			out += alphabet[(buffered >>> (bits - 5)) & 31];
			bits -= 5;
		}
	}
	if (bits > 0) out += alphabet[(buffered << (5 - bits)) & 31];
	return `b${out}`;
}
