/**
 * DirectClient reconnect tests (2026-09-23, Brett's drop-retry bug).
 *
 * THE BUG, pinned: a link drop (code 1006 - phone sleep, Wi-Fi blip)
 * schedules a reconnect that dialed this.lastUrl - which was NEVER
 * assigned. The retry dialed null forever: "retrying and not
 * connecting" until a page refresh re-ran connect() with the real
 * URL. The fix: connect() remembers the URL it was given, and open()
 * refuses to dial a blank one.
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

test("reconnect after a 1006 drop dials the ORIGINAL url (lastUrl bug)",
  async () => {
    FakeWebSocket.instances = [];
    const client = new DirectClient({ onLog: () => {} });
    client.connect("ws://hilltop:8710/ws");
    assert.strictEqual(dialedUrls().length, 1);
    assert.strictEqual(dialedUrls()[0], "ws://hilltop:8710/ws");

    // the link dies the way Brett's log showed: code=1006, clean=false
    const link = FakeWebSocket.instances[0];
    link.onclose?.({ code: 1006, wasClean: false });

    // the retry timer fires after ~1-1.5 s of backoff; the ONE thing
    // that must be true: the second dial carries the node's URL again
    // (before the fix it dialed null and never reconnected at all).
    const deadline = Date.now() + 3000;
    while (FakeWebSocket.instances.length < 2 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.strictEqual(FakeWebSocket.instances.length, 2,
      "a reconnect must have been dialed after the drop");
    assert.strictEqual(dialedUrls()[1], "ws://hilltop:8710/ws",
      `the retry must dial the original url, got: ${dialedUrls()[1]}`);

    client.disconnect();     // stop the client's timers before exiting
  });

runIfMain();
