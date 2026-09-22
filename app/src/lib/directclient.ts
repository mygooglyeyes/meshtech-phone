/**
 * Direct client - WebSocket link to meshtech-node's WebServe.
 *
 * DIRECT mode transport (WEBSERVE-PROTOCOL.md): the node serves the
 * SAME wire bodies the BLE path yields (`wire` hex per packet), so the
 * app's shared decoder consumes them unchanged - direct mode is a new
 * transport, not a new decoder. Metadata is honest: snr is always null
 * (no radio hop - the UI shows "direct", never a fake number).
 *
 * Reconnect: exponential backoff 1s -> 30s with jitter (the answerbot's
 * proven pattern). On reconnect the client resumes from its last seq;
 * if the node's sequence regressed (node restarted), local state is
 * stale - a fresh LAYOUT is requested and callers are told via
 * onReset so stale maps are never kept without saying so.
 */

import { decodeAny, type ScopePacket } from "./codec.ts";

export type DirectState =
  | "disabled" | "connecting" | "connected" | "reconnecting";

export interface DirectClientEvents {
  onState?: (state: DirectState, detail?: string) => void;
  /** Decoded scope packets - the SAME onPacket the BLE client feeds. */
  onPacket?: (packet: ScopePacket, meta: { snr?: number }) => void;
  /** The node restarted (seq regressed): drop local feed state. */
  onReset?: () => void;
  /** One-line protocol events for the event log. */
  onLog?: (line: string) => void;
  /** Server state snapshots (state message) - bench visibility. */
  onNodeState?: (snap: { listener: unknown; feed: unknown }) => void;
}

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;

export class DirectClient {
  private ws: WebSocket | null = null;
  private state: DirectState = "disabled";
  private backoffMs = BASE_BACKOFF_MS;
  private lastSeq = 0;
  private wantRun = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private proto = 0;
  private txEnabled = false;
  private benchNoRadio = false;
  /** Host's data-door password (SELF-CONTAINED RULE 2026-09-21: the
   * feed link may cross machines; the password gates the DATA door).
   * Sent as a subprotocol - browsers cannot set custom WS headers. */
  private token: string | null = null;

  constructor(private readonly events: DirectClientEvents) {}

  get linkState(): DirectState {
    return this.state;
  }

  /** Server-reported truth (hello). */
  get nodeInfo(): { proto: number; txEnabled: boolean; bench: boolean } {
    return { proto: this.proto, txEnabled: this.txEnabled,
             bench: this.benchNoRadio };
  }

  connect(url: string, token?: string): void {
    this.wantRun = true;
    this.token = token || null;
    this.open(url);
  }

