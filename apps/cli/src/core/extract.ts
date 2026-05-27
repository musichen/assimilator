export interface ExtractedSignals {
  summaryShort: string;
  keyIdeas: string[];
  links: string[];
  commands: string[];
  openQuestions: string[];
  actionItems: string[];
  concepts: string[];
}

const stopWords = new Set([
  "about",
  "after",
  "again",
  "also",
  "because",
  "before",
  "build",
  "could",
  "from",
  "have",
  "into",
  "local",
  "more",
  "should",
  "system",
  "that",
  "their",
  "there",
  "this",
  "with",
  "work",
  "would",
  "your"
]);

export function extractSignals(markdown: string): ExtractedSignals {
  const plainLines = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const prose = plainLines.filter((line) => !line.startsWith("#") && !line.startsWith("---")).join(" ");
  const sentences = prose.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
  const links = Array.from(markdown.matchAll(/https?:\/\/[^\s)>\]]+/g)).map((match) => match[0]);
  const commands = plainLines.filter((line) =>
    /^(pnpm|npm|yarn|git|node|tsx|assimilate|hermes|\/goal|npx|python|pip|uv|curl|ssh)\b/.test(line.replace(/^[-*]\s*/, ""))
  );
  const openQuestions = plainLines.filter((line) => line.endsWith("?") || /^[-*]\s*(question|open question):/i.test(line));
  const actionItems = plainLines.filter((line) => /^[-*]\s*(todo|task|action|follow[- ]?up|next):/i.test(line));
  const concepts = extractConcepts(prose);

  return {
    summaryShort: sentences[0] ?? "Source ingested into ASSIMILATOR.",
    keyIdeas: sentences.slice(0, 5),
    links,
    commands,
    openQuestions,
    actionItems,
    concepts
  };
}

function extractConcepts(text: string): string[] {
  const counts = new Map<string, number>();
  for (const rawWord of text.match(/\b[A-Za-z][A-Za-z0-9-]{3,}\b/g) ?? []) {
    const word = rawWord.toLowerCase();
    if (stopWords.has(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([word]) => word);
}
