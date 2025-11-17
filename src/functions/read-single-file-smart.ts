// read-single-file-smart.ts
import * as path from 'path';
import * as fs from 'fs';
import { isSourceOrConfig } from './is-source-or-config';
import { getConfig } from '../config';  // ← your existing config.ts

export async function readSingleFileSmart(absPath: string, root: string, seen: Set<string>): Promise<string> {
  if (seen.has(absPath)) return '';
  seen.add(absPath);

  const rel = path.relative(root, absPath);
  if (!isSourceOrConfig(path.basename(absPath))) {
    return `File: ${rel} [skipped – not source/config]\n`;
  }

  try {
    const content = await fs.promises.readFile(absPath, 'utf8');
    const config = getConfig();
    const truncated = content.length > config.maxFileReadChars
      ? content.substring(0, config.maxFileReadChars) + '\n...[TRUNCATED]'
      : content;

    return `File: ${rel}\n  └─ ${truncated.split('\n').join('\n     ')}\n\n`;
  } catch {
    return `File: ${rel} [read error]\n\n`;
  }
}