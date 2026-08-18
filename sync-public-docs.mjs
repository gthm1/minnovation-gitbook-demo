#!/usr/bin/env node
/**
 * sync-public-docs.mjs
 *
 * Auto-discovers customer folder pairs in this repo by naming
 * convention: any folder ending in "-internal" that has a matching
 * folder with the same prefix ending in "-public" is treated as one
 * customer, e.g.:
 *
 *   acme-corp-internal/  <->  acme-corp-public/
 *   beta-industries-internal/  <->  beta-industries-public/
 *
 * No config file, no per-customer code changes. To add a new customer:
 *   1. Create two GitBook spaces (e.g. "AlphaCorp" and "AlphaCorp - Public")
 *   2. Connect each to Git Sync, pointed at NEW folders following the
 *      naming convention above (e.g. alphacorp-internal / alphacorp-public)
 *   3. That's it - the next run of this script picks them up automatically.
 *
 * For each discovered customer pair, this keeps the "-public" folder in
 * sync with pages from the "-internal" folder that are tagged "public"
 * in GitBook, including pages nested in subfolders (GitBook turns a
 * page-with-subpages into a folder, e.g.
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
 * - A subpage can only be public if its parent is also public in the
 *   destination tree. If a folder's own README.md isn't public-tagged,
 *   none of its children are synced either, even if individually
 *   tagged - and if a previously-public parent is untagged, its whole
 *   subtree is removed from the public folder on the next run, even if
 *   children are still individually tagged (no orphaned pages).
 *
 * Usage:
 *   node sync-public-docs.mjs           # sync all discovered customers
 *   node sync-public-docs.mjs --check   # dry run, report drift/leaks only
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHECK_ONLY = process.argv.includes("--check");
const PUBLIC_TAG = "public";

// ---------- customer discovery ----------

function discoverCustomers() {
  const entries = fs
    .readdirSync(__dirname, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("."));

  const internalFolders = entries
    .map((e) => e.name)
    .filter((name) => name.endsWith("-internal"));

  const customers = [];
  for (const internalName of internalFolders) {
    const prefix = internalName.slice(0, -"-internal".length);
    const publicName = `${prefix}-public`;
    if (!fs.existsSync(path.join(__dirname, publicName))) {
      console.warn(
        `[WARN] Found '${internalName}' but no matching '${publicName}' folder - skipping this customer. Create the public folder (e.g. via Git Sync from a new GitBook space) to enable syncing.`
      );
      continue;
    }
    customers.push({
      label: prefix
        .split("-")
        .map((w) => w[0].toUpperCase() + w.slice(1))
        .join(" "),
      internalDir: path.join(__dirname, internalName),
      publicDir: path.join(__dirname, publicName),
    });
  }
  return customers;
}

// ---------- frontmatter tags ----------

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

// ---------- tree walking ----------

/**
 * Recursively walks a directory, returning a tree of nodes relative to
 * that directory's own root.
 *   { type: "page", relPath, tags }
 *   { type: "folder", relPath, indexRelPath, indexTags, children }
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
 * Filters a node tree down to only public-tagged pages/folders. A
 * folder is included only if its own README.md is public-tagged; if
 * included, children are filtered the same way recursively (so an
 * untagged parent drops its whole subtree, even if a child is tagged).
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
        const result = filterPublic(node.children);
        included.push({ ...node, children: result.nodes });
        flatIncludedPaths.push(node.indexRelPath, ...result.flatIncludedPaths);
      }
    }
  }

  return { nodes: included, flatIncludedPaths };
}

// ---------- copy / cleanup ----------

function ensureDirFor(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function copyPublicTree(nodes, internalDir, publicDir, log) {
  for (const node of nodes) {
    const relPath = node.type === "page" ? node.relPath : node.indexRelPath;
    const sourcePath = path.join(internalDir, relPath);
    const targetPath = path.join(publicDir, relPath);
    const content = fs.readFileSync(sourcePath, "utf8");
    const alreadyMatches =
      fs.existsSync(targetPath) &&
      fs.readFileSync(targetPath, "utf8") === content;

    if (!alreadyMatches) {
      log.drift++;
      console.log(
        `${CHECK_ONLY ? "[DRIFT]" : "[SYNC] "} ${relPath} ${
          fs.existsSync(targetPath) ? "(updated)" : "(new)"
        }`
      );
      if (!CHECK_ONLY) {
        ensureDirFor(targetPath);
        fs.writeFileSync(targetPath, content, "utf8");
      }
    } else {
      console.log(`[OK]    ${relPath} (already in sync)`);
    }

    if (node.type === "folder") {
      copyPublicTree(node.children, internalDir, publicDir, log);
    }
  }
}

/** Collects every currently-existing page relPath under a public dir. */
function collectAllExistingPublicPaths(dir, relBase = "") {
  const results = new Set();
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "SUMMARY.md") continue;
    if (entry.name === "README.md") continue; // added explicitly for folders below; space-root README is never tracked as a "page"
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

