// src/utils/clean-output.ts
import * as difflib from 'difflib';

/**
 * Smart cleanup + deduplication for LM Studio output
 */
export function cleanOutput(raw: string): string {
  if (!raw) return '';

  // Step 1: Extract code from markdown (if any)
  const codeOnly = extractCodeFromMarkdown(raw);

  // Step 2: Split into logical lines (preserve intentional empty lines, collapse runs of blanks)
  const normalizedLines = normalizeLines(codeOnly);

  // Step 3: Deduplicate near-identical consecutive blocks
  const dedupedLines = deduplicateSimilarBlocks(normalizedLines);

  return dedupedLines.join('\n').trim() + '\n';
}

// ──────────────────────────────────────────────────

function extractCodeFromMarkdown(text: string): string {
  const block = text.match(/```[\w]*\n([\s\S]*?)\n```/);
  if (block) return block[1];

  // Fallback: drop common explanation prefixes
  const lines = text.split('\n');
  const cutoffIdx = lines.findIndex(line =>
    /^(Here.|Explanation|Note|Solution|Answer|Improved|Fixed)/i.test(line.trim())
  );
  return (cutoffIdx === -1 ? lines : lines.slice(0, cutoffIdx)).join('\n');
}

function normalizeLines(code: string): string[] {
  return code
    .split('\n')
    .map(line => line.trimEnd()) // keep indent, only trim trailing spaces
    .reduce((acc: string[], line) => {
      // Collapse multiple blank lines into one (but keep single intentional blanks)
      if (line === '' && acc.length > 0 && acc[acc.length - 1] === '') {
        return acc;
      }
      acc.push(line);
      return acc;
    }, []);
}

function deduplicateSimilarBlocks(lines: string[]): string[] {
  if (lines.length === 0) return lines;

  const result: string[] = [];
  let currentBlock: string[] = [];
  let lastBlockKey = '';

  const flushBlock = () => {
    if (currentBlock.length > 0) {
      result.push(...currentBlock);
      currentBlock = [];
    }
  };

  for (const line of lines) {
    currentBlock.push(line);

    // Try to detect block boundaries (empty line or significant indent change)
    if (line === '' || /^\s*$/.test(line)) {
      const blockKey = currentBlock.join('\n');
      const similarity = lastBlockKey
        ? new difflib.SequenceMatcher(null, lastBlockKey, blockKey).ratio()
        : 0;

      // If this block is ~90% similar to the previous one → skip it
      if (similarity > 0.90) {
        currentBlock = []; // discard duplicate
      } else {
        flushBlock();
        lastBlockKey = blockKey;
      }
    }
  }

  flushBlock(); // don't forget the last one
  return result;
}