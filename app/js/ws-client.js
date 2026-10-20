// WebSocket 客户端（design §4 协议 / §14 重连）。
// 职责：连 CONFIG.WS_URL、首帧发 hello（带 sessionStorage 旧 clientId）、
//       收发 JSON 帧按 type 分发、断线自动重连。
// 不含任何业务状态——状态归 store.js，界面路由归 main.js。

import { CONFIG } from './config.js';

const CLIENT_ID_KEY = 'kbg_client_id';

export class WsClient {
  constructor(url = CONFIG.WS_URL) {
    this.url = url;
    this.ws = null;
    this.handlers = new Map(); // type -> Set<fn>
    this.anyHandlers = new Set(); // fn(type, data)
    this._reconnectTimer = null;
    this._reconnectDelay = 1000;
    this._helloAcked = false;
    this._manualClose = false;
    this._queue = []; // hello_ok 之前排队的业务消息
  }

  get clientId() {
    try {
      return sessionStorage.getItem(CLIENT_ID_KEY);
    } catch {
      return null;
    }
  }

  set clientId(id) {
    try {
      if (id) sessionStorage.setItem(CLIENT_ID_KEY, id);
    } catch {
      /* 隐私模式可能禁用 sessionStorage，忽略 */
    }
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.handlers.get(type)?.delete(fn);
  }

  onAny(fn) {
    this.anyHandlers.add(fn);
    return () => this.anyHandlers.delete(fn);
  }

  connect() {
    this._manualClose = false;
    this._open();
  }

  _open() {
    try {
      this.ws = new WebSocket(this.url);
    } catch (e) {
      console.error('[ws] 连接创建失败', e);
      this._scheduleReconnect();
      return;
    }
    this._helloAcked = false;

    this.ws.addEventListener('open', () => {
      this._reconnectDelay = 1000;
      // 首帧契约：先发 hello，带旧 clientId（重连认领）
      this._raw({ type: 'hello', data: { clientId: this.clientId || undefined } });
    });

    this.ws.addEventListener('message', (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (!msg || typeof msg.type !== 'string') return;
      const { type, data } = msg;

      if (type === 'hello_ok') {
        if (data && data.clientId) this.clientId = data.clientId;
        this._helloAcked = true;
        // flush 排队的业务消息
        const q = this._queue;
        this._queue = [];
        for (const frame of q) this._raw(frame);
      }

      this._dispatch(type, data);
    });

    this.ws.addEventListener('close', () => {
      this._helloAcked = false;
      this._dispatch('_disconnected', {});
      if (!this._manualClose) this._scheduleReconnect();
    });

    this.ws.addEventListener('error', () => {
      // close 事件会跟进处理重连
    });
  }

  _scheduleReconnect() {
    if (this._reconnectTimer) return;
    const delay = this._reconnectDelay;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._reconnectDelay = Math.min(this._reconnectDelay * 1.5, 8000);
      this._open();
    }, delay);
  }

  _dispatch(type, data) {
    const set = this.handlers.get(type);
    if (set) for (const fn of set) { try { fn(data); } catch (e) { console.error(e); } }
    for (const fn of this.anyHandlers) { try { fn(type, data); } catch (e) { console.error(e); } }
  }

  /** 发送业务消息。hello_ok 之前自动排队，确保首帧契约。 */
  send(type, data = {}) {
    if (!this._helloAcked && type !== 'hello') {
      this._queue.push({ type, data });
      return;
    }
    this._raw({ type, data });
  }

  _raw(frame) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ ...frame, ts: Date.now() }));
    }
  }

  close() {
    this._manualClose = true;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this.ws) this.ws.close();
  }
}
