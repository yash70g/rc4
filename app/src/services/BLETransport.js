/**
 * BLETransport — Bridges react-native-ble-plx (Central) with expo-ble-peripheral
 * (Peripheral) to provide real BLE data transfer for PeerConnectionManager.
 *
 * Each device runs BOTH roles simultaneously:
 *   - Central: scans, connects to peers' GATT servers, writes to RX, subscribes to TX
 *   - Peripheral: advertises, accepts connections, receives writes, sends notifications
 *
 * This module implements PeerConnectionManager's transport interface:
 *   - connect(deviceId)
 *   - disconnect(deviceId)
 *   - sendFrame(deviceId, frame)
 */

let NativeBleManagerClass = null;
try {
  const mod = require('react-native-ble-plx');
  NativeBleManagerClass = mod.BleManager;
} catch (e) {
  NativeBleManagerClass = null;
}

let ExoBlePeripheral = null;
try {
  ExoBlePeripheral = require('../../modules/expo-ble-peripheral');
} catch (e) {
  ExoBlePeripheral = null;
}

const SERVICE_UUID = 'CAFE0001-C0DE-FACE-B00C-CAFE01234567';
const RX_CHAR_UUID = 'CAFE0002-C0DE-FACE-B00C-CAFE01234567';
const TX_CHAR_UUID = 'CAFE0003-C0DE-FACE-B00C-CAFE01234567';

// BLE chunk size — 400 allows room for our 300-byte logical payload + JSON/Base64 overhead
const BLE_CHUNK_SIZE = 400;

// Delimiter for BLE-level chunk framing
const CHUNK_START = '---RC-START---';
const CHUNK_END = '---RC-END---';

class BLETransport {
  constructor() {
    this.bleManager = null; // react-native-ble-plx instance
    this.connectedDevices = new Map(); // deviceId → { device, rxChar, txChar }
    this.incomingBuffers = new Map(); // centralId → accumulated string
    this.onFrameReceived = null; // callback: (deviceId, frame) => void
    this.onConnectionStateChange = null;
    this.onError = null;
    this.peripheralSubscriptions = [];

    this._initBleManager();
    this._initPeripheralListeners();
  }

  _initBleManager() {
    if (!NativeBleManagerClass) return;
    try {
      this.bleManager = new NativeBleManagerClass();
    } catch (e) {
      console.warn('[BLETransport] Failed to init BLE manager:', e.message);
    }
  }

  _initPeripheralListeners() {
    if (!ExoBlePeripheral) return;

    try {
      // Listen for data from centrals connecting TO us (incoming / peripheral side)
      const sub1 = ExoBlePeripheral.addDataReceivedListener(({ centralId, data }) => {
        this._handleIncomingBleChunk(centralId, data);
      });

      const sub2 = ExoBlePeripheral.addCentralConnectedListener(({ centralId }) => {
        console.log('[BLETransport] Incoming central connected:', centralId);
        if (this.onConnectionStateChange) {
          this.onConnectionStateChange({ deviceId: centralId, state: 'connected' });
        }
      });

      const sub3 = ExoBlePeripheral.addCentralDisconnectedListener(({ centralId }) => {
        console.log('[BLETransport] Incoming central disconnected:', centralId);
        this.incomingBuffers.delete(centralId);
        if (this.onConnectionStateChange) {
          this.onConnectionStateChange({ deviceId: centralId, state: 'disconnected' });
        }
      });

      this.peripheralSubscriptions = [sub1, sub2, sub3];
    } catch (e) {
      console.warn('[BLETransport] Failed to init peripheral listeners:', e.message);
    }
  }

