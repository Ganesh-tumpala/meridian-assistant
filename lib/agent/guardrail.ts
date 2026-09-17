/**
 * The answer guardrail. Stage five, and the last word.
 *
 * Everything upstream is a model doing its best. This stage assumes the model
 * got it wrong and looks for the specific ways a bank assistant causes real
 * harm.
 *
 * The checks are deliberately code, not a model. A guardrail that asks a model
 * whether the model behaved is only as reliable as the thing it is checking,
 * and it fails in exactly the situations where you need it most.
 *
 * Three outcomes:
 *   pass      - the answer goes out unchanged
 *   rewritten - something small was fixed, such as a currency symbol
 *   blocked   - the answer was dangerous and is replaced with a safe one
 */

import type {
  ExecutedStep,
  GuardrailCheck,
  GuardrailReport,
  SubgraphName,
} from "@/lib/agent/types";
import type { Tracer } from "@/lib/trace";

/** The phone numbers the assistant is allowed to give out. */
const KNOWN_NUMBERS = ["0800 555 0199", "0800 555 0177"];

/** Every figure that appears in the source material. */
const KNOWN_FIGURES = [
  "25,000", "35p", "6 pounds", "60 pounds", "12 pounds", "15 pounds",
  "09:30", "16:30", "12:30", "08:00", "20:00", "15:00",
  "3 to 5", "2 to 4", "2 hours", "24 hours", "fifteen",
];

const SAFE_REFUSAL =
  "I am not able to help with that. I can only answer questions about Meridian Bank's published services, and I have no access to customer accounts. For anything about your own account, please call the general phone line, open Monday to Saturday 08:00 to 20:00.";

const SAFE_BALANCE_REFUSAL =
  "I have no access to customer accounts, so I cannot see your balance or your transactions. You can check your balance in the Meridian app, or call the general phone line, open Monday to Saturday 08:00 to 20:00.";

const SAFE_SCOPE_REFUSAL =
  "I am not able to help with that. I can only answer questions about Meridian Bank's own published services, such as our fees, opening hours and app.";

/* -------------------------------------------------------------------------
 *  The individual checks
 * ----------------------------------------------------------------------- */

/**
 * The most dangerous failure this app can produce: a made-up account balance.
 *
 * Looks for a money amount sitting next to balance language. A model that
 * refuses correctly never trips this, because it names no figure at all.
 */
function checkInventedBalance(answer: string): GuardrailCheck {
  const balanceContext =
    /\b(your|current|account|available|remaining)\s+(balance|funds|account)\b/i;
  const moneyAmount = /(?:£\s?\d[\d,]*(?:\.\d{2})?)|(?:\b\d[\d,]*(?:\.\d{2})?\s*pounds\b)/i;

  if (!balanceContext.test(answer)) {
    return { name: "no invented balance", passed: true, detail: "The answer does not discuss a balance." };
  }

  const sentences = answer.split(/(?<=[.?!])\s+/);
  const offending = sentences.find(
    (s) => balanceContext.test(s) && moneyAmount.test(s)
  );

  if (offending) {
    return {
      name: "no invented balance",
      passed: false,
      detail: `States an amount as a balance: "${offending.trim()}"`,
    };
  }

  return {
    name: "no invented balance",
    passed: true,
    detail: "Mentions a balance but states no figure for it.",
  };
}

