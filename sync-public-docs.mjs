#!/usr/bin/env node
/**
 * sync-public-docs.mjs
 *
 * Keeps acme-corp-public/ in sync with pages from acme-corp-internal/
 * that are tagged "public" in GitBook, INCLUDING pages nested in
 * subfolders (GitBook turns a page-with-subpages into a folder, e.g.
 * troubleshooting/README.md + troubleshooting/troubleshooting-subpage-1.md).
 *
 * Tagging: in GitBook's editor, open a page -> Page options -> Add tags
 * -> add a tag called "public". On merge, GitBook's Git Sync exports
 * real YAML frontmatter into the file:
 *
 *   ---
 *   tags:
 *     - public
 *   ---
 *
 * Rules for nested pages:
 * - Each page's OWN tag is what matters. Tagging a parent page public
 *   does NOT automatically make its subpages public, and vice versa -
 *   every page (folder/README.md or plain file) needs its own "public"
 *   tag to be included.
 * - A subpage can only be public if its parent chain is also public in
 *   the destination tree; this script enforces that by only syncing a
 *   folder's README.md/subpages if the folder's own README.md is
 *   public-tagged. (A public subpage under a private parent would have
 *   nowhere sensible to attach in the public SUMMARY.md.)
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

function parseFrontmatterTags(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return [];
  const tagsBlockMatch = match[1].match(/tags:\n((?:\s*-\s*.+\n?)+)/);
  if (!tagsBlockMatch) return [];
  return tagsBlockMatch[1]
    .split("\n")
    .map((line) => line.replace(/^\s*-\s*/, "").trim())
    .filter(Boolean);
}

/**
 * Recursively walks a directory, returning a tree of nodes.
 * Each node is either:
 *   { type: "page", relPath: "getting-started.md", tags: [...] }
 *   { type: "folder", relPath: "troubleshooting", indexTags: [...],
 *     indexRelPath: "troubleshooting/README.md", children: [...] }
 * relPath is always relative to the space root (acme-corp-internal or
 * acme-corp-public), using forward slashes.
 */
function walk(dir, relBase = "") {
  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));

  const nodes = [];
  for (const entry of entries) {
    if (entry.name === "SUMMARY.md") continue;
    if (entry.name === "README.md") continue; // handled as folder/space index separately, never a plain child
    if (entry.name.startsWith(".")) continue; // .gitbook/ etc.

    if (entry.isDirectory()) {
      const folderRel = relBase ? `${relBase}/${entry.name}` : entry.name;
      const indexPath = path.join(dir, entry.name, "README.md");
      let indexTags = [];
      if (fs.existsSync(indexPath)) {
        indexTags = parseFrontmatterTags(fs.readFileSync(indexPath, "utf8"));
      }
      const children = walk(path.join(dir, entry.name), folderRel);
      nodes.push({
        type: "folder",
        relPath: folderRel,
        indexRelPath: `${folderRel}/README.md`,
        indexTags,
        children,
      });
    } else if (entry.name.endsWith(".md")) {
      const fileRel = relBase ? `${relBase}/${entry.name}` : entry.name;
      const content = fs.readFileSync(path.join(dir, entry.name), "utf8");
      nodes.push({
        type: "page",
        relPath: fileRel,
        tags: parseFrontmatterTags(content),
      });
    }
  }
  return nodes;
}

/**
 * Filters a node tree down to only public-tagged pages/folders.
 * A folder is included only if its own README.md is public-tagged;
 * if included, its children are filtered the same way recursively.
 * Returns a new, possibly-smaller tree plus a flat list of all
 * included relPaths (for copy/delete/leak-check bookkeeping).
 */
function filterPublic(nodes) {
  const included = [];
  const flatIncludedPaths = [];

  for (const node of nodes) {
    if (node.type === "page") {
      if (node.tags.includes(PUBLIC_TAG)) {
        included.push(node);
        flatIncludedPaths.push(node.relPath);
      }
    } else if (node.type === "folder") {
      if (node.indexTags.includes(PUBLIC_TAG)) {
        const { included: childIncluded, flat: childFlat } = (() => {
          const r = filterPublic(node.children);
          return { included: r.nodes, flat: r.flatIncludedPaths };
        })();
        included.push({ ...node, children: childIncluded });
        flatIncludedPaths.push(node.indexRelPath, ...childFlat);
      }
      // if the folder's own index isn't public, its children are
      // never included either, even if individually tagged - there's
      // no sensible place to attach them in the public tree.
    }
  }

  return { nodes: included, flatIncludedPaths };
}