  /**
   * Connect to a peer's GATT server as Central.
   * Discovers services, finds RX/TX characteristics, subscribes to TX notifications.
   */
  async connect(deviceId) {
    if (!this.bleManager) {
      throw new Error('BLE manager not available');
    }

    if (this.connectedDevices.has(deviceId)) {
      return; // Already connected
    }

    try {
      // 0. Ensure any stale connection is cleared
      try {
        await this.bleManager.cancelDeviceConnection(deviceId);
        await this._delay(500); // Wait for disconnect to propagate
      } catch (e) {
        // Not connected or error clearing — ignore
      }

      // 1. Connect to the peripheral
      const device = await this.bleManager.connectToDevice(deviceId, {
        requestMTU: 512,
        timeout: 10000,
      });

      // 2. Discover services and characteristics
      await device.discoverAllServicesAndCharacteristics();

      // Find our service
      const services = await device.services();
      let targetService = null;
      for (const svc of services) {
        if (svc.uuid.toUpperCase() === SERVICE_UUID.toUpperCase()) {
          targetService = svc;
          break;
        }
      }

      if (!targetService) {
        await device.cancelConnection();
        throw new Error(`Service ${SERVICE_UUID} not found on device ${deviceId}`);
      }

      // Find characteristics
      const chars = await targetService.characteristics();
      let rxChar = null;
      let txChar = null;

      for (const ch of chars) {
        const uuid = ch.uuid.toUpperCase();
        if (uuid === RX_CHAR_UUID.toUpperCase()) rxChar = ch;
        if (uuid === TX_CHAR_UUID.toUpperCase()) txChar = ch;
      }

      if (!rxChar || !txChar) {
        await device.cancelConnection();
        throw new Error('Required characteristics not found on device');
      }

      // Subscribe to TX notifications (this is how the peer sends data back)
      txChar.monitor((error, characteristic) => {
        if (error) {
          console.warn('[BLETransport] TX monitor error:', error.message);
          return;
        }
        if (characteristic?.value) {
          // Value comes as base64 from ble-plx, decode it
          const decoded = this._base64decode(characteristic.value);
          this._handleIncomingBleChunk(deviceId, decoded);
        }
      });

      // Store connection info
      this.connectedDevices.set(deviceId, { device, rxChar, txChar });

      // Monitor disconnection
      device.onDisconnected((error, dev) => {
        this.connectedDevices.delete(deviceId);
        this.incomingBuffers.delete(deviceId);
        if (this.onConnectionStateChange) {
          this.onConnectionStateChange({ deviceId, state: 'disconnected' });
        }
      });

      console.log('[BLETransport] Connected to peer:', deviceId);
    } catch (e) {
      console.error('[BLETransport] Connect failed:', e.message);
      throw e;
    }
  }

  /**
   * Disconnect from a peer.
   */
  async disconnect(deviceId) {
    const conn = this.connectedDevices.get(deviceId);
    if (conn) {
      try {
        await conn.device.cancelConnection();
      } catch (e) {
        // Already disconnected
      }
      this.connectedDevices.delete(deviceId);
      this.incomingBuffers.delete(deviceId);
    }
  }

  /**
   * Send a frame to a peer. The frame is an object that gets JSON-serialized.
   * This handles BLE-level chunking automatically.
   *
   * Outgoing path depends on HOW we're connected to this peer:
   *   - If we connected as Central (via connect()) → write to their RX characteristic
   *   - If they connected to us as Central → send notification via peripheral module
   */
  async sendFrame(deviceId, frame) {
    const payload = JSON.stringify(frame);
    const framedPayload = CHUNK_START + payload + CHUNK_END;

    // Path 1: We're connected as Central to this device
    const conn = this.connectedDevices.get(deviceId);
    if (conn) {
      await this._writeChunked(conn.rxChar, framedPayload);
      return;
    }

    // Path 2: This device is connected to us as Central (peripheral side)
    if (ExoBlePeripheral) {
      const connectedCentrals = ExoBlePeripheral.getConnectedCentrals();
      if (connectedCentrals.includes(deviceId)) {
        await this._sendNotificationChunked(deviceId, framedPayload);
        return;
      }
    }

    console.warn('[BLETransport] Cannot send frame — device not connected:', deviceId);
    if (this.onError) {
      this.onError({ deviceId, message: 'Device not connected' });
    }
  }

  /**
   * Write data in BLE-sized chunks to a characteristic (Central → Peripheral).
   */
  async _writeChunked(rxChar, data) {
    const chunks = this._chunkString(data, BLE_CHUNK_SIZE);
    for (const chunk of chunks) {
      const encoded = this._base64encode(chunk);
      await rxChar.writeWithoutResponse(encoded);
      // Small delay between chunks to avoid flooding
      if (chunks.length > 1) {
        await this._delay(40);
      }
    }
  }

  /**
   * Send data in BLE-sized chunks as notifications (Peripheral → Central).
   */
  async _sendNotificationChunked(centralId, data) {
    if (!ExoBlePeripheral) return;
    const chunks = this._chunkString(data, BLE_CHUNK_SIZE);
    for (const chunk of chunks) {
      await ExoBlePeripheral.sendNotification(centralId, chunk);
      if (chunks.length > 1) {
        await this._delay(40);
      }
    }
  }

