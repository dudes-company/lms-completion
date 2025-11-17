import * as vscode from 'vscode';
import { getConfig } from './config';
import { cleanOutput } from './functions/clean-output';

export class GhostCompletionProvider implements vscode.InlineCompletionItemProvider {
  private controller = new AbortController();

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[] | null> {
    const config = getConfig();
    if (!config.inlineEnabled) return null;

    // NEW: Only trigger when cursor is at the END of the current line
    const currentLine = document.lineAt(position.line);
    if (position.character !== currentLine.text.length) {
      return null; // Cursor is in the middle or beginning → no ghost completion
    }

    // Optional: Still respect manual trigger (Ctrl+Space etc.), but keep auto-trigger strict
    if (context.triggerKind === vscode.InlineCompletionTriggerKind.Automatic) {
      // Only auto-trigger if we're truly at line end and last char was typed (not navigation)
      const lineBeforeCursor = currentLine.text;
      if (lineBeforeCursor.trim() === '') {
        return null; // Don't suggest on empty lines unless manually triggered
      }
    }

    // Abort any previous request
    this.controller.abort();
    this.controller = new AbortController();

    const before = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
    
    // Much better prompt for "continue from end of line" behavior
    const prompt = `${before}`;

    try {
      const response = await fetch(`${config.endpoint}/v1/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.model,
          prompt,
          max_tokens: 256,
          temperature: 0.1,
          stream: false,
          stop: ['\n\n', '```',"\n", '\n#', '\n// TODO', '\n<!--'],
          presence_penalty: 0.3,
          frequency_penalty: 0.3,
        }),
        signal: this.controller.signal,
      });

      if (!response.ok) return null;

      const data: any = await response.json();
      let completion = data.choices[0]?.text || '';

      if (!completion.trim()) return null;

      // Aggressive cleanup: remove any leading/trailing junk and prevent mid-line breaks
      completion = cleanOutput(completion);

      // Extra safety: never return something that starts with a newline if we're at line end
      // (this prevents double line breaks)
      if (completion.startsWith('\n')) {
        completion = completion.replace(/^\n+/, '');
      }

      if (!completion) return null;

      return [
        new vscode.InlineCompletionItem(completion, new vscode.Range(position, position))
      ];
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        console.warn('Ghost completion error:', e);
      }
      return null;
    }
  }
}