/**
 * Talks to the Groq API.
 *
 * Groq speaks the same language as the OpenAI API, so this is a plain HTTP
 * request. No special library is needed and you can read exactly what is
 * being sent.
 *
 * There are three ways in:
 *   askGroq      - plain text answer
 *   askGroqJson  - answer forced into a JSON object, for the planner
 *   askGroqRaw   - the whole response, for when tool calls are needed
 */

import { MODEL, TEMPERATURE } from "@/config";

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** Present on a tool result message, linking it to the call it answers. */
  tool_call_id?: string;
  /** Present on an assistant message that asked for tools to be run. */
  tool_calls?: ToolCall[];
};

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type GroqUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

export type GroqReply = {
  content: string;
  toolCalls: ToolCall[];
  usage: GroqUsage;
  /** "stop" when the model finished, "length" when it hit the token ceiling. */
  finishReason: string;
  raw: unknown;
};

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

export class GroqError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "GroqError";
    this.status = status;
  }
}

export type AskOptions = {
  /** Tool schemas, when the model is allowed to call tools. */
  tools?: unknown[];
  /** Force a JSON object back. Your prompt must also mention JSON. */
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
};

/**
 * The one place an HTTP request is actually made.
 *
 * Everything else in this file is a convenience wrapper around it.
 */
export async function askGroqRaw(
  messages: ChatMessage[],
  options: AskOptions = {}
): Promise<GroqReply> {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    throw new GroqError(
      "GROQ_API_KEY is not set. Add it in Vercel under Settings, Environment Variables.",
      500
    );
  }

  const body: Record<string, unknown> = {
    model: MODEL,
    temperature: options.temperature ?? TEMPERATURE,
    messages,
  };

  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools;
    body.tool_choice = "auto";
  }
  if (options.json) {
    body.response_format = { type: "json_object" };
  }
  if (options.maxTokens) {
    body.max_tokens = options.maxTokens;
  }

  const response = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new GroqError(
      `Groq returned ${response.status}. ${detail.slice(0, 300)}`,
      response.status
    );
  }

  const data = await response.json();
  const choice = data?.choices?.[0];
  const message = choice?.message;

  return {
    content: typeof message?.content === "string" ? message.content.trim() : "",
    toolCalls: Array.isArray(message?.tool_calls) ? message.tool_calls : [],
    usage: data?.usage ?? {},
    finishReason: typeof choice?.finish_reason === "string" ? choice.finish_reason : "",
    raw: data,
  };
}

/** A plain text answer. Throws rather than returning an empty bubble. */
export async function askGroq(
  messages: ChatMessage[],
  options: AskOptions = {}
): Promise<string> {
  const reply = await askGroqRaw(messages, options);

  if (reply.content === "") {
    // A reasoning model spends tokens thinking before it writes anything. If
    // the budget runs out during that, the reply comes back empty with
    // finish_reason "length" rather than as an error, so say which it was.
    throw new GroqError(
      reply.finishReason === "length"
        ? "Groq ran out of output tokens before writing an answer. Raise maxTokens."
        : `Groq returned an empty answer (finish_reason: ${reply.finishReason || "unknown"}).`,
      502
    );
  }

  return reply.content;
}

/**
 * An answer parsed as JSON.
 *
 * Models occasionally wrap JSON in a code fence even when asked not to, so
 * that is stripped before parsing rather than treated as a failure.
 */
export async function askGroqJson<T>(
  messages: ChatMessage[],
  options: AskOptions = {}
): Promise<T> {
  const reply = await askGroqRaw(messages, { ...options, json: true });

  if (reply.content === "") {
    throw new GroqError("Groq returned an empty answer.", 502);
  }

  const cleaned = reply.content
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new GroqError(
      `Groq did not return valid JSON. It said: ${cleaned.slice(0, 200)}`,
      502
    );
  }
}
