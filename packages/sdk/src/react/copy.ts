import { ShowmarkError, ShowmarkRelayError } from "@showmark/sdk";

/** Plain-language copy for an error, safe to show to an attendee. The relayer's own copy wins when it has some. */
export function describeError(error: ShowmarkError): string {
  if (error instanceof ShowmarkRelayError) return `${error.message} ${error.action}`;
  switch (error.code) {
    case "INVALID_INPUT":
      return "This door code is not valid. Scan the code on the door screen again.";
    case "SIGNING":
      return "Your pass could not sign the check-in. Reload the page and try again.";
    case "NETWORK":
      return "Showmark could not be reached. Check your connection and try again.";
    case "CONFIG":
      return "This check-in button is not set up correctly. Tell the event organizer.";
    case "CONTRACT":
    case "RELAY":
      return "The check-in did not go through. Try again.";
  }
}

export function toShowmarkError(value: unknown): ShowmarkError {
  if (value instanceof ShowmarkError) return value;
  return new ShowmarkError("NETWORK", value instanceof Error ? value.message : "Unknown error", { cause: value });
}
