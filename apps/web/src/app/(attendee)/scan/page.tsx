import type { Metadata } from "next";
import { PhoneHandoff } from "../_components/PhoneHandoff";
import { AttendeeShell } from "../_components/AttendeeShell";
import { Scanner } from "./Scanner";
import { ScanIntro } from "./ScanIntro";

export const metadata: Metadata = {
  title: "Scan a door code",
  description: "Scan the QR code on a Showmark door screen to check in.",
};

/** For people who open the app first. Most people never see this: their camera app opens /c/ directly. */
export default function ScanPage() {
  return (
    <AttendeeShell current="scan">
      <div className="mx-auto grid w-full max-w-[64rem] gap-16 px-4 pt-6 sm:px-6 sm:pt-10 lg:grid-cols-[minmax(0,34rem)_20rem] lg:justify-between lg:px-8">
        <div className="flex min-w-0 flex-col gap-6">
          <ScanIntro />
          <Scanner />
        </div>
        <PhoneHandoff page="scan" />
      </div>
    </AttendeeShell>
  );
}
