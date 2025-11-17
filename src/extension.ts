// src/extension.ts
import * as vscode from 'vscode';
import * as path from 'path';

// ──────────────────────────────────────────────────────────────
// Your existing smart context reader (uses all your current files)
// ──────────────────────────────────────────────────────────────
import { readProjectContext } from './functions/read-project';

// ──────────────────────────────────────────────────────────────
// Config (you already have config.ts – we just use it)
// ──────────────────────────────────────────────────────────────
import { getConfig, refreshConfig } from './config';
import { GhostCompletionProvider } from './inline-completion-provider';
import { cleanOutput } from './functions/clean-output';

export function activate(context: vscode.ExtensionContext) {
  vscode.window.showInformationMessage('LM Studio extension activated');
  vscode.window.showInformationMessage('LM Studio extension ready – local models loaded');

  let config = getConfig();
  console.log('lmstudio: loaded config', config);
  const ghostProvider = new GhostCompletionProvider();
  // Refresh config when user changes settings
  context.subscriptions.push(
    vscode.languages.registerInlineCompletionItemProvider({ pattern: "**" }, ghostProvider),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('lmstudio')) {
        refreshConfig();
        config = getConfig();
        console.log('lmstudio: config updated', config);
        vscode.window.showInformationMessage('LM Studio config updated');
      }
    })
  );

  const disposable = vscode.commands.registerCommand('lmstudio.generateCode', async () => {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
      vscode.window.showErrorMessage('No active editor');
      return;
    }

    const selection = editor.selection;
    if (selection.isEmpty) {
      vscode.window.showInformationMessage('Select some code first!');
      return;
    }

    const selectedText = editor.document.getText(selection);

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'LM Studio: generating...',
        cancellable: true,
      },
      async progress => {
        try {
          progress.report({ increment: 10, message: 'Reading project context...' });
          const projectContext = await readProjectContext(); // ← smart version

          progress.report({ increment: 30, message: 'Building prompt...' });
          const currentFileContext = getCurrentFileContext(editor, config.contextLines);
          const prompt = createPrompt(projectContext, currentFileContext, selectedText);

          progress.report({ increment: 50, message: 'Calling local model...' });
          const raw = await callLMStudioWithRetries(prompt, config);

          progress.report({ increment: 90, message: 'Inserting code...' });
          await replaceGeneratedCode(editor, raw, selection);

          vscode.window.showInformationMessage('Code generated & inserted');
        } catch (err: any) {
          console.error('lmstudio error:', err);
          vscode.window.showErrorMessage(`LM Studio failed: ${err.message || err}`);
        }
      }
    );
  });

  context.subscriptions.push(disposable);
}

export function deactivate() { }

// ──────────────────────── Helpers ────────────────────────

function getCurrentFileContext(editor: vscode.TextEditor, contextLines = 50): string {
  const doc = editor.document;
  const cursor = editor.selection.active;
  const lines = doc.getText().split('\n');

  const half = Math.floor(contextLines / 2);
  const start = Math.max(0, cursor.line - half);
  const end = Math.min(lines.length - 1, cursor.line + half);

  let out = `CURRENT FILE: ${path.basename(doc.fileName)}\n`;
  for (let i = start; i <= end; i++) {
    const prefix = i === cursor.line ? '>>> ' : '    ';
    out += `${prefix}${lines[i]}\n`;
  }
  return out;
}

function createPrompt(projectContext: string, currentFileContext: string, selectedCode: string): string {
  return `You are an expert developer. Replace the selected code with better, cleaner, or fixed code that perfectly fits this project.

PROJECT CONTEXT:
${projectContext}

CURRENT FILE SNIPPET:
${currentFileContext}

SELECTED CODE TO REPLACE:
${selectedCode}

INSTRUCTIONS:
- Output ONLY the raw code, no explanations, no markdown fences,no comments in code, no extra text.
- Match the exact coding style and formatting of the surrounding code.
- Make it syntactically correct and ready to run.`;
}

// ──────────────────────── LM Studio API ────────────────────────

async function callLMStudioWithRetries(prompt: string, config: any): Promise<string> {
  let lastError: any;
  for (let i = 0; i <= config.retries; i++) {
    try {
      return await callLMStudio(prompt, config);
    } catch (e) {
      lastError = e;
      if (i < config.retries) await new Promise(r => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw lastError;
}

async function callLMStudio(prompt: string, config: any): Promise<string> {
  const url = `${config.endpoint}/v1/chat/completions`;
  const body = {
    model: config.model || undefined,
    messages: [
      { role: 'system', content: 'You are a helpful code assistant. Respond with only code. no comment in code.' },
      { role: 'user', content: prompt },
    ],
    max_tokens: config.maxTokens,
    temperature: config.temperature,
    stream: false,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeout);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }

    const data: any = await res.json();
    return (data.choices?.[0]?.message?.content ?? '').trim();
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error(`Request timed out after ${config.timeout}ms`);
    }
    throw err;
  }
}

// ──────────────────────── Output cleaning ────────────────────────

async function replaceGeneratedCode(editor: vscode.TextEditor, generated: string, selection: vscode.Selection) {
  const clean = cleanOutput(generated);
  await editor.edit(edit => edit.replace(selection, clean));
}

