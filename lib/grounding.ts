/**
 * The grounding checker.
 *
 * Catches the quiet failure mode models rarely get flagged for: a reply
 * that reads confidently but attaches a phone number, a fee, or an
 * opening time that never appeared in the fact sheet. This is a warning,
 * not a filter — it never blocks a reply, only flags it.
 */

export type Ungrounded = {
  kind: "phone" | "money" | "time";
  value: string;
};

const PHONE_RE = /\b0\d{3}[\s-]?\d{3}[\s-]?\d{4}\b/g;
const MONEY_RE = /£\s?\d[\d,]*(?:\.\d{1,2})?|\b\d[\d,]*(?:\.\d{1,2})?\s*pounds\b|\b\d+p\b/gi;
const TIME_RE = /\b([01]?\d|2[0-3]):[0-5]\d\b/g;

function normalisePhone(value: string): string {
  return value.replace(/[\s-]/g, "");
}

function normaliseMoney(value: string): string {
  const pence = /^(\d+)p$/i.exec(value.trim());
  if (pence) return `${pence[1]}p`;

  const cleaned = value
    .replace(/£/g, "")
    .replace(/pounds?/gi, "")
    .replace(/,/g, "")
    .trim();

  const asNumber = parseFloat(cleaned);
  return Number.isNaN(asNumber) ? value.trim().toLowerCase() : String(asNumber);
}

function normaliseTime(value: string): string {
  const [hours, minutes] = value.split(":");
  return `${parseInt(hours, 10)}:${minutes}`;
}

function extractAll(text: string, pattern: RegExp): string[] {
  return text.match(pattern) ?? [];
}

/**
 * Returns every phone number, money amount and time that appears in the
 * reply but does NOT appear in the fact sheet.
 * An empty array means the reply is fully grounded.
 */
export function findUngrounded(reply: string, facts: string): Ungrounded[] {
  if (!reply || !reply.trim()) return [];

  const findings: Ungrounded[] = [];

  const checkKind = (
    kind: Ungrounded["kind"],
    pattern: RegExp,
    normalise: (value: string) => string
  ) => {
    const replyMatches = extractAll(reply, pattern);
    if (replyMatches.length === 0) return;

    const groundedValues = new Set(extractAll(facts, pattern).map(normalise));
    const alreadyFlagged = new Set<string>();

    for (const match of replyMatches) {
      const normalised = normalise(match);
      if (groundedValues.has(normalised)) continue;
      if (alreadyFlagged.has(normalised)) continue;
      alreadyFlagged.add(normalised);
      findings.push({ kind, value: match.trim() });
    }
  };

  checkKind("phone", PHONE_RE, normalisePhone);
  checkKind("money", MONEY_RE, normaliseMoney);
  checkKind("time", TIME_RE, normaliseTime);

  return findings;
}
