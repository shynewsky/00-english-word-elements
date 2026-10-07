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
await writeFile(path.join(dist, 'build-meta.json'), JSON.stringify({ builtAt: new Date().toISOString(), source: 'data/catalog.json' }, null, 2));
console.log(`Prepared GitHub Pages artifact at ${dist}`);
