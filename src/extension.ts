import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Refactored LM Studio VS Code extension
 * - Uses `lmstudio` configuration namespace (matches package.json)
 * - Safe endpoint construction (/v1/chat/completions)
 * - Timeout + retry logic
 * - Config change listener
 * - Improved project context reading with depth and size limits
 * - Logging and simple debug output
 * - Single command: `lmstudio.generateCode`
 */

interface Config {
  endpoint: string;
  model: string;
  maxTokens: number;
  temperature: number;
  timeout: number; // ms
  retries: number;
  debounceMs: number;
  contextLines: number;
  maxFileReadChars: number;
}

let cachedConfig: Config;

function loadConfig(): Config {
  const c = vscode.workspace.getConfiguration('lmstudio');
  const endpointRaw = (c.get<string>('endpoint') || 'http://127.0.0.1:1234').trim();
  const endpointBase = endpointRaw.endsWith('/') ? endpointRaw.slice(0, -1) : endpointRaw;

  return {
    endpoint: endpointBase,
    model: c.get<string>('model') || '',
    maxTokens: Number(c.get<number>('maxTokens') ?? 512),
    temperature: Number(c.get<number>('temperature') ?? 0.7),
    timeout: Number(c.get<number>('timeout') ?? 60000),
    retries: Number(c.get<number>('retries') ?? 1),
    debounceMs: Number(c.get<number>('debounceMs') ?? 500),
    contextLines: Number(c.get<number>('contextLines') ?? 50),
    maxFileReadChars: Number(c.get<number>('maxFileReadChars') ?? 1200),
  };
}

