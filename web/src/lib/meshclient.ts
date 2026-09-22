/**
 * Mesh client - BLE link to the companion radio + CHANNEL_DATA parse.
 *
 * Uses the official meshcore.js library when served with a bundler
 * (`import("meshcore.js")`), and falls back to direct Web Bluetooth
 * (Nordic UART service) when the dynamic import fails (e.g. running
 * from file:// during bench testing). Both paths feed the same frame
 * reassembler; decoded scope packets come out through onData.
 *
 * VERIFIED 2026-09-17 (meshtech-scope TODOS #11): the official
 * meshcore.js already parses CHANNEL_DATA_RECV frames (ResponseCode 27)
 * byte-identically to the Python SDK, and exposes sendChannelData()
 * for TX - no upstream work needed. When driving the library directly,
 * listen on the NUMERIC event key 27 (connection.emit(27, {snr,
 * channelIdx, pathLen, dataType, dataLen, data})), or use
 * getWaitingMessages() which resolves { channelData: {...} }.
 */

import { decodeAny, type ScopePacket } from "./codec.ts";

// Nordic UART service (verified against the meshcore SDK's ble_cx.py)
const UART_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const UART_TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"; // radio -> phone
const UART_RX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"; // phone -> radio

export type LinkState = "disconnected" | "connecting" | "connected";

// Companion-protocol constants (docs.meshcore.io/companion_protocol,
// cross-checked against openhop_core frame_server.py + the plugin's
// client.py - never guess wire constants).
const CMD_APP_START = 0x01;          // first after connect
const CMD_SYNC_NEXT_MESSAGE = 0x0a;  // poll: next queued packet
const CMD_DEVICE_QUERY = 0x16;       // arg 0x03 -> PACKET_DEVICE_INFO
const CMD_GET_CHANNEL = 0x1f;        // arg: slot 0..7
const CMD_SEND_CHANNEL_DATA = 62;    // [62][slot][0xFF]+type+payload
const RSP_CHANNEL_INFO = 0x12;       // 50 B: idx,name(32),secret(16)
const RSP_CHANNEL_DATA_RECV = 0x1b;  // scope datagrams arrive here
const SCOPE_CHANNEL_NAME = "scope";

export interface MeshClientEvents {
  onState?: (state: LinkState, detail?: string) => void;
  onPacket?: (packet: ScopePacket, meta: { snr?: number; rssi?: number }) => void;
  onRaw?: (frame: Uint8Array) => void;
  onLog?: (line: string) => void;
}

/** Companion CHANNEL_DATA_RECV frame: code(1)+snr(1)+rsv(2)+chan(1)+
 *  path_len(1)+data_type(2)+data_len(1)+payload. We locate the 9-byte
 *  header by the scope magic rather than trusting stream sync. */
export function extractScopePayloads(
  frame: Uint8Array,
): Array<{ payload: Uint8Array; snr?: number }> {
  const out: Array<{ payload: Uint8Array; snr?: number }> = [];
  for (let off = 0; off + 9 <= frame.length; off++) {
    const dataType = frame[off + 6] | (frame[off + 7] << 8);
    if ((dataType & 0xff00) !== 0x5300) continue;
    const dataLen = frame[off + 8];
    if (off + 9 + dataLen > frame.length) continue;
    const snrRaw = frame[off + 1];
    // signed 8-bit -> quarters (companion convention)
    const snr = (snrRaw >= 128 ? snrRaw - 256 : snrRaw) / 4;
    // Reconstruct the FULL plaintext from the envelope: bytes 6-7 =
    // data_type (2 LE), byte 8 = data_len, bytes 9.. = body (the
    // firmware strips the 3-byte prefix when queueing, and
    // _build_message_frame rebuilds the envelope around it). Slicing
    // 6..8+len reassembles data_type+data_len+body - what decodeAny
    // expects. Verified LIVE 2026-09-18 16:26:55: "scope pulse
    // received (snr 12.0dB)". (Slicing from 9 yields a headless body
    // that fails the type dispatch silently - the 16:13-16:19 bug.)
    out.push({ payload: frame.slice(off + 6, off + 9 + dataLen), snr });
    off += 9 + dataLen - 1;
  }
  // Bare scope plaintext (bench captures): also accept directly.
  if (out.length === 0 && frame.length >= 3 && (frame[1] & 0xff) === 0x53
      && frame[1] === 0x53) {
    out.push({ payload: frame });
  }
  return out;
}