function removeStaleFiles(currentPublicPaths, keepPaths, publicDir, log) {
  for (const relPath of currentPublicPaths) {
    if (!keepPaths.has(relPath)) {
      log.removed.push(relPath);
      console.log(
        `${CHECK_ONLY ? "[WOULD REMOVE]" : "[REMOVE]"} ${relPath} — no longer tagged '${PUBLIC_TAG}'`
      );
      if (!CHECK_ONLY) {
        const targetPath = path.join(publicDir, relPath);
        if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
      }
    }
  }
  if (!CHECK_ONLY) {
    const dirs = [...currentPublicPaths]
      .filter((p) => p.includes("/"))
      .map((p) => path.dirname(path.join(publicDir, p)))
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

// ---------- SUMMARY.md ----------

function buildSummaryLines(nodes, depth = 0) {
  const indent = "  ".repeat(depth);
  const lines = [];
  for (const node of nodes) {
    if (node.type === "page") {
      lines.push(`${indent}* [${titleFromPath(node.relPath)}](${node.relPath})`);
    } else if (node.type === "folder") {
      lines.push(
        `${indent}* [${titleFromPath(node.relPath)}](${node.indexRelPath})`
      );
      lines.push(...buildSummaryLines(node.children, depth + 1));
    }
  }
  return lines;
}

function titleFromPath(relPath) {
  const name = relPath.split("/").pop().replace(/\.md$/, "");
  return name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------- per-customer sync ----------

function syncCustomer(customer) {
  console.log(`\n=== ${customer.label} ===`);
  const { internalDir, publicDir } = customer;

  if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });

  const internalTree = walk(internalDir);
  const { nodes: publicTree, flatIncludedPaths } = filterPublic(internalTree);
  const keepPaths = new Set(flatIncludedPaths);

  const log = { drift: 0, removed: [] };

  copyPublicTree(publicTree, internalDir, publicDir, log);

  const currentPublicPaths = collectAllExistingPublicPaths(publicDir);
  removeStaleFiles(currentPublicPaths, keepPaths, publicDir, log);

  const summaryPath = path.join(publicDir, "SUMMARY.md");
  const summaryLines = [
    "# Table of contents",
    "",
    `* [${customer.label}](README.md)`,
    ...buildSummaryLines(publicTree),
  ];
  const newSummary = summaryLines.join("\n") + "\n";
  const oldSummary = fs.existsSync(summaryPath)
    ? fs.readFileSync(summaryPath, "utf8")
    : "";
  if (newSummary !== oldSummary) {
    log.drift++;
    console.log(CHECK_ONLY ? "[WOULD UPDATE] SUMMARY.md" : "[UPDATE] SUMMARY.md");
    if (!CHECK_ONLY) fs.writeFileSync(summaryPath, newSummary, "utf8");
  } else {
    console.log("[OK]    SUMMARY.md (already in sync)");
  }

  console.log(
    `${customer.label}: ${flatIncludedPaths.length} public pages, ${log.drift} synced, ${log.removed.length} removed`
  );

  return log;
}

// ---------- main ----------

function main() {
  const customers = discoverCustomers();

  if (customers.length === 0) {
    console.log(
      "No customer folder pairs found (looking for *-internal with a matching *-public folder)."
    );
    return;
  }

  console.log(
    `Discovered ${customers.length} customer(s): ${customers
      .map((c) => c.label)
      .join(", ")}`
  );

  let totalDrift = 0;
  let totalRemoved = 0;
  let anyErrors = false;

  for (const customer of customers) {
    try {
      const log = syncCustomer(customer);
      totalDrift += log.drift;
      totalRemoved += log.removed.length;
    } catch (err) {
      anyErrors = true;
      console.error(`[ERROR] ${customer.label} failed to sync: ${err.message}`);
      // continue to next customer rather than aborting the whole run
    }
  }

  console.log("\n--- Overall summary ---");
  console.log(`Customers processed: ${customers.length}`);
  console.log(`Total synced/updated: ${totalDrift}`);
  console.log(`Total removed:        ${totalRemoved}`);

  if (anyErrors) {
    console.error("\nOne or more customers failed to sync - see [ERROR] lines above.");
    process.exit(2);
  }
  if (CHECK_ONLY && (totalDrift > 0 || totalRemoved > 0)) {
    console.log("\nChanges pending. Run without --check to apply.");
    process.exit(1);
  }
  console.log(CHECK_ONLY ? "\nNo changes needed." : "\nSync complete.");
}

main();
