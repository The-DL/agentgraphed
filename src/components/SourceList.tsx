'use client';

import { useState } from 'react';

type Source = { path: string; tag: string };

export function SourceList({
  name,
  label,
  initial,
  placeholder,
}: {
  name: string;
  label: string;
  initial: Source[];
  placeholder: string;
}) {
  const [rows, setRows] = useState<Source[]>(initial.length ? initial : [{ path: '', tag: '' }]);

  const update = (i: number, patch: Partial<Source>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => setRows((rs) => rs.filter((_, idx) => idx !== i));
  const add = () => setRows((rs) => [...rs, { path: '', tag: '' }]);

  // Only rows with a non-empty path are meaningful; the server cleans again.
  const serialized = JSON.stringify(rows.filter((r) => r.path.trim() !== ''));

  return (
    <div className="space-y-2">
      <label className="text-label-caps text-ink-mute block">{label}</label>
      <input type="hidden" name={name} value={serialized} />
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            value={r.path}
            onChange={(e) => update(i, { path: e.target.value })}
            placeholder={placeholder}
            className="bg-surface-1 border border-surface-3 rounded px-3 h-9 text-body-md font-mono flex-1 focus:outline-none focus:border-primary"
          />
          <input
            value={r.tag}
            onChange={(e) => update(i, { tag: e.target.value })}
            placeholder="tag"
            className="bg-surface-1 border border-surface-3 rounded px-3 h-9 text-body-md font-mono w-32 focus:outline-none focus:border-primary"
          />
          <button
            type="button"
            onClick={() => remove(i)}
            className="btn text-ink-mute px-2"
            title="Remove source"
            aria-label="Remove source"
          >
            ✕
          </button>
        </div>
      ))}
      <button type="button" onClick={add} className="btn text-body-sm">
        + Add source
      </button>
    </div>
  );
}
