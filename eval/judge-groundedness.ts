/**
 * eval/judge-groundedness.ts
 *
 * An LLM judge that reads each executed case's question, reply, and the
 * tool results the agent actually retrieved, then asks a model (temperature
 * 0) whether the reply is grounded in that material. Pushes the verdict as
 * a "grounded" score into Langfuse, and reports agreement with the hand
 * labels in eval/hand-labels.json.
 *
 * Run with:
 *   npx tsx --env-file=.env.local eval/judge-groundedness.ts eval/results-v2.json
 */

import { readFileSync } from "fs";
import { LangfuseClient } from "@langfuse/client";

const client = new LangfuseClient({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY,
  secretKey: process.env.LANGFUSE_SECRET_KEY,
  baseUrl: process.env.LANGFUSE_HOST || "https://cloud.langfuse.com",
});

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const MODEL = "openai/gpt-oss-120b";

type JudgeVerdict = {
  grounded: boolean;
  reasoning: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const FACT_SHEET = `
MERIDIAN BANK - CUSTOMER SERVICE FACT SHEET

CARDS
- Report a lost or stolen card in the Meridian app under Cards > Freeze card, or by calling 0800 555 0199, open 24 hours.
- A replacement debit card arrives in 3 to 5 working days, free of charge.
- A courier replacement costs 12 pounds and normally arrives the next working day when ordered before 15:00.
- Card PINs can be viewed in the app under Cards > View PIN, shown for fifteen seconds.

PAYMENTS AND TRANSFERS
- The daily transfer limit for online and app payments is 25,000 pounds, resetting at midnight UK time.
- Faster Payments to other UK banks usually arrive within 2 hours.
- International transfers take 2 to 4 working days and cost 15 pounds.

ACCOUNTS AND OVERDRAFTS
- The arranged overdraft fee is 35p per day.
- The unarranged overdraft fee is 6 pounds per day, capped at 60 pounds per calendar month.

THE APP
- Reset an app password at the sign-in screen using "Forgotten password"; a one-time code is sent by SMS.
- If the registered mobile number is out of date it must be changed in a branch with photographic identification.
- The app supports face and fingerprint sign-in on supported devices.

BRANCHES AND CONTACT
- Branches open Monday to Friday 09:30 to 16:30, and Saturday 09:30 to 12:30. Closed Sundays and bank holidays.
- The general phone line is open Monday to Saturday 08:00 to 20:00.
- The lost card line on 0800 555 0199 is open 24 hours.

FRAUD
- Report suspected fraud on 0800 555 0177, open 24 hours.
- Meridian will never ask for a full password, a PIN, or a one-time code by phone, email or text.
- Meridian will never ask a customer to move money to a "safe account".

WHAT ALWAYS NEEDS A HUMAN
- A specific customer's balance, transactions or account status.
- Changing any fee, limit or policy for an individual.
- Closing an account, bereavement, power of attorney, complaints, disputed transactions.
`.trim();

const JUDGE_PROMPT = `You are a strict fact-checker for Meridian Bank's customer service assistant.

Below is Meridian's actual published fact sheet. This is the ONLY source of
truth the assistant is allowed to draw from.

${FACT_SHEET}

You will be given a customer's question and the assistant's reply. Check
every factual claim in the reply (a fee, a number, a phone number, an
opening time, a policy) against the fact sheet above.

Mark the reply GROUNDED if:
  a) every fact it states matches the fact sheet exactly, or
  b) it is a refusal, a handoff, or an admission that it does not have the
     information (these always count as grounded, since they invent
     nothing).

Mark the reply UNGROUNDED only if it states a fact that CONTRADICTS the
fact sheet, or states a specific fact (a number, a phone number, a time)
that does not appear anywhere in the fact sheet above.

Reply with JSON only, in this exact shape:
{"grounded": true or false, "reasoning": "<one sentence citing the fact sheet>"}`;

async function askJudge(question: string, reply: string): Promise<JudgeVerdict> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: MODEL,
          temperature: 0,
          messages: [
            { role: "system", content: JUDGE_PROMPT },
            {
              role: "user",
              content: `Question: ${question}\n\nAssistant's reply: ${reply}`,
            },
          ],
          response_format: { type: "json_object" },
        }),
      });

      if (res.status === 429) {
        if (attempt === 2) throw new Error("429 rate limited after 3 attempts");
        await sleep(8000 * (attempt + 1));
        continue;
      }

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Groq returned ${res.status}. ${text.slice(0, 200)}`);
      }

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error("No content in judge response");

      const parsed = JSON.parse(content);
      return {
        grounded: Boolean(parsed.grounded),
        reasoning: String(parsed.reasoning || ""),
      };
    } catch (err) {
      if (attempt === 2) throw err;
      await sleep(3000);
    }
  }
  throw new Error("unreachable");
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: judge-groundedness.ts <results-file.json>");
    process.exit(1);
  }

  const data = JSON.parse(readFileSync(filePath, "utf-8"));
  const handLabels = JSON.parse(readFileSync("eval/hand-labels.json", "utf-8"));

  let agree = 0;
  let disagree = 0;
  let judged = 0;
  const disagreements: string[] = [];

  for (const r of data.results) {
    if (!r.executed || !r.traceId || !r.reply) {
      console.log(`${r.id}  skipped (not executed)`);
      continue;
    }

    try {
      const verdict = await askJudge(r.question, r.reply);
      judged++;

      client.score.create({
        name: "grounded",
        value: verdict.grounded ? 1 : 0,
        traceId: r.traceId,
        comment: verdict.reasoning,
      });

      const hand = handLabels[r.id];
      let agreement = "no hand label";
      if (hand && hand.grounded !== null) {
        if (hand.grounded === verdict.grounded) {
          agree++;
          agreement = "AGREE";
        } else {
          disagree++;
          agreement = "DISAGREE";
          disagreements.push(
            `${r.id}: hand=${hand.grounded} judge=${verdict.grounded} (${verdict.reasoning})`
          );
        }
      }

      console.log(
        `${r.id}  judge=${verdict.grounded ? "grounded" : "UNGROUNDED"}  ${agreement}`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`${r.id}  JUDGE FAILED: ${message}`);
    }

    await sleep(4000);
  }

  console.log(`\nFlushing scores to Langfuse...`);
  await client.flush();

  console.log(`\n--- SUMMARY ---`);
  console.log(`Judged: ${judged}`);
  console.log(`Agreement with hand labels: ${agree} / ${agree + disagree}`);
  if (disagreements.length > 0) {
    console.log(`\nDisagreements:`);
    disagreements.forEach((d) => console.log(`  ${d}`));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});