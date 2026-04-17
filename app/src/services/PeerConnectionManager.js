import BLETransport from './BLETransport';

// Logical chunk size - 150 is the "sweet spot" for Android Bluetooth MTU stability
const CHUNK_BYTES = 150;

function makeMessageId() {
  return `msg-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

// ── Pure JS Base64 (Hermes & Android Compatible) ─────────────────────
const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

function base64Encode(str) {
  try {
    // UTF-8 safe encoding for React Native/Hermes
    return btoa(unescape(encodeURIComponent(str)));
  } catch (e) {
    return btoa(str);
  }
}

function base64Decode(str) {
  try {
    // Sanitize: Remove all non-base64 characters and ensure proper padding
    const sanitized = str.replace(/[^A-Za-z0-9+/=]/g, '');
    
    // Polyfill atob for robustness
    if (typeof atob === 'function') {
      return decodeURIComponent(escape(atob(sanitized)));
    }
    // Fallback if atob is missing
    return Buffer.from(sanitized, 'base64').toString('utf-8');
  } catch (e) {
    console.warn('[PeerConnection] base64Decode error:', e.message);
    // Last ditch: provide the raw string if possible
    return str;
  }
}

class PeerConnectionManager {
  constructor() {
    this.listeners = {};
    this.connectedPeers = new Set();
    this.addressMap = new Map();
    this.incomingBuffers = new Map();
    this.transport = BLETransport;

    this._wireTransport();
  }

  _wireTransport() {
    if (!this.transport) return;

    this.transport.onFrameReceived = (deviceId, frame) => {
      let logicalId = deviceId;
      for (const [id, addr] of this.addressMap.entries()) {
        if (addr === deviceId) {
          logicalId = id;
          break;
        }
      }
      this.receiveFrame(logicalId, frame);
    };

    this.transport.onConnectionStateChange = ({ deviceId, state }) => {
      let logicalId = deviceId;
      for (const [id, addr] of this.addressMap.entries()) {
        if (addr === deviceId) {
          logicalId = id;
          break;
        }
      }

      if (state === 'connected') {
        this.connectedPeers.add(logicalId);
        console.log(`[PeerConnection] Device ${logicalId} is now online`);
      } else {
        this.connectedPeers.delete(logicalId);
        console.log(`[PeerConnection] Device ${logicalId} went offline`);
      }
      this.emit('connection-state', { deviceId: logicalId, state });
    };

    this.transport.onError = ({ deviceId, message }) => {
      console.warn(`[PeerConnection] Error from ${deviceId}:`, message);
      this.emit('error', { deviceId, message });
    };
  }

  on(event, callback) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(callback);
  }

  off(event, callback) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter((cb) => cb !== callback);
  }

  emit(event, data) {
    if (!this.listeners[event]) return;
    this.listeners[event].forEach((cb) => cb(data));
  }

  onMessage(callback) {
    this.on('message', callback);
  }

  onConnectionStateChange(callback) {
    this.on('connection-state', callback);
  }

  async connectToPeer(bleDeviceId, logicalId) {
    if (!bleDeviceId) return;
    const id = logicalId || bleDeviceId;
    if (this.connectedPeers.has(id)) return;

    try {
      this.addressMap.set(id, bleDeviceId);
      if (this.transport?.connect) {
        await this.transport.connect(bleDeviceId);
      }
      this.connectedPeers.add(id);
      this.emit('connection-state', { deviceId: id, state: 'connected' });
    } catch (e) {
      this.emit('error', { deviceId: id, message: `Connection failed: ${e.message}` });
    }
  }

  async disconnectPeer(deviceId) {
    if (!this.connectedPeers.has(deviceId)) return;
    const bleId = this.addressMap.get(deviceId) || deviceId;
    try {
      if (this.transport?.disconnect) {
        await this.transport.disconnect(bleId);
      }
    } finally {
      this.connectedPeers.delete(deviceId);
      this.addressMap.delete(deviceId);
      this.emit('connection-state', { deviceId, state: 'disconnected' });
    }
  }

  isConnected(deviceId) {
    return this.connectedPeers.has(deviceId);
  }

  async sendMessage(deviceId, data) {
    if (!this.connectedPeers.has(deviceId)) {
      console.warn('[PeerConnection] Not connected to:', deviceId);
      return false;
    }

    const bleId = this.addressMap.get(deviceId) || deviceId;
    console.log(`[PeerConnection] Outgoing: ${data.type} -> ${deviceId}`);

    try {
      const rawPayload = JSON.stringify(data);
      
      if (rawPayload.length <= CHUNK_BYTES) {
        await this._sendFrame(bleId, {
          f: 'message',
          p: base64Encode(rawPayload),
        });
        return true;
      }

      const messageId = makeMessageId();
      const totalChunks = Math.ceil(rawPayload.length / CHUNK_BYTES);

      for (let i = 0; i < totalChunks; i += 1) {
        const start = i * CHUNK_BYTES;
        const end = start + CHUNK_BYTES;
        const chunk = rawPayload.slice(start, end);
        
        await this._sendFrame(bleId, {
          f: 'chunk',
          m: messageId,
          i,
          t: totalChunks,
          p: base64Encode(chunk),
        });

        // Small delay between logical chunks to avoid flooding the radio
        await new Promise(r => setTimeout(r, 100));
      }

      return true;
    } catch (e) {
      console.error('[PeerConnection] Send failed:', e.message);
      this.emit('error', { deviceId, message: `Send failed: ${e.message}` });
      return false;
    }
  }

  receiveFrame(deviceId, frame) {
    if (!frame || typeof frame !== 'object') return;

    const kind = frame.f || frame.kind;
    const payload = frame.p || frame.payload;

    if (kind === 'message') {
      try {
        const decodedPayload = base64Decode(payload);
        this._emitCompleteMessage(deviceId, decodedPayload);
      } catch (e) {
        console.warn('[PeerConnection] Decode failed for message:', e.message);
      }
      return;
    }

    if (kind !== 'chunk') return;

    const messageId = frame.m || frame.messageId;
    const index = frame.i ?? frame.index;
    const total = frame.t || frame.total;

    console.log(`[PeerConnection] Incoming chunk ${index + 1}/${total} from ${deviceId}`);

    const bufferKey = `${deviceId}:${messageId}`;
    const current = this.incomingBuffers.get(bufferKey) || {
      total: total,
      chunks: new Array(total),
      received: 0,
    };

    if (!current.chunks[index]) {
      try {
        current.chunks[index] = base64Decode(payload);
        current.received += 1;
      } catch (e) {
        console.warn('[PeerConnection] Decode failed for chunk:', e.message);
      }
    }

    this.incomingBuffers.set(bufferKey, current);

    if (current.received >= current.total) {
      this.incomingBuffers.delete(bufferKey);
      const completePayload = current.chunks.join('');
      this._emitCompleteMessage(deviceId, completePayload);
    }
  }

  _sendFrame(bleDeviceId, frame) {
    if (this.transport?.sendFrame) {
      this.transport.sendFrame(bleDeviceId, frame).catch((e) => {
        console.warn('[PeerConnection] Transport error:', e.message);
      });
    }
  }

  _emitCompleteMessage(deviceId, payload) {
    try {
      // Final sanitization of the decoded string before parsing
      const sanitized = typeof payload === 'string' 
        ? payload.replace(/[\x00-\x1F]/g, '').trim() 
        : payload;
        
      const data = typeof sanitized === 'string' ? JSON.parse(sanitized) : sanitized;
      console.log(`[PeerConnection] Incoming: ${data.type} from ${deviceId}`);
      this.emit('message', { deviceId, data });
    } catch (e) {
      console.error('[PeerConnection] Parse complete message failed:', e.message);
      this.emit('error', { deviceId, message: `Parse failed: ${e.message}` });
    }
  }
}

export default new PeerConnectionManager();
