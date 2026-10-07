import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, 'data'), { recursive: true });
for (const file of ['index.html', '404.html', 'styles.css', 'app.js', '.nojekyll']) {
  await cp(path.join(root, file), path.join(dist, file));
}
await cp(path.join(root, 'data', 'catalog.json'), path.join(dist, 'data', 'catalog.json'));
await cp(path.join(root, 'data', 'imported-words.json'), path.join(dist, 'data', 'imported-words.json'));
await writeFile(path.join(dist, 'build-meta.json'), JSON.stringify({ builtAt: new Date().toISOString(), sources: ['data/catalog.json', 'data/imported-words.json'] }, null, 2));
console.log(`Prepared GitHub Pages artifact at ${dist}`);
