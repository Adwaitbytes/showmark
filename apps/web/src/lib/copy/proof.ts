/** Names and one-line explanations for the two proof modes (docs/INTERFACES.md section 2.1). */
export const PROOF_MODES = {
  1: {
    name: "Rotating door code",
    explain: "The attendee scans a code on the door screen that is signed again every 15 seconds.",
  },
  2: {
    name: "Door scans you",
    explain: "Door staff scan a code on the attendee's phone, and the door signs for that one person.",
  },
} as const satisfies Record<1 | 2, { name: string; explain: string }>;

export type ProofMode = keyof typeof PROOF_MODES;
