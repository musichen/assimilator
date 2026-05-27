import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { listFiles } from "../core/fs.js";
import { slugify } from "../core/ids.js";
import { readConfig } from "../core/config.js";
import { markdownToHtml } from "../converters/showdown.js";

export interface RenderPortalResult {
  pagesRendered: number;
  indexPath: string;
  searchIndexPath: string;
}

interface PortalPage {
  title: string;
  type: string;
  source: string;
  href: string;
  text: string;
  updated?: string;
}

export async function renderPortal(workspace: string): Promise<RenderPortalResult> {
  const config = await readConfig(workspace);
  const wikiRoot = path.join(workspace, "wiki");
  const pagesRoot = path.join(workspace, "portal", "pages");
  const files = await listFiles(wikiRoot, new Set([".md"]));
  await fs.mkdir(pagesRoot, { recursive: true });
  const pages: PortalPage[] = [];

  for (const filePath of files) {
    const relative = path.relative(wikiRoot, filePath);
    const parsed = matter(await fs.readFile(filePath, "utf8"));
    const title = String(parsed.data.title || path.basename(filePath, ".md"));
    const html = markdownToHtml(resolveWikiLinks(parsed.content));
    const outName = `${slugify(relative.replace(/\.md$/, ""))}.html`;
    const outPath = path.join(pagesRoot, outName);
    const type = String(parsed.data.type || relative.split(path.sep)[0] || "page");
    await fs.writeFile(outPath, wrapHtml(config.portal.title, title, pageChrome(title, type, html)));
    pages.push({
      title,
      type,
      source: relative.split(path.sep).join("/"),
      href: `pages/${outName}`,
      text: stripMarkdown(parsed.content).slice(0, 1200),
      updated: String(parsed.data.updated || parsed.data.ingested || parsed.data.date || "")
    });
  }

  const indexPath = path.join(workspace, "portal", "public", "index.html");
  const searchIndexPath = path.join(workspace, "portal", "search-index", "pages.json");
  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  await fs.mkdir(path.dirname(searchIndexPath), { recursive: true });
  await fs.writeFile(searchIndexPath, `${JSON.stringify({ generated_at: new Date().toISOString(), pages }, null, 2)}\n`);
  await fs.writeFile(indexPath, wrapHtml(config.portal.title, "Home", dashboardHtml(config.portal.title, pages)));
  return { pagesRendered: files.length, indexPath, searchIndexPath };
}

function resolveWikiLinks(markdown: string): string {
  return markdown.replace(/\[\[([^\]]+)\]\]/g, (_match, rawTarget: string) => {
    const label = String(rawTarget).split("|").pop() ?? rawTarget;
    const target = String(rawTarget).split("|")[0] ?? rawTarget;
    return `[${label}](./${slugify(target)}.html)`;
  });
}

