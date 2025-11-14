import * as vscode from 'vscode';



const MODEL = 'qwen2.5-coder-0.5b-instruct';


// -------------------------------
// 3. Call LM Studio / Ollama
// -------------------------------
async function callModel(prompt: string): Promise<string> {
  try {
    const res = await fetch('http://localhost:1234/v1/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        prompt,
        max_tokens: 64,
        temperature: 0.5,
        stop: ['```']
      })
    });

    const data: any = await res.json();

    // Try both formats: message.content and text
    const raw =
      data?.choices?.[0]?.message?.content ??
      data?.choices?.[0]?.text ??
      '';

    return raw;

  } catch (err) {
    console.error('Model error:', err);
    return '';
  }
}


// -------------------------------
// 4. Full Inline Completion Provider
// -------------------------------
export function activate(context: vscode.ExtensionContext) {
  console.log('✅ LMS AI (Inline Completion) activated');

  const provider: vscode.InlineCompletionItemProvider = {
    async provideInlineCompletionItems(document, position) {

      // Extract language & file name
      const language = document.languageId;
      const fileName = document.fileName.split(/[/\\]/).pop() || 'file';

      // Use last N lines of the file as context
      const MAX_LINES = 300; // adjust as needed
      const fullText = document.getText();
      const lines = fullText.split(/\r?\n/);
      const lastLines = lines.slice(-MAX_LINES);
      let contextText = lastLines.join('\n');

      // Add the current line up to the cursor if it's not already included
      const currentLineText = document.lineAt(position).text.substring(0, position.character);
      if (!contextText.endsWith(currentLineText)) {
        contextText += '\n' + currentLineText;
      }

      const debouncedCallModel = debouncePromise(callModel, 1000);

      // Call local model
      const completion = await debouncedCallModel(contextText);
      if (!completion) { return; }

      // Return completion
      return {
        items: [
          {
            insertText: completion,
            range: new vscode.Range(position, position)
          }
        ]
      };
    }

  };

  context.subscriptions.push(
    vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, provider)
  );
}

export function deactivate() { }
function debouncePromise<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => Promise<ReturnType<T>> {
  let timer: NodeJS.Timeout;
  let pending: {
    resolve: (value: any) => void;
    reject: (reason?: any) => void;
  } | null = null;
  let lastArgs: any;

  return (...args: Parameters<T>) => {
    lastArgs = args;

    if (timer) clearTimeout(timer);

    return new Promise((resolve, reject) => {
      pending = { resolve, reject };

      timer = setTimeout(async () => {
        try {
          const result = await fn(...(lastArgs as any));
          pending?.resolve(result);
        } catch (err) {
          pending?.reject(err);
        }
      }, delay);
    });
  };
}
