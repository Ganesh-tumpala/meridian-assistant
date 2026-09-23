/**
 * The composer. Stage four.
 *
 * Turns the tool results into the sentence the customer reads.
 *
 * The composer is given the tool results and nothing else. It is told not to
 * add anything of its own, which is what keeps the answer tied to the facts
 * that were actually retrieved.
 */

import { askGroq } from "@/lib/groq";
import { formatResults } from "@/lib/agent/executor";
import { getSubgraph } from "@/lib/agent/subgraphs";
import type { ExecutedStep, SubgraphName } from "@/lib/agent/types";
import type { Tracer } from "@/lib/trace";

const HOUSE_STYLE = `You are the Meridian Bank customer service assistant.

How to write:
- British English. Two to five sentences. No greeting and no sign-off.
- Write amounts exactly as the source writes them: "6 pounds per day", not "£6/day".
- Never use a heading, a bullet list or bold text. Plain sentences only.
- Include every fee, number, or time in the tool results that relates to the question, even if the question only asked about one part of it.

Phone numbers. Only two exist, and you must never write any other:
- 0800 555 0199 for a lost or stolen card, open 24 hours.
- 0800 555 0177 to report fraud, open 24 hours.
The general phone line has no published number. Call it "the general phone line"
and give its hours, Monday to Saturday 08:00 to 20:00. Never invent a number
for it, and never give a number belonging to another organisation.

What you may say:
- Only what the tool results below contain. They are your only source.
- If the tool results do not answer the question, say that you do not have that
  information and give the general phone line, open Monday to Saturday 08:00 to 20:00.
- Never state, guess or illustrate a customer's own balance, transactions or
  account status. You cannot see customer accounts.
- Never agree to change a fee, a limit or a policy for an individual.
- Never mention tools, steps, plans or knowledge bases. The customer does not
  know those exist.`;

export async function compose(
  question: string,
  subgraph: SubgraphName,
  steps: ExecutedStep[],
  tracer: Tracer
): Promise<string> {
  const branch = getSubgraph(subgraph);

  return tracer.span(
    "composer",
    {
      type: "GENERATION",
      input: { question, subgraph, stepCount: steps.length },
      metadata: { stage: "compose" },
    },
    async (end) => {
      const prompt = `${HOUSE_STYLE}

For this answer specifically: ${branch.composerGuidance}

Tool results:

${formatResults(steps)}`;

      try {
        const answer = await askGroq(
          [
            { role: "system", content: prompt },
            { role: "user", content: question },
          ],
          { temperature: 0, maxTokens: 1500 }
        );

        end({ output: answer, metadata: { length: answer.length } });
        return answer;
      } catch (error) {
        // Even a composer failure owes the customer a usable sentence.
        const message = error instanceof Error ? error.message : "unknown error";
        const safe =
          "I am not able to answer that at the moment. Please call the general phone line, open Monday to Saturday 08:00 to 20:00, and a colleague will help.";
        end({ output: safe, level: "ERROR", statusMessage: message });
        return safe;
      }
    }
  );
}
