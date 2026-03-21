export interface SignatureRenderOptions {
  drawingDataUrl: string;
  name: string;
  date: string;
  title?: string;
  organization?: string;
  format: 'basic' | 'full';
  width?: number;
}

export async function computeImageHash(dataUrl: string): Promise<string> {
  const base64 = dataUrl.split(',')[1] || '';
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function renderSignatureImage(options: SignatureRenderOptions): Promise<string> {
  const { drawingDataUrl, name, date, title, organization, format, width = 320 } = options;

  return new Promise((resolve) => {
    const drawingImg = new Image();
    drawingImg.onload = () => {
      const drawingHeight = 80;
      const textLineHeight = 18;
      const padding = 16;
      let totalHeight = padding + drawingHeight + 8 + textLineHeight + padding;

      if (format === 'full') {
        if (title) totalHeight += textLineHeight;
        if (organization) totalHeight += textLineHeight;
      }

      totalHeight += textLineHeight;

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = totalHeight;
      const ctx = canvas.getContext('2d')!;

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, totalHeight);

      const drawScale = Math.min((width - 2 * padding) / drawingImg.width, drawingHeight / drawingImg.height);
      const drawWidth = drawingImg.width * drawScale;
      const drawX = (width - drawWidth) / 2;
      ctx.drawImage(drawingImg, drawX, padding, drawWidth, drawingImg.height * drawScale);

      let y = padding + drawingHeight + 4;
      ctx.strokeStyle = '#cccccc';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(width - padding, y);
      ctx.stroke();
      y += 8;

      ctx.fillStyle = '#1a1a2e';
      ctx.font = 'bold 14px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillText(name, padding, y);
      y += textLineHeight;

      if (format === 'full' && title) {
        ctx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.fillStyle = '#5a5a72';
        ctx.fillText(title, padding, y);
        y += textLineHeight;
      }

      if (format === 'full' && organization) {
        ctx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.fillStyle = '#5a5a72';
        ctx.fillText(organization, padding, y);
        y += textLineHeight;
      }

      ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillStyle = '#8a8a9e';
      ctx.fillText(date, padding, y);

      resolve(canvas.toDataURL('image/png'));
    };
    drawingImg.src = drawingDataUrl;
  });
}
