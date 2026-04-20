/**
 * Post-processes dist/index.js after esbuild to fix CodeQL alerts in bundled dependencies.
 *
 * ReDoS in json-with-bigint (js/redos):
 *   `(?:\\.|[^"])*` has exponential backtracking on inputs like `"\!\!\!...`.
 *   Replaced with `(?:[^"\\]|\\.)*` -- semantically identical for valid JSON,
 *   possessively unambiguous (alternatives are mutually exclusive).
 */

import { readFileSync, writeFileSync } from "node:fs";

const distPath = new URL("../dist/index.js", import.meta.url).pathname;
let src = readFileSync(distPath, "utf8");

const reDoSOrig = "var stringsOrLargeNumbers = /\"(?:\\\\.|[^\"])*\"|-?(0|[1-9][0-9]*)(\\.[0-9]+)?([eE][+-]?[0-9]+)?/g;";
const reDoSFixed = "var stringsOrLargeNumbers = /\"(?:[^\"\\\\]|\\\\.)*\"|-?(0|[1-9][0-9]*)(\\.[0-9]+)?([eE][+-]?[0-9]+)?/g;";

if (src.includes(reDoSFixed)) {
  console.log("postprocess-dist: ReDoS regex already fixed, skipping");
} else if (src.includes(reDoSOrig)) {
  src = src.replace(reDoSOrig, reDoSFixed);
  writeFileSync(distPath, src, "utf8");
  console.log("postprocess-dist: fixed ReDoS regex in json-with-bigint ((?:\\\\.|[^\"])*  =>  (?:[^\"\\\\]|\\\\.)*) ");
} else {
  console.error("postprocess-dist: ReDoS regex line not found -- dist may have changed, update this script");
  process.exit(1);
}
