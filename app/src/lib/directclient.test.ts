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
 * SILENT-DROP WATCHDOG (2026-09-24, the 233-minute pulse age): phone
 * sleep kills TCP with NO close frame - the chip stayed "connected"
 * and the pulse age counted up for hours while the server pulsed into
 * a dead socket. Pinned here: a link that delivers NOTHING past the
 * watchdog span ends itself ("link lost"), and live packets keep it
 * alive. Timings are injected (tiny) so the test runs in milliseconds.
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
  onmessage: ((ev: { data: string }) => void) | null = null;
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

const HELLO = JSON.stringify({
  type: "hello", proto: 5, tx_enabled: false, last_seq: 42,
  feed: { bench_no_radio: false },
});
const PULSE = JSON.stringify({
  type: "packet", seq: 43, ts_ms: 0,
  kind: "pulse", wire: "0153170513017eb1d20404000900280009090305080200010406",
});

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

test("silent drop: a starved link ends itself - 'link lost' (watchdog)",
  async () => {
    FakeWebSocket.instances = [];
    let lastState = "";
    let lastDetail = "";
    const logs: string[] = [];
    // watchdog 80ms span, 20ms ticks: the flip lands in milliseconds
    const client = new DirectClient({
      onLog: (l) => logs.push(l),
      onState: (s, detail) => { lastState = s; lastDetail = detail ?? ""; },
    }, { watchdogMs: 80, watchdogTickMs: 20 });
    client.connect("ws://hilltop:8710/ws");
    const link = FakeWebSocket.instances[0];
    link.onmessage?.({ data: HELLO });          // connected; watchdog armed
    assert.strictEqual(client.linkState, "connected");

    // NO packets, NO pongs - the silent drop. Wait past the span.
    await new Promise((r) => setTimeout(r, 250));

    assert.strictEqual(lastState, "disabled",
      "a starved link must end itself");
    assert.ok(lastDetail.includes("link lost"),
      `the chip must say 'link lost', got: "${lastDetail}"`);
    assert.ok(logs.some((l) => l.includes("silent drop")),
      "the event log must record the silent-drop verdict");
    assert.strictEqual(FakeWebSocket.instances.length, 1,
      "the watchdog must NOT re-dial (a drop ends the session)");
  });

test("silent drop: live packets keep the link alive (feed evidence)",
  async () => {
    FakeWebSocket.instances = [];
    let lastState = "";
    const client = new DirectClient({
      onLog: () => {},
      onState: (s) => { lastState = s; },
    }, { watchdogMs: 120, watchdogTickMs: 20 });
    client.connect("ws://hilltop:8710/ws");
    const link = FakeWebSocket.instances[0];
    link.onmessage?.({ data: HELLO });
    assert.strictEqual(client.linkState, "connected");

    // a healthy feed: a packet every 40 ms (well inside the 120 ms span)
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 40));
      link.onmessage?.({ data: PULSE });
    }
    assert.strictEqual(lastState, "connected",
      "live packets must keep the link connected past any watchdog span");
    client.disconnect();
    assert.strictEqual(lastState, "disabled");
  });

runIfMain();
