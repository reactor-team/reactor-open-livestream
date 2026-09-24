"use client";

import { EmojiPicker, useSkinTone, type SkinTone } from "frimousse";
import { reactionDetails, reactionKeyForEmoji, type ReactionKey } from "@reactor/infinite-contracts";
import { RiSearchLine, RiCloseLine, RiTimeLine, RiEmotionLine, RiHand, RiLeafLine, RiRestaurantLine, RiCarLine, RiFootballLine, RiLightbulbLine, RiHeartLine, RiFlagLine } from "@remixicon/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { readRecentEmojis } from "@/lib/recent-emojis";

const categories = [
  { label: "Smileys & emotion", icon: RiEmotionLine }, { label: "People & body", icon: RiHand },
  { label: "Animals & nature", icon: RiLeafLine }, { label: "Food & drink", icon: RiRestaurantLine },
  { label: "Travel & places", icon: RiCarLine }, { label: "Activities", icon: RiFootballLine },
  { label: "Objects", icon: RiLightbulbLine }, { label: "Symbols", icon: RiHeartLine }, { label: "Flags", icon: RiFlagLine },
];
const skinToneKey = "reactor-tv:emoji-skin-tone:v1";
function savedSkinTone(): SkinTone {
  try {
    const tone = localStorage.getItem(skinToneKey);
    if (["light", "medium-light", "medium", "medium-dark", "dark"].includes(tone ?? "")) return tone as SkinTone;
  } catch { /* Use the neutral tone without storage. */ }
  return "none";
}
function SkinPreference() {
  const [tone] = useSkinTone();
  useEffect(() => { try { localStorage.setItem(skinToneKey, tone); } catch { /* Preference storage is optional. */ } }, [tone]);
  return <EmojiPicker.SkinToneSelector title="Change skin tone" />;
}
function LoadingStatus({ retry }: { retry: () => void }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => { const timer = setTimeout(() => setSlow(true), 8000); return () => clearTimeout(timer); }, []);
  return <span className="emoji-picker-empty" role="status">{slow ? <>Emojis couldn&apos;t load. <button type="button" onClick={retry}>Retry</button></> : "Loading emojis..."}</span>;
}

export default function ReactorEmojiPicker({ selected, onSelect, onClose }: {
  selected: readonly string[]; onSelect: (key: ReactionKey) => void; onClose: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const recentRef = useRef<HTMLDivElement>(null);
  const [recent] = useState(readRecentEmojis);
  const [skinTone] = useState(savedSkinTone);
  const [search, setSearch] = useState("");
  const [columns, setColumns] = useState(7);
  const [retry, setRetry] = useState(0);
  const [jump, setJump] = useState<string | null>(null);
  useLayoutEffect(() => {
    searchRef.current?.focus({ preventScroll: true });
    const resize = new ResizeObserver(() => {
      if (root.current) setColumns(Math.max(4, Math.min(7, Math.floor((root.current.clientWidth - 24) / 44))));
    });
    if (root.current) resize.observe(root.current);
    return () => resize.disconnect();
  }, [retry]);
  useEffect(() => {
    if (!jump || search) return;
    const frame = requestAnimationFrame(() => {
      const header = [...(viewport.current?.querySelectorAll<HTMLElement>("[frimousse-category-header]") ?? [])]
        .find(element => element.textContent === jump);
      if (header?.parentElement) viewport.current?.scrollTo({ top: header.parentElement.offsetTop, behavior: "instant" });
      setJump(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [jump, search]);
  return <EmojiPicker.Root key={retry} ref={root} className="reactor-emoji-picker" columns={columns} skinTone={skinTone} emojibaseUrl="/emoji/17" onEmojiSelect={({ emoji }) => {
    const key = reactionKeyForEmoji(emoji);
    if (key) onSelect(key);
  }}>
    <div className="emoji-picker-search">
      <RiSearchLine aria-hidden="true" />
      <EmojiPicker.Search ref={searchRef} value={search} onChange={event => setSearch(event.target.value.replace(/^:|:$/g, "").replace(/_/g, " "))} aria-label="Search all emojis" placeholder="Search emojis" />
      <button type="button" className="emoji-picker-close" aria-label="Close emoji picker" onClick={onClose}><RiCloseLine aria-hidden="true" /></button>
    </div>
    <div className="emoji-picker-categories" role="toolbar" aria-label="Emoji categories">
      {recent.length ? <button type="button" aria-label="Recently used" title="Recently used" onClick={() => { setSearch(""); recentRef.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true }); }}><RiTimeLine aria-hidden="true" /></button> : null}
      {categories.map(({ label, icon: Icon }) => <button type="button" key={label} aria-label={label} title={label} onClick={() => { setSearch(""); setJump(label); }}><Icon aria-hidden="true" /></button>)}
    </div>
    {!search && recent.length ? <div ref={recentRef} className="emoji-picker-recents" aria-label="Recently used emojis">
      <span className="emoji-picker-category-label">Recently used</span>
      <div style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>{recent.slice(0, columns * 2).map(key => {
        const item = reactionDetails(key)!;
        return <button type="button" key={key} aria-label={item.label} title={item.label} aria-pressed={selected.includes(key)} onClick={() => onSelect(key)}>{item.emoji}</button>;
      })}</div>
    </div> : null}
    <EmojiPicker.Viewport ref={viewport} className="emoji-picker-viewport" tabIndex={0} aria-label="Emojis">
      <EmojiPicker.Loading><LoadingStatus retry={() => setRetry(value => value + 1)} /></EmojiPicker.Loading>
      <EmojiPicker.Empty className="emoji-picker-empty" role="status">No emojis found.</EmojiPicker.Empty>
      <EmojiPicker.List components={{
        CategoryHeader: ({ category, ...props }) => <div {...props} className="emoji-picker-category-label">{category.label}</div>,
        Emoji: ({ emoji, ...props }) => <button {...props} type="button" title={emoji.label} data-selected={selected.includes(reactionKeyForEmoji(emoji.emoji) ?? "") || undefined}>{emoji.emoji}</button>,
      }} />
    </EmojiPicker.Viewport>
    <div className="emoji-picker-footer">
      <EmojiPicker.ActiveEmoji>{({ emoji }) => <span>{emoji ? <><span className="emoji-picker-preview">{emoji.emoji}</span><span>{emoji.label}</span></> : null}</span>}</EmojiPicker.ActiveEmoji>
      <SkinPreference />
    </div>
  </EmojiPicker.Root>;
}
