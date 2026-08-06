// The whole driver: Node 22's global WebSocket speaks CDP directly, so no npm
// package is involved. `CDP` is the socket; `Page` binds one attached target so
// callers stop threading a session id through every call.

import { once } from 'node:events';

import { waitUntil } from './util.mjs';

// Minimal CDP client. One socket, id-matched replies, flat sessions.
export class CDP {
  static async connect(url) {
    const ws = new WebSocket(url);
    await once(ws, 'open');
    return new CDP(ws);
  }

  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id != null) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        msg.error ? p.reject(new Error(`${msg.error.message} (${p.method})`)) : p.resolve(msg.result);
      } else {
        for (const fn of this.listeners.get(msg.method) || []) fn(msg.params, msg.sessionId);
      }
    });
    ws.addEventListener('close', () => {
      for (const p of this.pending.values()) p.reject(new Error('DevTools socket closed'));
      this.pending.clear();
    });
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify(payload));
    });
  }
}

// One attached target, with the two calls this tool actually makes of a page:
// evaluate an expression and poll one until it is true.
export class Page {
  constructor(cdp, sessionId) {
    this.cdp = cdp;
    this.sessionId = sessionId;
  }

  send(method, params = {}) {
    return this.cdp.send(method, params, this.sessionId);
  }

  async eval(expression, { awaitPromise = false } = {}) {
    const { result, exceptionDetails } = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    return result.value;
  }

  waitFor(expression, timeoutMs, what) {
    return waitUntil(() => this.eval(expression), timeoutMs, what);
  }
}

// A fresh tab, sized for the capture and wired to report page errors — a broken
// module is otherwise a silent ten seconds of black frames.
export async function openPage(cdp, opts) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const page = new Page(cdp, sessionId);

  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: opts.width, height: opts.height, deviceScaleFactor: opts.scale, mobile: false,
  });

  cdp.on('Runtime.exceptionThrown', (p) => {
    console.error('page error:', p.exceptionDetails?.exception?.description || p.exceptionDetails?.text);
  });
  return page;
}