  disconnect(): void {
    this.wantRun = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.ws) {
      try { this.ws.close(); } catch { /* already gone */ }
      this.ws = null;
    }
    this.setState("disabled");
  }

  private open(url: string): void {
    if (!this.wantRun) return;
    this.setState("connecting");
    let ws: WebSocket;
    try {
      // Token via WebSocket subprotocol ("bearer.<token>"): the one
      // channel a browser WS actually controls. The node compares the
      // received subprotocol against its token (constant-time). No
      // token = no subprotocol = loopback/same-origin use as before.
      ws = this.token
        ? new WebSocket(url, [`bearer.${this.token}`])
        : new WebSocket(url);
    } catch (err) {
      this.scheduleReconnect(`bad url: ${String(err)}`);
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.backoffMs = BASE_BACKOFF_MS; // healthy link: reset backoff
      // hello arrives as the first message; state reported there.
    };
    ws.onmessage = (ev) => this.onMessage(ev.data as string);
    ws.onclose = (ev) => {
      // CLOSE FORENSICS (2026-09-21, the quick-drop mystery): the
      // CloseEvent's code names who ended it - 1001 = the server said
      // "node restarting" (our own close_all_clients), 1006 = the
      // TCP link died without a close frame (crash/network), and a
      // heartbeat timeout shows as 1006 too. Without this line the
      // drop cause was unprovable.
      this.log(`link closed: code=${ev.code} clean=${ev.wasClean}`);
      this.ws = null;
      if (this.wantRun) this.scheduleReconnect("link closed");
    };
    ws.onerror = () => { /* onclose follows; it owns the retry */ };
  }

  private onMessage(raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return; // never a JSON frame - ignore, count via log below
    }
    const type = msg.type as string;
    if (type === "hello") {
      this.proto = Number(msg.proto ?? 0);
      this.txEnabled = Boolean(msg.tx_enabled);
      this.benchNoRadio = Boolean(
        (msg.feed as Record<string, unknown> | undefined)?.bench_no_radio);
      this.setState("connected",
        `node proto ${this.proto}` +
        (this.benchNoRadio ? " - BENCH (tx impossible)" :
          this.txEnabled ? "" : " - node TX off (listen-only)"));
      this.log(`node hello: proto ${this.proto}, last_seq ${msg.last_seq}`);
      // Node restarted since our last view? Its seq regressed -> local
      // state is stale: drop it and let a fresh LAYOUT redraw (the
      // node serves LAYOUT immediately after restart, so the map
      // returns in seconds, not an hour).
      this.noteHelloSeq(Number(msg.last_seq ?? 0));
      // fresh session: resume anything newer than our last seq.
      this.send({ type: "resume", after_seq: this.lastSeq });
      return;
    }
    if (type === "packet") {
      const seq = Number(msg.seq ?? 0);
      if (seq <= this.lastSeq) return;        // duplicate from resume
      this.lastSeq = seq;
      const wire = String(msg.wire ?? "");
      try {
        const bytes = new Uint8Array(
          wire.match(/.{1,2}/g)?.map((h) => parseInt(h, 16)) ?? []);
        const packet = decodeAny(bytes);
        if (packet) this.events.onPacket?.(packet, { snr: null });
      } catch (err) {
        this.log(`decode failed: ${String(err)}`);
      }
      return;
    }
    if (type === "state") {
      this.events.onNodeState?.({
        listener: msg.listener,
        feed: msg.feed,
      });
      return;
    }
    if (type === "pong") return; // liveness, not news
    if (type === "ack") {
      // The node's verdict on a refresh request. Honest refusal beats
      // silence: a budget-spent whole-map refresh would otherwise look
      // like "sent... nothing happened" (the 2026-09-18 pain, again).
      const accepted = Boolean(msg.accepted);
      if (accepted) {
        this.log(`refresh accepted (${msg.req_id})`);
      } else {
        const wait = Number(msg.retry_after_s ?? 0);
        const why = String(msg.reason ?? "refused");
        const mins = Math.ceil(wait / 60);
        this.log(
          why === "map_budget"
            ? `refresh refused - whole-map refresh budget spent, try again in ~${mins} min`
            : why === "listen_only"
              ? `refresh refused - this is a listen-only companion device; the map fills from heard packets`
              : `refresh refused (${why})`);
      }
      return;
    }
  }

  private scheduleReconnect(reason: string): void {
    if (!this.wantRun) return;
    this.setState("reconnecting", reason);
    const jitter = Math.floor(Math.random() * 500);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.wantRun) {
        // Node restarted (seq regressed) is detected at hello time via
        // last_seq; treat every reconnect as potentially stale: if the
        // node's hello last_seq < our lastSeq, state is stale.
        this.open(this.lastUrl!);
      }
    }, this.backoffMs + jitter);
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
  }

  private lastUrl: string | null = null;

  /** Refresh request over the wire - SAME codec bytes as radio mode. */
  sendRefresh(payload: Uint8Array, reqId: string, kind: string,
              target: number, origin: number): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.log("not connected - refresh NOT sent");
      return;
    }
    this.send({
      type: "refresh",
      req_id: reqId,
      kind,
      target,
      origin,
      wire: Array.from(payload).map((b) =>
        b.toString(16).padStart(2, "0")).join(""),
    });
    this.log(`direct refresh sent (kind=${kind} target=${target})`);
  }

  /** True when the node restarted (hello last_seq < our lastSeq). */
  noteHelloSeq(lastSeq: number): boolean {
    if (lastSeq < this.lastSeq) {
      this.lastSeq = 0;
      this.events.onReset?.();
      return true;
    }
    return false;
  }

  private send(obj: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  private setState(s: DirectState, detail?: string): void {
    if (this.state === s && !detail) return;
    this.state = s;
    this.events.onState?.(s, detail);
  }

  private log(line: string): void {
    this.events.onLog?.(line);
  }
}
