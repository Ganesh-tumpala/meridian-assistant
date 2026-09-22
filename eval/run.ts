/**
 * eval/run.ts
 *
 * The evaluation harness. Calls the live /api/chat endpoint for every case
 * in golden.json, so the whole agent pipeline runs and a real Langfuse
 * trace is produced for each one.
 *
 * Run with: npm run eval
 * Writes results to the file named on the command line, e.g.:
 *   npx tsx eval/run.ts eval/results-v1.json
 */

import { writeFileSync, readFileSync } from "fs";

const API_URL = process.env.EVAL_API_URL || "http://localhost:3000/api/chat";
const PAUSE_MS = 12000;

type GoldenCase = {
  id: string;
  question: string;
  expect: "answer" | "refuse";
  expected_subgraph: string | null;
  must_contain: string[];
  expected_source: string | null;
  notes: string;
};

type CaseResult = {
  id: string;
  question: string;
  expect: "answer" | "refuse";
  executed: boolean;
  executionError?: string;
  reply?: string;
  subgraph?: string;
  guardrailVerdict?: string;
  toolsUsed?: string[];
  citations?: string[];
  traceId?: string;
  routing_correct: boolean | null;
  answer_correct: boolean | null;
  retrieval_hit: boolean | null;
  scoreNotes: string[];
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Normalises text before comparison.
 *
 * The handbook writes "6 pounds per day"; the model often writes "£6 per
 * day". Without this, a correct answer gets marked wrong and you waste an
 * hour blaming the prompt instead of the comparison.
 */
function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u00a3\s?(\d+)/g, "$1 pounds")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Calls the chat endpoint for one question, with one retry on a 429.
 * A session id per case keeps each case's trace independent.
 */
async function askAssistant(question: string, caseId: string): Promise<any> {
  const sessionId = `eval_${caseId}_${Date.now()}`;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: question }],
          sessionId,
        }),
      });

      if (res.status === 429) {
        if (attempt === 2) throw new Error("429 rate limited after 3 attempts");
        await sleep(5000 * (attempt + 1));
        continue;
      }

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }

      return data;
    } catch (err) {
      if (attempt === 2) throw err;
      await sleep(2000);
    }
  }

  throw new Error("unreachable");
}

/** Scores one executed case against its golden expectations. */
function scoreCase(golden: GoldenCase, response: any): {
  routing_correct: boolean | null;
  answer_correct: boolean | null;
  retrieval_hit: boolean | null;
  scoreNotes: string[];
} {
  const scoreNotes: string[] = [];
  const run = response.run;
  const reply = response.reply as string;

  // routing_correct: subgraph equals expected_subgraph.
  // null when the golden case has no expected subgraph (e.g. empty input).
  let routing_correct: boolean | null = null;
  if (golden.expected_subgraph !== null) {
    routing_correct = run?.subgraph === golden.expected_subgraph;
    if (!routing_correct) {
      scoreNotes.push(
        `routing: expected "${golden.expected_subgraph}", got "${run?.subgraph}"`
      );
    }
  }

  // answer_correct: every must_contain string present after normalising.
  let answer_correct: boolean | null = null;
  if (golden.must_contain.length > 0) {
    const normalisedReply = normalise(reply || "");
    const missing = golden.must_contain.filter(
      (fact) => !normalisedReply.includes(normalise(fact))
    );
    answer_correct = missing.length === 0;
    if (!answer_correct) {
      scoreNotes.push(`answer: missing "${missing.join('", "')}"`);
    }
  }

  // retrieval_hit: expected_source among the citations returned.
  let retrieval_hit: boolean | null = null;
  if (golden.expected_source !== null) {
    const citations: string[] = run?.citations || [];
    retrieval_hit = citations.includes(golden.expected_source);
    if (!retrieval_hit) {
      scoreNotes.push(
        `retrieval: expected source "${golden.expected_source}", got [${citations.join(", ")}]`
      );
    }
  }

  return { routing_correct, answer_correct, retrieval_hit, scoreNotes };
}

async function main() {
  const outputPath = process.argv[2] || "eval/results.json";

  const golden: GoldenCase[] = JSON.parse(
    readFileSync("eval/golden.json", "utf-8")
  );

  console.log(`Loaded ${golden.length} cases. Writing to ${outputPath}.`);
  console.log(`Calling ${API_URL}\n`);

  const results: CaseResult[] = [];
  let executionFailures = 0;
  let scoringFailures = 0;

  for (const goldenCase of golden) {
    process.stdout.write(`${goldenCase.id}  `);

    try {
      const response = await askAssistant(goldenCase.question, goldenCase.id);
      const scores = scoreCase(goldenCase, response);

      const result: CaseResult = {
        id: goldenCase.id,
        question: goldenCase.question,
        expect: goldenCase.expect,
        executed: true,
        reply: response.reply,
        subgraph: response.run?.subgraph,
        guardrailVerdict: response.run?.guardrail?.verdict,
        toolsUsed: (response.run?.tools || []).map((t: any) => t.tool),
        citations: response.run?.citations || [],
        traceId: response.run?.traceId,
        ...scores,
      };

      results.push(result);

      const anyScoreFailed =
        scores.routing_correct === false ||
        scores.answer_correct === false ||
        scores.retrieval_hit === false;
      if (anyScoreFailed) scoringFailures++;

      console.log(anyScoreFailed ? "SCORE FAIL" : "ok");
      if (scores.scoreNotes.length > 0) {
        scores.scoreNotes.forEach((n) => console.log(`    ${n}`));
      }
    } catch (err) {
      executionFailures++;
      const message = err instanceof Error ? err.message : String(err);
      console.log(`EXECUTION FAILED: ${message}`);

      results.push({
        id: goldenCase.id,
        question: goldenCase.question,
        expect: goldenCase.expect,
        executed: false,
        executionError: message,
        routing_correct: null,
        answer_correct: null,
        retrieval_hit: null,
        scoreNotes: [],
      });
    }

    await sleep(PAUSE_MS);
  }

  const executed = results.filter((r) => r.executed);
  const totalRouting = executed.filter((r) => r.routing_correct !== null);
  const totalAnswer = executed.filter((r) => r.answer_correct !== null);
  const totalRetrieval = executed.filter((r) => r.retrieval_hit !== null);

  const summary = {
    totalCases: golden.length,
    executed: executed.length,
    executionFailures,
    scoringFailures,
    routing_correct: {
      passed: totalRouting.filter((r) => r.routing_correct).length,
      total: totalRouting.length,
    },
    answer_correct: {
      passed: totalAnswer.filter((r) => r.answer_correct).length,
      total: totalAnswer.length,
    },
    retrieval_hit: {
      passed: totalRetrieval.filter((r) => r.retrieval_hit).length,
      total: totalRetrieval.length,
    },
  };

  console.log("\n--- SUMMARY ---");
  console.log(`Total cases: ${summary.totalCases}`);
  console.log(`Executed: ${summary.executed}, execution failures: ${summary.executionFailures}`);
  console.log(
    `routing_correct: ${summary.routing_correct.passed} / ${summary.routing_correct.total}`
  );
  console.log(
    `answer_correct: ${summary.answer_correct.passed} / ${summary.answer_correct.total}`
  );
  console.log(
    `retrieval_hit: ${summary.retrieval_hit.passed} / ${summary.retrieval_hit.total}`
  );

  writeFileSync(
    outputPath,
    JSON.stringify({ summary, results }, null, 2)
  );
  console.log(`\nWritten to ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});