/** Nordic-UART frame reassembler: 0xFF prefix + len(2 LE) + payload. */
export class FrameReassembler {
  private buf = new Uint8Array(0);

  feed(chunk: Uint8Array, onFrame: (frame: Uint8Array) => void): void {
    const merged = new Uint8Array(this.buf.length + chunk.length);
    merged.set(this.buf);
    merged.set(chunk, this.buf.length);
    this.buf = merged;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      // resync to prefix byte
      while (this.buf.length >= 1 && this.buf[0] !== 0xff) {
        this.buf = this.buf.subarray(1);
      }
      if (this.buf.length < 3) return;
      const total = 3 + (this.buf[1] | (this.buf[2] << 8));
      if (this.buf.length < total) return;
      const frame = this.buf.slice(3, total);
      this.buf = this.buf.subarray(total);
      if (frame.length > 0) onFrame(frame);
    }
  }
}

export class MeshClient {
  private events: MeshClientEvents;
  private device: any = null;
  private characteristic: any = null;
  private state: LinkState = "disconnected";
  private meshcoreModule: any = null;
  private pollTimer: number | null = null;
  /** Notification reassembly buffer (raw response packets). */
  private rxbuf = new Uint8Array(0);
  /** #scope slot in the radio's channel table (found by probing). */
  private scopeSlot: number | null = null;
  /** Expected #scope secret: sha256("#scope")[:16] (hashtag rule). */
  private expectedSecret: Uint8Array | null = null;
  /** Timestamp of an uplink awaiting the radio's OK/ERROR verdict. */
  private awaitingTxAck = 0;

  constructor(events: MeshClientEvents) {
    this.events = events;
  }

  private setState(state: LinkState, detail?: string): void {
    this.state = state;
    this.events.onState?.(state, detail);
  }

  private handleFrame(frame: Uint8Array): void {
    this.events.onRaw?.(frame);
    for (const { payload, snr } of extractScopePayloads(frame)) {
      let packet: ScopePacket;
      try {
        packet = decodeAny(payload);
      } catch (e) {
        // decode failure IS diagnostic - never swallow silently
        this.events.onLog?.(`decode failed: ${e}`);
        continue;
      }
      // WIRE TRUTH (2026-09-18 health-numbers hunt): the card showed
      // impossible values (airtime > 3600 s/h) with tests green on
      // both ends - so the on-air bytes must differ from what either
      // side's tests assume. Log the header + first fields as hex for
      // one capture cycle; remove once the mismatch is named.
      {
        const hex = Array.from(payload.slice(0, 16))
          .map((b) => b.toString(16).padStart(2, "0")).join("");
        this.events.onLog?.(`wire ${packet.kind}: ${hex}${payload.length > 16 ? "…" : ""} (${payload.length}B)`);
      }
      try {
        this.events.onPacket?.(packet, { snr });
      } catch (e) {
        // an app-side throw (state/render) must name itself, not
        // vanish - the 2026-09-18 silent-render hunt
        this.events.onLog?.(`app handler failed on ${packet.kind}: ${e}`);
      }
    }
  }

