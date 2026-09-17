/**
 * Runs a single tool on its own.
 *
 * The /tools page uses this so you can try any tool by hand, without going
 * through the whole agent. Being able to poke one tool in isolation is the
 * fastest way to work out whether a bad answer came from the tool or from the
 * model that called it.
 */

import { NextRequest, NextResponse } from "next/server";
import { getTool, TOOLS } from "@/lib/agent/tools";

export const runtime = "nodejs";

/** The tool catalogue, for the page to render. */
export async function GET() {
  return NextResponse.json({
    tools: TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      mutates: tool.mutates,
      subgraphs: tool.subgraphs,
      parameters: tool.parameters,
    })),
  });
}

export async function POST(request: NextRequest) {
  let body: { tool?: string; args?: Record<string, unknown> };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body was not valid JSON." }, { status: 400 });
  }

  const name = typeof body.tool === "string" ? body.tool : "";
  const tool = getTool(name);

  if (!tool) {
    return NextResponse.json(
      { error: `There is no tool called "${name}".` },
      { status: 404 }
    );
  }

  const args = body.args && typeof body.args === "object" ? body.args : {};

  const startMs = Date.now();
  try {
    const result = await tool.run(args);
    return NextResponse.json({ tool: name, args, result, ms: Date.now() - startMs });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return NextResponse.json(
      { tool: name, args, error: message, ms: Date.now() - startMs },
      { status: 500 }
    );
  }
}
