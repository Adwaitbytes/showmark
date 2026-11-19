import { redirect } from "next/navigation";

/** The site header's "My passport" link points at /me; the attendee app lives at /pass. */
export default function MePage() {
  redirect("/pass");
}
