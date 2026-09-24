export const BROADCAST_WAITING_MESSAGE = "Reactor TV will be right back";

// Never accept diagnostic text as an input to the public presentation boundary.
export function publicBroadcastDetail(status: string): string {
  return status === "live" ? "Live transmission" : BROADCAST_WAITING_MESSAGE;
}
