import { describe, expect, it } from "vitest";
import { isUsableYoutubeTranscript } from "../src/converters/remote-converter.js";

describe("remote converter safeguards", () => {
  it("keeps generic YouTube pages from masquerading as transcripts", async () => {
    const generic = [
      "# YouTube",
      "",
      "[YouTube](/)",
      "[Info](https://www.youtube.com/about/)",
      "© 2026 Google LLC"
    ].join("\n");
    expect(isUsableYoutubeTranscript(generic)).toBe(false);
    expect(isUsableYoutubeTranscript("# Video\n\n## Transcript\n\nThis is a real transcript with useful spoken text.")).toBe(true);
  });
});
