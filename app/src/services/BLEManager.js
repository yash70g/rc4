import { PermissionsAndroid, Platform } from 'react-native';

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

function createNativeBleManagerSafely() {
  if (!NativeBleManagerClass) return { manager: null, error: null };

  try {
    return { manager: new NativeBleManagerClass(), error: null };
  } catch (error) {
    return { manager: null, error };
  }
}

const DEVICE_TTL_MS = 15000;
const SERVICE_UUID = 'CAFE0001-C0DE-FACE-B00C-CAFE01234567';

function generateDeviceId() {
  return `rc-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function normalizeMetadata(input = {}) {
  return {
    deviceId: input.deviceId || generateDeviceId(),
    deviceName: input.deviceName || 'Reality Cache Device',
    pageCount: Number(input.pageCount || 0),
    hashPreview: Array.isArray(input.hashPreview) ? input.hashPreview.slice(0, 8) : [],
  };
}

class BLEManager {
  constructor() {
    this.listeners = {};
    this.nearbyDevices = new Map();
    this.advertising = false;
    this.scanning = false;
    this.localMetadata = normalizeMetadata();
    const { manager, error } = createNativeBleManagerSafely();
    this.nativeBleManager = manager;
    this.nativeInitError = error;
    this.stopScanFn = null;
    this.lostSweepTimer = null;
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

  getLocalMetadata() {
    return { ...this.localMetadata };
  }

  isScanning() {
    return this.scanning;
  }

  isAdvertising() {
    return this.advertising;
  }

  getNearbyDevices() {
    return Array.from(this.nearbyDevices.values()).sort((a, b) => {
      const aSeen = a.lastSeen || 0;
      const bSeen = b.lastSeen || 0;
      return bSeen - aSeen;
    });
  }

  // ── Advertising (uses native expo-ble-peripheral module) ──────

  async startAdvertising(metadata = {}) {
    this.localMetadata = {
      ...this.localMetadata,
      ...normalizeMetadata({ ...metadata, deviceId: this.localMetadata.deviceId }),
    };

    if (ExoBlePeripheral) {
      try {
        // Compact encoding: RC-shortId-pageCountp
        // This fits in 31-byte BLE advertisement limit where JSON won't.
        const shortId = this.localMetadata.deviceId.slice(-6);
        const compactName = `RC-${shortId}-${this.localMetadata.pageCount}p`;
        
        await ExoBlePeripheral.startPeripheral({
          serviceUuid: SERVICE_UUID,
          deviceName: compactName,
          metadata: JSON.stringify(this.localMetadata), // Still put full JSON in GATT record for reading once connected
        });
        this.advertising = true;
        console.log(`[BLEManager] Native peripheral started: ${compactName}`);
      } catch (e) {
        console.warn('[BLEManager] Native peripheral failed:', e.message);
        this.advertising = false;
      }
    } else {
      // Fallback
      this.advertising = true;
      this.emit('warning', {
        message: 'BLE advertising requires a Development Build. Native peripheral module not available.',
      });
    }

    this.emit('advertising-state', {
      advertising: this.advertising,
      metadata: this.getLocalMetadata(),
    });
  }

  async stopAdvertising() {
    if (ExoBlePeripheral) {
      try {
        await ExoBlePeripheral.stopPeripheral();
      } catch (e) {
        console.warn('[BLEManager] Stop peripheral error:', e.message);
      }
    }
    this.advertising = false;
    this.emit('advertising-state', {
      advertising: this.advertising,
      metadata: this.getLocalMetadata(),
    });
  }

  async updateAdvertisingMetadata(metadata = {}) {
    this.localMetadata = {
      ...this.localMetadata,
      ...normalizeMetadata({ ...metadata, deviceId: this.localMetadata.deviceId }),
    };

    if (ExoBlePeripheral && this.advertising) {
      try {
        const shortId = this.localMetadata.deviceId.slice(-6);
        const compactName = `RC-${shortId}-${this.localMetadata.pageCount}p`;
        
        // Restart advertising with new name
        await ExoBlePeripheral.stopPeripheral();
        await ExoBlePeripheral.startPeripheral({
          serviceUuid: SERVICE_UUID,
          deviceName: compactName,
          metadata: JSON.stringify(this.localMetadata),
        });
      } catch (e) {
        console.warn('[BLEManager] Update advertising data error:', e.message);
      }
    }

    this.emit('advertising-state', {
      advertising: this.advertising,
      metadata: this.getLocalMetadata(),
    });
  }

  // ── Scanning (uses react-native-ble-plx Central role) ─────────

  async startScanning() {
    if (this.scanning) return;

    const permissionGranted = await this._requestScanPermissionsIfNeeded();
    if (!permissionGranted) {
      this.scanning = false;
      this.emit('scan-state', { scanning: false });
      this.emit('warning', {
        message:
          'BLE permissions are not granted. Enable Nearby devices/Bluetooth/Location permissions and try again.',
      });
      return;
    }

    if (!this.nativeBleManager) {
      const { manager, error } = createNativeBleManagerSafely();
      this.nativeBleManager = manager;
      this.nativeInitError = error;
    }

    if (!this.nativeBleManager) {
      this.scanning = false;
      this.emit('scan-state', { scanning: false });
      this.emit('warning', {
        message: this.nativeInitError
          ? `BLE native transport is unavailable: ${this.nativeInitError.message}`
          : 'BLE native transport is unavailable. Build with a Dev Client/Bare app to enable real scanning.',
      });
      return;
    }

    try {
      this.scanning = true;
      this.emit('scan-state', { scanning: true });
      this._startLostSweep();

      // Scan specifically for our service UUID for targeted discovery,
      // but also allow general scan to catch all RC devices
      this.nativeBleManager.startDeviceScan(
        [SERVICE_UUID],
        { allowDuplicates: true },
        (error, device) => {
          if (error) {
            this.emit('warning', {
              message: `BLE scan error${typeof error.errorCode === 'number' ? ` (${error.errorCode})` : ''}: ${error.message}`,
            });
            return;
          }

          if (!device) return;
          const parsed =
            this._extractMetadataFromDevice(device) ||
            this._fallbackMetadataFromDevice(device);
          if (!parsed || parsed.deviceId === this.localMetadata.deviceId) return;

          const next = {
            ...parsed,
            bleDeviceId: device.id, // The actual BLE address for connecting
            rssi: typeof device.rssi === 'number' ? device.rssi : null,
            platform: Platform.OS,
            lastSeen: Date.now(),
            hasRealityCache: true, // Discovered via our service UUID filter
          };
          this._upsertDevice(next);
        }
      );

      this.stopScanFn = () => this.nativeBleManager.stopDeviceScan();
    } catch (e) {
      this.scanning = false;
      this.emit('scan-state', { scanning: false });
      this.emit('warning', {
        message: `BLE scan failed to start: ${e.message}`,
      });
    }
  }

  stopScanning() {
    this.scanning = false;
    if (this.stopScanFn) {
      this.stopScanFn();
      this.stopScanFn = null;
    }
    if (this.lostSweepTimer) {
      clearInterval(this.lostSweepTimer);
      this.lostSweepTimer = null;
    }
    this.emit('scan-state', { scanning: false });
  }

  isScanning() {
    return this.scanning;
  }

  injectMockDevice(device) {
    const normalized = normalizeMetadata(device);
    if (normalized.deviceId === this.localMetadata.deviceId) return;
    this._upsertDevice({
      ...normalized,
      lastSeen: Date.now(),
      rssi: null,
      platform: 'mock',
    });
  }

  _upsertDevice(device) {
    const existed = this.nearbyDevices.has(device.deviceId);
    this.nearbyDevices.set(device.deviceId, device);
    this.emit(existed ? 'deviceUpdated' : 'deviceFound', device);
    this.emit('nearby-update', this.getNearbyDevices());
  }

  _startLostSweep() {
    if (this.lostSweepTimer) clearInterval(this.lostSweepTimer);

    this.lostSweepTimer = setInterval(() => {
      const now = Date.now();
      const toRemove = [];

      this.nearbyDevices.forEach((device, deviceId) => {
        if (now - (device.lastSeen || 0) > DEVICE_TTL_MS) {
          toRemove.push(deviceId);
        }
      });

      toRemove.forEach((deviceId) => {
        const lost = this.nearbyDevices.get(deviceId);
        this.nearbyDevices.delete(deviceId);
        if (lost) this.emit('deviceLost', lost);
      });

      if (toRemove.length > 0) {
        this.emit('nearby-update', this.getNearbyDevices());
      }
    }, 2000);
  }

  _extractMetadataFromDevice(device) {
    const candidates = [];
    if (device.localName) candidates.push(device.localName);

    const serviceData = device.serviceData || {};
    Object.values(serviceData).forEach((value) => {
      if (typeof value === 'string') candidates.push(value);
    });

    if (typeof device.manufacturerData === 'string') {
      candidates.push(device.manufacturerData);
    }

    for (const entry of candidates) {
      try {
        if (entry.startsWith('{') && entry.includes('deviceId')) {
          const parsed = JSON.parse(entry);
          return normalizeMetadata(parsed);
        }
      } catch (e) {
        // Ignore invalid metadata payloads.
      }
    }

    return null;
  }

  _fallbackMetadataFromDevice(device) {
    if (!device?.id) return null;

    const name = device.localName || device.name || '';
    let pageCount = 0;
    let logicalId = null;

    // Parse compact format: RC-[shortId]-[count]p
    if (name.startsWith('RC-')) {
      const parts = name.split('-');
      if (parts.length >= 2) {
        logicalId = `rc-node-${parts[1]}`;
      }
      if (parts.length >= 3) {
        const countStr = parts[2].replace('p', '');
        pageCount = parseInt(countStr, 10) || 0;
      }
    }

    const compactId = String(device.id)
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .slice(-20);
    
    return {
      deviceId: logicalId || `ble-${compactId}`,
      deviceName: name || `BLE Device ${compactId.slice(-4)}`,
      pageCount: pageCount,
      hashPreview: [],
    };
  }

  async _requestScanPermissionsIfNeeded() {
    if (Platform.OS !== 'android') return true;

    try {
      const apiLevel = Number(Platform.Version || 0);
      const permissions =
        apiLevel >= 31
          ? [
              PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
              PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
              PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
              PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
            ]
          : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];

      const status = await PermissionsAndroid.requestMultiple(permissions);
      return permissions.every(
        (permission) => status[permission] === PermissionsAndroid.RESULTS.GRANTED
      );
    } catch (error) {
      this.emit('warning', {
        message: `Failed to request BLE permissions: ${error.message}`,
      });
      return false;
    }
  }
}

export default new BLEManager();
