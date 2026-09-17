/**
 * The tools the agent can call.
 *
 * Every tool here is deterministic and offline. That is a deliberate choice:
 * the same question always produces the same tool results, so a run can be
 * replayed and a test can assert on it. Nothing here calls a third-party API.
 *
 * A tool returns `ok: false` for an ordinary "I could not do that" and only
 * throws for a genuine bug, so an expected failure still shows up as a proper
 * step in the trace.
 */

import { search } from "@/lib/knowledge/retriever";
import { KNOWLEDGE_BASE } from "@/lib/knowledge/documents";
import type { Tool, ToolResult } from "@/lib/agent/types";

/* -------------------------------------------------------------------------
 *  Small helpers for reading arguments the model supplied
 * ----------------------------------------------------------------------- */

function asString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/[£,\s]/g, "");
    const parsed = Number(cleaned);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function money(amount: number): string {
  return `${amount.toFixed(2)} pounds`;
}

/* -------------------------------------------------------------------------
 *  Reference data
 * ----------------------------------------------------------------------- */

const FEE_SCHEDULE: Record<string, { amount: string; note: string }> = {
  courier_replacement_card: {
    amount: "12 pounds",
    note: "Courier delivery of a replacement card.",
  },
  international_transfer: {
    amount: "15 pounds",
    note: "Per international transfer. The receiving bank may add its own charge.",
  },
  arranged_overdraft: {
    amount: "35p per day",
    note: "Charged for each day the account is overdrawn within an agreed limit.",
  },
  unarranged_overdraft: {
    amount: "6 pounds per day",
    note: "Capped at 60 pounds per calendar month.",
  },
  replacement_card_standard: {
    amount: "free",
    note: "Standard post, 3 to 5 working days.",
  },
  faster_payment: { amount: "free", note: "Payments to other UK banks." },
};

const BRANCHES = [
  { postcodeArea: "E1", name: "Whitechapel", address: "112 Whitechapel High Street" },
  { postcodeArea: "EC2", name: "Moorgate", address: "8 Moorfields" },
  { postcodeArea: "N1", name: "Islington", address: "204 Upper Street" },
  { postcodeArea: "SE1", name: "London Bridge", address: "31 Tooley Street" },
  { postcodeArea: "SW1", name: "Victoria", address: "19 Victoria Street" },
  { postcodeArea: "W1", name: "Oxford Circus", address: "260 Regent Street" },
  { postcodeArea: "M1", name: "Manchester Piccadilly", address: "44 Portland Street" },
  { postcodeArea: "B1", name: "Birmingham New Street", address: "7 Navigation Street" },
  { postcodeArea: "LS1", name: "Leeds City", address: "22 Park Row" },
  { postcodeArea: "G1", name: "Glasgow Central", address: "88 Gordon Street" },
];

const EXCHANGE_RATES: Record<string, number> = {
  EUR: 1.17,
  USD: 1.27,
  CHF: 1.12,
  JPY: 191.4,
  AUD: 1.93,
  CAD: 1.73,
  INR: 106.2,
};

/** Phrases that suggest an attempt to get at a specific customer's account. */
const ACCOUNT_SPECIFIC_PATTERNS = [
  /\bmy\s+(current\s+)?(account\s+)?balance\b/i,
  /\bhow much (do i|have i|money do i)\b/i,
  /\bmy\s+(recent\s+)?transactions?\b/i,
  /\bmy\s+account\s+(number|status|details)\b/i,
  /\bam i overdrawn\b/i,
];

/* -------------------------------------------------------------------------
 *  The tools
 * ----------------------------------------------------------------------- */

