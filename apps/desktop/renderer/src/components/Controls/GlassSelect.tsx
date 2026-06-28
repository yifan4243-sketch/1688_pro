import React, { useEffect, useMemo, useRef, useState } from 'react';

export interface GlassSelectOption {
  value: string;
  label: string;
}

interface Props {
  value: string;
  options: GlassSelectOption[];
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
}

export default function GlassSelect({ value, options, onChange, className = '', disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<'bottom' | 'top'>('bottom');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = useMemo(
    () => options.find((option) => option.value === value) || options[0],
    [options, value],
  );

  useEffect(() => {
    if (!open) return;
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect) {
      const menuHeight = Math.min(236, options.length * 34 + 14);
      const roomBelow = window.innerHeight - rect.bottom;
      const roomAbove = rect.top;
      setPlacement(roomBelow < menuHeight + 24 && roomAbove > roomBelow ? 'top' : 'bottom');
    }
    const closeOnOutside = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`glass-select-wrap ${open ? 'open' : ''} ${placement === 'top' ? 'drop-up' : ''} ${className}`}>
      <button
        type="button"
        className="glass-select-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((next) => !next)}
      >
        <span>{selected?.label || '请选择'}</span>
        <span className="glass-select-arrow" aria-hidden="true" />
      </button>
      {open && (
        <div className="glass-select-menu" role="listbox">
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={active}
                className={`glass-select-option ${active ? 'active' : ''}`}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
