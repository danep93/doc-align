import DiffMatchPatch from 'diff-match-patch';

export interface DiffLine {
  type: 'add' | 'remove' | 'context';
  text: string;
}

const dmp = new DiffMatchPatch();

export function computeTextDiff(oldText: string, newText: string): DiffLine[] {
  const diffs = dmp.diff_main(oldText, newText);
  dmp.diff_cleanupSemantic(diffs);

  // Split diffs into lines for GitHub-style display
  const lines: DiffLine[] = [];

  for (const [op, text] of diffs) {
    const type: DiffLine['type'] = op === 0 ? 'context' : op === -1 ? 'remove' : 'add';
    const textLines = text.split('\n');

    for (let i = 0; i < textLines.length; i++) {
      const lineText = textLines[i]!;
      // Skip empty strings from trailing newlines, unless it's meaningful
      if (i === textLines.length - 1 && lineText === '' && textLines.length > 1) {
        continue;
      }
      lines.push({ type, text: lineText });
    }
  }

  return lines;
}

export function diffToHtml(diffLines: DiffLine[]): string {
  let addCount = 0;
  let removeCount = 0;

  const lineHtml = diffLines.map((line) => {
    const escaped = escapeHtml(line.text) || '&nbsp;';
    switch (line.type) {
      case 'add':
        addCount++;
        return `<div class="diff-line diff-line-added"><span class="diff-line-marker">+</span><span class="diff-line-text">${escaped}</span></div>`;
      case 'remove':
        removeCount++;
        return `<div class="diff-line diff-line-removed"><span class="diff-line-marker">-</span><span class="diff-line-text">${escaped}</span></div>`;
      case 'context':
        return `<div class="diff-line diff-line-context"><span class="diff-line-marker">&nbsp;</span><span class="diff-line-text">${escaped}</span></div>`;
    }
  }).join('');

  const summary = `<div class="diff-summary"><span class="diff-summary-added">+${addCount} added</span><span class="diff-summary-removed">-${removeCount} removed</span></div>`;

  return `${summary}<div class="diff-viewer">${lineHtml}</div>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
