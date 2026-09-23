/**
 * eval/push-scores.ts
 *
 * Reads an eval results file and pushes routing_correct, answer_correct,
 * and retrieval_hit as named scores into Langfuse, attached to each case's
 * traceId. Run with:
 *   npx tsx --env-file=.env.local eval/push-scores.ts eval/results-v2.json
 */

import { readFileSync } from "fs";
import { LangfuseClient } from "@langfuse/client";

const client = new LangfuseClient({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY,
  secretKey: process.env.LANGFUSE_SECRET_KEY,
  baseUrl: process.env.LANGFUSE_HOST || "https://cloud.langfuse.com",
});

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: push-scores.ts <results-file.json>");
    process.exit(1);
  }

  const data = JSON.parse(readFileSync(filePath, "utf-8"));
  const results = data.results;

  let pushed = 0;
  let skipped = 0;

  for (const r of results) {
    if (!r.executed || !r.traceId) {
      skipped++;
      continue;
    }

    let count = 0;

    if (r.routing_correct !== null) {
      client.score.create({
        name: "routing_correct",
        value: r.routing_correct ? 1 : 0,
        traceId: r.traceId,
      });
      count++;
    }
    if (r.answer_correct !== null) {
      client.score.create({
        name: "answer_correct",
        value: r.answer_correct ? 1 : 0,
        traceId: r.traceId,
      });
      count++;
    }
    if (r.retrieval_hit !== null) {
      client.score.create({
        name: "retrieval_hit",
        value: r.retrieval_hit ? 1 : 0,
        traceId: r.traceId,
      });
      count++;
    }

    if (count > 0) {
      console.log(`${r.id}  queued ${count} score(s) -> trace ${r.traceId}`);
      pushed++;
    }
  }

  console.log(`\nFlushing to Langfuse...`);
  await client.flush();

  console.log(`\nDone. Pushed scores for ${pushed} cases, skipped ${skipped} (no trace or not executed).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});