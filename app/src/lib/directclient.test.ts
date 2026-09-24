/**
 * DirectClient drop tests (2026-09-23, Brett's call: NO AUTO-RECONNECT).
 *
 * THE STORY: background re-dials after a drop (a) dialed a blank URL
 * when lastUrl was never assigned (the "retrying and not connecting"
 * bug), then (b) even after that fix, retries with a stale password
 * tripped the node's anti-guessing lockout (5 refusals/min) and locked
 * out the RIGHT password. Brett's verdict: a drop ENDS the session.
 * Pinned here: a 1006 close must NOT dial again - the state goes
 * disabled with the reason, and only a human connect() re-dials.
 *
 * The client's WebSocket needs a browser; tests stub the global
 * WebSocket with a tiny fake that records every dial.
 */
import * as assert from "node:assert";
import { test, runIfMain } from "./testrunner.ts";
import { DirectClient } from "./directclient.ts";

interface FakeCloseEvent {
  code: number;
  wasClean: boolean;
}

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;
  readyState = 1;
  onopen: (() => void) | null = null;
  onclose: ((ev: FakeCloseEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  constructor(public url: string | URL, public protocols?: string[]) {
    FakeWebSocket.instances.push(this);
  }
  close(): void {}
  send(): void {}
}

// @ts-expect-error - install the fake as the global WebSocket
globalThis.WebSocket = FakeWebSocket;

function dialedUrls(): string[] {
  return FakeWebSocket.instances.map((ws) => String(ws.url));
}

test("a 1006 drop ends the session - no background re-dial (Brett)",
  async () => {
    FakeWebSocket.instances = [];
    let lastState = "";
    let lastDetail = "";
    const client = new DirectClient({
      onLog: () => {},
      onState: (s, detail) => { lastState = s; lastDetail = detail ?? ""; },
    });
    client.connect("ws://hilltop:8710/ws");
    assert.strictEqual(dialedUrls().length, 1);

    // the link dies the way Brett's log showed: code=1006, clean=false
    const link = FakeWebSocket.instances[0];
    link.onclose?.({ code: 1006, wasClean: false });

    // give any (now-forbidden) retry timer a moment to misfire
    await new Promise((r) => setTimeout(r, 300));

    // ONE dial, ever: the drop must NOT schedule a background re-dial.
    assert.strictEqual(FakeWebSocket.instances.length, 1,
      "a drop must not re-dial in the background");
    assert.strictEqual(lastState, "disabled");
    assert.ok(lastDetail.includes("1006"),
      `the chip must say why it ended, got: "${lastDetail}"`);

    // ...and only a human connect() dials again:
    client.connect("ws://hilltop:8710/ws");
    assert.strictEqual(FakeWebSocket.instances.length, 2);
    client.disconnect();
  });

runIfMain();
