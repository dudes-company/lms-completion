export const completionPrompt = (before) => `Continue the code naturally. Output ONLY the continuation, no comments, no explanation. Do not add any new lines. ${before}`;
export const generationPrompt = (projectContext, currentFileContext, selectedCode) => `

INSTRUCTIONS:
- Output ONLY the raw code, no explanations, no markdown fences,no comments in code, no extra text. no \`\`\`.
- Match the exact coding style and formatting of the surrounding code.
- Make it syntactically correct and ready to run.
- Do not output file name, language name or and Types name.
- If your solution requires additional context from projectContext (such as dependencies) please make reasonable assumptions.
- Never output any reasoning, thoughts, explanations, or comments.
- Never use <think> tags or any tags.
- Never say "I think", "here is", "updated version", etc.
- Only output the exact final code or file content requested.
- If you make a change, output the full file.
- Do not wrap code in \`\`\` markers unless explicitly asked.

PROJECT CONTEXT:
${projectContext}

CURRENT FILE SNIPPET:
${currentFileContext}

selected CODE TO REPLACE:
${selectedCode}

`;

export const systemPrompt = `You are a silent code generator.
  Output ONLY the final code.
  No explanations, no thoughts, 
  no tags, no markdown, 
  no triple backticks \`\`\`.
  no reasoning of any kind. 
  Never use <think> or any XML tags. 
  Never add comments explaining changes.`;