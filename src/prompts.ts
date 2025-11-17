export const completionPropmt=(before)=>`Continue the code naturally. Output ONLY the continuation, no comments, no explanation. Do not add any new lines. ${before}`;
export const generationPrompt=(projectContext,currentFileContext,selectedCode)=> `
You are an expert developer.
Replace the selected code with better, cleaner, or fixed code that perfectly fits this project.


PROJECT CONTEXT:
${projectContext}

CURRENT FILE SNIPPET:
${currentFileContext}

SELECTED CODE TO REPLACE:
${selectedCode}

INSTRUCTIONS:
- Output ONLY the raw code, no explanations, no markdown fences,no comments in code, no extra text. no \`\`\`.
- Match the exact coding style and formatting of the surrounding code.
- Make it syntactically correct and ready to run.
- Do not output file name, language name or and Types name.
`;