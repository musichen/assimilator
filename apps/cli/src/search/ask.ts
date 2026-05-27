import { searchWorkspace, type SearchMatch } from "./search.js";

export interface AskResult {
  query: string;
  matches: SearchMatch[];
  answer: string;
}

export async function askLocal(workspace: string, query: string): Promise<AskResult> {
  const matches = await searchEvidence(workspace, query);
  const answer = matches.length === 0
    ? "No local evidence found. In local_first mode, ASSIMILATOR does not invent an answer."
    : [
        "Local evidence found. Review these source-linked matches:",
        ...matches.slice(0, 8).map((match) => `- ${match.file}:${match.line}: ${match.text}`)
      ].join("\n");
  return { query, matches, answer };
}

async function searchEvidence(workspace: string, query: string): Promise<SearchMatch[]> {
  const exact = await searchWorkspace(workspace, query);
  const terms = query
    .toLowerCase()
    .split(/\W+/)
    .filter((term) => term.length > 2);
  const all = [...exact];
  for (const term of terms) {
    all.push(...await searchWorkspace(workspace, term));
  }
  const seen = new Set<string>();
  return all.filter((match) => {
    const key = `${match.file}:${match.line}:${match.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 20);
}
