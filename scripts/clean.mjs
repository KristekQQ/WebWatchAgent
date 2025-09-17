// @ts-check
import { promises as fs } from 'fs';
import path from 'path';

const ROOT = process.cwd();
const responses = path.join(ROOT, 'responses');
const requests = path.join(ROOT, 'requests');

async function emptyDir(dir, keepGitkeep = true) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (keepGitkeep && e.name === '.gitkeep') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        await fs.rm(p, { recursive: true, force: true });
      } else {
        await fs.rm(p, { force: true });
      }
    }
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
}

await emptyDir(responses, true);
await emptyDir(requests, true);
await fs.mkdir(path.join(requests, 'processing'), { recursive: true });

// re-create .gitkeep files if missing
const touch = async (p) => fs.writeFile(p, '', { flag: 'a' });
await touch(path.join(responses, '.gitkeep'));
await touch(path.join(requests, '.gitkeep'));
await touch(path.join(requests, 'processing', '.gitkeep'));

console.log('Cleaned responses/ and requests/');

