/**
 * The knowledge base browser.
 *
 * Shows every document the agent can retrieve, and lets you run the same
 * search the agent runs. If the assistant gives a thin answer, search here
 * first: nine times out of ten the passage it needed is missing or is worded
 * so differently that the retriever never found it.
 */

import Link from "next/link";
import { Badge, Card, Page } from "@/app/components/shell";
import { KNOWLEDGE_BASE, categories } from "@/lib/knowledge/documents";
import { search } from "@/lib/knowledge/retriever";

export const dynamic = "force-dynamic";

/**
 * The documents are hard-wrapped in the source so they stay readable in the
 * editor. On screen those line breaks land mid-sentence, so single newlines
 * become spaces here while blank lines still separate paragraphs.
 */
function reflow(text: string): string {
  return text.replace(/([^\n])\n(?!\n)/g, "$1 ");
}

export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string }>;
}) {
  const params = await searchParams;
  const query = (params.q ?? "").trim();
  const category = (params.category ?? "").trim();

  const hits = query ? search(query, { limit: 5, category: category || undefined }) : [];
  const shown = query
    ? []
    : KNOWLEDGE_BASE.filter((doc) => !category || doc.category === category);

  return (
    <Page
      current="/knowledge"
      title="Knowledge base"
      subtitle={`${KNOWLEDGE_BASE.length} documents. The agent answers only from these.`}
    >
      <div className="space-y-6">
        <Card
          title="Search"
          description="This runs exactly the same BM25 search the agent's search_knowledge_base tool runs, with the same scores."
        >
          <form method="GET" className="flex flex-wrap gap-2">
            <input
              name="q"
              defaultValue={query}
              placeholder="unarranged overdraft fee"
              className="min-w-[200px] flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
            />
            <select
              name="category"
              defaultValue={category}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">All categories</option>
              {categories().map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="rounded-lg px-4 py-2 text-sm font-medium text-white"
              style={{ background: "var(--brand)" }}
            >
              Search
            </button>
            {(query || category) && (
              <Link
                href="/knowledge"
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700"
              >
                Clear
              </Link>
            )}
          </form>
        </Card>

        {query && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              {hits.length === 0
                ? `Nothing scored above the relevance threshold for "${query}". The agent would say it does not have that information.`
                : `${hits.length} passage${hits.length === 1 ? "" : "s"} for "${query}", best first.`}
            </p>
            {hits.map((hit) => (
              <div key={hit.document.id} className="rounded-xl border border-slate-200 bg-white p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[15px] font-semibold text-slate-800">
                    {hit.document.title}
                  </h3>
                  <Badge tone="brand">score {hit.score}</Badge>
                  <Badge>{hit.document.category}</Badge>
                </div>
                <p className="pt-1 text-xs text-slate-500">{hit.document.source}</p>
                <p className="pt-3 text-sm leading-relaxed text-slate-700">{hit.excerpt}</p>
                {hit.matched.length > 0 && (
                  <p className="pt-3 font-mono text-xs text-slate-500">
                    matched: {hit.matched.join(", ")}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {!query && (
          <div className="grid gap-4 md:grid-cols-2">
            {shown.map((doc) => (
              <div key={doc.id} className="rounded-xl border border-slate-200 bg-white p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[15px] font-semibold text-slate-800">{doc.title}</h3>
                  <Badge>{doc.category}</Badge>
                </div>
                <p className="pt-1 text-xs text-slate-500">{doc.source}</p>
                <p className="max-h-48 overflow-y-auto pt-3 text-sm leading-relaxed whitespace-pre-wrap text-slate-700">
                  {reflow(doc.text)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </Page>
  );
}