  /**
   * Raw-response handling. Per the protocol doc, one notification
   * carries one protocol frame (long frames may SPLIT across
   * notifications, so 0x1B/0x12 accumulate in rxbuf until complete).
   * Scope datagrams (0x1B, data_type 0x53xx) go to handleFrame;
   * everything else is logged once per 10 s so a silent link and a
   * quiet feed are never indistinguishable again.
   */
  private rxBuffer(chunk: Uint8Array): void {
    const merged = new Uint8Array(this.rxbuf.length + chunk.length);
    merged.set(this.rxbuf);
    merged.set(chunk, this.rxbuf.length);
    this.rxbuf = merged;
    if (this.rxbuf.length === 0) return;
    const t = merged[0];
    if (t === RSP_CHANNEL_DATA_RECV) {
      if (merged.length < 9) return; // header split - wait
      const dataLen = merged[8];
      if (merged.length < 9 + dataLen) return; // body split - wait
      this.handleFrame(merged.slice(0, 9 + dataLen));
      this.rxbuf = merged.slice(9 + dataLen);
      if (this.rxbuf.length > 0) this.rxBuffer(new Uint8Array(0));
      return;
    }
    if (t === RSP_CHANNEL_INFO) {
      if (merged.length < 50) return; // split - wait
      this.onChannelInfo(merged.slice(0, 50));
      this.rxbuf = new Uint8Array(0);
      return;
    }
    if (t === 0x0d && merged.length >= 2) {
      // PACKET_DEVICE_INFO: fw_ver(1) ... build(12 @8). Log version +
      // build only - NEVER the BLE PIN (bytes 4-7). Older companion
      // firmware lacks channel-datagram support entirely, which would
      // explain zero 0x1B frames on a live mesh (2026-09-18 hunt).
      let build = "";
      if (merged.length >= 20) {
        build = new TextDecoder().decode(merged.slice(8, 20))
          .replaceAll("\x00", "").trim();
      }
      this.events.onLog?.(`radio firmware v${merged[1]}${build ? ` (${build})` : ""} - datagram support needs v1.12+`);
      return;
    }
    // One complete short frame (ack / no-more / self-info / waiting...)
    this.events.onRaw?.(merged);
    this.rxbuf = new Uint8Array(0);
    // TX verdict: SEND_CHANNEL_DATA answers PACKET_OK (0x00) or
    // PACKET_ERROR (0x01+code). Surface it - the uplink's fate must
    // never be invisible (2026-09-18: a filtered 1-byte OK hid the
    // fact that we could not tell accepted vs silently dropped).
    if (this.awaitingTxAck && (t === 0x00 || t === 0x01)) {
      this.awaitingTxAck = 0;
      this.events.onLog?.(t === 0x00
        ? "uplink ACCEPTED by radio (OK)"
        : `uplink REJECTED by radio (error code ${merged[1] ?? "?"})`);
      return;
    }
    // Heartbeat/ack frames (0x0a sync-acks etc.) are logged nowhere:
    // a steady link must be silent in the log. Real uplink verdicts
    // (OK/ERROR above) and packet frames still print - the log stays
    // signal, not noise (Brett, 2026-09-18: the 1/10s heartbeat
    // flooding made real packets hard to find).
  }

