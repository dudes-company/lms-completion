import * as vscode from 'vscode';
import * as path from 'path';
import { extractImports } from './extract-imports';
import { resolveImportPath } from './resolve-import-path';
import { readSingleFileSmart } from './read-single-file-smart';
import { findConfigFiles } from './find-config-files';
import { readDirectorySmart } from './read-directory-smart';
import { getModelMaxChars } from '../model-info'; // ← new

export async function readProjectContext(): Promise<string> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return 'NO_ACTIVE_EDITOR';

  const currentFile = editor.document.fileName;
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders?.length) return 'NO_WORKSPACE_OPEN';

  const root = workspaceFolders[0].uri.fsPath;
  const relPath = path.relative(root, currentFile);

  let context = `CURRENT FILE: ${relPath}\n\n`;
  context += `RELEVANT PROJECT CONTEXT (token-limited):\n\n`;

  const seen = new Set<string>();
  const addFile = (p: string) => seen.add(path.normalize(p));
  addFile(currentFile);

  const MAX_CHARS = await getModelMaxChars(); // ← THIS IS THE MAGIC
  let usedChars =  context.length;

  const tryAdd = (text: string): boolean => {
    if (usedChars + text.length > MAX_CHARS) return false;
    context += text;
    usedChars += text.length;
    return true;
  };

  // Priority 1: Same directory
  const dir = path.dirname(currentFile);
  const dirContent = await readDirectorySmart(dir, root, seen, 1);
  if (dirContent && !tryAdd(dirContent)) return context + `\n...[CONTEXT TRUNCATED FOR TOKEN LIMIT]`;

  // Priority 2: Direct imports
  const imports = extractImports(editor.document.getText(), currentFile);
  for (const imp of imports) {
    if (usedChars > MAX_CHARS * 0.9) break; // stop early
    const resolved = resolveImportPath(imp, currentFile, root);
    if (resolved && !seen.has(resolved)) {
      const fileContent = await readSingleFileSmart(resolved, root, seen);
      if (fileContent && !tryAdd(fileContent)) {
        context += `\n...[CONTEXT TRUNCATED FOR TOKEN LIMIT]`;
        break;
      }
    }
  }

  // Priority 3: Config files (only if room)
  if (usedChars < MAX_CHARS * 0.8) {
    const configFiles = findConfigFiles(root);
    for (const cfg of configFiles) {
      if (usedChars > MAX_CHARS * 0.9) break;
      if (!seen.has(cfg)) {
        const content = await readSingleFileSmart(cfg, root, seen);
        if (content) tryAdd(content);
      }
    }
  }

  if (usedChars >= MAX_CHARS) {
    context += `\n...[CONTEXT TRUNCATED – model limit reached]`;
  }

  return context;
}