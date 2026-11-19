import type { Metadata } from "next";
import { JudgesDesk } from "../_components/door/JudgesDesk";

export const metadata: Metadata = {
  title: "Judges' desk",
  description: "A live Showmark door for QIE Hackathon judges: scan the code with your own phone to check in. Run by the Showmark team; its pool is team-funded.",
};

export default function JudgesPage() {
  return <JudgesDesk />;
}
