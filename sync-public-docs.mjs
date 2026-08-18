#!/usr/bin/env node
/**
 * sync-public-docs.mjs
 *
 * Keeps acme-corp-public/ in sync with a specific subset of files from
 * acme-corp-internal/, defined in public-pages.json.
 *
 * GitBook's editor does NOT support Markdown frontmatter (it renders it
 * as literal visible text rather than metadata), so we can't tag pages
 * public/internal inside the files themselves. Instead, public-pages.json
 * is the single source of truth for "which internal pages are also
 * public." Anything in acme-corp-internal/ NOT listed there (e.g.
 * account-notes.md, support-history.md) is treated as staff-only and
 * is never copied.
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
const CONFIG_PATH = path.join(__dirname, "public-pages.json");
const CHECK_ONLY = process.argv.includes("--check");

// SUMMARY.md is hand-maintained separately per folder (page order/tree
// can legitimately differ between internal and public), so it's never
// auto-synced by this script.
const ALWAYS_SKIP = new Set(["SUMMARY.md", "public-pages.json"]);

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`Missing config: ${CONFIG_PATH}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.publicPages)) {
    console.error(`public-pages.json must have a "publicPages" array.`);
    process.exit(1);
  }
  return new Set(parsed.publicPages);
}

function main() {
  if (!fs.existsSync(INTERNAL_DIR)) {
    console.error(`Missing folder: ${INTERNAL_DIR}`);
    process.exit(1);
  }
  if (!fs.existsSync(PUBLIC_DIR)) {
    fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  }

  const publicPages = loadConfig();

  const allInternalFiles = fs
    .readdirSync(INTERNAL_DIR)
    .filter((f) => f.endsWith(".md") && !ALWAYS_SKIP.has(f));

  let driftCount = 0;
  let leakDetected = false;
  const missingFromInternal = [];

  // 1. Sync every file listed in public-pages.json that exists internally
  for (const file of publicPages) {
    const sourcePath = path.join(INTERNAL_DIR, file);
    if (!fs.existsSync(sourcePath)) {
      missingFromInternal.push(file);
      console.warn(
        `[WARN]  ${file} is listed in public-pages.json but doesn't exist in acme-corp-internal/`
      );
      continue;
    }

    const content = fs.readFileSync(sourcePath, "utf8");
    const targetPath = path.join(PUBLIC_DIR, file);
    const alreadyMatches =
      fs.existsSync(targetPath) &&
      fs.readFileSync(targetPath, "utf8") === content;

    if (!alreadyMatches) {
      driftCount++;
      console.log(
        `${CHECK_ONLY ? "[DRIFT]" : "[SYNC] "} ${file} ${
          fs.existsSync(targetPath) ? "(updated)" : "(new)"
        }`
      );
      if (!CHECK_ONLY) {
        fs.writeFileSync(targetPath, content, "utf8");
      }
    } else {
      console.log(`[OK]    ${file} (already in sync)`);
    }
  }

  // 2. Report internal-only files, for visibility
  const internalOnly = allInternalFiles.filter((f) => !publicPages.has(f));
  for (const file of internalOnly) {
    console.log(`[SKIP]  ${file} (not in public-pages.json, staff-only)`);
  }

  // 3. Safety net: flag any file sitting in acme-corp-public/ that is
  //    NOT in public-pages.json — this catches manual copy mistakes or
  //    leftover files from before a page was removed from the list.
  if (fs.existsSync(PUBLIC_DIR)) {
    const publicFiles = fs
      .readdirSync(PUBLIC_DIR)
      .filter((f) => f.endsWith(".md") && !ALWAYS_SKIP.has(f));
    for (const file of publicFiles) {
      if (!publicPages.has(file)) {
        leakDetected = true;
        console.error(
          `[LEAK!] ${file} exists in acme-corp-public/ but is NOT listed in public-pages.json — remove it manually and investigate how it got there.`
        );
      }
    }
  }

  console.log("\n--- Summary ---");
  console.log(`Public pages (per config): ${publicPages.size}`);
  console.log(`Internal-only pages:       ${internalOnly.length}`);
  console.log(`Drifted/synced:            ${driftCount}`);
  if (missingFromInternal.length) {
    console.log(`Missing from internal:     ${missingFromInternal.length}`);
  }

  if (leakDetected) {
    console.error(
      "\nCRITICAL: one or more files exist in the public folder without being authorized in public-pages.json. Fix before publishing."
    );
    process.exit(2);
  }

  if (CHECK_ONLY && driftCount > 0) {
    console.log(
      "\nDrift detected. Run without --check to sync, or review changes above."
    );
    process.exit(1);
  }

  console.log(CHECK_ONLY ? "\nNo drift detected." : "\nSync complete.");
}

main();
