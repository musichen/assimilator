import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { spawn } from "node:child_process";

export interface LinkedinConversionResult {
  markdown: string;
  title?: string;
  author?: string;
  warnings: string[];
}

export function isLinkedinUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return (
      host === "linkedin.com" ||
      host.endsWith(".linkedin.com") ||
      host === "lnkd.in"
    );
  } catch {
    return false;
  }
}

export async function convertLinkedinWithPuppeteer(
  url: string,
  options: { headless?: boolean; userDataDir?: string } = {}
): Promise<LinkedinConversionResult> {
  const { headless = true, userDataDir } = options;

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "assimilator-linkedin-"));
  const outputPath = path.join(tempDir, "result.json");

  const launchArgs: string[] = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-blink-features=AutomationControlled",
  ];

  if (userDataDir) {
    launchArgs.push(`--user-data-dir=${userDataDir}`);
    launchArgs.push("--profile-directory=Default");
  } else {
    launchArgs.push("--guest-session");
  }

  const scriptPath = path.join(tempDir, "scrape.js");

  const script = `
const puppeteer = require('puppeteer-core');
const chromeExecutable =
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' ||
  process.env.PUPPETEER_EXECUTABLE_PATH;

const launchOptions = {
  headless: ${headless},
  executablePath: chromeExecutable,
  args: ${JSON.stringify(launchArgs)},
};

(async () => {
  const browser = await puppeteer.launch(launchOptions).catch(() => null);
  if (!browser) {
    console.error(JSON.stringify({ error: "Browser launch failed" }));
    process.exit(1);
  }

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  // Mimic real browser
  await page.setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36"
  );

  const result = { warnings: [] };

  try {
    const response = await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

    if (!response || response.status() >= 400) {
      result.error = \`HTTP \${response?.status() ?? "no response"}\`;
      console.log(JSON.stringify(result));
      await browser.close();
      process.exit(0);
    }

    // Wait for content
    await page.waitForSelector("[data-entity-id], .feed-shared-update-v2, .occludable-content", {
      timeout: 15000
    }).catch(() => {
      result.warnings.push("Main content selector not found within 15s");
    });

    // Extract title
    const title = await page.title().catch(() => undefined);
    result.title = title || undefined;

    // Extract main article/post text
    const articleText = await page.evaluate(() => {
      const selectors = [
        ".feed-shared-update-v2",
        ".occludable-content",
        "[data-entity-id] article",
        ".share-body",
        ".attributed-text-segment-item__content",
      ];

      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.textContent.trim().length > 100) {
          return el.textContent.trim();
        }
      }

      // Fallback: read main content area
      const main = document.querySelector("main") || document.body;
      const paragraphs = Array.from(main.querySelectorAll("p, span, div"));
      return paragraphs
        .map(p => p.textContent.trim())
        .filter(t => t.length > 30)
        .slice(0, 50)
        .join("\\n");
    });

    // Extract author
    const author = await page.evaluate(() => {
      const authorEl = document.querySelector(
        ".feed-shared-actor__name, .update-components-actor__name, .presence-entity__name"
      );
      return authorEl ? authorEl.textContent.trim() : undefined;
    });

    result.author = author || undefined;
    result.markdown = articleText || "";

    if (!result.markdown) {
      result.warnings.push("No article text extracted — page may require login");
    }

    console.log(JSON.stringify(result));
  } catch (err) {
    result.error = err.message;
    console.log(JSON.stringify(result));
  } finally {
    await browser.close();
  }
})();
  `.trim();

  await fs.writeFile(scriptPath, script);

  const warnings: string[] = [];

  try {
    const output = await runNode(scriptPath, tempDir);

    let parsed: {
      title?: string;
      author?: string;
      markdown?: string;
      warnings?: string[];
      error?: string;
    };

    try {
      parsed = JSON.parse(output);
    } catch {
      throw new Error(`Failed to parse LinkedIn scraper output: ${output.slice(0, 200)}`);
    }

    if (parsed.error) {
      throw new Error(parsed.error);
    }

    warnings.push(...(parsed.warnings || []));

    const title = parsed.title || slugifyUrl(url);
    const author = parsed.author;

    // Build markdown
    const lines: string[] = [];
    lines.push(`# ${title}`);
    lines.push("");
    lines.push("## Source");
    lines.push(`- URL: ${url}`);
    if (author) lines.push(`- Author: ${author}`);
    lines.push("");
    lines.push("## Content");
    lines.push("");

    const content = parsed.markdown || "";
    if (content) {
      const paragraphs = content.split(/\n\n+/).filter(Boolean);
      for (const p of paragraphs) {
        lines.push(p.trim());
        lines.push("");
      }
    } else {
      lines.push("*No content extracted. LinkedIn may require login.*");
      lines.push("");
    }

    return {
      markdown: lines.filter(Boolean).join("\n"),
      title,
      author,
      warnings,
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

function slugifyUrl(url: string): string {
  try {
    const u = new URL(url);
    const slug = (u.pathname + u.search)
      .replace(/\//g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80);
    return slug || u.hostname;
  } catch {
    return "linkedin-post";
  }
}

async function runNode(scriptPath: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [scriptPath],
      { cwd, stdio: ["ignore", "pipe", "pipe"] }
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });

    child.on("error", (err) => reject(new Error(`Node failed: ${err.message}`)));

    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(stderr.trim() || `Node exited with code ${code}`));
      }
    });

    setTimeout(() => {
      child.kill();
      reject(new Error("Puppeteer script timed out after 60s"));
    }, 60_000);
  });
}