#!/usr/bin/env node
/**
 * sync-public-docs.mjs
 *
 * Keeps acme-corp-public/ in sync with pages from acme-corp-internal/
 * that are tagged "public" in GitBook.
 *
 * How tagging works: in GitBook's editor, open a page -> Page options ->
 * Add tags -> add a tag called "public". When that change request is
 * merged, GitBook's Git Sync exports real YAML frontmatter into the
 * page's .md file, e.g.:
 *
 *   ---
 *   tags:
 *     - public
 *   ---
 *
 * This script reads that frontmatter directly. Pages with no "public"
 * tag (including untagged pages, and pages tagged anything else, e.g.
 * "internal") are treated as staff-only and are never copied.
 *
 * README.md and SUMMARY.md are structural files, not "pages" in the
 * tagging sense, and are always synced/maintained separately (see notes
 * below) rather than driven by tags.
 *
 * Usage:
 *   node sync-public-docs.mjs           # sync
 *   node sync-public-docs.mjs --check   # dry run, only report drift/leaks
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INTERNAL_DIR = path.join(__dirname, "acme-corp-internal");
const PUBLIC_DIR = path.join(__dirname, "acme-corp-public");
const CHECK_ONLY = process.argv.includes("--check");

const PUBLIC_TAG = "public";

// SUMMARY.md defines page order/tree per space and is hand-maintained
// separately (the public space may reasonably have a different,
// shorter table of contents). README.md is each space's own homepage
// and is also left alone by this script - edit each space's README
// directly if you want it to say something different.
const ALWAYS_SKIP = new Set(["SUMMARY.md", "README.md"]);

function parseFrontmatterTags(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return [];
  const frontmatter = match[1];
  // crude but sufficient YAML list parse for a "tags:" block, e.g.:
  // tags:
  //   - public
  //   - beta
  const tagsBlockMatch = frontmatter.match(/tags:\n((?:\s*-\s*.+\n?)+)/);
  if (!tagsBlockMatch) return [];
  return tagsBlockMatch[1]
    .split("\n")
    .map((line) => line.replace(/^\s*-\s*/, "").trim())
    .filter(Boolean);
}

function main() {
  if (!fs.existsSync(INTERNAL_DIR)) {
    console.error(`Missing folder: ${INTERNAL_DIR}`);
    process.exit(1);
  }
  if (!fs.existsSync(PUBLIC_DIR)) {
    fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  }

  const internalFiles = fs
    .readdirSync(INTERNAL_DIR)
    .filter((f) => f.endsWith(".md") && !ALWAYS_SKIP.has(f));

  const publicTagged = [];
  const notPublicTagged = [];
  let driftCount = 0;

  for (const file of internalFiles) {
    const sourcePath = path.join(INTERNAL_DIR, file);
    const content = fs.readFileSync(sourcePath, "utf8");
    const tags = parseFrontmatterTags(content);
    const isPublic = tags.includes(PUBLIC_TAG);

    if (isPublic) {
      publicTagged.push(file);
      const targetPath = path.join(PUBLIC_DIR, file);
      const alreadyMatches =
        fs.existsSync(targetPath) &&
        fs.readFileSync(targetPath, "utf8") === content;

      if (!alreadyMatches) {
        driftCount++;
        console.log(
          `${CHECK_ONLY ? "[DRIFT]" : "[SYNC] "} ${file} (tags: ${tags.join(", ")}) ${
            fs.existsSync(targetPath) ? "(updated)" : "(new)"
          }`
        );
        if (!CHECK_ONLY) {
          fs.writeFileSync(targetPath, content, "utf8");
        }
      } else {
        console.log(`[OK]    ${file} (already in sync)`);
      }
    } else {
      notPublicTagged.push(file);
      console.log(
        `[SKIP]  ${file} (tags: ${tags.length ? tags.join(", ") : "none"} — not tagged '${PUBLIC_TAG}')`
      );
    }
  }

  // Removal pass: any file sitting in acme-corp-public/ that no longer
  // corresponds to a public-tagged internal file gets deleted, and its
  // entry is also stripped from acme-corp-public/SUMMARY.md. Deleting
  // just the .md file is not enough - GitBook follows SUMMARY.md as the
  // table of contents, so a stale entry there will keep showing the old
  // page even after its file is gone.
  const removedFiles = [];
  if (fs.existsSync(PUBLIC_DIR)) {
    const publicFiles = fs
      .readdirSync(PUBLIC_DIR)
      .filter((f) => f.endsWith(".md") && !ALWAYS_SKIP.has(f));
    for (const file of publicFiles) {
      const stillPublic = publicTagged.includes(file);
      if (!stillPublic) {
        removedFiles.push(file);
        console.log(
          `${CHECK_ONLY ? "[WOULD REMOVE]" : "[REMOVE]"} ${file} — no longer tagged '${PUBLIC_TAG}' in acme-corp-internal/`
        );
        if (!CHECK_ONLY) {
          fs.unlinkSync(path.join(PUBLIC_DIR, file));
        }
      }
    }
  }

  // Keep acme-corp-public/SUMMARY.md in sync with whatever files are
  // actually present after the above sync/removal pass, preserving the
  // existing line order for files that remain, and appending any newly
  // public-tagged file that isn't listed yet.
  const summaryPath = path.join(PUBLIC_DIR, "SUMMARY.md");
  if (fs.existsSync(summaryPath)) {
    const summaryContent = fs.readFileSync(summaryPath, "utf8");
    const lines = summaryContent.split("\n");
    const linkLineRegex = /^\*\s*\[([^\]]+)\]\(([^)]+)\)\s*$/;

    const keptLines = [];
    const referencedFiles = new Set();

    for (const line of lines) {
      const match = line.match(linkLineRegex);
      if (!match) {
        keptLines.push(line); // headings, blank lines, README link, etc.
        continue;
      }
      const [, , linkedFile] = match;
      if (linkedFile === "README.md" || publicTagged.includes(linkedFile)) {
        keptLines.push(line);
        referencedFiles.add(linkedFile);
      } else {
        console.log(
          `${CHECK_ONLY ? "[WOULD REMOVE FROM SUMMARY]" : "[REMOVE FROM SUMMARY]"} ${linkedFile}`
        );
      }
    }

    for (const file of publicTagged) {
      if (!referencedFiles.has(file)) {
        const title = file
          .replace(/\.md$/, "")
          .replace(/-/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase());
        keptLines.push(`* [${title}](${file})`);
        console.log(
          `${CHECK_ONLY ? "[WOULD ADD TO SUMMARY]" : "[ADD TO SUMMARY]"} ${file}`
        );
      }
    }

    const newSummary = keptLines.join("\n");
    if (newSummary !== summaryContent) {
      driftCount++;
      if (!CHECK_ONLY) {
        fs.writeFileSync(summaryPath, newSummary, "utf8");
      }
    }
  }

  console.log("\n--- Summary ---");
  console.log(`Public-tagged pages: ${publicTagged.length}`);
  console.log(`Not public-tagged:   ${notPublicTagged.length}`);
  console.log(`Drifted/synced:      ${driftCount}`);
  console.log(`Removed (untagged):  ${removedFiles.length}`);

  if (CHECK_ONLY && (driftCount > 0 || removedFiles.length > 0)) {
    console.log(
      "\nChanges pending. Run without --check to apply, or review above."
    );
    process.exit(1);
  }

  console.log(CHECK_ONLY ? "\nNo changes needed." : "\nSync complete.");
}

main();