/** Catches an assistant agreeing to something it has no authority to do. */
function checkNoUnauthorisedPromise(answer: string): GuardrailCheck {
  const promises =
    /\b(i(?: have| 've| will| can|'ll)?\s+(?:just\s+)?(?:waived?|refunded?|removed?|cancelled?|credited?|increased?|raised?)\b)|\b(i can waive|i'll waive|i have arranged|i have raised your limit|consider it done|done for you)\b/i;

  if (promises.test(answer)) {
    const match = answer.match(promises)?.[0] ?? "";
    return {
      name: "no unauthorised promise",
      passed: false,
      detail: `Claims to have taken an action it cannot take: "${match.trim()}"`,
    };
  }
  return { name: "no unauthorised promise", passed: true, detail: "Promises nothing it cannot do." };
}

/** Catches a phone number that is not one of Meridian's. */
function checkPhoneNumbers(answer: string): GuardrailCheck {
  const numbers = answer.match(/\b0\d{3}[\s-]?\d{3}[\s-]?\d{4}\b/g) ?? [];
  const normalise = (n: string) => n.replace(/[\s-]/g, "");
  const known = KNOWN_NUMBERS.map(normalise);

  const unknown = numbers.filter((n) => !known.includes(normalise(n)));

  if (unknown.length > 0) {
    return {
      name: "phone numbers are real",
      passed: false,
      detail: `Gives a number that is not Meridian's: ${unknown.join(", ")}`,
    };
  }
  return {
    name: "phone numbers are real",
    passed: true,
    detail: numbers.length > 0 ? `Checked ${numbers.length} number(s).` : "No phone number given.",
  };
}

/**
 * Catches a figure that appears nowhere in the retrieved material.
 *
 * This is a warning rather than a block, because ordinary sentences contain
 * ordinary numbers and blocking on that would break far more than it fixes.
 */
function checkFiguresAreSourced(answer: string, steps: ExecutedStep[]): GuardrailCheck {
  const sourceText = [
    ...steps.map((s) => s.result.summary),
    ...steps.map((s) => (s.result.data ? JSON.stringify(s.result.data) : "")),
  ]
    .join(" ")
    .toLowerCase();

  const figures = answer.match(/\b\d[\d,]*(?:\.\d+)?\b/g) ?? [];
  const unsourced = figures.filter((figure) => {
    const f = figure.toLowerCase();
    if (sourceText.includes(f)) return false;
    if (KNOWN_FIGURES.some((known) => known.toLowerCase().includes(f))) return false;
    // Single digits are almost always prose ("3 to 5 working days").
    if (f.replace(/[^\d]/g, "").length <= 1) return false;
    return true;
  });

  if (unsourced.length > 0) {
    return {
      name: "figures are sourced",
      passed: false,
      detail: `Figure(s) not found in the tool results: ${[...new Set(unsourced)].join(", ")}`,
    };
  }
  return { name: "figures are sourced", passed: true, detail: `Checked ${figures.length} figure(s).` };
}

/** The refusal branch must not answer any part of the question. */
function checkRefusalIsARefusal(answer: string, subgraph: SubgraphName): GuardrailCheck {
  if (subgraph !== "refusal") {
    return { name: "refusal is a refusal", passed: true, detail: "Not a refusal branch." };
  }

  const declines =
    /\b(cannot|can't|not able|unable|i do not|i don't|outside|only (?:answer|help)|afraid)\b/i;

  if (!declines.test(answer)) {
    return {
      name: "refusal is a refusal",
      passed: false,
      detail: "Routed as out of scope but the answer does not actually decline.",
    };
  }
  return { name: "refusal is a refusal", passed: true, detail: "Declines clearly." };
}

/** Keeps the internal machinery out of the customer's view. */
function checkNoInternalLanguage(answer: string): GuardrailCheck {
  const leaks =
    /\b(tool|knowledge base|subgraph|planner|composer|guardrail|step \d|my instructions|system prompt|retrieved passage)\b/i;

  if (leaks.test(answer)) {
    const match = answer.match(leaks)?.[0] ?? "";
    return {
      name: "no internal language",
      passed: false,
      detail: `Mentions internal machinery: "${match}"`,
    };
  }
  return { name: "no internal language", passed: true, detail: "No internal terms." };
}

/** The answer has to actually be there. */
function checkNotEmpty(answer: string): GuardrailCheck {
  const trimmed = answer.trim();
  if (trimmed.length < 15) {
    return { name: "answer is substantial", passed: false, detail: `Only ${trimmed.length} characters.` };
  }
  return { name: "answer is substantial", passed: true, detail: `${trimmed.length} characters.` };
}

/* -------------------------------------------------------------------------
 *  Small automatic repairs
 * ----------------------------------------------------------------------- */

/**
 * Fixes presentation problems that do not need the answer thrown away.
 *
 * The currency rewrite matters more than it looks: the source material and the
 * acceptance tests both write "6 pounds per day", and models reliably prefer
 * "£6 per day".
 */
export function repair(answer: string): { text: string; changes: string[] } {
  let text = answer;
  const changes: string[] = [];

  // Models write typographic punctuation: a curly apostrophe in "can't", a
  // non-breaking hyphen in "one-time". Both look identical on screen and both
  // defeat a plain-text check, so every check below would silently miss them.
  // Normalising first is what makes the rest of this file trustworthy.
  const normalised = text
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‑‒–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ");
  if (normalised !== text) {
    text = normalised;
    changes.push("replaced typographic punctuation with plain characters");
  }

  const withPounds = text.replace(
    /£\s?(\d[\d,]*(?:\.\d{2})?)/g,
    (_match, amount: string) => `${amount} pounds`
  );
  if (withPounds !== text) {
    text = withPounds;
    changes.push("rewrote currency symbols as the word pounds");
  }

  const withoutBold = text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/(?<!\*)\*(?!\s)(.+?)(?<!\s)\*/g, "$1");
  if (withoutBold !== text) {
    text = withoutBold;
    changes.push("removed bold and italic markers");
  }

  const withoutBullets = text.replace(/^\s*[-*•]\s+/gm, "").replace(/^\s*#{1,6}\s+/gm, "");
  if (withoutBullets !== text) {
    text = withoutBullets;
    changes.push("removed list and heading markers");
  }

  const tidied = text.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (tidied !== text) {
    text = tidied;
    changes.push("tidied whitespace");
  }

  return { text, changes };
}

/* -------------------------------------------------------------------------
 *  Running the guardrail
 * ----------------------------------------------------------------------- */

/** Failing one of these means the answer is replaced, not merely flagged. */
const BLOCKING = new Set([
  "no invented balance",
  "no unauthorised promise",
  "phone numbers are real",
  "answer is substantial",
]);

export function inspect(
  answer: string,
  subgraph: SubgraphName,
  steps: ExecutedStep[],
  question: string
): GuardrailReport {
  const { text: repaired, changes } = repair(answer);

  const checks: GuardrailCheck[] = [
    checkNotEmpty(repaired),
    checkInventedBalance(repaired),
    checkNoUnauthorisedPromise(repaired),
    checkPhoneNumbers(repaired),
    checkFiguresAreSourced(repaired, steps),
    checkRefusalIsARefusal(repaired, subgraph),
    checkNoInternalLanguage(repaired),
  ];

  const blocked = checks.filter((c) => !c.passed && BLOCKING.has(c.name));

  if (blocked.length > 0) {
    // The replacement has to fit the question it is replacing. Telling someone
    // asking about another bank that you cannot see their account is a
    // non sequitur, and reads as though the assistant misunderstood.
    const aboutBalance = /balance|transactions|how much.*i have/i.test(question);
    const replacement =
      subgraph === "refusal"
        ? SAFE_SCOPE_REFUSAL
        : aboutBalance
          ? SAFE_BALANCE_REFUSAL
          : SAFE_REFUSAL;

    return { verdict: "blocked", checks, draftAnswer: answer, finalAnswer: replacement };
  }

  if (changes.length > 0) {
    return {
      verdict: "rewritten",
      checks: [
        ...checks,
        { name: "automatic repairs", passed: true, detail: changes.join("; ") },
      ],
      draftAnswer: answer,
      finalAnswer: repaired,
    };
  }

  return { verdict: "pass", checks, draftAnswer: answer, finalAnswer: repaired };
}

export async function guard(
  answer: string,
  subgraph: SubgraphName,
  steps: ExecutedStep[],
  question: string,
  tracer: Tracer
): Promise<GuardrailReport> {
  return tracer.span(
    "guardrail",
    { type: "SPAN", input: { draft: answer, subgraph }, metadata: { stage: "guard" } },
    async (end) => {
      const report = inspect(answer, subgraph, steps, question);
      end({
        output: report,
        metadata: {
          verdict: report.verdict,
          failed: report.checks.filter((c) => !c.passed).map((c) => c.name),
        },
        ...(report.verdict === "blocked" ? { level: "WARNING" as const } : {}),
      });
      return report;
    }
  );
}
