// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { recoverTypedDataAddress, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDoorPass, decodeDoorPass, doorPassTypedData, doorPassUrl, ShowmarkNetworkError, type DoorPassPayload } from "@showmark/sdk";
import { CheckInButton, DoorQR, PresenceBadge, type CheckInPhase } from "@showmark/sdk/react";

afterEach(cleanup);

const registry: Address = "0x1111111111111111111111111111111111111111";
const domain = { chainId: 1983, registry };
const door = privateKeyToAccount(generatePrivateKey());
const pass = privateKeyToAccount(generatePrivateKey());
const txHash: Hex = `0x${"ef".repeat(32)}`;

async function freshPass(eventId = 42n): Promise<DoorPassPayload> {
  return createDoorPass({ ...domain, signer: door, eventId });
}

function relayFetch(routes: Record<string, () => Response>) {
  return vi.fn(async (url: string, _init?: RequestInit) => {
    const path = new URL(url).pathname;
    const route = Object.keys(routes).find((p) => path.startsWith(p));
    if (!route) throw new Error(`unexpected ${path}`);
    return (routes[route] as () => Response)();
  });
}

describe("CheckInButton", () => {
  it("signs, relays and waits for the chain, announcing each step", async () => {
    let polls = 0;
    const fetch = relayFetch({
      "/api/relay/check-in": () => Response.json({ txHash, status: "submitted" }),
      "/api/tx/": () => Response.json(++polls < 2 ? { status: "pending" } : { status: "success", blockNumber: "77" }),
    });
    const phases: CheckInPhase[] = [];
    const doorPass = await freshPass();
    render(
      <CheckInButton
        doorPass={doorPassUrl("https://showmark.example", doorPass)}
        account={pass}
        relayUrl="https://showmark.example"
        chainId={1983}
        registry={registry}
        fetch={fetch}
        className="cta"
        statusClassName="cta-status"
        onStateChange={(s) => phases.push(s.phase)}
      />,
    );

    const button = screen.getByRole("button", { name: "Check in" });
    expect(button.className).toBe("cta");
    fireEvent.click(button);

    await waitFor(() => expect(button.getAttribute("data-state")).toBe("confirmed"), { timeout: 5_000 });
    expect(button.textContent).toBe("Checked in");
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toBe("You are checked in.");
    expect(screen.getByRole("status").className).toBe("cta-status");
    expect(phases).toEqual(["signing", "relaying", "confirming", "confirmed"]);

    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as { attendee: string; eventId: string; mode: number };
    expect(body).toMatchObject({ attendee: pass.address, eventId: "42", mode: 1 });
  });

  it("shows the relayer's own copy when it refuses, and lets the attendee retry", async () => {
    const fetch = relayFetch({
      "/api/relay/check-in": () =>
        Response.json(
          { error: { code: "Stale", message: "This door code expired.", action: "Scan the code on the door screen again." } },
          { status: 422 },
        ),
    });
    render(
      <CheckInButton doorPass={await freshPass()} account={pass} relayUrl="https://showmark.example" chainId={1983} registry={registry} fetch={fetch} />,
    );
    const button = screen.getByRole("button");
    fireEvent.click(button);
    await waitFor(() => expect(button.getAttribute("data-state")).toBe("failed"));
    expect(screen.getByRole("status").textContent).toBe("This door code expired. Scan the code on the door screen again.");
    expect(button.textContent).toBe("Try again");
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it("rejects a door code that does not decode, without calling the relayer", async () => {
    const fetch = relayFetch({});
    render(<CheckInButton doorPass="https://x/c/nope" account={pass} relayUrl="https://showmark.example" chainId={1983} registry={registry} fetch={fetch} />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("This door code is not valid"));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports a reverted transaction", async () => {
    const fetch = relayFetch({
      "/api/relay/check-in": () => Response.json({ txHash, status: "submitted" }),
      "/api/tx/": () => Response.json({ status: "reverted", blockNumber: "78" }),
    });
    render(
      <CheckInButton doorPass={await freshPass()} account={pass} relayUrl="https://showmark.example" chainId={1983} registry={registry} fetch={fetch} />,
    );
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByRole("button").getAttribute("data-state")).toBe("failed"), { timeout: 5_000 });
  });

  it("can skip waiting for confirmation and accepts custom labels", async () => {
    const fetch = relayFetch({ "/api/relay/check-in": () => Response.json({ txHash, status: "submitted" }) });
    render(
      <CheckInButton
        doorPass={await freshPass()}
        account={pass}
        relayUrl="https://showmark.example"
        chainId={1983}
        registry={registry}
        fetch={fetch}
        waitForConfirmation={false}
        labels={{ idle: "Stamp my passport", confirmed: "Stamped" }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Stamp my passport" }));
    await screen.findByRole("button", { name: "Stamped" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("PresenceBadge", () => {
  it("reads hasAttended and shows the result", async () => {
    const client = { hasAttended: vi.fn(async () => true) };
    render(<PresenceBadge client={client} eventId={42n} account={pass.address} className="badge" />);
    const badge = await screen.findByText("Attended");
    expect(badge.getAttribute("data-state")).toBe("attended");
    expect(badge.className).toBe("badge");
    expect(client.hasAttended).toHaveBeenCalledWith(42n, pass.address);
  });

  it("shows absence, custom text and errors", async () => {
    const absent = { hasAttended: vi.fn(async () => false) };
    render(<PresenceBadge client={absent} eventId={1n} account={pass.address}>{(s) => `state: ${s}`}</PresenceBadge>);
    await screen.findByText("state: absent");
    cleanup();

    const onError = vi.fn();
    const failing = {
      hasAttended: vi.fn(async (): Promise<boolean> => {
        throw new ShowmarkNetworkError("rpc down");
      }),
    };
    render(<PresenceBadge client={failing} eventId={1n} account={pass.address} onError={onError} />);
    await screen.findByText("Presence unavailable");
    expect(onError).toHaveBeenCalledWith(expect.any(ShowmarkNetworkError));
  });
});

describe("DoorQR", () => {
  it("renders a signed door pass as an SVG QR and re-signs on the interval", async () => {
    const rotations: { pass: DoorPassPayload; url: string }[] = [];
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      render(
        <DoorQR
          doorKey={door}
          eventId={42n}
          chainId={1983}
          registry={registry}
          origin="https://showmark.example"
          className="door"
          imgClassName="door-code"
          onRotate={(p, url) => rotations.push({ pass: p, url })}
        >
          <figcaption>Live count 12</figcaption>
        </DoorQR>,
      );

      const img = await screen.findByRole("img");
      expect(img.getAttribute("src")).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
      expect(img.className).toBe("door-code");
      expect(img.getAttribute("alt")).toContain("changes every 15 seconds");
      expect(screen.getByText("Live count 12").tagName).toBe("FIGCAPTION");
      expect(img.closest("figure")?.getAttribute("data-state")).toBe("ready");

      await act(async () => {
        vi.advanceTimersByTime(15_000);
      });
      await waitFor(() => expect(rotations.length).toBe(2));
    } finally {
      vi.useRealTimers();
    }

    for (const r of rotations) {
      const decoded = decodeDoorPass(r.url);
      expect(decoded).toEqual(r.pass);
      const ticket = privateKeyToAccount(r.pass.ticketKey).address;
      const signer = await recoverTypedDataAddress({ ...doorPassTypedData(domain, { ...r.pass, ticket }), signature: r.pass.doorSig });
      expect(signer).toBe(door.address);
    }
  });
});
