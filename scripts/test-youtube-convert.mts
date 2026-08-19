import { convertRemoteToMarkdown } from '/Users/musichen/apps/assimilator/apps/cli/src/converters/remote-converter.js';

async function main() {
  const url = process.argv[2] || 'https://www.youtube.com/watch?v=EkezmPpKdzo';
  console.log('Testing YouTube conversion for:', url);
  const r = await convertRemoteToMarkdown(url);
  console.log('SUCCESS | type:', r.sourceType, '| converter:', r.converter);
  console.log('title:', r.title);
  console.log('markdown length:', r.markdown.length);
  console.log('warnings:', JSON.stringify(r.warnings));
  console.log('--- head ---');
  console.log(r.markdown.slice(0, 600));
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
