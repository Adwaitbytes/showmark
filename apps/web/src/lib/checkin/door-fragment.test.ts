import { describe, expect, it } from "vitest";
import { generatePrivateKey } from "viem/accounts";
import { encodeDoorPass } from "@/lib/qr/payload";
import { classifyDoorCode } from "./door-fragment";

const [token, fragment] = encodeDoorPass({ eventId: 12n, issuedAt: 1_764_245_000n, doorSig: `0x${"11".repeat(64)}1b`, ticketKey: generatePrivateKey() }).split("#");

describe("classifyDoorCode", () => {
  it("waits while the fragment is unknown (server render and hydration)", () => {
    expect(classifyDoorCode(token, null)).toEqual({ status: "reading" });
  });

  it("decodes the path token together with the #ticketKey fragment", () => {
    const code = classifyDoorCode(token, fragment);
    expect(code.status).toBe("ok");
    if (code.status === "ok") expect(code.door.eventId).toBe(12n);
  });

  it("tells a door link that lost its fragment apart from a link that is not a door code", () => {
    expect(classifyDoorCode(token, "")).toEqual({ status: "missing-key" });
    expect(classifyDoorCode("not-a-door-code", "")).toEqual({ status: "invalid" });
    expect(classifyDoorCode(token, "AAAA")).toEqual({ status: "invalid" });
  });
});
