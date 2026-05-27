# Converter Strategy

ASSIMILATOR should not depend on one converter being perfect.

Current chain:

```txt
Local Markdown/TXT/HTML
-> internal local adapters

Rich local files
-> markit-ai
-> project-local Microsoft markitdown CLI fallback

YouTube URLs
-> project-packaged yt-dlp subtitles/transcripts
-> markit-ai
-> project-local Microsoft markitdown CLI fallback

For YouTube, ASSIMILATOR asks `yt-dlp` for metadata so saved outputs use the video title instead of generic names such as `youtube.md`.

Generic URLs
-> markit-ai
-> project-local Microsoft markitdown CLI fallback

Markdown to HTML
-> Showdown
```

## Keys

No API key is needed for ordinary document conversion, HTML conversion, many URL conversions, or YouTube transcript extraction when captions are available through `yt-dlp`.

API keys or external services may be needed for:

- image descriptions in `markit-ai`
- audio transcription in `markit-ai`
- MarkItDown audio transcription via Google Speech Recognition
- OCR/vision plugins that use LLM providers

## Tool Assessment

`showdown` is good for Markdown to HTML and usable for HTML to Markdown imports with a DOM bridge. It is not a semantic article cleaner or OCR engine.

`markit-ai` is convenient as a Node dependency and covers many common formats, but media conversion relies on LLM provider configuration.

Microsoft `markitdown` is broader and mature for file-to-Markdown workflows, especially as a Python CLI fallback. It has optional extras for YouTube, audio, OCR, and plugins.

`yt-dlp` is the best first attempt for YouTube because it can extract available subtitles without asking an LLM to listen to the audio.

## Portable Dependencies

ASSIMILATOR does not rely on globally installed `yt-dlp`.

`yt-dlp` is provided by the Node dependency `yt-dlp-exec`.

Microsoft MarkItDown is a Python dependency managed by the project:

```bash
pnpm setup:python-tools
```

This creates `.venv/` and installs `python/requirements.txt`.

The converter looks for MarkItDown in this order:

1. `ASSIMILATOR_MARKITDOWN_BIN`
2. `.venv/bin/markitdown`

It does not silently depend on a global `markitdown`.