function wrapHtml(siteTitle: string, pageTitle: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(pageTitle)} - ${escapeHtml(siteTitle)}</title>
  <style>
    :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; line-height: 1.6; background: #f7f7f4; color: #1f2933; }
    main { max-width: 920px; margin: 0 auto; padding: 40px 20px 72px; }
    header { margin-bottom: 28px; }
    .eyebrow { color: #637067; font-size: 0.86rem; text-transform: uppercase; letter-spacing: 0.08em; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin: 20px 0 28px; }
    .panel { border: 1px solid #d9ddd2; border-radius: 8px; padding: 14px; background: #fffefa; }
    .metric { font-size: 1.8rem; font-weight: 700; line-height: 1.1; }
    input { width: 100%; box-sizing: border-box; padding: 12px 14px; border-radius: 8px; border: 1px solid #ccd2c5; background: #fffefa; color: inherit; font: inherit; }
    .page-list { padding-left: 18px; }
    .muted { color: #637067; }
    a { color: #0f766e; }
    pre, code { background: #eceee8; border-radius: 6px; }
    code { padding: 2px 5px; }
    pre { padding: 14px; overflow: auto; }
    h1, h2, h3 { line-height: 1.2; }
    li { margin: 4px 0; }
    @media (prefers-color-scheme: dark) {
      body { background: #151714; color: #eceee8; }
      .panel, input { background: #1f231d; border-color: #394033; }
      pre, code { background: #262a24; }
      a { color: #5eead4; }
    }
  </style>
</head>
<body>
  <main>${body}</main>
</body>
</html>
`;
}

function dashboardHtml(siteTitle: string, pages: PortalPage[]): string {
  const typeCounts = countBy(pages, (page) => page.type);
  const recent = [...pages]
    .sort((a, b) => (b.updated || "").localeCompare(a.updated || ""))
    .slice(0, 12);
  const topTypes = Array.from(typeCounts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8);
  return [
    "<header>",
    `<div class="eyebrow">Local-first knowledge portal</div>`,
    `<h1>${escapeHtml(siteTitle)}</h1>`,
    `<p class="muted">Generated from canonical Markdown wiki pages.</p>`,
    "</header>",
    `<input id="search" type="search" placeholder="Search rendered pages" aria-label="Search rendered pages">`,
    "<section class=\"grid\">",
    metricPanel("Pages", String(pages.length)),
    metricPanel("Types", String(typeCounts.size)),
    metricPanel("Recent", String(recent.length)),
    "</section>",
    "<section>",
    "<h2>Page Types</h2>",
    `<ul>${topTypes.map(([type, count]) => `<li>${escapeHtml(type)}: ${count}</li>`).join("\n")}</ul>`,
    "</section>",
    "<section>",
    "<h2>Recent Pages</h2>",
    `<ul id="pages" class="page-list">${recent.map(pageLink).join("\n")}</ul>`,
    "</section>",
    searchScript(pages)
  ].join("\n");
}

function pageChrome(title: string, type: string, html: string): string {
  return [
    "<header>",
    `<div class="eyebrow">${escapeHtml(type)}</div>`,
    `<h1>${escapeHtml(title)}</h1>`,
    `<p><a href="../public/index.html">Portal Home</a></p>`,
    "</header>",
    html
  ].join("\n");
}

function metricPanel(label: string, value: string): string {
  return `<div class="panel"><div class="metric">${escapeHtml(value)}</div><div class="muted">${escapeHtml(label)}</div></div>`;
}

function pageLink(page: PortalPage): string {
  return `<li data-title="${escapeHtml(page.title.toLowerCase())}" data-text="${escapeHtml(page.text.toLowerCase())}"><a href="${escapeHtml(page.href)}">${escapeHtml(page.title)}</a> <span class="muted">${escapeHtml(page.type)}</span></li>`;
}

function searchScript(pages: PortalPage[]): string {
  return `<script>
const pages = ${JSON.stringify(pages.map((page) => ({ title: page.title, href: page.href, type: page.type, text: page.text })))};
const input = document.getElementById("search");
const list = document.getElementById("pages");
input?.addEventListener("input", () => {
  const query = input.value.trim().toLowerCase();
  const matches = (query ? pages.filter((page) =>
    page.title.toLowerCase().includes(query) ||
    page.type.toLowerCase().includes(query) ||
    page.text.toLowerCase().includes(query)
  ) : pages.slice(0, 12)).slice(0, 50);
  list.innerHTML = matches.map((page) =>
    '<li><a href="' + page.href + '">' + escapeHtml(page.title) + '</a> <span class="muted">' + escapeHtml(page.type) + '</span></li>'
  ).join("");
});
function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}
</script>`;
}

function countBy<T>(items: T[], keyFn: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyFn(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/---[\s\S]*?---/, "")
    .replace(/`{3}[\s\S]*?`{3}/g, " ")
    .replace(/[#>*_[\]()`~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "\"": return "&quot;";
      default: return "&#39;";
    }
  });
}
