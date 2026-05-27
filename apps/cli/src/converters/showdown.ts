import { JSDOM } from "jsdom";
import showdown from "showdown";

export function createShowdownConverter(): showdown.Converter {
  return new showdown.Converter({
    tables: true,
    strikethrough: true,
    tasklists: true,
    simplifiedAutoLink: true,
    ghCompatibleHeaderId: true
  });
}

export function markdownToHtml(markdown: string): string {
  return createShowdownConverter().makeHtml(markdown);
}

export function htmlToMarkdown(html: string): string {
  const dom = new JSDOM(html);
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;

  try {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: dom.window
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: dom.window.document
    });
    return createShowdownConverter()
      .makeMarkdown(html)
      .replace(/<!--\s*-->/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  } finally {
    restoreGlobal("window", previousWindow);
    restoreGlobal("document", previousDocument);
    dom.window.close();
  }
}

function restoreGlobal(name: "window" | "document", previousValue: unknown): void {
  if (previousValue === undefined) {
    Reflect.deleteProperty(globalThis, name);
    return;
  }
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: previousValue
  });
}
