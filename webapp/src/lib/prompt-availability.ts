type PromptAvailability = {
  connected: boolean;
  identity: string;
  settingsLoaded: boolean;
  namesAvailable: boolean;
  viewerLoaded: boolean;
  name: string;
  voting: boolean;
  checking: boolean;
  queueLoaded: boolean;
  acceptedOutstanding: boolean;
  ownPromptStatus?: string;
  queueLabel?: string;
};

// Shared by the player composer and chat's /prompt command. Drafting stays available.
export function promptUnavailableReason(state: PromptAvailability): string | null {
  if (!state.connected) return "Reconnecting to the prompt service. Your draft is safe. Try again when connected.";
  if (!state.identity) return "Your viewer session is still loading. Please try again in a moment.";
  if (!state.settingsLoaded) return "The stream settings are still loading. Please try again in a moment.";
  if (!state.namesAvailable) return "Prompt submission is temporarily unavailable. Refresh the page to load the latest version.";
  if (!state.viewerLoaded) return "Your chat profile is still loading. Please try again in a moment.";
  if (!state.name) return "Choose a name above the chat box before submitting a prompt.";
  if (state.voting) return "Audience voting is active. Choose an option in the player instead of submitting a text prompt.";
  if (state.checking) return "Your previous prompt is still being checked. You can keep drafting while you wait.";
  if (!state.queueLoaded) return "The prompt queue is still loading. Your draft is safe. Please try again in a moment.";
  if (state.ownPromptStatus === "playing") return "Your previous prompt is playing. You can draft now and submit when it finishes.";
  if (state.ownPromptStatus) return (state.queueLabel ? "Your previous prompt is " + state.queueLabel + "." : "Your previous prompt is queued.") + " One prompt at a time. You can keep drafting while you wait.";
  if (state.acceptedOutstanding) return "Your previous prompt was accepted. Waiting for its queue status to update before you can submit another.";
  return null;
}
