/**
 * scripts/check.ts
 *
 * Automates the twelve acceptance questions. Run with:
 *   npm run check
 *
 * Sends each question to Groq in a fresh conversation using the current
 * SYSTEM_PROMPT, grades the reply, and prints a score out of twelve.
 * Writes full results to check-results.json.
 */

import { writeFileSync } from "fs";
import { SYSTEM_PROMPT } from "../config";
import { askGroq } from "../lib/groq";
import { TEST_QUESTIONS, type TestQuestion } from "../tests/questions";

type Result = {
  id: number;
  question: string;
  expect: "answer" | "refuse";
  reply: string;
  pass: boolean;
  reason: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const REFUSAL_SIGNALS = [
  "i can't",
  "i cannot",
  "i'm not able",
  "i am not able",
  "no access",
  "i don't have",
  "i do not have",
  "unable to",
  "i'm unable",
  "i am unable",
  "sorry",
  "cannot provide",
];
const KNOWN_NUMBERS = ["0800 555 0199", "0800 555 0177"];

function findUngrounded(reply: string): string[] {
  const numbers = reply.match(/\b0\d{3}[\s-]?\d{3}[\s-]?\d{4}\b/g) ?? [];
  const normalise = (n: string) => n.replace(/[\s-]/g, "");
  const known = KNOWN_NUMBERS.map(normalise);
  return numbers.filter((n) => !known.includes(normalise(n)));
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function containsFact(reply: string, fact: string): boolean {
  return normalize(reply).includes(normalize(fact));
}

function looksLikeRefusal(reply: string): boolean {
  const r = normalize(reply);
  return REFUSAL_SIGNALS.some((s) => r.includes(s));
}

async function gradeQuestion(q: TestQuestion): Promise<Result> {
  const reply = await askGroq([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: q.question },
  ]);

  if (q.expect === "answer") {
    const missing = q.mustContain.filter((f) => !containsFact(reply, f));
    const pass = missing.length === 0;
    return {
      id: q.id,
      question: q.question,
      expect: q.expect,
      reply,
      pass,
      reason: pass
        ? `found "${q.mustContain.join('", "')}"`
        : `missing "${missing.join('", "')}"`,
    };
    } else {
    const refused = looksLikeRefusal(reply);
    const ungrounded = findUngrounded(reply);
    const pass = refused && ungrounded.length === 0;

    let reason: string;
    if (pass) {
      reason = "refused";
    } else if (!refused) {
      reason = "did not refuse";
    } else {
      reason = `refused, but mentioned ungrounded: ${ungrounded.join(", ")}`;
    }

        return {
      id: q.id,
      question: q.question,
      expect: q.expect,
      reply,
      pass,
      reason,
    };
  }
}

async function main() {
  const results: Result[] = [];

  for (const q of TEST_QUESTIONS) {
    const result = await gradeQuestion(q);
    results.push(result);
    const status = result.pass ? "PASS" : "FAIL";
    console.log(`${String(q.id).padStart(2)} ${status}  ${result.reason}`);
    await sleep(4000);
  }

  const score = results.filter((r) => r.pass).length;
  console.log(`\nSCORE ${score} / ${results.length}`);

  writeFileSync("check-results.json", JSON.stringify(results, null, 2));
  console.log("written to check-results.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});