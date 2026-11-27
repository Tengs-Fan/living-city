// Bundle the viewer into single files that need no server:
//   dist/living-city.html   a whole page, to open from disk
//   dist/artifact.html      the same page without its document shell, for hosts that add their own
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const html = await readFile(new URL('viewer/index.html', root), 'utf8');
const between = (name) => html.split(`<!-- ${name}:start -->`)[1].split(`<!-- ${name}:end -->`)[0].trim();
const out = await build({
  entryPoints: [new URL('viewer/main.js', root).pathname],
  bundle: true, format: 'iife', minify: true, write: false, target: 'es2020',
});
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const body = between('body').replace(/<script type="module" src="\.\/main\.js"><\/script>/, () => `<script>\n${js}</script>`);
if (!body.includes(js)) throw new Error('the viewer page no longer loads ./main.js');
await mkdir(new URL('dist/', root), { recursive: true });
await writeFile(new URL('dist/artifact.html', root), `${between('head')}\n${body}\n`);
await writeFile(new URL('dist/living-city.html', root),
  `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${between('head')}\n</head>\n<body>\n${body}\n</body>\n</html>\n`);
console.log(`dist/living-city.html and dist/artifact.html written (${Math.round(js.length / 1024)} KB of script)`);
