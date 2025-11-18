import path = require("path");
import fs = require("fs");
import { langsExt } from "../file-extensions";

export function resolveImportPath(imp: string, fromFile: string, root: string): string | null {
  const dir = path.dirname(fromFile);

  // relative
  if (imp.startsWith('./') || imp.startsWith('../')) {
    let candidate = path.resolve(dir, imp);
    if (!path.extname(candidate)) {
      // try common extensions
      for (const ext of langsExt) {
        const withExt = candidate + ext;
        if (fs.existsSync(withExt)) { return withExt; }
        const index = path.join(withExt, 'index.ts');
        if (fs.existsSync(index)) { return index; }
      }
    }
    return fs.existsSync(candidate) ? candidate : null;
  }

  // node_modules or absolute – skip for now (too big, not worth it)
  if (imp.startsWith('node_modules') || !imp.includes('/')) { return null; }

  // scoped or deep package – just return null, we don't want vendor code
  return null;
}