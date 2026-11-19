import type { Metadata } from "next";
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
      <div className="mx-auto flex w-full max-w-[36rem] flex-col gap-6 px-4 pt-6 sm:pt-10">
        <SubpageIntro page="withdraw" />
        <Withdraw />
      </div>
    </AttendeeShell>
  );
}
