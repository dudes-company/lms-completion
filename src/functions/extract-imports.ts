import * as path from 'path';
import { langsExt } from '../file-extensions';
export function extractImports(code: string, filePath: string): string[] {
  const ext = path.extname(filePath).toLowerCase();
  const imports: string[] = [];

  if (langsExt.includes(ext)) {
    // import ... from 'xyz' or require('xyz')
    const matches = code.matchAll(/(?:import|require\()\s*['"](.+?)['"]/g);
    for (const m of matches) {imports.push(m[1]);}
  } else if (ext === '.py') {
    const matches = code.matchAll(/(?:import|from)\s+([\w\.]+)|import\s+['"](.+?)['"]/g);
    for (const m of matches) {imports.push(m[1] || m[2]);}
  }
  // add more languages if you want

  return [...new Set(imports.filter(Boolean))];
}