import { getAddress, zeroAddress } from "viem";
import { describe, expect, it } from "vitest";
import {
  buildMetadata,
  campaignMetadataSchema,
  localInputToSeconds,
  secondsToLocalInput,
  validateCampaignForm,
  type CampaignFormValues,
} from "./form";

const QUSDC = getAddress("0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5");
const NOW = localInputToSeconds("2026-11-20T10:00") ?? 0;

function values(overrides: Partial<CampaignFormValues> = {}): CampaignFormValues {
  return {
    name: "Pune builders night",
    sponsorName: "Acme Labs",
    description: "Pays every verified attendee at our meetups.",
    url: "https://acme.example",
    token: "QUSDC",
    pricing: "token",
    amount: "2",
    attendeeShareBps: 6_000,
    minProofMode: 1,
    requireQieId: false,
    startsAt: "2026-11-20T09:00",
    endsAt: "2026-11-30T21:00",
    maxPerEvent: "",
    maxTotal: "250",
    openToBonded: false,
    minBond: "",
    deposit: "500",
    ...overrides,
  };
}

describe("validateCampaignForm", () => {
  it("turns a valid QUSDC form into exact createCampaign arguments", () => {
    const result = validateCampaignForm(values(), NOW, QUSDC);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { params, deposit, token } = result.draft;
    expect(token).toBe("QUSDC");
    expect(deposit).toBe(500_000_000n);
    expect(params).toMatchObject({
      token: QUSDC,
      pricing: 0,
      amountPerPresence: 2_000_000n,
      attendeeShareBps: 6_000,
      minProofMode: 1,
      requireQieId: false,
      maxPerEvent: 0,
      maxTotal: 250,
      openToBonded: false,
      minBond: 0n,
    });
    expect(params.startsAt).toBe(BigInt(localInputToSeconds("2026-11-20T09:00") ?? -1));
    expect(campaignMetadataSchema.parse(JSON.parse(params.metadata))).toEqual({
      v: 1,
      name: "Pune builders night",
      sponsor: "Acme Labs",
      description: "Pays every verified attendee at our meetups.",
      url: "https://acme.example",
    });
  });

  it("stores USD pricing with 6 decimals and pays in native QIE", () => {
    const result = validateCampaignForm(values({ token: "QIE", pricing: "usd", amount: "1.25", deposit: "40" }), NOW, QUSDC);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.params).toMatchObject({ token: zeroAddress, pricing: 1, amountPerPresence: 1_250_000n });
    expect(result.draft.deposit).toBe(40n * 10n ** 18n);
  });

  it("refuses USD pricing with QUSDC, because the vault requires native QIE", () => {
    const result = validateCampaignForm(values({ pricing: "usd" }), NOW, QUSDC);
    expect(result).toMatchObject({ ok: false, errors: { pricing: expect.any(String) } });
  });

  it("refuses QUSDC where it does not exist", () => {
    const result = validateCampaignForm(values(), NOW, zeroAddress);
    expect(result).toMatchObject({ ok: false, errors: { token: expect.stringContaining("Mainnet") } });
  });

  it("requires an end after the start and after now", () => {
    expect(validateCampaignForm(values({ endsAt: "2026-11-20T08:00" }), NOW, QUSDC)).toMatchObject({
      ok: false,
      errors: { endsAt: "The end must be after the start." },
    });
    expect(validateCampaignForm(values({ startsAt: "2026-11-19T08:00", endsAt: "2026-11-19T09:00" }), NOW, QUSDC)).toMatchObject({
      ok: false,
      errors: { endsAt: expect.stringContaining("past") },
    });
  });

  it("rejects zero, malformed and over-precise amounts", () => {
    expect(validateCampaignForm(values({ amount: "0" }), NOW, QUSDC)).toMatchObject({ ok: false, errors: { amount: expect.any(String) } });
    expect(validateCampaignForm(values({ amount: "two" }), NOW, QUSDC)).toMatchObject({ ok: false, errors: { amount: expect.any(String) } });
    expect(validateCampaignForm(values({ amount: "1.0000001" }), NOW, QUSDC)).toMatchObject({ ok: false, errors: { amount: expect.stringContaining("6") } });
  });

  it("requires the deposit to cover at least one payout", () => {
    expect(validateCampaignForm(values({ deposit: "1" }), NOW, QUSDC)).toMatchObject({ ok: false, errors: { deposit: expect.any(String) } });
    expect(validateCampaignForm(values({ deposit: "0" }), NOW, QUSDC)).toMatchObject({ ok: false, errors: { deposit: expect.any(String) } });
  });

  it("requires a positive minimum bond when open to bonded organizers, as the vault does", () => {
    expect(validateCampaignForm(values({ openToBonded: true, minBond: "" }), NOW, QUSDC)).toMatchObject({
      ok: false,
      errors: { minBond: expect.any(String) },
    });
    const ok = validateCampaignForm(values({ openToBonded: true, minBond: "100" }), NOW, QUSDC);
    expect(ok.ok && ok.draft.params.minBond).toBe(100n * 10n ** 18n);
  });

  it("validates caps as whole numbers within uint32", () => {
    expect(validateCampaignForm(values({ maxPerEvent: "1.5" }), NOW, QUSDC)).toMatchObject({ ok: false, errors: { maxPerEvent: expect.any(String) } });
    expect(validateCampaignForm(values({ maxTotal: "4294967296" }), NOW, QUSDC)).toMatchObject({ ok: false, errors: { maxTotal: expect.any(String) } });
    expect(validateCampaignForm(values({ maxTotal: "0" }), NOW, QUSDC)).toMatchObject({ ok: false, errors: { maxTotal: expect.any(String) } });
  });

  it("requires a name, a sponsor and an https link", () => {
    const result = validateCampaignForm(values({ name: " ", sponsorName: "", url: "http://acme.example" }), NOW, QUSDC);
    expect(result).toMatchObject({
      ok: false,
      errors: { name: expect.any(String), sponsorName: expect.any(String), url: expect.any(String) },
    });
  });

  it("counts metadata in UTF-8 bytes against the 2,048 byte limit", () => {
    // Every field within its character limit, but Devanagari takes 3 bytes per character: 2,280 bytes plus JSON.
    const long = { name: "क".repeat(80), sponsorName: "क".repeat(80), description: "क".repeat(600) };
    const result = validateCampaignForm(values(long), NOW, QUSDC);
    expect(result).toMatchObject({ ok: false, errors: { metadata: expect.stringContaining("2048") } });
  });
});

describe("metadata and time helpers", () => {
  it("omits url when empty", () => {
    expect(JSON.parse(buildMetadata({ name: "a", sponsorName: "b", description: "", url: "" }))).toEqual({
      v: 1,
      name: "a",
      sponsor: "b",
      description: "",
    });
  });

  it("round trips datetime-local values", () => {
    const seconds = localInputToSeconds("2026-11-25T18:30");
    expect(seconds).not.toBeNull();
    expect(secondsToLocalInput(seconds ?? 0)).toBe("2026-11-25T18:30");
    expect(localInputToSeconds("not a date")).toBeNull();
  });
});
