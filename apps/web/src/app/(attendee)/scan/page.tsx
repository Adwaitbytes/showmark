import type { Metadata } from "next";
import { AttendeeShell } from "../_components/AttendeeShell";
import { Scanner } from "./Scanner";
import { ScanIntro, ScanTip } from "./ScanIntro";

export const metadata: Metadata = {
  title: "Scan a door code",
  description: "Scan the QR code on a Showmark door screen to check in.",
};

/** For people who open the app first. Most people never see this: their camera app opens /c/ directly. */
export default function ScanPage() {
  return (
    <AttendeeShell current="scan">
      <div className="mx-auto flex w-full max-w-[32rem] flex-col gap-6 px-4 pt-6 sm:pt-10">
        <ScanIntro />
        <Scanner />
        <ScanTip />
      </div>
    </AttendeeShell>
  );
}
