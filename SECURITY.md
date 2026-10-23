# Security Policy

## Reporting a vulnerability

Open a GitHub issue in this repository for non-sensitive reports. For a sensitive vulnerability, contact the maintainer privately first through the GitHub profile at https://github.com/musichen instead of posting details publicly.

## Notes for users

- Keep your `.env` file private. It holds secrets such as `BOT_key` (the Telegram bot token) and local paths like `ASSIMILATOR_WORKSPACE`. Never commit `.env`; start from `.env.example` instead.
- The Telegram bot can convert URLs and uploaded files for anyone who can message it. Run it only for accounts you trust.
- Converted output lands under `knowledge-system/converted/` by default. Review downloaded or converted content before opening it, as with any downloaded file.
