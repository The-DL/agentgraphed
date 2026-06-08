'use client';

import { useState } from 'react';

// Share-stats button. Single job: generate the stat-card PNG and write it
// to the OS clipboard as an image. The user pastes it wherever they want.
//
// Three states: idle ("Share stats") -> generating ("Generating image") ->
// done ("Image copied to clipboard"). No share sheet, no tweet intent, no
// text wrangling.

type Props = {
  imageUrl: string;
  className?: string;
};

type Status = 'idle' | 'busy' | 'done' | 'err';

export function ShareButton({ imageUrl, className }: Props) {
  const [status, setStatus] = useState<Status>('idle');
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const onClick = async () => {
    setStatus('busy');
    setErrMsg(null);
    try {
      const resp = await fetch(imageUrl);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();

      // ClipboardItem expects a Promise<Blob> or Blob keyed by MIME type.
      // Browsers that support image-in-clipboard: Chrome, Edge, Safari 13.4+,
      // Firefox 127+. Older Firefox throws — we catch and fall back to
      // downloading the file instead so the user is never stuck.
      if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
        throw new Error('clipboard image unsupported');
      }
      const item = new ClipboardItem({ 'image/png': blob });
      await navigator.clipboard.write([item]);

      setStatus('done');
      setTimeout(() => setStatus('idle'), 2400);
    } catch (e) {
      // Fallback for browsers without clipboard.write image support: trigger
      // a download. Honest UX, not pretty, but not a dead end.
      try {
        const resp = await fetch(imageUrl);
        const blob = await resp.blob();
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = 'agentgraphed-stats.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(objectUrl), 5_000);
        setErrMsg('Saved to Downloads (your browser doesn\'t support image copy)');
        setStatus('err');
        setTimeout(() => setStatus('idle'), 4_000);
      } catch (e2) {
        setErrMsg((e2 as Error).message || (e as Error).message);
        setStatus('err');
        setTimeout(() => setStatus('idle'), 3_000);
      }
    }
  };

  const label =
    status === 'busy' ? 'Generating image…' :
    status === 'done' ? '✓ Image copied to clipboard' :
    status === 'err' ? (errMsg ?? 'Try again') :
    'Share stats';

  return (
    <button
      onClick={onClick}
      disabled={status === 'busy'}
      className={`btn btn-primary disabled:opacity-60 disabled:cursor-not-allowed ${className ?? ''}`}
      title="Generate a share image and copy it to your clipboard"
    >
      {label}
    </button>
  );
}
