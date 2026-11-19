import type { Metadata } from "next";
import { AttendeeShell } from "../../_components/AttendeeShell";
import { CheckInScreen } from "./CheckInScreen";

export const metadata: Metadata = {
  title: "Check in",
  // Door codes expire in seconds and carry a signature; nothing here should be indexed.
  robots: { index: false, follow: false },
};

/**
 * /c/{eventId}.{issuedAt}.{doorSig}#{ticketKey}: the URL inside the door QR, so any phone camera
 * opens it. The page reads no route params on the server, so it is one static shell served from the
 * edge; the phone reads the code from the address bar and starts the check-in before hydration.
 */
export default function CheckInPage() {
  return (
    <AttendeeShell current="checkin" tabs={false}>
      <CheckInScreen />
    </AttendeeShell>
  );
}
