import BLEManager from './BLEManager';
import bleTransport from './BLETransport';
import PeerConnectionManager from './PeerConnectionManager';
import * as CacheManager from './CacheManager';

// Maps BLE hardware address ↔ logical device ID
// Needed because scanning gives us deviceId but BLE transport uses bleDeviceId

class MeshManager {
  constructor() {
    this.listeners = {};
    this.nearbyDevices = new Map();
    this.connectedPeers = new Map();
    this.peerCatalogs = new Map();
    this.bleIdMap = new Map(); // bleDeviceId → deviceId
    this.pendingRequests = new Map(); // hash → Set(deviceId)
    this.activeRequests = new Map(); // hash → timerId
    this.incomingTransfers = new Map(); // deviceId → { hash, totalSize }
    this.started = false;

    BLEManager.on('deviceFound', this.handleDeviceFound.bind(this));
    BLEManager.on('deviceUpdated', this.handleDeviceFound.bind(this));
    BLEManager.on('deviceLost', this.handleDeviceLost.bind(this));
    BLEManager.on('scan-state', this.handleScanStateChange.bind(this));
    BLEManager.on('advertising-state', this.handleAdvertisingStateChange.bind(this));
    BLEManager.on('warning', ({ message }) => {
      this.emit('warning', { message });
    });

    PeerConnectionManager.onMessage(this.handleMessage.bind(this));
    PeerConnectionManager.onConnectionStateChange(this.handleConnectionStateChange.bind(this));
    PeerConnectionManager.on('error', ({ message, deviceId }) => {
      this.emit('error', { message, deviceId });
    });
    
    bleTransport.onProgress = (deviceId, bytes) => {
      const resolvedId = this.bleIdMap.get(deviceId) || deviceId;
      const incoming = this.incomingTransfers.get(resolvedId);
      this.emit('transfer-progress', { 
        deviceId: resolvedId, 
        received: bytes,
        hash: incoming?.hash,
        total: incoming?.totalSize
      });
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

  async start() {
    if (this.started) return;
    this.started = true;

    await this.refreshAdvertisingMetadata();
    await BLEManager.startAdvertising(BLEManager.getLocalMetadata());
    await BLEManager.startScanning();

    this.emit('nearby-devices-update', this.getNearbyDevices());
    this.emit('connected-peers-update', this.getConnectedPeers());
    this.emit('mesh-radio-state', this.getRadioState());
    this.emit('mesh-state', this.getNetworkStats());
  }

  async stop() {
    if (!this.started) return;
    this.started = false;

    const peers = Array.from(this.connectedPeers.keys());
    for (const deviceId of peers) {
      await PeerConnectionManager.disconnectPeer(deviceId);
    }

    BLEManager.stopAdvertising();
    BLEManager.stopScanning();

    this.nearbyDevices.clear();
    this.connectedPeers.clear();
    this.peerCatalogs.clear();
    
    // Clear any active timeouts
    this.activeRequests.forEach(timerId => clearTimeout(timerId));
    this.activeRequests.clear();

    this.emit('nearby-devices-update', []);
    this.emit('connected-peers-update', []);
    this.emit('mesh-radio-state', this.getRadioState());
    this.emit('mesh-state', this.getNetworkStats());
  }

  async setScanning(enabled) {
    if (enabled) {
      await BLEManager.startScanning();
    } else {
      BLEManager.stopScanning();
    }
    this.emit('mesh-radio-state', this.getRadioState());
  }

  async setAdvertising(enabled) {
    if (enabled) {
      await this.refreshAdvertisingMetadata();
      await BLEManager.startAdvertising(BLEManager.getLocalMetadata());
    } else {
      BLEManager.stopAdvertising();
    }
    this.emit('mesh-radio-state', this.getRadioState());
  }

  async restartMesh() {
    await this.setAdvertising(false);
    await this.setScanning(false);
    await this.setAdvertising(true);
    await this.setScanning(true);
  }

  getRadioState() {
    return {
      scanning: BLEManager.isScanning(),
      advertising: BLEManager.isAdvertising(),
    };
  }

  async refreshAdvertisingMetadata() {
    const stats = await CacheManager.getStats();
    const catalog = await CacheManager.getCatalog();
    const hashPreview = catalog.slice(0, 5).map((p) => p.hash);
    const myName = await CacheManager.getSetting('deviceName', 'Reality Cache Device');

    await BLEManager.updateAdvertisingMetadata({
      pageCount: stats.count,
      deviceName: myName,
      hashPreview,
    });
  }

  getNearbyDevices() {
    return Array.from(this.nearbyDevices.values());
  }

  getConnectedPeers() {
    return Array.from(this.connectedPeers.values());
  }

  getPeerCatalog(deviceId) {
    const entry = this.peerCatalogs.get(deviceId);
    return entry ? entry.pages : [];
  }

  getPeerCatalogs() {
    const out = {};
    this.peerCatalogs.forEach((entry, deviceId) => {
      out[deviceId] = entry; // entry is { deviceName, pages }
    });
    return out;
  }

  handleDeviceFound(device) {
    this.nearbyDevices.set(device.deviceId, device);
    
    // Autonomous Discovery: If we don't have a catalog for this device yet,
    // and weren't already connected, try to fetch it in the background.
    if (!this.peerCatalogs.has(device.deviceId) && !this.connectedPeers.has(device.deviceId)) {
        console.log(`[MeshManager] Autonomous sync starting for: ${device.deviceName || device.deviceId}`);
        this.connectToDevice(device.deviceId).catch(e => {
            console.warn(`[MeshManager] Auto-sync failed for ${device.deviceId}:`, e.message);
        });
    }

    this.emit('nearby-devices-update', this.getNearbyDevices());
    this.emit('mesh-state', this.getNetworkStats());
  }

  handleDeviceLost(device) {
    this.nearbyDevices.delete(device.deviceId);
    this.peerCatalogs.delete(device.deviceId); // PURGE stale catalog
    this.emit('nearby-devices-update', this.getNearbyDevices());
    this.emit('catalog-update', { deviceId: device.deviceId, pages: [] });
    this.emit('mesh-state', this.getNetworkStats());
  }

  handleConnectionStateChange({ deviceId, state }) {
    // Resolve logical deviceId: could be a bleDeviceId from an incoming connection
    const resolvedId = this.bleIdMap.get(deviceId) || deviceId;

    if (state === 'connected') {
      const device = this.nearbyDevices.get(resolvedId);
      this.connectedPeers.set(resolvedId, {
        ...(device || { deviceId: resolvedId, deviceName: `Peer-${resolvedId.slice(0, 6)}` }),
        deviceId: resolvedId,
        bleDeviceId: deviceId, // keep the transport-level ID
      });
      this.requestCatalog(resolvedId);
    } else {
      this.connectedPeers.delete(resolvedId);
      this.peerCatalogs.delete(resolvedId);
    }

    this.emit('connected-peers-update', this.getConnectedPeers());
    this.emit('mesh-state', this.getNetworkStats());
  }

  async handleMessage({ deviceId, data }) {
    if (!data || typeof data !== 'object') return;

    // Resolve logical ID from the message source
    const resolvedId = this.bleIdMap.get(deviceId) || deviceId;

    switch (data.type) {
      case 'CATALOG':
        // Identity Handshake: if the peer sent their name, update our records
        if (data.deviceName) {
            const currentPeer = this.connectedPeers.get(resolvedId);
            if (currentPeer) {
                this.connectedPeers.set(resolvedId, { ...currentPeer, deviceName: data.deviceName });
                this.emit('connected-peers-update', this.getConnectedPeers());
            }
            
            const nearby = this.nearbyDevices.get(resolvedId);
            if (nearby) {
                this.nearbyDevices.set(resolvedId, { ...nearby, deviceName: data.deviceName });
                this.emit('nearby-devices-update', this.getNearbyDevices());
            }
        }

        this.peerCatalogs.set(resolvedId, {
            deviceName: data.deviceName || `Peer-${resolvedId.slice(0, 8)}`,
            pages: Array.isArray(data.pages) ? data.pages : []
        });
        this.emit('catalog-update', { deviceId: resolvedId, pages: this.getPeerCatalog(resolvedId) });
        this.emit('mesh-state', this.getNetworkStats());
        break;

      case 'REQUEST_CATALOG':
        await this.sendCatalog(deviceId);
        break;

      case 'PAGE_DATA':
        if (data.hash && data.url && data.title && typeof data.html === 'string') {
          await CacheManager.storeMeshContent(data.hash, data.url, data.title, data.html);
          
          this.incomingTransfers.delete(resolvedId);

          // Clear watchdog timer
          const timerId = this.activeRequests.get(data.hash);
          if (timerId) {
            clearTimeout(timerId);
            this.activeRequests.delete(data.hash);
          }

          await this.refreshAdvertisingMetadata();
          this.emit('page-received', {
            hash: data.hash,
            title: data.title,
            deviceId,
          });
        }
        break;

      case 'REQUEST_PAGE':
        await this.sendPage(deviceId, data.hash);
        break;

      case 'PERMISSION_PENDING':
        this.emit('permission-pending', { deviceId, hash: data.hash });
        break;

      case 'PERMISSION_DENIED':
        // Clear watchdog timer
        const denyTimerId = this.activeRequests.get(data.hash);
        if (denyTimerId) {
          clearTimeout(denyTimerId);
          this.activeRequests.delete(data.hash);
        }

        this.emit('error', {
          deviceId,
          hash: data.hash,
          message: `Peer denied permission to download: ${data.title || 'Private content'}`,
        });
        break;

      case 'PAGE_NOT_FOUND':
        this.emit('error', {
          deviceId,
          hash: data.hash,
          message: `Peer could not find content for hash: ${data.hash}`,
        });
        break;

      case 'TRANSFER_START':
        this.incomingTransfers.set(resolvedId, { 
            hash: data.hash, 
            totalSize: data.totalSize 
        });
        this.emit('transfer-progress', {
          deviceId: resolvedId,
          hash: data.hash,
          received: 0,
          total: data.totalSize,
          title: data.title
        });
        break;

      default:
        break;
    }
  }

  async connectToDevice(deviceId) {
    // Look up the BLE hardware address from the discovered device
    const device = this.nearbyDevices.get(deviceId);
    const bleId = device?.bleDeviceId || deviceId;

    // 1. Stop scanning before connecting — critical for Android stability
    if (BLEManager.isScanning()) {
      await BLEManager.stopScanning();
      // Give the radio a moment to settle
      await new Promise(r => setTimeout(r, 500));
    }

    // Store the mapping so incoming messages can be resolved
    this.bleIdMap.set(bleId, deviceId);

    // Pass both the hardware address and the logical user-friendly ID
    await PeerConnectionManager.connectToPeer(bleId, deviceId);
  }

  async disconnectDevice(deviceId) {
    await PeerConnectionManager.disconnectPeer(deviceId);
  }

  requestCatalog(deviceId) {
    return PeerConnectionManager.sendMessage(deviceId, { type: 'REQUEST_CATALOG' });
  }

  requestPage(deviceId, hash) {
    // Start Watchdog Timer (15 seconds)
    if (this.activeRequests.has(hash)) {
        clearTimeout(this.activeRequests.get(hash));
    }

    const timerId = setTimeout(() => {
        if (this.activeRequests.has(hash)) {
            this.activeRequests.delete(hash);
            this.emit('error', {
                deviceId,
                hash,
                message: 'Request Timed Out: Peer is unresponsive or out of range.'
            });
        }
    }, 15000);

    this.activeRequests.set(hash, timerId);

    return PeerConnectionManager.sendMessage(deviceId, { type: 'REQUEST_PAGE', hash });
  }

  async sendCatalog(deviceId) {
    const catalog = await CacheManager.getCatalog();
    const pages = catalog.map(({ hash, title, url, isPrivate }) => ({ hash, title, url, isPrivate }));
    const myName = await CacheManager.getSetting('deviceName', 'Reality Cache Device');
    
    return PeerConnectionManager.sendMessage(deviceId, { 
        type: 'CATALOG', 
        pages,
        deviceName: myName 
    });
  }

  async shareCatalog() {
    const peers = Array.from(this.connectedPeers.keys());
    await Promise.all(peers.map((deviceId) => this.sendCatalog(deviceId)));
  }

  async sendPage(deviceId, hash, approved = false) {
    if (!hash) return;

    const page = await CacheManager.getByHash(hash);
    if (!page) {
      PeerConnectionManager.sendMessage(deviceId, {
        type: 'PAGE_NOT_FOUND',
        hash,
      });
      return;
    }

    // Check privacy
    if (page.isPrivate && !approved) {
      // Add to pending
      if (!this.pendingRequests.has(hash)) {
        this.pendingRequests.set(hash, new Set());
      }
      this.pendingRequests.get(hash).add(deviceId);

      // Notify owner locally
      this.emit('permission-requested', {
        deviceId,
        hash,
        title: page.title,
        peerName: this.connectedPeers.get(deviceId)?.deviceName || 'Unknown Peer',
      });

      // Notify requester
      PeerConnectionManager.sendMessage(deviceId, {
        type: 'PERMISSION_PENDING',
        hash,
      });
      return;
    }
    
    // Announce transfer start for progress tracking
    await PeerConnectionManager.sendMessage(deviceId, {
        type: 'TRANSFER_START',
        hash: page.hash,
        totalSize: page.html.length,
        title: page.title
    });

    PeerConnectionManager.sendMessage(deviceId, {
      type: 'PAGE_DATA',
      hash: page.hash,
      html: page.html,
      title: page.title,
      url: page.url,
      assets: [],
    });
  }

  async approveRequest(deviceId, hash) {
    const set = this.pendingRequests.get(hash);
    if (set) set.delete(deviceId);
    await this.sendPage(deviceId, hash, true);
  }

  async denyRequest(deviceId, hash) {
    const set = this.pendingRequests.get(hash);
    if (set) set.delete(deviceId);
    
    const page = await CacheManager.getByHash(hash);
    PeerConnectionManager.sendMessage(deviceId, {
      type: 'PERMISSION_DENIED',
      hash,
      title: page?.title,
    });
  }

  searchPeers(query) {
    const q = (query || '').trim().toLowerCase();
    if (!q) return [];

    const results = [];
    const seen = new Set();

    for (const [deviceId, entry] of this.peerCatalogs.entries()) {
      const { pages } = entry;
      for (const page of pages) {
        const title = (page.title || '').toLowerCase();
        const url = (page.url || '').toLowerCase();
        if (title.includes(q) || url.includes(q)) {
          if (!seen.has(page.hash)) {
            seen.add(page.hash);
            results.push({ ...page, source: 'mesh', deviceId });
          }
        }
      }
    }

    return results;
  }

  getNetworkStats() {
    const uniquePeerHashes = new Set();
    this.peerCatalogs.forEach((entry) => {
      const { pages } = entry;
      pages.forEach((item) => {
        if (item?.hash) uniquePeerHashes.add(item.hash);
      });
    });

    return {
      nearbyDevices: this.nearbyDevices.size,
      connectedPeers: this.connectedPeers.size,
      peerPages: uniquePeerHashes.size,
    };
  }

  handleScanStateChange() {
    this.emit('mesh-radio-state', this.getRadioState());
  }

  handleAdvertisingStateChange() {
    this.emit('mesh-radio-state', this.getRadioState());
  }

  getKnowledgeRadius() {
    const stats = this.getNetworkStats();
    return {
      totalPages: stats.peerPages,
      totalDevices: stats.connectedPeers,
    };
  }

  isConnected() {
    return this.connectedPeers.size > 0;
  }
}

export default new MeshManager();
