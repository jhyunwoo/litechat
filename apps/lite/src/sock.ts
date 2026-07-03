/**
 * WebSocket 클라이언트 (Lite) — 자동 재연결 + 송수신 바이트 계측
 */
import type { ClientFrame, ServerFrame } from '@litechat/types';
import { addBytes } from './net';

/** WS 프레임당 프로토콜 오버헤드 추정치 (헤더+마스킹) */
const FRAME_OVERHEAD = 6;
const encoder = new TextEncoder();

let ws: WebSocket | null = null;
let running = false;
let delay = 500;
let everConnected = false;
let pingTimer = 0;

type FrameHandler = (frame: ServerFrame) => void;
const frameHandlers: FrameHandler[] = [];
const reconnectHandlers: (() => void)[] = [];

export function onFrame(handler: FrameHandler): void {
  frameHandlers.push(handler);
}
export function onReconnect(handler: () => void): void {
  reconnectHandlers.push(handler);
}

/** 프레임 전송 — 연결이 없으면 false (호출자는 REST 폴백) */
export function send(frame: ClientFrame): boolean {
  if (ws?.readyState === 1) {
    const payload = JSON.stringify(frame);
    addBytes(encoder.encode(payload).byteLength + FRAME_OVERHEAD);
    ws.send(payload);
    return true;
  }
  return false;
}

export function startSocket(): void {
  if (running) return;
  running = true;
  connect();
}

export function stopSocket(): void {
  running = false;
  clearInterval(pingTimer);
  ws?.close();
  ws = null;
  everConnected = false;
}

function connect(): void {
  if (!running) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.onopen = () => {
    delay = 500;
    if (everConnected) for (const handler of reconnectHandlers) handler();
    everConnected = true;
    // 25초 간격 핑으로 연결 유지 (프록시 타임아웃 방지)
    clearInterval(pingTimer);
    pingTimer = setInterval(() => send({ t: 'p' }), 25000) as unknown as number;
  };

  ws.onmessage = (event) => {
    const raw = String(event.data);
    addBytes(encoder.encode(raw).byteLength + FRAME_OVERHEAD);
    try {
      const frame = JSON.parse(raw) as ServerFrame;
      if (frame.t === 'q') return;
      for (const handler of frameHandlers) handler(frame);
    } catch {
      /* 무시 */
    }
  };

  ws.onclose = () => {
    clearInterval(pingTimer);
    if (!running) return;
    setTimeout(connect, delay);
    delay = Math.min(delay * 2, 8000);
  };
}
