import type { Metadata } from "next";
import { AttendeeShell } from "../_components/AttendeeShell";
import { PassportScreen } from "./PassportScreen";

export const metadata: Metadata = {
  title: "Your passport",
  description: "Your Showmark stamps, rewards and door code on this phone.",
  robots: { index: false, follow: false },
};

/**
 * The home of the attendee app. Everything here belongs to the pass on this phone, which only the
 * browser knows, so the page is a static shell and the passport loads on the device.
 */
export default function PassportPage() {
  return (
    <AttendeeShell current="pass">
      <PassportScreen />
    </AttendeeShell>
  );
}
