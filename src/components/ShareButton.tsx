'use client';

import { useState } from 'react';

// Share button for session / project pages.
//
// Click flow:
//   1. Copies a tweet-ready text string to clipboard
//   2. Triggers a download of the stat-card PNG (also branded with
//      agentgraphed.com)
//   3. Opens twitter.com/intent/tweet with the prefilled text in a new tab
//
// User then drags the just-downloaded PNG into the Twitter compose box and
// posts. Two clicks total from button press to tweet sent.
//
// Every share image has the AgentGraphed wordmark + agentgraphed.com baked
// in, so each post is a tiny piece of organic distribution.

type Props = {
  kind: 'session' | 'project';
  id: string;
  // Caller supplies the prefilled tweet text — we don't try to be cute and
  // generate it from inside the button.
  tweetText: string;
  filename: string;
};

export function ShareButton({ kind, id, tweetText, filename }: Props) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const imageUrl = `/api/share/${kind}/${id}`;

  const onClick = async () => {
    setBusy(true);
    try {
      // Fetch the image so we can download it via a Blob → anchor click. This
      // is more reliable than just navigating to imageUrl, which would open
      // the PNG inline in the user's tab.
      const resp = await fetch(imageUrl);
      const blob = await resp.blob();
      const objectUrl = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Free the object URL after a beat — the browser still needs it for the
      // download to land on disk in some flows.
      setTimeout(() => URL.revokeObjectURL(objectUrl), 5_000);

      // Copy tweet text to clipboard as a friendly default.
      try { await navigator.clipboard.writeText(tweetText); } catch { /* ignore */ }

      // Open Twitter compose in a new tab with the text prefilled. User
      // attaches the just-downloaded image manually.
      const intentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`;
      window.open(intentUrl, '_blank', 'noopener,noreferrer');

      setDone(true);
      setTimeout(() => setDone(false), 2400);
    } catch (e) {
      console.error('share failed', e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="btn disabled:opacity-50"
      title="Download a share-image and open Twitter with prefilled text"
    >
      {busy ? '… preparing' : done ? '✓ Image saved · Tweet opened' : '⤴ Share stats'}
    </button>
  );
}
