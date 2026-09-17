/**
 * The tool catalogue.
 *
 * Every tool the agent can call, with a form to run it by hand. Trying a tool
 * on its own is the quickest way to tell a broken tool apart from a model that
 * called a working tool badly.
 *
 * This half runs on the server and reduces each tool to plain data. The
 * interactive half is a separate client component, so the tool code itself
 * never reaches the browser.
 */

import { Page } from "@/app/components/shell";
import { TOOLS } from "@/lib/agent/tools";
import { ToolExplorer, type ToolSummary } from "@/app/tools/tool-explorer";

export const dynamic = "force-dynamic";

export default function ToolsPage() {
  const catalogue: ToolSummary[] = TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    mutates: tool.mutates,
    subgraphs: [...tool.subgraphs],
    parameters: tool.parameters.map((p) => ({
      name: p.name,
      type: p.type,
      description: p.description,
      required: p.required,
      ...(p.enum ? { enum: [...p.enum] } : {}),
    })),
  }));

  const writes = catalogue.filter((t) => t.mutates).length;

  return (
    <Page
      current="/tools"
      title="Tools"
      subtitle={`${catalogue.length} tools, ${writes} of which write data. Every one is deterministic and offline, so the same arguments always give the same result.`}
    >
      <ToolExplorer tools={catalogue} />
    </Page>
  );
}
