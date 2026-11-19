import type { StatusTone } from "@/ui/StatusMark";

const HOUR = 3_600_000;

export interface EventStatus {
  tone: StatusTone;
  label: string;
}

/** Where an event is in its life, judged by its check-in window (one hour either side). */
export function eventStatus(startsAt: string, endsAt: string, now: number = Date.now()): EventStatus {
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  if (now < start - HOUR) return { tone: "scheduled", label: "Upcoming" };
  if (now <= end + HOUR) return { tone: "live", label: "Check-in open" };
  return { tone: "ended", label: "Ended" };
}
