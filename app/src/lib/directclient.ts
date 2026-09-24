/**
 * Direct client - WebSocket link to meshtech-node's WebServe.
 *
 * DIRECT mode transport (WEBSERVE-PROTOCOL.md): the node serves the
 * SAME wire bodies the BLE path yields (`wire` hex per packet), so the
 * app's shared decoder consumes them unchanged - direct mode is a new
 * transport, not a new decoder. Metadata is honest: snr is always null
 * (no radio hop - the UI shows "direct", never a fake number).
 *
 * NO AUTO-RECONNECT (2026-09-23, Brett's call): a drop ENDS the
 * session - the app shows disconnected and reconnecting is a human
 * press of Connect (address + password stay saved). Why: background
 * re-dials with a stale password tripped the node's anti-guessing
 * lockout (5 refusals/min), locking out even the right password; and
 * a broken link should say so, not hide behind silent retries.
 *
 * SILENT-DROP WATCHDOG (2026-09-24, Brett's 233-minute pulse age):
 * the rule above only fires when the drop is ANNOUNCED (a close
 * frame). Phone sleep kills TCP without either side noticing - no
 * close event, chip still says "connected", and the pulse-age counter
 * counted up from the last true pulse for hours while the server
 * pulsed into a dead socket. Now: any LINK-DEAD span (no packet AND
 * no pong) past WATCHDOG_TIMEOUT_MS ends the session exactly like an
 * announced close - honest "link lost" chip, Connect is a human
 * press. Heartbeats don't mask a starved feed: the node's cadence
 * (a burst every few minutes, always with packets) is what this
 * actually watches. WS frames can be sent into a half-dead socket,
 * so the flip may take one failed write - it lands on the next tick.
 */

import { decodeAny, type ScopePacket } from "./codec.ts";

export type DirectState =
  | "disabled" | "connecting" | "connected" | "reconnecting";

/** Silent-drop detection span: no LINK-DEAD span may last longer than
 * this before the app itself ends the session. The node's slowest
 * certain heartbeat is the pulse cadence (300s), so 2x plus margin
 * (660s = 11 min) never false-positives on a healthy link. */
export const WATCHDOG_TIMEOUT_MS = 660_000;

/** How often the watchdog looks. Only ever fires long after the
 * timeout, so a coarse 15s poll costs nothing and wakes nobody. */
const WATCHDOG_TICK_MS = 15_000;

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

export class DirectClient {
  private ws: WebSocket | null = null;
  private state: DirectState = "disabled";
  private lastSeq = 0;
  private wantRun = false;
  private proto = 0;
  private txEnabled = false;
  private benchNoRadio = false;
  /** Host's data-door password (SELF-CONTAINED RULE 2026-09-21: the
   * feed link may cross machines; the password gates the DATA door).
   * Sent as a subprotocol - browsers cannot set custom WS headers. */
  private token: string | null = null;
  /** Last proof the link lives (packet OR pong), epoch ms. */
  private lastAliveMs = 0;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  /** Legacy reconnect timer slot (kept for disconnect cleanup). */
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Watchdog timings (tests inject small values; prod uses the
   * honest 11-min timeout). */
  private readonly watchdogMs: number;
  private readonly watchdogTickMs: number;

  constructor(private readonly events: DirectClientEvents,
              opts: { watchdogMs?: number; watchdogTickMs?: number } = {}) {
    this.watchdogMs = opts.watchdogMs ?? WATCHDOG_TIMEOUT_MS;
    this.watchdogTickMs = opts.watchdogTickMs ?? WATCHDOG_TICK_MS;
  }

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
    this.stopWatchdog();
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
    if (!url) {
      // Belt and braces: a blank address must never reach the
      // WebSocket constructor (it would silently connect somewhere
      // else or fail forever - never the node).
      this.wantRun = false;
      this.setState("disabled", "no address to dial");
      return;
    }
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
      this.wantRun = false;
      this.setState("disabled", `bad address: ${String(err)}`);
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      // hello arrives as the first message; state reported there.
      // The watchdog counts from here (0 span at open; it starts
      // for real when "connected" is reported below).
    };
    ws.onmessage = (ev) => this.onMessage(ev.data as string);
    ws.onclose = (ev) => {
      // CLOSE FORENSICS (2026-09-21, the quick-drop mystery): the
      // CloseEvent's code names who ended it - 1001 = the server said
      // "node restarting" (our own close_all_clients), 1006 = the
      // TCP link died without a close frame (crash/network), 4401-ish
      // paths land here as a refused upgrade. Without this line the
      // drop cause was unprovable.
      this.log(`link closed: code=${ev.code} clean=${ev.wasClean}`);
      this.ws = null;
      // NO AUTO-RECONNECT (Brett, 2026-09-23): end the session. The
      // chip shows WHY (code 1006 = the network path died; a refused
      // password lands here too), and Connect is a human press.
      this.stopWatchdog();
      if (!this.wantRun) return;   // disconnect() already reported it
      this.wantRun = false;
      this.setState("disabled", `link closed (code ${ev.code})`);
    };
    ws.onerror = () => { /* onclose follows; it owns the verdict */ };
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
      this.lastAliveMs = Date.now();
      this.startWatchdog();
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
      this.lastAliveMs = Date.now();
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
    if (type === "pong") {
      this.lastAliveMs = Date.now();   // liveness counts; news doesn't
      return;
    }
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
        const secs = Math.ceil(wait);
        this.log(
          why === "map_budget"
            ? `refresh refused - whole-map refresh budget spent, try again in ~${mins} min`
            : why === "hourly_cap"
              ? `refresh refused - the ${mins}-min pool for this size is spent, next slot in ~${mins} min`
              : why === "cooldown"
                ? `refresh refused - asks are rate-limited to one per 30s, try again in ${secs}s`
                : why === "listen_only"
                  ? `refresh refused - this is a listen-only companion device; the map fills from heard packets`
                  : `refresh refused (${why})`);
      }
      return;
    }
  }

  /** Refresh request over the wire - SAME codec bytes as radio mode.
   *  spanKm (v1.3): the client's wanted window (0 = host decides) -
   *  the node pools the global map budget PER SIZE from this value. */
  sendRefresh(payload: Uint8Array, reqId: string, kind: string,
              target: number, origin: number, spanKm = 0): void {
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
      span_km: spanKm,
      wire: Array.from(payload).map((b) =>
        b.toString(16).padStart(2, "0")).join(""),
    });
    this.log(`direct refresh sent (kind=${kind} target=${target}` +
             (spanKm ? `, ${spanKm} km window)` : ")"));
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
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  // ------------------------------------------------- silent-drop watchdog

  private startWatchdog(): void {
    this.stopWatchdog();
    this.watchdogTimer = setInterval(() => {
      if (this.wantRun && this.state === "connected" &&
          Date.now() - this.lastAliveMs > this.watchdogMs) {
        // A silent drop is still a drop: no close frame will ever
        // come. End the session exactly like an announced one.
        // (If the TCP write fails too, onclose completes the job
        // moments later - the states agree.)
        this.log(
          `link lost - no feed for ` +
          `${Math.round(this.watchdogMs / 60000)} min (silent drop)`);
        this.wantRun = false;
        try { this.ws?.close(); } catch { /* already gone */ }
        this.ws = null;
        this.stopWatchdog();
        this.setState("disabled", "link lost (no feed)");
      }
    }, this.watchdogTickMs);
  }

  private stopWatchdog(): void {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.watchdogTimer = null;
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
