import type { SponsorSettlement } from "@/lib/sponsor/api";
import { AddressChip } from "@/ui/AddressChip";
import { formatDate, formatTime, shortAddress, type TokenSymbol } from "@/ui/format";
import { TxLink } from "@/ui/TxLink";
import { amountText } from "./campaign";

function Who({ address, name }: { address: string; name?: string | null; plain: true }) {
  return (
    <span className="flex flex-col" title={address}>
      {name ? <span className="font-medium">{name}</span> : null}
      <span className="font-mono text-xs">{shortAddress(address)}</span>
    </span>
  );
}

/**
 * Every payout, one row per verified person, each linked to its transaction. `plain` drops interactive chips for the
 * printed report, where the transaction link is what matters.
 */
export function SettlementsTable({ settlements, symbol, plain = false }: { settlements: SponsorSettlement[]; symbol: TokenSymbol; plain?: boolean }) {
  return (
    <>
      <div className={plain ? "relative -mx-6 overflow-x-auto px-6 sm:mx-0 sm:px-0 print:overflow-visible" : "relative hidden overflow-x-auto md:block print:block"}>
        <table className={plain ? "w-full min-w-[46rem] border-collapse text-left text-sm print:min-w-0" : "w-full border-collapse text-left text-sm"}>
          <caption className="sr-only">Payouts, newest first</caption>
          <thead>
            <tr className="border-b border-ink text-xs text-ink-soft">
              <th scope="col" className="py-2 pr-4 font-medium">When</th>
              <th scope="col" className="py-2 pr-4 font-medium">Event</th>
              <th scope="col" className="py-2 pr-4 font-medium">Attendee</th>
              <th scope="col" className="py-2 pr-4 font-medium">Organizer</th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">Attendee got</th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">Organizer got</th>
              <th scope="col" className="py-2 font-medium">Transaction</th>
            </tr>
          </thead>
          <tbody>
            {settlements.map((s) => (
              <tr key={`${s.eventId}-${s.attendee}`} className="border-b border-rule-soft align-top break-inside-avoid">
                <td className="py-2.5 pr-4 whitespace-nowrap text-ink-soft">
                  {formatDate(s.at)}
                  <span className="block text-xs">{formatTime(s.at)}</span>
                </td>
                <td className="py-2.5 pr-4 text-ink">
                  {s.eventName}
                  <span className="block font-mono text-xs text-ink-faint">#{s.eventId}</span>
                </td>
                <td className="py-2.5 pr-4">
                  <Who address={s.attendee} name={s.attendeeName} plain />
                </td>
                <td className="py-2.5 pr-4">
                  <Who address={s.organizer} name={s.organizerName} plain />
                </td>
                <td className="py-2.5 pr-4 text-right font-mono whitespace-nowrap">{amountText(s.toAttendee, symbol)}</td>
                <td className="py-2.5 pr-4 text-right font-mono whitespace-nowrap">{amountText(s.toOrganizer, symbol)}</td>
                <td className="py-2.5">
                  <TxLink hash={s.tx} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {plain ? null : (
        <ul className="flex flex-col md:hidden print:hidden" aria-label="Payouts, newest first">
          {settlements.map((s) => (
            <li key={`${s.eventId}-${s.attendee}`} className="flex flex-col gap-2 border-b border-rule-soft py-4 last:border-b-0">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-base text-ink">{s.eventName}</span>
                <span className="shrink-0 text-xs text-ink-soft">
                  {formatDate(s.at)}, {formatTime(s.at)}
                </span>
              </div>
              <dl className="grid grid-cols-[4.75rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 text-sm">
                <dt className="text-ink-soft">Attendee</dt>
                <dd className="min-w-0">
                  <AddressChip address={s.attendee} name={s.attendeeName} copy={false} />
                </dd>
                <dd className="text-right font-mono">{amountText(s.toAttendee, symbol)}</dd>
                <dt className="text-ink-soft">Organizer</dt>
                <dd className="min-w-0">
                  <AddressChip address={s.organizer} name={s.organizerName} copy={false} />
                </dd>
                <dd className="text-right font-mono">{amountText(s.toOrganizer, symbol)}</dd>
              </dl>
              <TxLink hash={s.tx} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
