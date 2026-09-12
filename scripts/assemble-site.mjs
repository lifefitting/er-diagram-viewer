import { access, copyFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const demoSource = '../docs/assets/er-demo.svg';
const demoPublished = './assets/er-demo.svg';

/** Assemble the same static directory for Pages and local previews. The SVG
 * stays a single source in docs/assets; only generated HTML URLs are changed. */
export async function assembleSite(outDir = resolve(root, 'site')) {
  const html = await readFile(resolve(root, 'landing/index.html'), 'utf8');
  if (!html.includes(`src="${demoSource}"`) || !html.includes(`href="${demoSource}"`)) {
    throw new Error('Landing demo asset references changed; update the site assembly mapping.');
  }
  // Fail before writing output if either required input is missing.
  await access(resolve(root, 'dist/index.html'));
  await access(resolve(root, 'docs/assets/er-demo.svg'));
  await cp(resolve(root, 'landing'), outDir, { recursive: true });
  const demoPath = resolve(outDir, demoPublished);
  await mkdir(dirname(demoPath), { recursive: true });
  await copyFile(resolve(root, 'docs/assets/er-demo.svg'), demoPath);
  await writeFile(resolve(outDir, 'index.html'), html.replaceAll(demoSource, demoPublished));
  await cp(resolve(root, 'dist'), resolve(outDir, 'app'), { recursive: true });
  return outDir;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`Static site ready: ${await assembleSite()}`);
}
