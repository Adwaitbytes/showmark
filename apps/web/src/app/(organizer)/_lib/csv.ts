// Attendee export for organizers. Plain RFC 4180 CSV that opens in Excel, Sheets and Numbers.

export interface AttendeeRow {
  attendee: string;
  qieName: string | null;
  mode: 1 | 2;
  doorTime: string; // ISO 8601
  streak: number;
  tx: string;
}

function cell(value: string | number): string {
  const text = String(value);
  // A leading = + - @ makes spreadsheets run the cell as a formula; prefix a quote so it stays text.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function attendeesCsv(rows: readonly AttendeeRow[], explorerTx: (hash: string) => string): string {
  const header = ["attendee", "qie_name", "proof_mode", "door_time_utc", "streak", "transaction", "explorer_link"];
  const lines = rows.map((r) =>
    [r.attendee, r.qieName ?? "", r.mode === 2 ? "door scans you" : "rotating door code", r.doorTime, r.streak, r.tx, explorerTx(r.tx)]
      .map(cell)
      .join(","),
  );
  return [header.join(","), ...lines].join("\r\n") + "\r\n";
}
