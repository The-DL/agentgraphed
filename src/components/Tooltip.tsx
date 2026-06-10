'use client';

import { useState, useRef, useEffect, useId } from 'react';

// Small "(i)" icon button that opens a popover with explanation text.
//
// Why this exists: native `title=""` attributes are slow to appear, plain
// text only, and easy to miss because there's no visible affordance. Here
// the icon itself signals "there's an explanation"; clicking, hovering,
// or focusing it shows the popover.
//
// Behavior: opens on hover and on click. Closes on mouse leave (after a
// short delay so the user can move into the popover), on Escape, and on
// click outside. We keep the keyboard story simple — the icon is a real
// button so it gets tab focus.

type Props = {
  // Where to put the tooltip relative to the icon. Most labels in the
  // breakdown card live near the top of the card, so "bottom" is a good
  // default; switch to "top" near the bottom of any container.
  side?: 'top' | 'bottom';
  // Width budget for the popover. Body text wraps at this width.
  width?: number;
  children: React.ReactNode;
};

export function Tooltip({ side = 'bottom', width = 320, children }: Props) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLSpanElement | null>(null);
  const id = useId();

  // Esc + click-outside.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };

  return (
    <span
      ref={wrapperRef}
      className="relative inline-flex items-center"
      onMouseEnter={() => { cancelClose(); setOpen(true); }}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        aria-label="What's this?"
        aria-describedby={open ? id : undefined}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        onFocus={() => { cancelClose(); setOpen(true); }}
        onBlur={scheduleClose}
        className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-ink-mute/40 text-ink-mute hover:text-primary hover:border-primary text-[9px] font-bold transition-colors leading-none cursor-help"
        style={{ verticalAlign: 'middle' }}
      >
        i
      </button>
      {open && (
        <div
          id={id}
          role="tooltip"
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          className={`absolute z-50 left-0 ${side === 'bottom' ? 'top-full mt-1.5' : 'bottom-full mb-1.5'} bg-surface-1 border border-surface-3 rounded shadow-xl p-3 text-[11px] text-ink-dim leading-relaxed font-normal normal-case tracking-normal whitespace-normal`}
          style={{ width }}
        >
          {children}
        </div>
      )}
    </span>
  );
}