export function activate(context: vscode.ExtensionContext) {
  vscode.window.showInformationMessage('LM Studio extension (refactor) activated');

  cachedConfig = loadConfig();
  console.log('lmstudio: loaded config', cachedConfig);

  // Listen for config changes
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('lmstudio')) {
      cachedConfig = loadConfig();
      console.log('lmstudio: config updated', cachedConfig);
      vscode.window.showInformationMessage('LM Studio config updated');
    }
  }));

  // Command: generate code for selection only
  const disposable = vscode.commands.registerCommand('lmstudio.generateCode', async () => {
    try {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage('No active editor');
        return;
      }

      const selection = editor.selection;
      const selectedText = editor.document.getText(selection);

      if (!selectedText || selection.isEmpty) {
        vscode.window.showInformationMessage('No code selected. Please select code to generate replacement.');
        return; // Do not call API
      }

      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'LM Studio: generating code',
        cancellable: false
      }, async (progress) => {
        progress.report({ increment: 0, message: 'Collecting context...' });

        const projectContext = await readProjectContext();
        const currentFileContext = getCurrentFileContext(editor, cachedConfig.contextLines);

        progress.report({ increment: 20, message: 'Preparing prompt...' });
        const prompt = createPrompt(projectContext, currentFileContext, selectedText);

        progress.report({ increment: 20, message: 'Calling LM Studio...' });
        const generated = await callLMStudioWithRetries(prompt, cachedConfig);

        progress.report({ increment: 40, message: 'Inserting generated code...' });
        await replaceGeneratedCode(editor, generated, selection);

        progress.report({ increment: 100 });
        vscode.window.showInformationMessage('LM Studio: code inserted');
      });

    } catch (err) {
      console.error('lmstudio: error', err);
      vscode.window.showErrorMessage(`LM Studio error: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  context.subscriptions.push(disposable);
}

export function deactivate() {
  // nothing to cleanup currently
}

// ------------------------- Helpers -------------------------

async function readProjectContext(maxDepth = 3): Promise<string> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return 'NO_WORKSPACE_OPEN';

  let out = 'PROJECT STRUCTURE:\n\n';
  for (const f of folders) {
    out += `Root: ${f.uri.fsPath}\n`;
    out += await readDirectoryRecursive(f.uri.fsPath, f.uri.fsPath, 0, maxDepth);
  }
  return out;
}

async function readDirectoryRecursive(dirPath: string, rootPath: string, depth: number, maxDepth: number): Promise<string> {
  if (depth > maxDepth) return '';
  let result = '';
  try {
    const items = await fs.promises.readdir(dirPath, { withFileTypes: true });
    for (const item of items) {
      const fullPath = path.join(dirPath, item.name);
      const rel = path.relative(rootPath, fullPath);

      if (item.name === 'node_modules' || item.name === '.git' || item.name === 'dist' || item.name === 'build') continue;

      const indent = '  '.repeat(depth);
      if (item.isDirectory()) {
        result += `${indent}📁 ${rel}/\n`;
        result += await readDirectoryRecursive(fullPath, rootPath, depth + 1, maxDepth);
      } else {
        result += `${indent}📄 ${rel}\n`;
        if (shouldReadFile(item.name)) {
          try {
            const raw = await fs.promises.readFile(fullPath, 'utf8');
            const truncated = raw.length > cachedConfig.maxFileReadChars ? raw.substring(0, cachedConfig.maxFileReadChars) + '\n...[TRUNCATED]' : raw;
            result += `${indent}  Content:\n${indent}  ${truncated.split('\n').join('\n' + indent + '  ')}\n\n`;
          } catch {
            result += `${indent}  [Unable to read file]\n\n`;
          }
        }
      }
    }
  } catch {
    result += `[Unable to read directory ${dirPath}]\n`;
  }
  return result;
}

function shouldReadFile(name: string): boolean {
  const exts = ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.cpp', '.c', '.h', '.cs', '.php', '.rb', '.go', '.rs', '.swift'];
  const configs = ['package.json', 'requirements.txt', 'Cargo.toml', 'go.mod', 'pom.xml', 'build.gradle'];
  return exts.some(e => name.endsWith(e)) || configs.includes(name);
}

function getCurrentFileContext(editor: vscode.TextEditor, contextLines = 50): string {
  const doc = editor.document;
  const cursor = editor.selection.active;
  const fullText = doc.getText();
  const lines = fullText.split('\n');

  const half = Math.floor(contextLines / 2);
  const start = Math.max(0, cursor.line - half);
  const end = Math.min(lines.length - 1, cursor.line + half);

  let out = `CURRENT FILE: ${path.basename(doc.fileName)}\n`;
  for (let i = start; i <= end; i++) {
    const prefix = i === cursor.line ? '>>> ' : '    ';
    out += prefix + lines[i] + '\n';
  }
  return out;
}

function createPrompt(projectContext: string, currentFileContext: string, selectedCode: string): string {
  return `Analyze the project structure and current file context, then generate appropriate  code for the selected snippet.\n\n${projectContext}\n\n${currentFileContext}\n\nSELECTED CODE:\n${selectedCode}\n\nINSTRUCTIONS:\n1) Write only the code — no explanations.\n2) Keep style consistent with the codebase.\n3) Provide working, syntactically-correct code.`;
}

// ------------------------- LM Studio call with retries -------------------------

async function callLMStudioWithRetries(prompt: string, config: Config): Promise<string> {
  let lastErr: any = null;
  for (let attempt = 0; attempt <= config.retries; attempt++) {
    try {
      return await callLMStudio(prompt, config);
    } catch (e) {
      lastErr = e;
      console.warn(`lmstudio: attempt ${attempt} failed:`, e);
      if (attempt < config.retries) await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  throw lastErr;
}

async function callLMStudio(prompt: string, config: Config): Promise<string> {
  const messages = [
    { role: 'system', content: 'Write only the code, no explanations or invalid text.' },
    { role: 'user', content: prompt }
  ];

  const body: any = {
    model: config.model || undefined,
    messages,
    max_tokens: config.maxTokens,
    temperature: config.temperature,
    stream: false,
    stop: []
  };

  const url = `${config.endpoint}/v1/chat/completions`;
  console.log('lmstudio: POST', url);
  console.log('lmstudio: request body preview', JSON.stringify({ ...body, messages: '[omitted]' }));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeout);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status} - ${res.statusText} - ${text}`);
    }

    const data: any = await res.json();
    if (data.choices && data.choices.length > 0) {
      return String(data.choices[0].message?.content ?? data.choices[0].text ?? '').trim();
    }

    if (data.text) return String(data.text).trim();

    throw new Error('No content in LM Studio response');
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`LM Studio request timed out after ${config.timeout}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// ------------------------- Replace selected code -------------------------

async function replaceGeneratedCode(editor: vscode.TextEditor, generated: string, selection: vscode.Selection) {
  const cleaned = cleanAIOutput(generated); // CLEAN BEFORE INSERTING
  await editor.edit(editBuilder => {
    editBuilder.replace(selection, cleaned);
  });
}
/**
 * Cleans AI-generated output:
 * - Removes code fences (``` or ```lang)
 * - Returns only the code, discarding trailing explanations
 * - Trims whitespace
 *
 * @param aiOutput Raw AI-generated string
 * @returns Clean code
 */
function cleanAIOutput(aiOutput: string): string {
  if (!aiOutput) return '';

  // Match first code block between ```
  const codeBlockMatch = aiOutput.match(/```[\w]*\n([\s\S]*?)```/);
  if (codeBlockMatch && codeBlockMatch[1]) {
    return codeBlockMatch[1].trim();
  }

  // No code fences: take first code-like lines (up to double newline or explanation)
  const lines = aiOutput.split('\n');
  const codeLines: string[] = [];
  for (const line of lines) {
    // Stop at a clearly explanatory line
    if (line.match(/^(In this|This solution|Explanation|Note|Summary)/i)) break;
    codeLines.push(line);
  }

  return codeLines.join('\n').trim();
}

