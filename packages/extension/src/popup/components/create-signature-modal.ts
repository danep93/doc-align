import { SignatureCanvas } from '../../lib/signature-canvas';
import { renderSignatureImage, type SignatureRenderOptions } from '../../lib/signature-renderer';
import { api } from '../../lib/api';
import type { Tier } from '@doc-align/shared';
import { canUseFullSignature } from '@doc-align/shared';

export function initCreateSignatureModal(
  userTier: Tier,
  onSaved: () => void,
): void {
  const body = document.getElementById('create-sig-body')!;
  const isFullAllowed = canUseFullSignature(userTier);
  const format = isFullAllowed ? 'full' : 'basic';

  body.innerHTML = `
    <div class="sig-canvas-container">
      <canvas id="sig-draw-canvas" class="sig-canvas" width="328" height="120"></canvas>
      <div class="sig-canvas-actions">
        <button class="btn btn-ghost" id="sig-undo" style="font-size:11px;padding:4px 8px;">Undo</button>
        <button class="btn btn-ghost" id="sig-clear" style="font-size:11px;padding:4px 8px;">Clear</button>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Full Name</label>
      <input type="text" class="form-input" id="sig-name" placeholder="Jane Doe" />
    </div>
    ${isFullAllowed ? `
    <div class="form-group">
      <label class="form-label">Title</label>
      <input type="text" class="form-input" id="sig-title" placeholder="Engineering Lead" />
    </div>
    <div class="form-group">
      <label class="form-label">Organization</label>
      <input type="text" class="form-input" id="sig-org" placeholder="Acme Corp" />
    </div>
    ` : ''}
    <div class="sig-preview" id="sig-preview">
      <p style="color:var(--text-muted);font-size:12px;">Draw your signature above to see preview</p>
    </div>
  `;

  const canvas = document.getElementById('sig-draw-canvas') as HTMLCanvasElement;
  const sigCanvas = new SignatureCanvas(canvas);

  document.getElementById('sig-undo')!.addEventListener('click', () => sigCanvas.undo());
  document.getElementById('sig-clear')!.addEventListener('click', () => sigCanvas.clear());

  canvas.addEventListener('pointerup', () => updatePreview());

  async function updatePreview(): Promise<void> {
    if (sigCanvas.isEmpty()) return;
    const name = (document.getElementById('sig-name') as HTMLInputElement).value || 'Your Name';
    const title = document.getElementById('sig-title') as HTMLInputElement | null;
    const org = document.getElementById('sig-org') as HTMLInputElement | null;

    const opts: SignatureRenderOptions = {
      drawingDataUrl: sigCanvas.toDataURL(),
      name,
      date: new Date().toLocaleDateString(),
      title: title?.value || undefined,
      organization: org?.value || undefined,
      format,
    };

    const imageUrl = await renderSignatureImage(opts);
    const preview = document.getElementById('sig-preview')!;
    preview.innerHTML = `<img src="${imageUrl}" alt="Signature preview" />`;
  }

  document.getElementById('create-sig-save')!.addEventListener('click', async () => {
    const name = (document.getElementById('sig-name') as HTMLInputElement).value.trim();
    if (!name) {
      alert('Please enter your name');
      return;
    }
    if (sigCanvas.isEmpty()) {
      alert('Please draw your signature');
      return;
    }

    const title = document.getElementById('sig-title') as HTMLInputElement | null;
    const org = document.getElementById('sig-org') as HTMLInputElement | null;

    await api.createSignature({
      name,
      title: title?.value?.trim() || undefined,
      organization: org?.value?.trim() || undefined,
      format,
      drawingData: sigCanvas.toDataURL(),
    });

    document.getElementById('create-sig-modal')!.classList.add('hidden');
    onSaved();
  });

  document.getElementById('create-sig-cancel')!.addEventListener('click', () => {
    document.getElementById('create-sig-modal')!.classList.add('hidden');
  });
}
