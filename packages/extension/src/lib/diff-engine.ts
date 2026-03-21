import DiffMatchPatch from 'diff-match-patch';

export interface DiffLine {
  type: 'add' | 'remove' | 'context';
  text: string;
}

const dmp = new DiffMatchPatch();

export function computeTextDiff(oldText: string, newText: string): DiffLine[] {
  const diffs = dmp.diff_main(oldText, newText);
  dmp.diff_cleanupSemantic(diffs);

  const lines: DiffLine[] = [];
  for (const [op, text] of diffs) {
    if (op === 0) {
      lines.push({ type: 'context', text });
    } else if (op === -1) {
      lines.push({ type: 'remove', text });
    } else if (op === 1) {
      lines.push({ type: 'add', text });
    }
  }
  return lines;
}

export function diffToHtml(diffLines: DiffLine[]): string {
  return diffLines
    .map((line) => {
      const escaped = escapeHtml(line.text);
      switch (line.type) {
        case 'add':
          return `<span class="diff-add">${escaped}</span>`;
        case 'remove':
          return `<span class="diff-remove">${escaped}</span>`;
        case 'context':
          return `<span class="diff-context">${escaped}</span>`;
      }
    })
    .join('');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