export const TOOLS: Tool[] = [
  /* ---- 1 ---- */
  {
    name: "search_knowledge_base",
    description:
      "Search Meridian Bank's knowledge base for passages that answer a question about its products, fees, hours or app. Always use this before answering a factual question.",
    mutates: false,
    subgraphs: ["knowledge", "accounts", "fraud", "escalation"],
    parameters: [
      { name: "query", type: "string", description: "The question or keywords to search for.", required: true },
      {
        name: "category",
        type: "string",
        description: "Optional filter.",
        required: false,
        enum: ["cards", "payments", "accounts", "app", "branches", "fraud", "policy"],
      },
    ],
    run: (args): ToolResult => {
      const query = asString(args.query);
      if (!query) return { ok: false, summary: "No search query was given." };

      const category = asString(args.category) || undefined;
      let hits = search(query, { limit: 3, category });
      let widened = false;

      // A category filter is a guess by the planner, and a wrong guess hides
      // the very document that answers the question. Narrowing must never do
      // worse than not narrowing, so an empty filtered search is retried
      // across everything before giving up.
      if (hits.length === 0 && category) {
        hits = search(query, { limit: 3 });
        widened = hits.length > 0;
      }

      if (hits.length === 0) {
        return {
          ok: false,
          summary: `The knowledge base has nothing about "${query}".`,
          data: { query, category: category ?? null, hits: [] },
        };
      }

      return {
        ok: true,
        summary:
          `Found ${hits.length} passage${hits.length === 1 ? "" : "s"}: ${hits
            .map((h) => h.document.title)
            .join(", ")}.` +
          (widened ? ` Nothing matched in the "${category}" category, so every category was searched.` : ""),
        data: {
          query,
          category: category ?? null,
          widenedSearch: widened,
          hits: hits.map((h) => ({
            id: h.document.id,
            title: h.document.title,
            source: h.document.source,
            score: h.score,
            text: h.document.text,
            excerpt: h.excerpt,
          })),
        },
        citations: hits.map((h) => h.document.source),
      };
    },
  },

  /* ---- 2 ---- */
  {
    name: "lookup_fee",
    description:
      "Look up one of Meridian's published fees by name. Use this rather than recalling a fee from memory.",
    mutates: false,
    subgraphs: ["knowledge", "accounts"],
    parameters: [
      {
        name: "fee",
        type: "string",
        description: "Which fee to look up.",
        required: true,
        enum: Object.keys(FEE_SCHEDULE),
      },
    ],
    run: (args): ToolResult => {
      const key = asString(args.fee);
      const entry = FEE_SCHEDULE[key];
      if (!entry) {
        return {
          ok: false,
          summary: `There is no published fee called "${key}". Known fees: ${Object.keys(FEE_SCHEDULE).join(", ")}.`,
        };
      }
      return {
        ok: true,
        summary: `${key} is ${entry.amount}. ${entry.note}`,
        data: { fee: key, amount: entry.amount, note: entry.note },
        citations: ["Meridian fee schedule"],
      };
    },
  },

  /* ---- 3 ---- */
  {
    name: "calculate_overdraft_cost",
    description:
      "Work out what an overdraft costs over a number of days, applying the monthly cap. Use this instead of doing the arithmetic yourself.",
    mutates: false,
    subgraphs: ["knowledge", "accounts"],
    parameters: [
      {
        name: "type",
        type: "string",
        description: "Which kind of overdraft.",
        required: true,
        enum: ["arranged", "unarranged"],
      },
      { name: "days", type: "number", description: "How many days overdrawn.", required: true },
    ],
    run: (args): ToolResult => {
      const type = asString(args.type);
      const days = asNumber(args.days);

      if (type !== "arranged" && type !== "unarranged") {
        return { ok: false, summary: `Unknown overdraft type "${type}". Use arranged or unarranged.` };
      }
      if (days === null || days < 0) {
        return { ok: false, summary: "The number of days must be zero or more." };
      }

      const wholeDays = Math.floor(days);

      if (type === "arranged") {
        const total = wholeDays * 0.35;
        return {
          ok: true,
          summary: `${wholeDays} day(s) of arranged overdraft costs ${money(total)} at 35p per day.`,
          data: { type, days: wholeDays, dailyRate: "35p", total: money(total), capped: false },
          citations: ["Accounts policy, section 6"],
        };
      }

      const uncapped = wholeDays * 6;
      const capped = Math.min(uncapped, 60);
      return {
        ok: true,
        summary:
          `${wholeDays} day(s) of unarranged overdraft is ${money(uncapped)} at 6 pounds per day` +
          (uncapped > 60
            ? `, reduced to the monthly cap of ${money(60)}.`
            : `, which is under the 60 pounds monthly cap.`),
        data: {
          type,
          days: wholeDays,
          dailyRate: "6 pounds",
          uncapped: money(uncapped),
          total: money(capped),
          capped: uncapped > 60,
          monthlyCap: money(60),
        },
        citations: ["Accounts policy, section 6"],
      };
    },
  },

  /* ---- 4 ---- */
  {
    name: "check_transfer_limit",
    description:
      "Check whether a payment amount is inside the daily transfer limit, and say what to do when it is not.",
    mutates: false,
    subgraphs: ["knowledge", "accounts"],
    parameters: [
      { name: "amount", type: "number", description: "The payment amount in pounds.", required: true },
    ],
    run: (args): ToolResult => {
      const amount = asNumber(args.amount);
      if (amount === null || amount < 0) {
        return { ok: false, summary: "The amount must be a number of pounds, zero or more." };
      }

      const limit = 25000;
      const within = amount <= limit;

      return {
        ok: true,
        summary: within
          ? `${money(amount)} is within the 25,000 pounds daily limit.`
          : `${money(amount)} is over the 25,000 pounds daily limit by ${money(amount - limit)}. It can be raised temporarily by calling the phone line. It cannot be raised in the app or by an assistant.`,
        data: {
          amount: money(amount),
          limit: "25,000 pounds",
          withinLimit: within,
          excess: within ? null : money(amount - limit),
          howToRaise: "Call the general phone line. It cannot be raised in the app or by an assistant.",
        },
        citations: ["Payments policy, section 1"],
      };
    },
  },

  /* ---- 5 ---- */
  {
    name: "estimate_payment_arrival",
    description:
      "Estimate when a payment will arrive, given the payment type.",
    mutates: false,
    subgraphs: ["knowledge", "accounts"],
    parameters: [
      {
        name: "payment_type",
        type: "string",
        description: "The kind of payment.",
        required: true,
        enum: ["faster_payment", "international", "standing_order", "direct_debit"],
      },
    ],
    run: (args): ToolResult => {
      const type = asString(args.payment_type);
      const table: Record<string, { window: string; note: string; cost: string }> = {
        faster_payment: {
          window: "usually within 2 hours",
          note: "The scheme allows until the end of the next working day. A first payment to a new payee is more often delayed by extra checks.",
          cost: "free",
        },
        international: {
          window: "2 to 4 working days",
          note: "The receiving bank may deduct its own charge.",
          cost: "15 pounds",
        },
        standing_order: {
          window: "on the chosen date, or the next working day",
          note: "Paid from the account, so freezing a card does not stop it.",
          cost: "free",
        },
        direct_debit: {
          window: "on the date requested by the organisation",
          note: "Paid from the account, so freezing a card does not stop it.",
          cost: "free",
        },
      };

      const entry = table[type];
      if (!entry) {
        return { ok: false, summary: `Unknown payment type "${type}".` };
      }
      return {
        ok: true,
        summary: `A ${type.replace(/_/g, " ")} arrives ${entry.window}. Cost: ${entry.cost}. ${entry.note}`,
        data: { paymentType: type, ...entry },
        citations: ["Payments policy, section 3"],
      };
    },
  },

  /* ---- 6 ---- */
  {
    name: "find_branch",
    description: "Find the nearest Meridian branch from the first part of a UK postcode.",
    mutates: false,
    subgraphs: ["knowledge", "accounts", "escalation"],
    parameters: [
      { name: "postcode", type: "string", description: "A UK postcode or its first part, such as SW1 or E1 6AN.", required: true },
    ],
    run: (args): ToolResult => {
      const raw = asString(args.postcode).toUpperCase().replace(/\s+/g, "");
      if (!raw) return { ok: false, summary: "No postcode was given." };

      const areaMatch = raw.match(/^[A-Z]{1,2}\d{1,2}/);
      if (!areaMatch) {
        return { ok: false, summary: `"${raw}" does not look like a UK postcode.` };
      }
      const area = areaMatch[0];

      const exact = BRANCHES.find((b) => b.postcodeArea === area);
      if (exact) {
        return {
          ok: true,
          summary: `The ${exact.name} branch covers ${area}, at ${exact.address}.`,
          data: { ...exact, matchType: "exact" },
          citations: ["Branch directory"],
        };
      }

      const letters = area.match(/^[A-Z]+/)?.[0] ?? "";
      const nearby = BRANCHES.filter((b) => b.postcodeArea.startsWith(letters));
      if (nearby.length > 0) {
        return {
          ok: true,
          summary: `No branch sits directly in ${area}. The closest are ${nearby.map((b) => b.name).join(", ")}.`,
          data: { area, nearby, matchType: "nearby" },
          citations: ["Branch directory"],
        };
      }

      return {
        ok: false,
        summary: `No Meridian branch is listed near ${area}. Branch opening hours and the phone line still apply.`,
        data: { area, nearby: [] },
      };
    },
  },

  /* ---- 7 ---- */
  {
    name: "get_opening_hours",
    description: "Get opening hours for branches, the general phone line, or the 24-hour lost card line.",
    mutates: false,
    subgraphs: ["knowledge", "fraud", "escalation"],
    parameters: [
      {
        name: "service",
        type: "string",
        description: "Which service.",
        required: true,
        enum: ["branch", "phone_line", "lost_card_line", "fraud_line"],
      },
      {
        name: "day",
        type: "string",
        description: "Optional day of the week to check.",
        required: false,
        enum: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "bank_holiday"],
      },
    ],
    run: (args): ToolResult => {
      const service = asString(args.service);
      const day = asString(args.day).toLowerCase();

      const services: Record<string, { label: string; hours: Record<string, string>; number?: string }> = {
        branch: {
          label: "Branches",
          hours: {
            monday: "09:30 to 16:30", tuesday: "09:30 to 16:30", wednesday: "09:30 to 16:30",
            thursday: "09:30 to 16:30", friday: "09:30 to 16:30", saturday: "09:30 to 12:30",
            sunday: "closed on Sundays", bank_holiday: "closed on bank holidays",
          },
        },
        phone_line: {
          label: "The general phone line",
          hours: {
            monday: "08:00 to 20:00", tuesday: "08:00 to 20:00", wednesday: "08:00 to 20:00",
            thursday: "08:00 to 20:00", friday: "08:00 to 20:00", saturday: "08:00 to 20:00",
            sunday: "closed on Sundays", bank_holiday: "closed",
          },
        },
        lost_card_line: {
          label: "The lost card line",
          number: "0800 555 0199",
          hours: {
            monday: "24 hours", tuesday: "24 hours", wednesday: "24 hours", thursday: "24 hours",
            friday: "24 hours", saturday: "24 hours", sunday: "24 hours", bank_holiday: "24 hours",
          },
        },
        fraud_line: {
          label: "The fraud line",
          number: "0800 555 0177",
          hours: {
            monday: "24 hours", tuesday: "24 hours", wednesday: "24 hours", thursday: "24 hours",
            friday: "24 hours", saturday: "24 hours", sunday: "24 hours", bank_holiday: "24 hours",
          },
        },
      };

      const entry = services[service];
      if (!entry) return { ok: false, summary: `Unknown service "${service}".` };

      if (day && entry.hours[day]) {
        return {
          ok: true,
          summary: `${entry.label}${entry.number ? ` on ${entry.number}` : ""}: ${day} is ${entry.hours[day]}.`,
          data: { service, day, hours: entry.hours[day], number: entry.number ?? null },
          citations: ["Branch directory"],
        };
      }

      return {
        ok: true,
        summary: `${entry.label}${entry.number ? ` on ${entry.number}` : ""}: Mon-Fri ${entry.hours.monday}, Sat ${entry.hours.saturday}, Sun ${entry.hours.sunday}.`,
        data: { service, hours: entry.hours, number: entry.number ?? null },
        citations: ["Branch directory"],
      };
    },
  },

  /* ---- 8 ---- */
  {
    name: "get_card_replacement_eta",
    description: "Say how long a replacement card takes and what it costs, by delivery method.",
    mutates: false,
    subgraphs: ["knowledge", "accounts", "fraud"],
    parameters: [
      {
        name: "delivery",
        type: "string",
        description: "Delivery method.",
        required: true,
        enum: ["standard", "courier"],
      },
    ],
    run: (args): ToolResult => {
      const delivery = asString(args.delivery);
      if (delivery === "standard") {
        return {
          ok: true,
          summary: "A standard replacement debit card arrives in 3 to 5 working days and is free.",
          data: { delivery, eta: "3 to 5 working days", cost: "free" },
          citations: ["Cards handbook, section 2"],
        };
      }
      if (delivery === "courier") {
        return {
          ok: true,
          summary: "A courier replacement costs 12 pounds and normally arrives the next working day when ordered before 15:00.",
          data: { delivery, eta: "next working day if ordered before 15:00", cost: "12 pounds" },
          citations: ["Cards handbook, section 2"],
        };
      }
      return { ok: false, summary: `Unknown delivery method "${delivery}". Use standard or courier.` };
    },
  },

  /* ---- 9 ---- */
  {
    name: "assess_fraud_risk",
    description:
      "Assess a description of a suspicious contact against Meridian's published fraud rules, and return the right warning and number.",
    mutates: false,
    subgraphs: ["fraud"],
    parameters: [
      { name: "description", type: "string", description: "What the customer says happened.", required: true },
    ],
    run: (args): ToolResult => {
      const description = asString(args.description);
      if (!description) return { ok: false, summary: "No description was given." };

      const lowered = description.toLowerCase();
      const signals: string[] = [];

      if (/\bpin\b|password|one[- ]?time|otp|passcode|security code/.test(lowered)) {
        signals.push("Asked for a PIN, password or one-time code. Meridian never asks for these.");
      }
      if (/safe account|move (my )?money|transfer .* safe/.test(lowered)) {
        signals.push("Asked to move money to a safe account. There is no such thing; this is always fraud.");
      }
      if (/call(ed|er)?|phone|rang/.test(lowered)) {
        signals.push("Inbound contact by phone. Caller display can be faked and proves nothing.");
      }
      if (/text|sms|email|link|click/.test(lowered)) {
        signals.push("Contact by text or email containing a link.");
      }
      if (/remote|anydesk|teamviewer|screen ?share|install/.test(lowered)) {
        signals.push("Asked to install remote access software.");
      }

      const level = signals.length >= 2 ? "high" : signals.length === 1 ? "elevated" : "unclear";

      return {
        ok: true,
        summary:
          signals.length > 0
            ? `Risk ${level}. ${signals.length} warning sign(s) matched. Report on 0800 555 0177.`
            : "No specific warning sign matched, but anything suspicious should still go to 0800 555 0177.",
        data: {
          level,
          signals,
          reportNumber: "0800 555 0177",
          neverAsks: "Meridian will never ask for a full password, a PIN, or a one-time code by phone, email or text.",
        },
        citations: ["Security policy, section 1"],
      };
    },
  },

  /* ---- 10 ---- */
  {
    name: "validate_sort_code",
    description: "Check that a sort code and account number are correctly formatted. This does not look up any real account.",
    mutates: false,
    subgraphs: ["accounts", "knowledge"],
    parameters: [
      { name: "sort_code", type: "string", description: "Six digits, with or without dashes.", required: true },
      { name: "account_number", type: "string", description: "Eight digits.", required: false },
    ],
    run: (args): ToolResult => {
      const sortCode = asString(args.sort_code).replace(/[-\s]/g, "");
      const accountNumber = asString(args.account_number).replace(/\s/g, "");

      const sortValid = /^\d{6}$/.test(sortCode);
      const accountValid = accountNumber === "" || /^\d{8}$/.test(accountNumber);

      const problems: string[] = [];
      if (!sortValid) problems.push("A sort code must be exactly six digits.");
      if (!accountValid) problems.push("An account number must be exactly eight digits.");

      return {
        ok: problems.length === 0,
        summary:
          problems.length === 0
            ? `Format looks correct (${sortCode.replace(/(\d{2})(\d{2})(\d{2})/, "$1-$2-$3")}). This only checks the format, not that the account exists.`
            : problems.join(" "),
        data: {
          sortCodeValid: sortValid,
          accountNumberValid: accountValid,
          problems,
          caveat: "Format only. An assistant cannot confirm that an account exists.",
        },
      };
    },
  },

  /* ---- 11 ---- */
  {
    name: "convert_currency",
    description: "Convert an amount using Meridian's indicative exchange rates. These are indicative only.",
    mutates: false,
    subgraphs: ["knowledge", "accounts"],
    parameters: [
      { name: "amount", type: "number", description: "Amount in pounds.", required: true },
      {
        name: "currency",
        type: "string",
        description: "Target currency code.",
        required: true,
        enum: Object.keys(EXCHANGE_RATES),
      },
    ],
    run: (args): ToolResult => {
      const amount = asNumber(args.amount);
      const currency = asString(args.currency).toUpperCase();

      if (amount === null || amount < 0) {
        return { ok: false, summary: "The amount must be a number of pounds, zero or more." };
      }
      const rate = EXCHANGE_RATES[currency];
      if (!rate) {
        return {
          ok: false,
          summary: `No indicative rate is held for "${currency}". Available: ${Object.keys(EXCHANGE_RATES).join(", ")}.`,
        };
      }

      const converted = amount * rate;
      return {
        ok: true,
        summary: `${money(amount)} is about ${converted.toFixed(2)} ${currency} at an indicative rate of ${rate}. Indicative only; the rate at the time of the transfer applies.`,
        data: {
          amount: money(amount),
          currency,
          rate,
          converted: converted.toFixed(2),
          caveat: "Indicative rate. The rate applied is the one at the time of the transfer.",
          transferFee: "15 pounds for an international transfer",
        },
        citations: ["Meridian fee schedule"],
      };
    },
  },

  /* ---- 12 ---- */
  {
    name: "check_request_permitted",
    description:
      "Check a request against Meridian's service policy to see whether an assistant is allowed to handle it. Use this whenever a request looks account-specific, like a fee waiver, or like advice.",
    mutates: false,
    subgraphs: ["knowledge", "accounts", "escalation", "fraud"],
    parameters: [
      { name: "request", type: "string", description: "The customer's request, in their words.", required: true },
    ],
    run: (args): ToolResult => {
      const request = asString(args.request);
      if (!request) return { ok: false, summary: "No request was given." };

      const lowered = request.toLowerCase();
      const reasons: string[] = [];

      if (ACCOUNT_SPECIFIC_PATTERNS.some((p) => p.test(request))) {
        reasons.push("Asks about a specific customer's account. An assistant has no access to customer accounts.");
      }
      if (/waive|refund|cancel the (fee|charge)|just this once|as a gesture/.test(lowered)) {
        reasons.push("Asks to change a fee or policy for an individual. An assistant has no authority to do this.");
      }
      if (/should i (invest|put|save)|stocks?|shares?|isa|pension|which account should i/.test(lowered)) {
        reasons.push("Asks for regulated financial advice.");
      }
      if (/section 75|chargeback|legal|sue|ombudsman|my rights/.test(lowered)) {
        reasons.push("Asks for legal advice or a disputed transaction outcome.");
      }
      if (/close (my|the) account|bereave|power of attorney|deceased|probate/.test(lowered)) {
        reasons.push("Account closure, bereavement or power of attorney is always handled by a person.");
      }
      if (/complain|complaint|disputed? (transaction|payment)/.test(lowered)) {
        reasons.push("Complaints and disputed transactions are always handled by a person.");
      }
      if (/\b(barclays|hsbc|natwest|lloyds|santander|halifax|monzo|starling|revolut|nationwide|tsb)\b/.test(lowered)) {
        reasons.push("Asks about a different bank. The assistant only covers Meridian Bank.");
      }
      if (/poem|joke|story|song|rap|haiku|write me a/.test(lowered)) {
        reasons.push("Asks for creative writing, which is outside the assistant's scope.");
      }

      const permitted = reasons.length === 0;
      return {
        ok: true,
        summary: permitted
          ? "Permitted. This is a general question about Meridian's published information."
          : `Not permitted. ${reasons.join(" ")}`,
        data: {
          permitted,
          reasons,
          requiredAction: permitted ? "answer_from_knowledge_base" : "refuse_and_redirect",
        },
        citations: ["Service policy, section 9"],
      };
    },
  },

  /* ---- 13 ---- */
  {
    name: "create_handoff",
    description:
      "Record a handover to a human colleague. Use this when the policy check says a request needs a person, so the customer is left with a reference and a route.",
    mutates: true,
    subgraphs: ["escalation", "fraud"],
    parameters: [
      { name: "reason", type: "string", description: "Why a human is needed.", required: true },
      {
        name: "urgency",
        type: "string",
        description: "How quickly it needs attention.",
        required: true,
        enum: ["routine", "urgent", "emergency"],
      },
      { name: "summary", type: "string", description: "A one-line summary of what the customer wants.", required: true },
    ],
    run: async (args): Promise<ToolResult> => {
      const reason = asString(args.reason);
      const urgency = asString(args.urgency) || "routine";
      const summaryText = asString(args.summary);

      if (!reason || !summaryText) {
        return { ok: false, summary: "A handoff needs both a reason and a summary." };
      }

      const reference = `MER-${Date.now().toString(36).toUpperCase().slice(-6)}`;
      const route =
        urgency === "emergency"
          ? "Call 0800 555 0177 now. That line is open 24 hours."
          : urgency === "urgent"
            ? "Call the general phone line, open Monday to Saturday 08:00 to 20:00."
            : "Call the general phone line or visit a branch, Monday to Friday 09:30 to 16:30 or Saturday 09:30 to 12:30.";

      // Saving is best-effort. A database that is down must not stop the
      // customer being told how to reach a person.
      let saved = false;
      try {
        const { saveHandoff } = await import("@/lib/db");
        saved = await saveHandoff({ reference, reason, urgency, summary: summaryText });
      } catch {
        saved = false;
      }

      return {
        ok: true,
        summary: `Handoff ${reference} recorded (${urgency}). ${route}`,
        data: { reference, reason, urgency, summary: summaryText, route, saved },
        citations: ["Service policy, section 9"],
      };
    },
  },
];

