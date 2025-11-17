import * as vscode from 'vscode';
import { getConfig } from './config';
import { cleanOutput } from './functions/clean-output';

export class GhostCompletionProvider implements vscode.InlineCompletionItemProvider {
  private controller = new AbortController();
  private currentRequest: Promise<void> | null = null;

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[] | null> {
    const config = getConfig();
    if (!config.inlineEnabled) return null;

    // Abort previous streaming request
    this.controller.abort();
    this.controller = new AbortController();

    // Simple trigger: only when user just typed something (not on arrow/move)
    if (context.triggerKind === vscode.InlineCompletionTriggerKind.Automatic) {
      const line = document.lineAt(position.line).text.substring(0, position.character);
      if (!/\w$/.test(line)) return null; // only after word chars
    }

    const before = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
    const prompt = `Continue the code naturally. Output ONLY the continuation, no explanation.\n\n${before}`;

    try {
      const response = await fetch(`${config.endpoint}/v1/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.model,
          prompt,
          max_tokens: 128,
          temperature: 0.2,
          stream: false, // change to true later for real ghost streaming
          stop: ['\n\n', '```',"\n"], // optional
        }),
        signal: this.controller.signal,
      });

      if (!response.ok) return null;
      const data:any = await response.json();
      const completion = data.choices[0]?.text || '';

      if (!completion.trim()) return null;

      return [
        new vscode.InlineCompletionItem(cleanOutput(completion), new vscode.Range(position, position))
      ];
    } catch (e) {
      return null;
    }
  }
}