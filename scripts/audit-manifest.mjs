// Fails if a Draft made it into the built Visible Post manifest.
//
// Deliberately does not import `getVisiblePosts` or anything else from src/.
// That helper is the one production owner of the Draft rule (ADR 0004); this
// script exists to *disagree* with it if it ever regresses, so it re-derives
// the Draft set on its own by reading each Post's frontmatter. Sharing the
// implementation would make the two agree by construction and the audit
// worthless. If you're tempted to dedupe them, don't.
//
// Only meaningful against a production-mode build (`npm run build`, or CI).
// Drafts legitimately appear in the manifest of a dev or preview build, so this
// fails there by design — that is what a leak looks like.
//
// It fails closed: anything it can't confidently reason about is an error, not
// a pass. A quiet false pass is the one outcome this script exists to prevent.
//
// Run after a build: `npm run build && npm run audit:manifest`.
import { readFileSync, readdirSync } from "node:fs";
import { basename, join, sep } from "node:path";

const root = join(import.meta.dirname, "..");
const postsDir = join(root, "src/content/posts");
const manifestFile = join(root, "dist/posts.json");

function fail(message) {
	console.error(`audit-manifest: ${message}`);
	process.exit(1);
}

// `draft: true` as a root key, quoted or not, any case, optionally followed by a
// comment. Covers the forms the schema's boolean accepts (ADR 0005 keeps the
// schema `.strict()`, so there is no other key to hide it under).
const DRAFT_LINE = /^["']?draft["']?\s*:\s*["']?true["']?\s*(#.*)?$/im;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/;

// Astro turns a folder name into the Post's URL slug by slugifying it (case
// folded, punctuation dropped), so `My-Post/` is served at `/posts/my-post`.
// This script doesn't reimplement that: it accepts only names that are already
// plain slugs, where the folder name *is* the URL. Reimplementing the slugger
// would just be a second copy that can disagree with the first, quietly.
const PLAIN_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// A Post is `<slug>/index.md` or `<slug>/index.mdx` (ADR 0001). The collection's
// glob would also accept deeper nesting, and a Post folder holding both files;
// checking every match at exactly one level deep turns the first into an error
// and covers the second.
const draftPaths = new Set();
for (const relative of readdirSync(postsDir, { recursive: true })) {
	if (!/^index\.mdx?$/.test(basename(relative))) continue;

	const segments = relative.split(sep);
	if (segments.length !== 2) {
		fail(
			`${relative} is nested; Posts are one flat folder each (ADR 0001), and this audit can't predict a nested Post's URL.`,
		);
	}

	const source = readFileSync(join(postsDir, relative), "utf8");
	if (!DRAFT_LINE.test(source.match(FRONTMATTER)?.[1] ?? "")) continue;

	const [slug] = segments;
	if (!PLAIN_SLUG.test(slug)) {
		fail(
			`Draft folder "${slug}" isn't a plain lowercase slug, so this audit can't tell which URL it becomes. Rename it, or a leak of it would go unnoticed.`,
		);
	}
	draftPaths.add(`/posts/${slug}`);
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
