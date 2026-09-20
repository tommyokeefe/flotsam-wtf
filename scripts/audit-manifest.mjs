// Fails if a Draft made it into the built Visible Post manifest.
//
// Deliberately does not import `getVisiblePosts` or anything else from src/.
// That helper is the one production owner of the Draft rule (ADR 0004); this
// script exists to *disagree* with it if it ever regresses, so it re-derives
// the Draft set on its own by reading each Post's frontmatter. Sharing the
// implementation would make the two agree by construction and the audit
// worthless. If you're tempted to dedupe them, don't.
//
// Run after a build: `npm run build && npm run audit:manifest`.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const postsDir = join(root, "src/content/posts");
const manifestFile = join(root, "dist/posts.json");

function fail(message) {
	console.error(`audit-manifest: ${message}`);
	process.exit(1);
}

// `draft: true`, quoted or not, any case, optionally followed by a comment. The
// schema is `.strict()` (ADR 0005) and `draft` is a boolean, so this is the only
// shape a Draft can take; anything else parses as "not a Draft", which is the
// same reading the schema gives it.
const DRAFT_LINE = /^draft:\s*["']?true["']?\s*(#.*)?$/im;

function frontmatterOf(source) {
	return source.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
}

// A Post is a folder holding `index.md` or `index.mdx`, and its folder name is
// its slug (ADR 0001).
const draftPaths = new Set();
for (const entry of readdirSync(postsDir, { withFileTypes: true })) {
	if (!entry.isDirectory()) continue;
	const file = ["index.md", "index.mdx"]
		.map((name) => join(postsDir, entry.name, name))
		.find((candidate) => {
			try {
				readFileSync(candidate);
				return true;
			} catch {
				return false;
			}
		});
	if (!file) continue;
	if (DRAFT_LINE.test(frontmatterOf(readFileSync(file, "utf8")))) {
		draftPaths.add(`/posts/${entry.name}`);
	}
}

// A manifest that is missing or unreadable can't be shown to be Draft-free, so
// it fails rather than passing vacuously.
let manifest;
try {
	manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
} catch (error) {
	fail(`could not read ${manifestFile} — did the build run? (${error.message})`);
}
if (!Array.isArray(manifest)) fail("manifest is not an array");

const leaked = manifest.filter((post) => draftPaths.has(post.path));
if (leaked.length > 0) {
	fail(
		`${leaked.length} Draft(s) in the manifest, which must never happen:\n` +
			leaked.map((post) => `  ${post.path}`).join("\n"),
	);
}

console.log(
	`audit-manifest: ok — ${manifest.length} Post(s) in the manifest, ${draftPaths.size} Draft(s) on disk, none leaked.`,
);
