/**
 * Says which pieces are switched on.
 *
 * The dashboard reads this so you can see at a glance whether the model, the
 * database and tracing are all wired up, without having to send a message and
 * guess from the failure.
 */

import { NextResponse } from "next/server";
import { MODEL } from "@/config";
import { databaseIsConfigured, studentName } from "@/lib/db";
import { checkCredentials, langfuseHost, langfuseIsConfigured } from "@/lib/langfuse";
import { TOOLS } from "@/lib/agent/tools";
import { KNOWLEDGE_BASE } from "@/lib/knowledge/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const langfuse = langfuseIsConfigured()
    ? await checkCredentials()
    : { ok: false, detail: "LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are not set." };

  return NextResponse.json({
    model: { name: MODEL, configured: Boolean(process.env.GROQ_API_KEY) },
    database: { configured: databaseIsConfigured(), student: studentName() },
    tracing: { configured: langfuseIsConfigured(), host: langfuseHost(), ...langfuse },
    tools: { count: TOOLS.length, names: TOOLS.map((t) => t.name) },
    knowledge: { documents: KNOWLEDGE_BASE.length },
  });
}
