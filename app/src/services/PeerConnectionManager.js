import BLETransport from './BLETransport';

const CHUNK_BYTES = 4 * 1024; // 4KB — friendlier for BLE transport

function makeMessageId() {
  return `msg-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

class PeerConnectionManager {
  constructor() {
    this.listeners = {};
    this.connectedPeers = new Set(); // logical deviceIds
    this.addressMap = new Map(); // logical deviceId -> ble hardware address
    this.incomingBuffers = new Map();
    this.transport = BLETransport;

    this._wireTransport();
  }

  _wireTransport() {
    if (!this.transport) return;

    this.transport.onFrameReceived = (deviceId, frame) => {
      // Resolve transport deviceId (bleId) to logical deviceId if possible
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
      // Resolve bleId to logical ID
      let logicalId = deviceId;
      for (const [id, addr] of this.addressMap.entries()) {
        if (addr === deviceId) {
          logicalId = id;
          break;
        }
      }

      if (state === 'connected') {
        this.connectedPeers.add(logicalId);
      } else {
        this.connectedPeers.delete(logicalId);
      }
      this.emit('connection-state', { deviceId: logicalId, state });
    };

    this.transport.onError = ({ deviceId, message }) => {
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

  setTransport(transport) {
    this.transport = transport;
    this._wireTransport();
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

  sendMessage(deviceId, data) {
    if (!this.connectedPeers.has(deviceId)) {
      this.emit('error', { deviceId, message: `Peer is not connected: ${deviceId}` });
      return false;
    }

    const bleId = this.addressMap.get(deviceId) || deviceId;

    try {
      const payload = JSON.stringify(data);

      if (payload.length <= CHUNK_BYTES) {
        this._sendFrame(bleId, {
          kind: 'message',
          payload,
        });
        return true;
      }

      const messageId = makeMessageId();
      const totalChunks = Math.ceil(payload.length / CHUNK_BYTES);

      for (let i = 0; i < totalChunks; i += 1) {
        const start = i * CHUNK_BYTES;
        const end = start + CHUNK_BYTES;
        const chunk = payload.slice(start, end);
        this._sendFrame(bleId, {
          kind: 'chunk',
          messageId,
          index: i,
          total: totalChunks,
          payload: chunk,
        });
      }

      return true;
    } catch (e) {
      this.emit('error', { deviceId, message: `Failed to send message: ${e.message}` });
      return false;
    }
  }

  receiveFrame(deviceId, frame) {
    if (!frame || typeof frame !== 'object') return;

    if (frame.kind === 'message') {
      this._emitCompleteMessage(deviceId, frame.payload);
      return;
    }

    if (frame.kind !== 'chunk') return;

    const bufferKey = `${deviceId}:${frame.messageId}`;
    const current = this.incomingBuffers.get(bufferKey) || {
      total: frame.total,
      chunks: new Array(frame.total),
      received: 0,
    };

    if (!current.chunks[frame.index]) {
      current.chunks[frame.index] = frame.payload;
      current.received += 1;
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
        this.emit('error', { deviceId: bleDeviceId, message: `Transport send error: ${e.message}` });
      });
      return;
    }

    console.warn('[PeerConnectionManager] No transport available to send frame to', bleDeviceId);
    this.emit('error', { deviceId: bleDeviceId, message: 'No BLE transport available. Use a Development Build.' });
  }

  _emitCompleteMessage(deviceId, payload) {
    try {
      const data = JSON.parse(payload);
      this.emit('message', { deviceId, data });
    } catch (e) {
      this.emit('error', { deviceId, message: `Invalid message payload: ${e.message}` });
    }
  }
}

export default new PeerConnectionManager();
