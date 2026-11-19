import type { Metadata } from "next";
import { PhoneHandoff } from "../../_components/PhoneHandoff";
import { AttendeeShell } from "../../_components/AttendeeShell";
import { SubpageIntro } from "../SubpageIntro";
import { Withdraw } from "./Withdraw";

export const metadata: Metadata = {
  title: "Withdraw rewards",
  robots: { index: false, follow: false },
};

export default function WithdrawPage() {
  return (
    <AttendeeShell current="pass">
      <div className="mx-auto grid w-full max-w-[64rem] gap-16 px-4 pt-6 sm:px-6 sm:pt-10 lg:grid-cols-[minmax(0,36rem)_20rem] lg:justify-between lg:px-8">
        <div className="flex min-w-0 flex-col gap-6">
          <SubpageIntro page="withdraw" />
          <Withdraw />
        </div>
        <PhoneHandoff page="withdraw" />
      </div>
    </AttendeeShell>
  );
}