/* -------------------------------------------------------------------------
 *  Looking tools up
 * ----------------------------------------------------------------------- */

export function getTool(name: string): Tool | undefined {
  return TOOLS.find((t) => t.name === name);
}

export function toolsForSubgraph(subgraph: string): Tool[] {
  return TOOLS.filter((t) => (t.subgraphs as string[]).includes(subgraph));
}

/** The tool list in the shape the Groq API expects for function calling. */
export function toolSchemas(tools: Tool[]): unknown[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: "object",
        properties: Object.fromEntries(
          tool.parameters.map((p) => [
            p.name,
            {
              type: p.type,
              description: p.description,
              ...(p.enum ? { enum: p.enum } : {}),
            },
          ])
        ),
        required: tool.parameters.filter((p) => p.required).map((p) => p.name),
      },
    },
  }));
}

/** A compact description of the tools, for the planner's prompt. */
export function describeTools(tools: Tool[]): string {
  return tools
    .map((tool) => {
      const params = tool.parameters
        .map((p) => {
          const options = p.enum ? ` one of: ${p.enum.join(" | ")}` : "";
          return `    - ${p.name} (${p.type}${p.required ? ", required" : ", optional"}):${options || ` ${p.description}`}`;
        })
        .join("\n");
      return `  ${tool.name}: ${tool.description}\n${params}`;
    })
    .join("\n\n");
}

export const KNOWLEDGE_DOCUMENT_COUNT = KNOWLEDGE_BASE.length;
