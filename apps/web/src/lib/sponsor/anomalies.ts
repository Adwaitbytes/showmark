// Soft signals in a campaign's settlements. None of these prove anything: they point a sponsor at something worth a
// second look. The chain already enforces the hard rules (door signatures, freshness, one presence per person).

export interface SettlementLike {
  eventId: string;
  eventName: string;
  attendee: string;
  organizer: string;
  organizerName?: string | null;
  at: string;
}

function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

export type SignalKind = "burst" | "concentration" | "hopping";

export interface SoftSignal {
  kind: SignalKind;
  title: string;
  detail: string;
}

export const BURST_WINDOW_SECONDS = 60;
export const BURST_MIN = 30;
export const CONCENTRATION_SHARE = 0.6;
export const CONCENTRATION_MIN_SETTLEMENTS = 10;
export const HOP_WINDOW_SECONDS = 30 * 60;

function seconds(iso: string): number {
  return Math.floor(Date.parse(iso) / 1000);
}

/** Largest number of check-ins at one event inside any sliding window of `windowSeconds`. */
export function largestBurst(times: number[], windowSeconds: number): number {
  const sorted = [...times].sort((a, b) => a - b);
  let best = 0;
  let start = 0;
  for (let end = 0; end < sorted.length; end++) {
    while ((sorted[end] ?? 0) - (sorted[start] ?? 0) > windowSeconds) start++;
    best = Math.max(best, end - start + 1);
  }
  return best;
}

export function findSoftSignals(settlements: readonly SettlementLike[]): SoftSignal[] {
  const signals: SoftSignal[] = [];

  const byEvent = new Map<string, { name: string; times: number[] }>();
  for (const s of settlements) {
    const entry = byEvent.get(s.eventId) ?? { name: s.eventName, times: [] };
    entry.times.push(seconds(s.at));
    byEvent.set(s.eventId, entry);
  }
  for (const [eventId, { name, times }] of byEvent) {
    const burst = largestBurst(times, BURST_WINDOW_SECONDS);
    if (burst >= BURST_MIN) {
      signals.push({
        kind: "burst",
        title: `${burst} check-ins within ${BURST_WINDOW_SECONDS} seconds at ${name}`,
        detail: `Event ${eventId}. A busy door can do this, and the relayer batches check-ins into one block, but it is also what scripted check-ins look like. Ask the organizer how the door was run.`,
      });
    }
  }

  if (settlements.length >= CONCENTRATION_MIN_SETTLEMENTS && byEvent.size >= 2) {
    const perOrganizer = new Map<string, number>();
    const label = new Map<string, string>();
    for (const s of settlements) {
      const key = s.organizer.toLowerCase();
      perOrganizer.set(key, (perOrganizer.get(key) ?? 0) + 1);
      label.set(key, s.organizerName ?? shortAddress(s.organizer));
    }
    for (const [organizer, n] of perOrganizer) {
      const share = n / settlements.length;
      if (share > CONCENTRATION_SHARE) {
        signals.push({
          kind: "concentration",
          title: `One organizer received ${Math.round(share * 100)} percent of payouts`,
          detail: `${n} of ${settlements.length} payouts went to events run by ${label.get(organizer) ?? organizer}. That can simply be your most active partner. If it is unexpected, review their events before topping up.`,
        });
      }
    }
  }

  const byAttendee = new Map<string, { eventId: string; at: number }[]>();
  for (const s of settlements) {
    const list = byAttendee.get(s.attendee.toLowerCase()) ?? [];
    list.push({ eventId: s.eventId, at: seconds(s.at) });
    byAttendee.set(s.attendee.toLowerCase(), list);
  }
  let hoppers = 0;
  for (const visits of byAttendee.values()) {
    const sorted = visits.sort((a, b) => a.at - b.at);
    const hopped = sorted.some((v, i) => i > 0 && v.eventId !== sorted[i - 1]?.eventId && v.at - (sorted[i - 1]?.at ?? 0) <= HOP_WINDOW_SECONDS);
    if (hopped) hoppers++;
  }
  if (hoppers > 0) {
    signals.push({
      kind: "hopping",
      title: `${hoppers} ${hoppers === 1 ? "attendee was" : "attendees were"} paid at two events within 30 minutes`,
      detail: "Events in the same building can explain this. Events in different cities cannot, so check where those events were held.",
    });
  }

  return signals;
}
