import * as path from 'path';
import * as fs from 'fs';
import { readSingleFileSmart } from './read-single-file-smart';
import { isSourceOrConfig } from './is-source-or-config';
export async function readDirectorySmart(dirPath: string, root: string, seen: Set<string>, depth: number): Promise<string> {
  if (depth > 1) {return '';}
  let out = '';
  try {
    const items = await fs.promises.readdir(dirPath, { withFileTypes: true });
    for (const item of items) {
      if (item.name.startsWith('.') || ['node_modules', '.git', 'dist', 'build', '__pycache__'].includes(item.name)) continue;

      const full = path.join(dirPath, item.name);
      const rel = path.relative(root, full);

      if (item.isDirectory()) {
        out += `📁 ${rel}/\n`;
      } else if (isSourceOrConfig(item.name) && !seen.has(full)) {
        out += await readSingleFileSmart(full, root, seen);
      }
    }
  } catch {}
  return out;
}