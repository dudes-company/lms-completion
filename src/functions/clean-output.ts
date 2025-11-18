// src/utils/clean-output.ts
import * as difflib from 'difflib';

/**
 * Strict: return ALL code blocks merged
 * - Removes <think>...</think>
 * - Removes ALL comments inside code
 * - Normalizes & deduplicates
 */
export function cleanOutput(raw: string): string {
  if (!raw) return '';

  // Remove <think> ... </think>
  const withoutThink = removeThinkBlocks(raw);

  // Extract ALL code blocks (merged)
  const code = extractAllCodeBlocks(withoutThink);

  // Remove ALL comments
  const noComments = removeComments(code);

  // Normalize lines
  const normalizedLines = normalizeLines(noComments);

  // Deduplicate repeated blocks
  const dedupedLines = deduplicateSimilarBlocks(normalizedLines);

  return dedupedLines.join('\n').trim();
}

// ──────────────────────────────────────────────────
// REMOVE THINK BLOCKS
// ──────────────────────────────────────────────────

function removeThinkBlocks(input: string): string {
  return input.replace(/<think>[\s\S]*?<\/think>/gi, '');
}

// ──────────────────────────────────────────────────
// EXTRACT *ALL* CODE BLOCKS (MERGED)
// ──────────────────────────────────────────────────

function extractAllCodeBlocks(text: string): string {
  const matches = [...text.matchAll(/```[\w-]*\n([\s\S]*?)```/g)];

  if (matches.length === 0) return '';

  return matches
    .map(m => m[1].trim())
    .join('\n\n'); // merge with a blank line
}

// ──────────────────────────────────────────────────
// REMOVE ALL COMMENTS INSIDE CODE
// Supports: //  /* */  /** */  #  --  <!-- -->
// ──────────────────────────────────────────────────

function removeComments(code: string): string {
  return code
    .replace(/\/\/.*$/gm, '')           // JS/TS/C inline
    .replace(/\/\*[\s\S]*?\*\//g, '')   // block & JSDoc
    .replace(/^\s*#.*$/gm, '')          // python/bash
    .replace(/^\s*--.*$/gm, '')         // SQL
    .replace(/<!--[\s\S]*?-->/g, '')    // HTML comments
    .trim();
}

// ──────────────────────────────────────────────────
// NORMALIZATION (trim + collapse blank lines)
// ──────────────────────────────────────────────────

function normalizeLines(code: string): string[] {
  return code
    .split('\n')
    .map(line => line.trimEnd())
    .map(line => line.trim()) // remove leading indentation
    .reduce((acc: string[], line) => {
      if (line === '' && acc.at(-1) === '') return acc;
      acc.push(line);
      return acc;
    }, []);
}

// ──────────────────────────────────────────────────
// DEDUPLICATION
// ──────────────────────────────────────────────────

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

    if (line.trim() === '') {
      const blockKey = currentBlock.join('\n');
      const similarity = lastBlockKey
        ? new difflib.SequenceMatcher(null, lastBlockKey, blockKey).ratio()
        : 0;

      if (similarity > 0.9) {
        currentBlock = []; // skip duplicate
      } else {
        flushBlock();
        lastBlockKey = blockKey;
      }
    }
  }

  flushBlock();
  return result;
}
