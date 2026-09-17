/**
 * The knowledge base.
 *
 * Each entry is one self-contained passage. Keeping them small matters: the
 * retriever hands whole documents to the model, so a document that covers two
 * subjects drags an irrelevant one into every answer about the other.
 *
 * BANK_FACTS in config.ts is imported as its own document rather than copied,
 * so there is exactly one place where a fact can be wrong.
 */

import { BANK_FACTS } from "@/config";

export type KnowledgeDocument = {
  id: string;
  title: string;
  /** Shown as the source on a citation. */
  source: string;
  category: "cards" | "payments" | "accounts" | "app" | "branches" | "fraud" | "policy";
  text: string;
};

export const KNOWLEDGE_BASE: KnowledgeDocument[] = [
  {
    id: "fact-sheet",
    title: "Customer service fact sheet",
    source: "Meridian fact sheet",
    category: "policy",
    text: BANK_FACTS,
  },
  {
    id: "cards-lost",
    title: "Lost and stolen cards",
    source: "Cards handbook, section 2",
    category: "cards",
    text: `
A lost or stolen card should be frozen immediately. The fastest route is the
Meridian app under Cards, then Freeze card, which takes effect at once and can
be undone if the card is found. The lost card line on 0800 555 0199 is open 24
hours a day, every day of the year, including bank holidays.

Freezing a card stops new card payments and cash withdrawals. It does not stop
standing orders or direct debits, which are paid from the account rather than
the card, and it does not cancel a payment that has already been authorised.

A replacement debit card arrives in 3 to 5 working days by standard post. A
courier delivery can be arranged for a fee of 12 pounds and normally arrives the
next working day when ordered before 15:00.
`.trim(),
  },
  {
    id: "cards-pin",
    title: "PINs and card security",
    source: "Cards handbook, section 4",
    category: "cards",
    text: `
A card PIN can be viewed in the Meridian app under Cards, then View PIN. The PIN
is shown for fifteen seconds and is never sent by email or text message.

A PIN cannot be changed in the app. Changing a PIN is done at any Meridian cash
machine using the current PIN. A forgotten PIN requires a replacement PIN by
post, which takes 3 to 5 working days.

Three incorrect PIN entries block the card. The block is lifted at a Meridian
cash machine with the correct PIN, or by calling the general phone line.
`.trim(),
  },
  {
    id: "payments-limits",
    title: "Daily payment limits",
    source: "Payments policy, section 1",
    category: "payments",
    text: `
The daily transfer limit for online and app payments is 25,000 pounds. The limit
applies to the calendar day in UK time and resets at midnight.

The limit can be raised temporarily by calling the general phone line. It cannot
be raised in the app, on the website, or by an assistant. A temporary raise
normally lasts 24 hours and requires identity verification.

Payments to an account already saved as a trusted payee count towards the same
daily limit. There is no separate allowance for existing payees.
`.trim(),
  },
  {
    id: "payments-speed",
    title: "How long payments take",
    source: "Payments policy, section 3",
    category: "payments",
    text: `
Faster Payments to other UK banks usually arrive within 2 hours. The scheme
allows up to the end of the next working day, and a first payment to a new payee
is more often delayed because of additional checks.

International transfers take 2 to 4 working days and cost 15 pounds per
transfer. The receiving bank may deduct its own charge, which Meridian does not
control and cannot refund.

Payments made after 17:00, at a weekend, or on a bank holiday are processed on
the next working day.
`.trim(),
  },
  {
    id: "accounts-overdraft",
    title: "Overdraft fees",
    source: "Accounts policy, section 6",
    category: "accounts",
    text: `
The arranged overdraft fee is 35p per day on any day the account is overdrawn.
The fee is charged for each calendar day the balance is below zero at the end of
the day, and is collected monthly in arrears.

The unarranged overdraft fee is 6 pounds per day, capped at 60 pounds per
calendar month. An account is unarranged when it goes below zero without an
agreed limit, or below an agreed limit.

An account that is overdrawn only during the day but back above zero by the end
of the day is not charged.

Overdraft limits are reviewed on request through the app under Accounts, then
Overdraft. A review is not a guarantee and depends on a credit assessment.
`.trim(),
  },
  {
    id: "app-access",
    title: "Signing in to the app",
    source: "Digital guide, section 1",
    category: "app",
    text: `
An app password is reset at the sign-in screen using Forgotten password. A
one-time code is sent by SMS to the registered mobile number.

If the registered mobile number is out of date it must be changed in a branch
with photographic identification. This cannot be done over the phone or in the
app, because the number is what proves identity.

The app supports face and fingerprint sign-in on supported devices. Biometric
sign-in is switched on under Settings, then Security, and always keeps the
password as a fallback.
`.trim(),
  },
  {
    id: "branches-hours",
    title: "Branch and phone opening hours",
    source: "Branch directory",
    category: "branches",
    text: `
Branches open Monday to Friday 09:30 to 16:30, and Saturday 09:30 to 12:30.
Branches are closed on Sundays and bank holidays.

The general phone line is open Monday to Saturday 08:00 to 20:00. It is closed
on Sundays.

The lost card line on 0800 555 0199 is open 24 hours, every day, and is the only
number answered outside general opening hours.

Counter services, including cash deposits and identity checks, stop fifteen
minutes before the branch closes.
`.trim(),
  },
  {
    id: "fraud-reporting",
    title: "Reporting fraud",
    source: "Security policy, section 1",
    category: "fraud",
    text: `
Suspected fraud should be reported immediately on 0800 555 0177.

Meridian Bank will never ask for a full password, a PIN, or a one-time code by
phone, email or text message. Any caller who asks for one of these is not from
Meridian, no matter what the caller display shows, because caller display can be
faked.

Meridian will never ask a customer to move money to a safe account. There is no
such thing as a safe account and any request to move money for safekeeping is
fraud.

A customer who has already shared a code or moved money should call 0800 555
0177 straight away. Acting within 24 hours materially improves recovery.
`.trim(),
  },
  {
    id: "policy-escalation",
    title: "What always needs a human",
    source: "Service policy, section 9",
    category: "policy",
    text: `
An assistant has no access to customer accounts and must hand over to a human
for anything about a specific customer's balance, transactions or account
status.

An assistant cannot change any fee, limit or policy for an individual customer,
however reasonable the request or long-standing the customer.

Closing an account, bereavement and power of attorney are always handled by a
person, as are complaints, disputed transactions and chargeback claims.

Investment advice, tax advice and legal questions, including Section 75 claims,
are outside what an assistant may answer. These are regulated activities.
`.trim(),
  },
  {
    id: "policy-scope",
    title: "What the assistant covers",
    source: "Service policy, section 1",
    category: "policy",
    text: `
The assistant answers questions about Meridian Bank's own published products,
fees, opening hours and app. It works only from the knowledge base and does not
use general knowledge about banking.

The assistant does not answer questions about other banks, their products or
their fees, even when the question looks identical to one about Meridian.

The assistant does not write creative content, give opinions, or discuss
subjects unrelated to Meridian Bank's services.
`.trim(),
  },
];

export function getDocument(id: string): KnowledgeDocument | undefined {
  return KNOWLEDGE_BASE.find((doc) => doc.id === id);
}

export function categories(): string[] {
  return [...new Set(KNOWLEDGE_BASE.map((d) => d.category))].sort();
}