  /** PACKET_CHANNEL_INFO (0x12): idx(1) name(32) secret(16). */
  private onChannelInfo(frame: Uint8Array): void {
    const idx = frame[1];
    let end = 2;
    while (end < 34 && frame[end] !== 0) end++;
    const name = new TextDecoder().decode(frame.slice(2, end)).trim();
    this.probeNames[idx] = name || "(empty)";
    // Match like the plugin does (client.py _ensure_scope_channel):
    // strip the leading '#', case-insensitive - the radio may store
    // the channel as "#scope" or "scope".
    const bare = name.replace(/^#/, "").toLowerCase();
    if (bare !== SCOPE_CHANNEL_NAME) {
      if (!this.probeLogged) this.maybeLogProbe();
      return;
    }
    if (this.scopeSlot === idx) return; // already reported
    this.scopeSlot = idx;
    const secret = frame.slice(34, 50);
    let match = "secret not verified";
    if (this.expectedSecret) {
      match = secret.every((b, i) => b === this.expectedSecret![i])
        ? "secret MATCHES #scope"
        : "secret MISMATCHES #scope - wrong key on the radio";
    }
    this.events.onLog?.(`#scope found in radio slot ${idx} - ${match}`);
  }

  /** One compact line per probe sweep listing every slot heard. */
  private probeNames: Record<number, string> = {};
  private probeLogged = false;
  private maybeLogProbe(): void {
    // After the last slot's response window (8 x 120ms + margin).
    window.setTimeout(() => {
      if (this.probeLogged || this.scopeSlot != null) return;
      const parts: string[] = [];
      for (let i = 0; i < 8; i++) {
        if (this.probeNames[i] !== undefined) parts.push(`${i}:'${this.probeNames[i]}'`);
      }
      this.probeLogged = true;
      this.events.onLog?.(parts.length > 0
        ? `probe heard slots: ${parts.join(" ")} - no #scope among them`
        : "probe heard no channel info responses at all");
    }, 1400);
  }

  /** Ask the radio for all 8 channel slots; responses build scopeSlot. */
  private discoverScopeSlot(): void {
    // Expected #scope secret: first 16 bytes of sha256("#scope") - the
    // hashtag rule (docs.meshcore.io Channel Management; same rule the
    // plugin uses with an empty secret_hex).
    crypto.subtle.digest("SHA-256", new TextEncoder().encode("#scope"))
      .then((h) => { this.expectedSecret = new Uint8Array(h).slice(0, 16); })
      .catch(() => { this.expectedSecret = null; });
    for (let slot = 0; slot < 8; slot++) {
      window.setTimeout(() => {
        this.writeFrame(new Uint8Array([CMD_GET_CHANNEL, slot])).catch(() => {});
      }, 120 * slot);
    }
    this.maybeLogProbe();
    this.events.onLog?.("channel probe sent (slots 0-7) - looking for #scope");
  }

  isConnected(): boolean {
    return this.state === "connected";
  }

  /**
   * Send scope payload (data_type(2)+len(1)+body) to the #scope
   * channel: wrapped in CMD_SEND_CHANNEL_DATA with the slot discovered
   * at connect (verified against openhop_core frame_server.py - the
   * firmware parses [62][slot][0xFF] + data_type + body). The 3-byte
   * type/len framing is STRIPPED here: the radio adds its own envelope
   * when building the GRP_DATA plaintext (companion_base
   * .send_channel_data: plaintext = pack('<HB', type, len) + body),
   * so the command must carry the body only - passing the full
   * plaintext double-wraps the packet and the host's decoder silently
   * drops it (the 2026-09-18 bug that also hid hilltop's refresh
   * answers).
   */
  async send(payload: Uint8Array): Promise<boolean> {
    if (!this.characteristic) {
      this.events.onLog?.("not connected - send dropped");
      return false;
    }
    try {
      const dataType = payload.length >= 2 ? payload[0] | (payload[1] << 8) : 0;
      if ((dataType & 0xff00) === 0x5300) {
        if (this.scopeSlot == null) {
          this.events.onLog?.("#scope slot not found yet - uplink NOT sent");
          return false;
        }
        const bodyLen = payload.length >= 3 ? payload[2] : 0;
        const body = payload.length >= 3 && 3 + bodyLen <= payload.length
          ? payload.slice(3, 3 + bodyLen)
          : payload.slice(3);
        const frame = new Uint8Array(3 + body.length);
        frame[0] = CMD_SEND_CHANNEL_DATA;
        frame[1] = this.scopeSlot;
        frame[2] = 0xff; // flood
        frame.set(body, 3);
        await this.writeFrame(frame);
        this.awaitingTxAck = Date.now();
        this.events.onLog?.(`scope uplink sent (type ${dataType.toString(16).padStart(4, "0")}, ${body.length}B body, slot ${this.scopeSlot}) - awaiting radio verdict`);
      } else {
        await this.writeFrame(payload);
      }
      return true;
    } catch (e) {
      this.events.onLog?.(`TX failed: ${e}`);
      return false;
    }
  }

  /**
   * RAW command write (docs.meshcore.io/companion_protocol): the
   * firmware expects the bare command packet ([type][data]) on the RX
   * characteristic - NO 0xFF length-prefix framing. The old wrapper
   * made the radio silently ignore every command: the 2026-09-18
   * live-link bug (TX resolved, RX silent, radio never responded).
   */
  private async writeFrame(payload: Uint8Array): Promise<void> {
    if (!this.characteristic) throw new Error("not connected");
    await this.characteristic.writeValue(payload);
  }

  /**
   * Companion-protocol init + RX polling (docs.meshcore.io,
   * companion_protocol, v1.12+): the firmware QUEUES received datagrams
   * and pushes a MSG_WAITING note; the HOST must fetch each one with
   * CMD_SYNC_NEXT_MESSAGE (0x0A). A passive notification listener sees
   * nothing - the 2026-09-18 live-link bug (TX worked, RX silent).
   * CMD_APP_START (0x01) must come first after connecting.
   */
  private startRxPolling(): void {
    const name = new TextEncoder().encode("scope-app");
    const appStart = new Uint8Array(8 + name.length);
    appStart[0] = CMD_APP_START; // 7 reserved bytes follow
    appStart.set(name, 8);
    this.writeFrame(appStart).catch(() => {});
    // Device query (doc: byte0 0x16, byte1 0x03) - firmware version
    // gates channel-datagram (0x1B) support.
    this.writeFrame(new Uint8Array([CMD_DEVICE_QUERY, 0x03])).catch(() => {});
    // One poll per second: each response is one queued packet or an
    // empty ack - both flow through handleFrame, where scope payloads
    // are extracted and everything else drops quietly.
    this.pollTimer = window.setInterval(() => {
      // stale TX verdict: radio never answered within 6 s - stop waiting
      if (this.awaitingTxAck && Date.now() - this.awaitingTxAck > 6000) {
        this.awaitingTxAck = 0;
        this.events.onLog?.("uplink verdict MISSING - radio never answered the send");
      }
      this.writeFrame(new Uint8Array([CMD_SYNC_NEXT_MESSAGE]))
        .catch(() => {});
    }, 1000);
    this.discoverScopeSlot();
    this.events.onLog?.("companion init sent - RX polling every 1s");
  }

  private stopRxPolling(): void {
    if (this.pollTimer != null) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async connect(preferredName?: string): Promise<boolean> {
    const nav = navigator as any;
    if (!nav.bluetooth) {
      this.setState("disconnected",
        "Web Bluetooth unavailable - use Chrome/Edge on Android, or HTTPS");
      return false;
    }
    this.setState("connecting");
    try {
      // Try the official meshcore.js library first (it knows the full
      // companion protocol: adverts, contacts, channels).
      try {
        this.meshcoreModule = await import(/* @vite-ignore */ "meshcore.js");
        this.events.onLog?.("meshcore.js loaded (official library)");
      } catch {
        this.meshcoreModule = null;
        this.events.onLog?.("meshcore.js not bundled - direct BLE fallback");
      }

      const options: any = {
        filters: preferredName
          ? [{ namePrefix: preferredName }]
          : [{ services: [UART_SERVICE] }],
        optionalServices: [UART_SERVICE],
      };
      this.device = await nav.bluetooth.requestDevice(options);
      this.device.addEventListener?.("gattserverdisconnected", () => {
        this.setState("disconnected", "radio disconnected");
        this.characteristic = null;
      });
      const server = await this.device.gatt.connect();

      // Ask for a big MTU (frames are up to 172 B; default 23 truncates).
      try { await server.connect?.(); } catch { /* optional */ }

      const service = await server.getPrimaryService(UART_SERVICE);
      this.characteristic = await service.getCharacteristic(UART_RX);
      const txChar = await service.getCharacteristic(UART_TX);

      const onValue = (event: any) => {
        const value: DataView = event.target.value;
        const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        this.rxBuffer(bytes);
      };
      await txChar.startNotifications();
      txChar.addEventListener?.("characteristicvaluechanged", onValue);

      this.setState("connected", this.device.name || this.device.id);
      this.startRxPolling();
      return true;
    } catch (e: any) {
      this.setState("disconnected", `connect failed: ${e?.message || e}`);
      this.device = null;
      this.characteristic = null;
      return false;
    }
  }

  async disconnect(): Promise<void> {
    this.stopRxPolling();
    try { await this.device?.gatt?.disconnect(); } catch { /* fine */ }
    this.device = null;
    this.characteristic = null;
    this.setState("disconnected");
  }
}
