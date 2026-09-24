"use client";

import { completeMention, mentionAtCaret } from "@reactor/infinite-contracts";
import { useEffect, useId, useRef, useState } from "react";

export default function MentionInput({ value, onChange, placeholder, onBlur, suggestions, onSearch, onError }: {
  value: string; onChange: (value: string) => void; placeholder: string; onBlur: () => void;
  suggestions: readonly string[] | undefined; onSearch: (search: string | null) => void;
  onError: (reason: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const [caret, setCaret] = useState(0);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [selection, setSelection] = useState(0);
  const range = focused && !dismissed ? mentionAtCaret(value, caret) : null;
  const search = range?.search ?? null;
  useEffect(() => onSearch(search), [search, onSearch]);
  const matches = search === null ? [] : (suggestions ?? []).filter(name => name.toLowerCase().startsWith(search));
  const selected = Math.min(selection, Math.max(0, matches.length - 1));
  const open = Boolean(range && suggestions !== undefined && matches.length);

  function choose(name: string) {
    if (!range) return;
    const result = completeMention(value, range, name);
    if (result.text.length > 800) { onError("Shorten your message to make room for this mention."); return; }
    onChange(result.text);
    setCaret(result.caret);
    setDismissed(true);
    requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(result.caret, result.caret); });
  }

  return <div className="chat-mention-input">
    <input ref={input} value={value} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={open ? id : undefined}
      aria-activedescendant={open ? `${id}-${selected}` : undefined} aria-label="Chat message" autoComplete="off" placeholder={placeholder} maxLength={800}
      onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); onBlur(); }}
      onChange={event => { onChange(event.target.value); setCaret(event.target.selectionStart ?? 0); setSelection(0); setDismissed(false); }}
      onSelect={event => setCaret(event.currentTarget.selectionStart ?? 0)}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (range && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setDismissed(true); }
        if (!open) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault(); setSelection((selected + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length);
        } else if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault(); event.stopPropagation(); choose(matches[selected]);
        }
      }} />
    {open ? <ul id={id} role="listbox" aria-label="Mention a user" className="chat-mention-options">
      {matches.map((name, index) => <li id={`${id}-${index}`} key={name} role="option" aria-selected={selected === index}
        onMouseDown={event => event.preventDefault()} onClick={() => choose(name)} onMouseEnter={() => setSelection(index)}>@{name}</li>)}
    </ul> : null}
  </div>;
}
