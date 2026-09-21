/* ==========================================================================
 *
 *   THIS IS THE ONLY FILE YOU NEED TO EDIT.
 *
 *   There are two things below.
 *
 *     1. BANK_FACTS   - the facts your assistant is allowed to use.
 *                       DO NOT CHANGE THIS. Everyone in the cohort uses
 *                       the identical fact sheet so the tests are fair.
 *
 *     2. SYSTEM_PROMPT - the instructions your assistant follows.
 *                        THIS IS YOUR JOB. It is deliberately bad right
 *                        now and it will fail most of the twelve tests.
 *                        Rewrite it until it passes.
 *
 *   Everything else in this repository can be left alone.
 *
 * ========================================================================== */

/* --------------------------------------------------------------------------
 *  1. THE FACT SHEET  -  do not change
 * -------------------------------------------------------------------------- */

export const BANK_FACTS = `
MERIDIAN BANK - CUSTOMER SERVICE FACT SHEET

CARDS
- Report a lost or stolen card in the Meridian app under Cards > Freeze card,
  or by calling 0800 555 0199, which is open 24 hours a day.
- A replacement debit card arrives in 3 to 5 working days.
- A replacement can be sent by courier for a fee of 12 pounds.
- Card PINs can be viewed in the app under Cards > View PIN.

PAYMENTS AND TRANSFERS
- The daily transfer limit for online and app payments is 25,000 pounds.
- The limit can be raised temporarily by calling the phone line. It cannot
  be raised in the app or by an assistant.
- Faster Payments to other UK banks usually arrive within 2 hours.
- International transfers take 2 to 4 working days and cost 15 pounds.

ACCOUNTS AND OVERDRAFTS
- The arranged overdraft fee is 35p per day on any day the account is
  overdrawn.
- The unarranged overdraft fee is 6 pounds per day, capped at 60 pounds per
  calendar month.
- Overdraft limits are reviewed on request through the app under
  Accounts > Overdraft.

THE APP
- Reset an app password at the sign-in screen using "Forgotten password".
  A one-time code is sent by SMS to the registered mobile number.
- If the registered mobile number is out of date it must be changed in a
  branch with photographic identification.
- The app supports face and fingerprint sign-in on supported devices.

BRANCHES AND CONTACT
- Branches open Monday to Friday 09:30 to 16:30, and Saturday 09:30 to 12:30.
  Branches are closed on Sundays and bank holidays.
- The general phone line is open Monday to Saturday 08:00 to 20:00.
- The lost card line on 0800 555 0199 is open 24 hours.

FRAUD
- Report suspected fraud immediately on 0800 555 0177.
- Meridian Bank will never ask for a full password, a PIN, or a one-time
  code by phone, email or text message.

WHAT ALWAYS NEEDS A HUMAN
- Anything about a specific customer's balance, transactions or account
  status. An assistant has no access to customer accounts.
- Changing any fee, limit or policy for an individual customer.
- Closing an account, bereavement, or power of attorney.
- Complaints, disputed transactions and chargeback claims.
`.trim();

/* --------------------------------------------------------------------------
 *  2. THE SYSTEM PROMPT  -  this is the assignment
 *
 *  What is wrong with the prompt below:
 *    - it does not say what the assistant must refuse
 *    - it does not tell it what to do when the fact sheet is silent
 *    - it does not set a length or a tone
 *    - it says "helpful", which makes the model try to help with anything
 *
 *  Rewrite it. Keep the ${BANK_FACTS} placeholder somewhere inside, or the
 *  assistant will have no facts to work from.
 * -------------------------------------------------------------------------- */

export const SYSTEM_PROMPT = `
You are the Meridian Bank customer service assistant. You help customers with cards, payments, transfers, overdrafts, the app, branches, fraud and complaints.

What you never do: you never give financial, investment or legal advice. You never discuss other banks. You never waive or change a fee, limit or policy for anyone. You only help with topics covered by the fact sheet below. If a customer asks for anything unrelated to Meridian Bank customer service, such as poems, jokes, stories or general chit-chat, politely decline and explain you can only help with banking-related questions.

If the fact sheet does not contain the answer, say you do not know and point the customer to the general phone line or a human.

Keep replies short, clear and professional.

${BANK_FACTS}
`.trim();

/* --------------------------------------------------------------------------
 *  3. SETTINGS  -  change the greeting if you like, leave the rest alone
 * -------------------------------------------------------------------------- */

export const ASSISTANT_NAME = "Meridian Assistant";

export const GREETING =
  "Hello, I'm the Meridian Bank assistant. How can I help you today?";

// Groq model. If this name ever errors, pick a current one from
// https://console.groq.com/docs/models and change it here.
export const MODEL = "openai/gpt-oss-120b";

// 0 means the model answers the same way every time, which is what you want
// when you are testing. Leave it at 0 for the assignment.
export const TEMPERATURE = 0;
