import React, { useState } from "react";
import { Box, Text, useApp } from "ink";
import TextInput from "ink-text-input";
import SelectInput from "ink-select-input";
import { convertAnything, type ConvertResult } from "../core/convert.js";
import { webscrapeFetch, webscrapeDetect, webscrapeHealth, webscrapeStats } from "../core/webscrape.js";
import type { WebscrapeFetchResult, ProtectionResult, WebscrapeStats } from "../core/webscrape.js";
import {
  youtubeToMp3, youtubePlaylistToMp3,
  type YoutubeMp3Result, type YoutubePlaylistMp3Result,
} from "../converters/youtube-mp3.js";
import path from "node:path";

type Mode = (
  "menu" | "file" | "url" | "done"
  | "scrape-fetch" | "scrape-detect" | "scrape-stats" | "scrape-health" | "scrape-done"
  | "yt-mp3" | "yt-playlist-mp3" | "yt-mp3-done"
);

interface Props {
  workspace: string;
}

const mp3OutputDir = path.join(process.cwd(), "results", "mp3");

export function AssimilatorTui({ workspace }: Props) {
  const { exit } = useApp();
  const [mode, setMode] = useState<Mode>("menu");
  const [value, setValue] = useState("");
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<ConvertResult | null>(null);
  const [scrapeResult, setScrapeResult] = useState<WebscrapeFetchResult | null>(null);
  const [protectResult, setProtectResult] = useState<ProtectionResult | null>(null);
  const [statsResult, setStatsResult] = useState<WebscrapeStats | null>(null);
  const [healthMsg, setHealthMsg] = useState("");
  const [ytMp3Result, setYtMp3Result] = useState<YoutubeMp3Result | null>(null);
  const [ytPlaylistResult, setYtPlaylistResult] = useState<YoutubePlaylistMp3Result | null>(null);

  async function runConversion(kind: "file" | "url", input: string) {
    setStatus(`Converting ${input}...`);
    try {
      const converted = await convertAnything({
        workspace,
        filePath: kind === "file" ? input : undefined,
        url: kind === "url" ? input : undefined
      });
      setResult(converted);
      setStatus("Conversion complete.");
      setMode("done");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setMode("menu");
    }
  }

  async function runYtMp3(url: string) {
    setStatus("Downloading & converting to MP3...");
    try {
      const r = await youtubeToMp3(url, mp3OutputDir, (msg) => setStatus(msg));
      setYtMp3Result(r);
      setStatus("");
      setMode("yt-mp3-done");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setMode("menu");
    }
  }

  async function runYtPlaylistMp3(url: string) {
    setStatus("Fetching playlist...");
    try {
      const r = await youtubePlaylistToMp3(url, mp3OutputDir, (msg) => setStatus(msg));
      setYtPlaylistResult(r);
      setStatus("");
      setMode("yt-mp3-done");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setMode("menu");
    }
  }

  async function runScrapeFetch(url: string) {
    setStatus(`Fetching ${url}...`);
    setScrapeResult(await webscrapeFetch(url));
    setStatus("");
    setMode("scrape-done");
  }

  async function runScrapeDetect(url: string) {
    setStatus(`Scanning ${url}...`);
    setProtectResult(await webscrapeDetect(url));
    setStatus("");
    setMode("scrape-done");
  }

  async function runScrapeHealth() {
    setStatus("Checking bridge...");
    const h = await webscrapeHealth();
    setHealthMsg(h.message);
    setStatus("");
    setMode("scrape-done");
  }

  function showScrapeStats() {
    setStatsResult(webscrapeStats());
    setMode("scrape-done");
  }

  if (mode === "menu") {
    return (
      <Box flexDirection="column">
        <Text color="cyan" bold>ASSIMILATOR</Text>
        <Text>Convert files/URLs to Markdown, webscraping, or YouTube→MP3.</Text>
        {status ? <Text color="yellow">{status}</Text> : null}
        <SelectInput
          items={[
            { label: "Convert file", value: "file" },
            { label: "Convert URL", value: "url" },
            { label: "YouTube → MP3 (single)", value: "yt-mp3" },
            { label: "YouTube Playlist → MP3", value: "yt-playlist-mp3" },
            { label: "Webscrape: Fetch URL", value: "scrape-fetch" },
            { label: "Webscrape: Detect protection", value: "scrape-detect" },
            { label: "Webscrape: Stats", value: "scrape-stats" },
            { label: "Webscrape: Health check", value: "scrape-health" },
            { label: "Quit", value: "quit" }
          ]}
          onSelect={(item) => {
            if (item.value === "quit") { exit(); return; }
            if (item.value === "scrape-stats") { showScrapeStats(); return; }
            if (item.value === "scrape-health") { runScrapeHealth(); return; }
            setValue("");
            setMode(item.value as Mode);
          }}
        />
      </Box>
    );
  }

  if (mode === "file" || mode === "url") {
    return (
      <Box flexDirection="column">
        <Text color="cyan" bold>{mode === "file" ? "File path" : "URL"}</Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={(input) => void runConversion(mode, input)}
        />
        {status ? <Text color="yellow">{status}</Text> : null}
      </Box>
    );
  }

  if (mode === "yt-mp3") {
    return (
      <Box flexDirection="column">
        <Text color="cyan" bold>YouTube → MP3</Text>
        <Text>Enter a YouTube video URL to convert to MP3</Text>
        <TextInput value={value} onChange={setValue} onSubmit={(url) => void runYtMp3(url)} />
        {status ? <Text color="yellow">{status}</Text> : null}
      </Box>
    );
  }

  if (mode === "yt-playlist-mp3") {
    return (
      <Box flexDirection="column">
        <Text color="cyan" bold>YouTube Playlist → MP3</Text>
        <Text>Enter a YouTube playlist URL to convert all items to MP3</Text>
        <TextInput value={value} onChange={setValue} onSubmit={(url) => void runYtPlaylistMp3(url)} />
        {status ? <Text color="yellow">{status}</Text> : null}
      </Box>
    );
  }

  if (mode === "scrape-fetch") {
    return (
      <Box flexDirection="column">
        <Text color="cyan" bold>Webscrape: Fetch URL</Text>
        <Text>Enter URL to fetch through HTTP→Stealthy→Dynamic→Chrome</Text>
        <TextInput value={value} onChange={setValue} onSubmit={(url) => void runScrapeFetch(url)} />
        {status ? <Text color="yellow">{status}</Text> : null}
      </Box>
    );
  }

  if (mode === "scrape-detect") {
    return (
      <Box flexDirection="column">
        <Text color="cyan" bold>Webscrape: Detect Protection</Text>
        <Text>Enter URL to check anti-bot/WAF protection</Text>
        <TextInput value={value} onChange={setValue} onSubmit={(url) => void runScrapeDetect(url)} />
        {status ? <Text color="yellow">{status}</Text> : null}
      </Box>
    );
  }

  // ── Results screens ──────────────────────────────────────────────────

  if (mode === "done") {
    return (
      <Box flexDirection="column">
        <Text color="green" bold>{status}</Text>
        {result ? (
          <>
            <Text>Title: {result.title}</Text>
            <Text>Markdown: {result.markdownPath}</Text>
            <Text>HTML: {result.htmlPath}</Text>
          </>
        ) : null}
        <SelectInput
          items={[
            { label: "Convert another", value: "again" },
            { label: "Quit", value: "quit" }
          ]}
          onSelect={(item) => {
            if (item.value === "quit") { exit(); return; }
            setMode("menu");
            setStatus("");
          }}
        />
      </Box>
    );
  }

  if (mode === "yt-mp3-done") {
    return (
      <Box flexDirection="column">
        {status ? <Text color="yellow">{status}</Text> : null}
        {ytMp3Result ? (
          <>
            <Text color="green" bold>✅ MP3 ready</Text>
            <Text>🎵 {ytMp3Result.title}</Text>
            <Text>📁 {ytMp3Result.filePath}</Text>
            <Text>📦 {(ytMp3Result.size / 1024 / 1024).toFixed(1)} MB</Text>
          </>
        ) : ytPlaylistResult ? (
          <>
            <Text color="green" bold>✅ Playlist complete</Text>
            <Text>🎵 {ytPlaylistResult.items.length} converted, {ytPlaylistResult.errors.length} failed</Text>
            {ytPlaylistResult.items.map((item, i) => (
              <Text key={i}>  🎵 {item.title} ({(item.size / 1024 / 1024).toFixed(1)} MB)</Text>
            ))}
            {ytPlaylistResult.errors.map((err, i) => (
              <Text key={`e${i}`} color="red">  ❌ {err.title}: {err.error}</Text>
            ))}
          </>
        ) : null}
        <SelectInput
          items={[
            { label: "Back to menu", value: "again" },
            { label: "Quit", value: "quit" }
          ]}
          onSelect={(item) => {
            if (item.value === "quit") { exit(); return; }
            setMode("menu");
            setStatus("");
            setYtMp3Result(null);
            setYtPlaylistResult(null);
          }}
        />
      </Box>
    );
  }

  if (mode === "scrape-done") {
    return (
      <Box flexDirection="column">
        {healthMsg ? (
          <>
            <Text color="cyan" bold>Health Check</Text>
            <Text>{healthMsg}</Text>
          </>
        ) : statsResult ? (
          <>
            <Text color="cyan" bold>Protection Stats</Text>
            <Text>Events: {statsResult.totalEvents}</Text>
            {Object.entries(statsResult.summary).map(([type, info]) => (
              <Text key={type}>  {type}: {info.count}x ({info.tiers.join(", ")})</Text>
            ))}
          </>
        ) : protectResult ? (
          <>
            <Text color="cyan" bold>Detection Result</Text>
            {protectResult.detected ? (
              <Text>🛡️ {protectResult.type} ({protectResult.confidence}) — status {protectResult.status}</Text>
            ) : (
              <Text>✅ No protection detected (status {protectResult.status})</Text>
            )}
          </>
        ) : scrapeResult ? (
          <>
            <Text color="cyan" bold>Fetch Result</Text>
            {scrapeResult.success ? (
              <>
                <Text>✅ {scrapeResult.tier} tier | {scrapeResult.status} | {scrapeResult.elapsedMs}ms</Text>
                <Text>Size: {scrapeResult.bodyLength} bytes</Text>
                {scrapeResult.title ? <Text>Title: {scrapeResult.title}</Text> : null}
                {scrapeResult.protection ? <Text>Protection: {scrapeResult.protection}</Text> : null}
              </>
            ) : (
              <Text color="red">❌ {scrapeResult.error}</Text>
            )}
          </>
        ) : null}
        <SelectInput
          items={[
            { label: "Back to menu", value: "again" },
            { label: "Quit", value: "quit" }
          ]}
          onSelect={(item) => {
            if (item.value === "quit") { exit(); return; }
            setMode("menu");
            setStatus("");
            setScrapeResult(null);
            setProtectResult(null);
            setStatsResult(null);
            setHealthMsg("");
          }}
        />
      </Box>
    );
  }

  // fallback
  return <Text>Unknown mode: {mode}</Text>;
}