function ensureDirFor(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function copyPublicTree(nodes, log) {
  for (const node of nodes) {
    if (node.type === "page") {
      const sourcePath = path.join(INTERNAL_DIR, node.relPath);
      const targetPath = path.join(PUBLIC_DIR, node.relPath);
      const content = fs.readFileSync(sourcePath, "utf8");
      const alreadyMatches =
        fs.existsSync(targetPath) &&
        fs.readFileSync(targetPath, "utf8") === content;
      if (!alreadyMatches) {
        log.drift++;
        console.log(
          `${CHECK_ONLY ? "[DRIFT]" : "[SYNC] "} ${node.relPath} ${
            fs.existsSync(targetPath) ? "(updated)" : "(new)"
          }`
        );
        if (!CHECK_ONLY) {
          ensureDirFor(targetPath);
          fs.writeFileSync(targetPath, content, "utf8");
        }
      } else {
        console.log(`[OK]    ${node.relPath} (already in sync)`);
      }
    } else if (node.type === "folder") {
      const sourcePath = path.join(INTERNAL_DIR, node.indexRelPath);
      const targetPath = path.join(PUBLIC_DIR, node.indexRelPath);
      const content = fs.readFileSync(sourcePath, "utf8");
      const alreadyMatches =
        fs.existsSync(targetPath) &&
        fs.readFileSync(targetPath, "utf8") === content;
      if (!alreadyMatches) {
        log.drift++;
        console.log(
          `${CHECK_ONLY ? "[DRIFT]" : "[SYNC] "} ${node.indexRelPath} ${
            fs.existsSync(targetPath) ? "(updated)" : "(new)"
          }`
        );
        if (!CHECK_ONLY) {
          ensureDirFor(targetPath);
          fs.writeFileSync(targetPath, content, "utf8");
        }
      } else {
        console.log(`[OK]    ${node.indexRelPath} (already in sync)`);
      }
      copyPublicTree(node.children, log);
    }
  }
}

/** Collects every currently-included relPath as a flat Set, for cleanup. */
function collectAllExistingPublicPaths(dir, relBase = "") {
  const results = new Set();
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "SUMMARY.md") continue;
    if (entry.name === "README.md") continue; // added explicitly for folders below; space-root README is never a "public page" entry to track
    if (entry.name.startsWith(".")) continue;
    if (entry.isDirectory()) {
      const folderRel = relBase ? `${relBase}/${entry.name}` : entry.name;
      const sub = collectAllExistingPublicPaths(
        path.join(dir, entry.name),
        folderRel
      );
      for (const p of sub) results.add(p);
      results.add(`${folderRel}/README.md`);
    } else if (entry.name.endsWith(".md")) {
      const fileRel = relBase ? `${relBase}/${entry.name}` : entry.name;
      results.add(fileRel);
    }
  }
  return results;
}

function removeStaleFiles(currentPublicPaths, keepPaths, log) {
  for (const relPath of currentPublicPaths) {
    if (!keepPaths.has(relPath)) {
      log.removed.push(relPath);
      console.log(
        `${CHECK_ONLY ? "[WOULD REMOVE]" : "[REMOVE]"} ${relPath} — no longer tagged '${PUBLIC_TAG}'`
      );
      if (!CHECK_ONLY) {
        const targetPath = path.join(PUBLIC_DIR, relPath);
        if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
      }
    }
  }
  // Clean up now-empty directories (best effort, deepest first)
  if (!CHECK_ONLY) {
    const dirs = [...currentPublicPaths]
      .filter((p) => p.includes("/"))
      .map((p) => path.dirname(path.join(PUBLIC_DIR, p)))
      .sort((a, b) => b.length - a.length);
    for (const dir of dirs) {
      try {
        if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
          fs.rmdirSync(dir);
        }
      } catch {
        // not empty or already gone, fine
      }
    }
  }
}

/** Builds SUMMARY.md content from the filtered public tree. */
function buildSummary(nodes, depth = 0) {
  const indent = "  ".repeat(depth);
  const lines = [];
  for (const node of nodes) {
    if (node.type === "page") {
      const title = titleFromPath(node.relPath);
      lines.push(`${indent}* [${title}](${node.relPath})`);
    } else if (node.type === "folder") {
      const title = titleFromPath(node.indexRelPath, node.relPath);
      lines.push(`${indent}* [${title}](${node.indexRelPath})`);
      lines.push(...buildSummary(node.children, depth + 1));
    }
  }
  return lines;
}

function titleFromPath(relPath, folderName) {
  const base = folderName || relPath.replace(/\.md$/, "");
  const name = base.split("/").pop();
  return name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function main() {
  if (!fs.existsSync(INTERNAL_DIR)) {
    console.error(`Missing folder: ${INTERNAL_DIR}`);
    process.exit(1);
  }
  if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });

  const internalTree = walk(INTERNAL_DIR);
  const { nodes: publicTree, flatIncludedPaths } = filterPublic(internalTree);
  const keepPaths = new Set(flatIncludedPaths);

  const log = { drift: 0, removed: [] };

  console.log("--- Syncing public-tagged pages ---");
  copyPublicTree(publicTree, log);

  console.log("\n--- Cleaning up stale files ---");
  const currentPublicPaths = collectAllExistingPublicPaths(PUBLIC_DIR);
  removeStaleFiles(currentPublicPaths, keepPaths, log);

  console.log("\n--- Updating SUMMARY.md ---");
  const summaryPath = path.join(PUBLIC_DIR, "SUMMARY.md");
  const summaryLines = ["# Table of contents", "", "* [Acme Corp](README.md)"];
  summaryLines.push(...buildSummary(publicTree));
  const newSummary = summaryLines.join("\n") + "\n";
  const oldSummary = fs.existsSync(summaryPath)
    ? fs.readFileSync(summaryPath, "utf8")
    : "";
  if (newSummary !== oldSummary) {
    log.drift++;
    console.log(
      CHECK_ONLY ? "[WOULD UPDATE] SUMMARY.md" : "[UPDATE] SUMMARY.md"
    );
    if (!CHECK_ONLY) fs.writeFileSync(summaryPath, newSummary, "utf8");
  } else {
    console.log("[OK]    SUMMARY.md (already in sync)");
  }

  console.log("\n--- Summary ---");
  console.log(`Public-tagged pages (incl. subpages): ${flatIncludedPaths.length}`);
  console.log(`Drifted/synced:                       ${log.drift}`);
  console.log(`Removed (untagged):                   ${log.removed.length}`);

  if (CHECK_ONLY && (log.drift > 0 || log.removed.length > 0)) {
    console.log("\nChanges pending. Run without --check to apply.");
    process.exit(1);
  }
  console.log(CHECK_ONLY ? "\nNo changes needed." : "\nSync complete.");
}

main();
