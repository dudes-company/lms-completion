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
import { generationPrompt, systemPrompt } from './prompts';

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

  vscode.commands.registerCommand("ghost.triggerInline", () => {
    vscode.commands.executeCommand("editor.action.inlineSuggest.trigger");
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
  return generationPrompt(projectContext, currentFileContext, selectedCode);
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
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ],
    max_tokens: config.maxTokens || 1024,
    temperature: config.temperature || 0.0,
    stream: false,
    top_p: 1.0,
    top_k: 1,
    repeat_penalty: 1.1

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