  /**
   * Handle an incoming BLE chunk (from either Central or Peripheral side).
   * Accumulates chunks until a complete framed message is received.
   */
  _handleIncomingBleChunk(deviceId, chunk) {
    if (!chunk) return;

    let buffer = this.incomingBuffers.get(deviceId) || '';
    buffer += chunk;

    // Check for complete messages (delimited by CHUNK_START and CHUNK_END)
    while (true) {
      const firstStart = buffer.indexOf(CHUNK_START);
      if (firstStart === -1) break;

      // RECOVERY: Is there ANOTHER start marker before we hit an end marker?
      // If so, the first one was part of a truncated/lost frame. Discard it.
      const nextStart = buffer.indexOf(CHUNK_START, firstStart + CHUNK_START.length);
      const firstEnd = buffer.indexOf(CHUNK_END, firstStart + CHUNK_START.length);

      if (nextStart !== -1 && (firstEnd === -1 || nextStart < firstEnd)) {
        // Recovery: Skip the corrupted segment and start from the fresh marker
        buffer = buffer.substring(nextStart);
        continue;
      }

      if (firstEnd === -1) break;

      let rawMessage = buffer.substring(firstStart + CHUNK_START.length, firstEnd);
      
      // Advance buffer past the current frame
      buffer = buffer.substring(firstEnd + CHUNK_END.length);

      // Sanitize the message: Remove ALL control characters (ASCII 0-31)
      let sanitizedMessage = rawMessage.replace(/[\x00-\x1F]/g, '').trim();

      // Extract only the part starting with { and ending with }
      const startBrace = sanitizedMessage.indexOf('{');
      const endBrace = sanitizedMessage.lastIndexOf('}');
      if (startBrace !== -1 && endBrace !== -1 && endBrace > startBrace) {
        sanitizedMessage = sanitizedMessage.substring(startBrace, endBrace + 1);
      } else {
        continue;
      }

      // Parse and emit the complete frame
      try {
        const frame = JSON.parse(sanitizedMessage);
        
        // Map compressed keys back to original names for backward compatibility
        // while preserving all other metadata (m, i, t, etc.)
        const normalizedFrame = {
          ...frame,
          kind: frame.f || frame.kind,
          payload: frame.p || frame.payload
        };

        if (this.onFrameReceived && normalizedFrame.kind) {
          this.onFrameReceived(deviceId, normalizedFrame);
        }
      } catch (e) {
        console.warn(`[BLETransport] Frame parse failed (${sanitizedMessage.length} bytes):`, e.message);
        console.log(`[BLETransport] Start char codes: [${sanitizedMessage.slice(0, 10).split('').map(c => c.charCodeAt(0)).join(', ')}]`);
        console.log('[BLETransport] Raw snippet:', sanitizedMessage.slice(0, 100));
      }
    }

    this.incomingBuffers.set(deviceId, buffer);
  }

  // ── Utilities ────────────────────────────────────────────────

  _chunkString(str, size) {
    const chunks = [];
    for (let i = 0; i < str.length; i += size) {
      chunks.push(str.substring(i, i + size));
    }
    return chunks;
  }

  _delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  _base64encode(str) {
    // Use btoa-compatible encoding for react-native
    try {
      const bytes = [];
      for (let i = 0; i < str.length; i++) {
        bytes.push(str.charCodeAt(i) & 0xff);
      }
      const binary = String.fromCharCode(...bytes);
      return typeof btoa === 'function'
        ? btoa(binary)
        : Buffer.from(str, 'utf-8').toString('base64');
    } catch (e) {
      // Fallback: just return raw (will fail on ble-plx but keeps the structure)
      return str;
    }
  }

  _base64decode(base64) {
    try {
      if (typeof atob === 'function') {
        return atob(base64);
      }
      return Buffer.from(base64, 'base64').toString('utf-8');
    } catch (e) {
      return base64;
    }
  }

  /**
   * Cleanup everything.
   */
  destroy() {
    for (const sub of this.peripheralSubscriptions) {
      try { sub.remove(); } catch (e) { /* ignore */ }
    }
    this.peripheralSubscriptions = [];

    for (const [deviceId, conn] of this.connectedDevices) {
      try { conn.device.cancelConnection(); } catch (e) { /* ignore */ }
    }
    this.connectedDevices.clear();
    this.incomingBuffers.clear();
  }
}

// Singleton
const transport = new BLETransport();
export default transport;
