export type SignerStatus = 'pending' | 'signed' | 'drifted';

export interface Signer {
  id: string;
  name: string;
  email: string;
  status: SignerStatus;
  commitMessage: string | null;
  revisionId: string | null;
  timestamp: string | null;
  signoffSnapshot?: string;
}

export interface HistoryEntry {
  action: 'created' | 'signed' | 'drifted';
  name: string | null;
  email?: string;
  commitMessage: string | null;
  revisionId: string | null;
  timestamp: string | null;
  status: SignerStatus | null;
}

export interface AppState {
  docTitle: string;
  signers: Signer[];
  history: HistoryEntry[];
}

export type CardView =
  | { type: 'empty' }
  | { type: 'addSigners' }
  | { type: 'status' }
  | { type: 'signForm'; prefillMessage?: string }
  | { type: 'diff'; signerId: string }
  | { type: 'history' };

export interface DiffSection {
  title: string;
  type: 'added' | 'removed' | 'modified';
  added: number;
  removed: number;
  context: number;
}

export interface DiffResult {
  summary: string;
  stats: { added: number; removed: number; modified: number };
  sections: DiffSection[];
}
