/**
 * eval/compare.ts
 *
 * Compares two eval result files case by case, prints the score deltas,
 * and lists which case IDs flipped pass -> fail or fail -> pass on each
 * of the three scores between the two runs.
 *
 * Run with:
 *   npx tsx eval/compare.ts eval/results-v2.json eval/results-v3.json
 */

import { readFileSync } from "fs";

type CaseResult = {
  id: string;
  executed: boolean;
  routing_correct: boolean | null;
  answer_correct: boolean | null;
  retrieval_hit: boolean | null;
};

function loadResults(path: string): Map<string, CaseResult> {
  const data = JSON.parse(readFileSync(path, "utf-8"));
  const map = new Map<string, CaseResult>();
  for (const r of data.results) {
    map.set(r.id, r);
  }
  return map;
}

function countPassed(
  results: Map<string, CaseResult>,
  field: "routing_correct" | "answer_correct" | "retrieval_hit"
): { passed: number; total: number } {
  let passed = 0;
  let total = 0;
  for (const r of results.values()) {
    if (r[field] !== null) {
      total++;
      if (r[field]) passed++;
    }
  }
  return { passed, total };
}

function reportFlips(
  before: Map<string, CaseResult>,
  after: Map<string, CaseResult>,
  field: "routing_correct" | "answer_correct" | "retrieval_hit"
) {
  const improved: string[] = [];
  const regressed: string[] = [];

  for (const id of before.keys()) {
    const b = before.get(id);
    const a = after.get(id);
    if (!b || !a) continue;
    if (b[field] === null || a[field] === null) continue;

    if (!b[field] && a[field]) improved.push(id);
    if (b[field] && !a[field]) regressed.push(id);
  }

  if (improved.length > 0) {
    console.log(`  Fixed (fail -> pass): ${improved.join(", ")}`);
  }
  if (regressed.length > 0) {
    console.log(`  Broke (pass -> fail): ${regressed.join(", ")}`);
  }
  if (improved.length === 0 && regressed.length === 0) {
    console.log(`  No change.`);
  }
}

function main() {
  const beforePath = process.argv[2];
  const afterPath = process.argv[3];

  if (!beforePath || !afterPath) {
    console.error("Usage: compare.ts <before.json> <after.json>");
    process.exit(1);
  }

  const before = loadResults(beforePath);
  const after = loadResults(afterPath);

  console.log(`Comparing ${beforePath} (before) -> ${afterPath} (after)\n`);

  const fields: ("routing_correct" | "answer_correct" | "retrieval_hit")[] = [
    "routing_correct",
    "answer_correct",
    "retrieval_hit",
  ];

  for (const field of fields) {
    const b = countPassed(before, field);
    const a = countPassed(after, field);
    console.log(`${field}: ${b.passed}/${b.total} -> ${a.passed}/${a.total}`);
    reportFlips(before, after, field);
    console.log();
  }
}

main();