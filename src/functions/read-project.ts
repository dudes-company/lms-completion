// read-project.ts — CLEAN + CONFIGS FOR ALL LANGUAGES
import * as vscode from 'vscode';
import * as path from 'path';
import { extractImports } from './extract-imports';
import { resolveImportPath } from './resolve-import-path';
import { readSingleFileSmart } from './read-single-file-smart';
import { getModelMaxChars } from '../model-info';

const ROOT_CONFIG_FILES = [
  // Universal / Multi-lang
  'package.json',           // npm/yarn/pnpm/bun

  // TypeScript / JavaScript
  'tsconfig.json',
  'jsconfig.json',
  'vite.config.ts',
  'vite.config.js',
  'next.config.js',
  'next.config.mjs',

  // Python
  'pyproject.toml',
  'requirements.txt',
  'setup.py',
  'Pipfile',

  // Rust
  'Cargo.toml',

  // Go
  'go.mod',
  'go.sum',

  // Java / Kotlin / Scala
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',

  // Ruby
  'Gemfile',
  'Rakefile',

  // PHP
  'composer.json',

  // C# / .NET
  'Directory.Packages.props',
  '*.csproj',

  // Misc
  '.env.example',
  'Dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
];

export async function readProjectContext(): Promise<string> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return 'NO_ACTIVE_EDITOR';

  const currentFile = editor.document.fileName;
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders?.length) return 'NO_WORKSPACE_OPEN';

  const root = workspaceFolders[0].uri.fsPath;
  const relPath = path.relative(root, currentFile);

  let context = `CURRENT FILE: ${relPath}\n\n`;
  const seen = new Set<string>();
  const MAX_CHARS = await getModelMaxChars();
  let usedChars = context.length;

  const add = (text: string): boolean => {
    if (usedChars + text.length > MAX_CHARS) return false;
    context += text;
    usedChars += text.length;
    return true;
  };

  // 1. Current file (always first)
  seen.add(path.normalize(currentFile));
  const currentContent = await readSingleFileSmart(currentFile, root, seen);
  if (!add(currentContent)) {
    return context + `\n...[TRUNCATED: current file too large]`;
  }

  // 2. Recursively follow imports
  const queue: string[] = [currentFile];

  while (queue.length > 0 && usedChars < MAX_CHARS * 0.92) {
    const file = queue.shift()!;
    let code: string;
    try {
      code = await vscode.workspace.openTextDocument(file).then(d => d.getText());
    } catch {
      continue;
    }

    const imports = extractImports(code, file);
    for (const imp of imports) {
      const resolved = resolveImportPath(imp, file, root);
      if (!resolved || seen.has(resolved)) continue;

      seen.add(resolved);
      const content = await readSingleFileSmart(resolved, root, seen);
      if (content.includes('[skipped') || content.includes('[read error]')) continue;

      if (!add(content)) {
        context += `\n...[TRUNCATED: token limit reached during import crawl]`;
        queue.length = 0;
        break;
      }
      queue.push(resolved); // depth-first-ish, but safe
    }
  }

  // 3. Add root config/manifest files — only if we have room
  if (usedChars < MAX_CHARS * 0.88) {
    context += `PROJECT CONFIGS & MANIFESTS:\n\n`;

    for (const configName of ROOT_CONFIG_FILES) {
      if (usedChars > MAX_CHARS * 0.95) break;

      const fullPath = path.join(root, configName);
      if (seen.has(fullPath) || !require('fs').existsSync(fullPath)) continue;

      // Special case: skip huge lockfiles unless tiny
      if (['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'poetry.lock', 'Cargo.lock', 'go.sum'].includes(configName)) {
        const stats = require('fs').statSync(fullPath);
        if (stats.size > 100_000) {
          context += `File: ${configName} [large lockfile skipped – ${(stats.size/1024).toFixed(0)} KB]\n\n`;
          continue;
        }
      }

      seen.add(fullPath);
      const content = await readSingleFileSmart(fullPath, root, seen);
      if (content) add(content);
    }
  }

  if (usedChars >= MAX_CHARS) {
    context += `\n...[FINAL TRUNCATION – context window full]`;
  }

  return context;
}