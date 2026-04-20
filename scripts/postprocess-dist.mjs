/**
 * Post-processes dist/index.js after esbuild to fix CodeQL alerts in bundled dependencies.
 *
 * 1. SHA-1 in undici WebSocket handshake (js/weak-cryptographic-algorithm):
 *    SHA-1 is required by RFC 6455 ss 4.1 for Sec-WebSocket-Accept -- not a real vulnerability.
 *    Adds inline codeql suppression comment.
 *
 * 2. ReDoS in json-with-bigint (js/redos):
 *    `(?:\\.|[^"])*` has exponential backtracking on inputs like `"\!\!\!...`.
 *    Replaced with `(?:[^"\\]|\\.)*` -- semantically identical for valid JSON,
 *    possessively unambiguous (alternatives are mutually exclusive).
 */

import { readFileSync, writeFileSync } from "node:fs";

const distPath = new URL("../dist/index.js", import.meta.url).pathname;
let src = readFileSync(distPath, "utf8");
let changed = false;

// Fix 1: suppress CodeQL weak-crypto alert on undici WebSocket SHA-1 line.
// SHA-1 is mandated by RFC 6455 ss 4.1 for the Sec-WebSocket-Accept handshake.
const sha1Orig =
  `const digest = crypto2.createHash("sha1").update(keyValue + uid).digest("base64");`;
const sha1Fixed =
  `const digest = crypto2.createHash("sha1").update(keyValue + uid).digest("base64"); // codeql[js/weak-cryptographic-algorithm] -- SHA-1 required by RFC 6455 ss 4.1`;

if (src.includes(sha1Fixed)) {
  console.log("postprocess-dist: SHA-1 suppression already present, skipping");
} else if (src.includes(sha1Orig)) {
  src = src.replace(sha1Orig, sha1Fixed);
  changed = true;
  console.log("postprocess-dist: added codeql suppression for SHA-1 (undici WebSocket handshake)");
} else {
  console.error("postprocess-dist: SHA-1 line not found -- dist may have changed, update this script");
  process.exit(1);
}

// Fix 2: replace ReDoS-vulnerable regex in json-with-bigint.
// `(?:\\.|[^"])*` suffers exponential backtracking on `"` + many `\!` sequences.
// `(?:[^"\\]|\\.)*` is equivalent for valid JSON: the two alternatives are
// mutually exclusive ([^"\\] never matches \, so \\. can never back-track into it).
const reDoSOrig = "var stringsOrLargeNumbers = /\"(?:\\\\.|[^\"])*\"|-?(0|[1-9][0-9]*)(\\.[0-9]+)?([eE][+-]?[0-9]+)?/g;";
const reDoSFixed = "var stringsOrLargeNumbers = /\"(?:[^\"\\\\]|\\\\.)*\"|-?(0|[1-9][0-9]*)(\\.[0-9]+)?([eE][+-]?[0-9]+)?/g;";

if (src.includes(reDoSFixed)) {
  console.log("postprocess-dist: ReDoS regex already fixed, skipping");
} else if (src.includes(reDoSOrig)) {
  src = src.replace(reDoSOrig, reDoSFixed);
  changed = true;
  console.log("postprocess-dist: fixed ReDoS regex in json-with-bigint ((?:\\\\.|[^\"])*  =>  (?:[^\"\\\\]|\\\\.)*) ");
} else {
  console.error("postprocess-dist: ReDoS regex line not found -- dist may have changed, update this script");
  process.exit(1);
}

if (changed) {
  writeFileSync(distPath, src, "utf8");
  console.log("postprocess-dist: dist/index.js updated");
} else {
  console.log("postprocess-dist: no changes needed");
}
