type ScrollArea = { scrollHeight: number; scrollTop: number; clientHeight: number };

export function isFollowingChat(area: ScrollArea): boolean {
  return area.scrollHeight - area.scrollTop - area.clientHeight <= 48;
}

// Scroll only the chat rail, never its ancestors or the page.
export function scrollChatToLatest(area: ScrollArea | null): void {
  if (area) area.scrollTop = area.scrollHeight;
}
