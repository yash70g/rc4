import { io } from 'socket.io-client';
import * as CacheManager from './CacheManager';

// ─── Multi-Relay Mesh Manager ────────────────────────────────────────
// Each device can connect to MULTIPLE relay nodes simultaneously.
// Content and catalogs propagate through whichever relays are available.
// If one relay goes down, the mesh still works through others.

let relays = {};      // url -> socket instance
let myPeerId = null;
let myDeviceName = 'Device';
let listeners = {};

// Mesh state (aggregated from ALL relays)
let meshPeers = {};   // peerId -> { deviceName, catalog, relayUrl }
let meshStats = { totalPages: 0, totalDevices: 0 };

// Peer history (tracks inactive peers too)
let peerHistory = {};  // peerId -> { deviceName, active, lastSeen, relayUrl }

// Content transfer buffer
const contentBuffer = {};

// ─── Event System ────────────────────────────────────────────────────

export function on(event, callback) {
  if (!listeners[event]) listeners[event] = [];
  listeners[event].push(callback);
}

export function off(event, callback) {
  if (!listeners[event]) return;
  listeners[event] = listeners[event].filter((cb) => cb !== callback);
}

function emit(event, data) {
  if (!listeners[event]) return;
  listeners[event].forEach((cb) => cb(data));
}

// ─── Peer ID ─────────────────────────────────────────────────────────

function generatePeerId() {
  return 'rc-' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}

export function getPeerId() {
  return myPeerId;
}

// ─── Connect to a Relay Node ─────────────────────────────────────────
// Can be called MULTIPLE times to connect to different relay nodes.
// Each relay extends the mesh — the more relays, the more resilient.

export function connect(serverUrl, deviceName = 'My Device') {
  if (!myPeerId) myPeerId = generatePeerId();
  myDeviceName = deviceName;

  // Already connected to this relay?
  if (relays[serverUrl]?.connected) {
    console.log(`[Mesh] Already connected to ${serverUrl}`);
    return;
  }

  const socket = io(serverUrl, {
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 2000,
  });

  relays[serverUrl] = socket;

  socket.on('connect', () => {
    console.log(`[Mesh] Connected to relay: ${serverUrl}`);
    socket.emit('join-mesh', { peerId: myPeerId, deviceName });
    emit('connected', { peerId: myPeerId, relayUrl: serverUrl });

    // Share catalog with this relay (which gossips to all its peers)
    shareCatalogTo(serverUrl);
  });

  socket.on('disconnect', () => {
    console.log(`[Mesh] Disconnected from relay: ${serverUrl}`);
    // Remove peers that were only known through this relay
    for (const [pid, peer] of Object.entries(meshPeers)) {
      if (peer.relayUrl === serverUrl) {
        delete meshPeers[pid];
      }
    }
    updateStats();
    emit('disconnected', { relayUrl: serverUrl });
  });

  socket.on('connect_error', (error) => {
    console.log(`[Mesh] Error on ${serverUrl}:`, error.message);
    emit('error', { message: `Relay ${serverUrl}: ${error.message}` });
  });

  // ── Full mesh state (sent on join) ─────────────────────────────────
  socket.on('mesh-state', ({ peers: peerList, catalogs }) => {
    // Ingest all catalogs from this relay
    for (const [peerId, data] of Object.entries(catalogs)) {
      if (peerId === myPeerId) continue;
      meshPeers[peerId] = {
        deviceName: data.deviceName,
        catalog: data.catalog || [],
        relayUrl: serverUrl,
      };
      // Track in peer history as active
      peerHistory[peerId] = {
        deviceName: data.deviceName,
        active: true,
        lastSeen: Date.now(),
        relayUrl: serverUrl,
      };
    }
    updateStats();
    emit('mesh-state', { peers: peerList, catalogs });
  });

  // ── Peer history (includes inactive) ────────────────────────────
  socket.on('peer-history', (history) => {
    for (const peer of history) {
      if (peer.peerId === myPeerId) continue;
      // Only update if we don't already know them as active
      if (!peerHistory[peer.peerId] || !peerHistory[peer.peerId].active) {
        peerHistory[peer.peerId] = {
          deviceName: peer.deviceName,
          active: peer.active,
          lastSeen: peer.lastSeen,
          relayUrl: serverUrl,
        };
      }
    }
    emit('peer-history', history);
  });

  // ── Peer events ────────────────────────────────────────────────────
  socket.on('peer-joined', ({ peerId, deviceName, totalPeers }) => {
    if (peerId === myPeerId) return;
    console.log(`[Mesh] Peer joined via ${serverUrl}: ${deviceName}`);
    // Track in history as active
    peerHistory[peerId] = {
      deviceName,
      active: true,
      lastSeen: Date.now(),
      relayUrl: serverUrl,
    };
    emit('peer-joined', { peerId, deviceName, totalPeers });
    // Re-share our catalog so the new peer gets it
    shareCatalogTo(serverUrl);
  });

  socket.on('peer-left', ({ peerId, totalPeers }) => {
    // Only remove from active peers if we don't know them from another relay
    const otherRelayHas = Object.entries(relays).some(([url, s]) =>
      url !== serverUrl && s?.connected
    );
    if (!otherRelayHas) {
      delete meshPeers[peerId];
    }
    // Mark inactive in history (don't delete)
    if (peerHistory[peerId]) {
      peerHistory[peerId].active = false;
      peerHistory[peerId].lastSeen = Date.now();
    }
    updateStats();
    emit('peer-left', { peerId, totalPeers });
  });

  // ── Catalog gossip ─────────────────────────────────────────────────
  socket.on('catalog-update', ({ peerId, deviceName, catalog }) => {
    if (peerId === myPeerId) return;
    meshPeers[peerId] = {
      deviceName,
      catalog: catalog || [],
      relayUrl: serverUrl,
    };
    updateStats();
    emit('catalog-update', { peerId, deviceName, catalog });

    // GOSSIP FORWARDING: if we're connected to other relays,
    // forward this catalog update so it propagates further
    forwardCatalog(serverUrl, peerId, deviceName, catalog);
  });

  // ── Content propagation notification ───────────────────────────────
  socket.on('content-propagated', ({ hash, holderCount }) => {
    emit('content-propagated', { hash, holderCount });
  });

  // ── Content request (someone asking US) ────────────────────────────
  socket.on('content-requested', async ({ requesterPeerId, requesterSocketId, hash }) => {
    console.log(`[Mesh] Content requested: ${hash.substring(0, 8)}...`);
    try {
      const html = await CacheManager.readHtml(hash);
      if (!html) {
        console.log(`[Mesh] Don't have ${hash.substring(0, 8)}... — can't serve`);
        return;
      }

      // Chunked transfer
      const CHUNK_SIZE = 16 * 1024;
      const totalChunks = Math.ceil(html.length / CHUNK_SIZE);

      for (let i = 0; i < totalChunks; i++) {
        const chunk = html.substring(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        socket.emit('send-content-chunk', {
          targetSocketId: requesterSocketId,
          hash,
          chunkIndex: i,
          totalChunks,
          data: chunk,
        });
        await new Promise((r) => setTimeout(r, 50));
      }

      const pages = await CacheManager.getCatalog();
      const page = pages.find((p) => p.hash === hash);

      socket.emit('send-content-complete', {
        targetSocketId: requesterSocketId,
        hash,
        title: page?.title || 'Untitled',
        url: page?.url || '',
        mimeType: 'text/html',
        size: html.length,
      });
    } catch (e) {
      console.log('[Mesh] Error serving content:', e.message);
    }
  });

  // ── Receiving content chunks ───────────────────────────────────────
  socket.on('content-chunk', ({ hash, chunkIndex, totalChunks, data }) => {
    if (!contentBuffer[hash]) {
      contentBuffer[hash] = { chunks: new Array(totalChunks), received: 0, totalChunks };
    }
    contentBuffer[hash].chunks[chunkIndex] = data;
    contentBuffer[hash].received++;
    emit('download-progress', { hash, progress: contentBuffer[hash].received / totalChunks });
  });

  socket.on('content-complete', async ({ hash, title, url, mimeType, size }) => {
    const buffer = contentBuffer[hash];
    if (!buffer) return;
    const html = buffer.chunks.join('');
    delete contentBuffer[hash];

    const result = await CacheManager.storeMeshContent(hash, url, title, html);
    emit('content-received', { hash, title, url, size, deduplicated: result.deduplicated });

    // After receiving new content, gossip our updated catalog to ALL relays
    shareCatalog();
  });

  socket.on('content-unavailable', ({ hash }) => {
    emit('content-unavailable', { hash });
  });

  // ── Search ─────────────────────────────────────────────────────────
  socket.on('search-query', async ({ query, requestId, requesterSocketId }) => {
    const results = await CacheManager.search(query);
    const trimmed = results.map((r) => ({
      hash: r.hash,
      url: r.url,
      title: r.title,
      size: r.size,
      accessCount: r.accessCount,
    }));
    socket.emit('search-results', {
      targetSocketId: requesterSocketId,
      requestId,
      results: trimmed,
    });
  });

  socket.on('search-response', ({ requestId, results, source }) => {
    emit('search-response', { requestId, results, source });
  });
}

// ─── Gossip Forwarding ───────────────────────────────────────────────
// When we receive a catalog from Relay A, forward it to Relay B, C, etc.
// This is how the mesh propagates across multiple relay nodes.

function forwardCatalog(sourceRelayUrl, peerId, deviceName, catalog) {
  for (const [url, socket] of Object.entries(relays)) {
    if (url !== sourceRelayUrl && socket?.connected) {
      // Don't re-share, just emit a catalog update for this peer
      // The relay will handle dedup
      socket.emit('catalog-share', catalog);
    }
  }
}

// ─── Share catalog to a specific relay ───────────────────────────────

async function shareCatalogTo(relayUrl) {
  const socket = relays[relayUrl];
  if (!socket?.connected) return;
  try {
    const catalog = await CacheManager.getCatalog();
    socket.emit('catalog-share', catalog);
  } catch (e) {
    console.log('[Mesh] Error sharing catalog:', e.message);
  }
}

// ─── Share catalog to ALL connected relays (gossip) ──────────────────

export async function shareCatalog() {
  try {
    const catalog = await CacheManager.getCatalog();
    for (const [url, socket] of Object.entries(relays)) {
      if (socket?.connected) {
        socket.emit('catalog-share', catalog);
      }
    }
  } catch (e) {
    console.log('[Mesh] Error sharing catalog:', e.message);
  }
}

// ─── Request content (tries all relays) ──────────────────────────────

export function requestContent(targetPeerId, hash) {
  // Send request through ALL connected relays for maximum redundancy
  // The relay will route to whichever holder is available
  let sent = false;
  for (const [url, socket] of Object.entries(relays)) {
    if (socket?.connected) {
      socket.emit('request-content', { targetPeerId, hash });
      sent = true;
      break; // Send through the first connected relay — relay handles routing
    }
  }
  if (sent) {
    emit('download-started', { hash, targetPeerId });
  }
}

// ─── Auto Sync ───────────────────────────────────────────────────────

export async function autoSync() {
  const localCatalog = await CacheManager.getCatalog();
  const localHashes = new Set(localCatalog.map((p) => p.hash));
  const toDownload = [];

  for (const [peerId, peer] of Object.entries(meshPeers)) {
    for (const item of peer.catalog) {
      if (!localHashes.has(item.hash) && !toDownload.find((d) => d.hash === item.hash)) {
        toDownload.push({ ...item, peerId });
      }
    }
  }

  emit('sync-started', { total: toDownload.length });

  for (let i = 0; i < toDownload.length; i++) {
    const item = toDownload[i];
    requestContent(item.peerId, item.hash);
    await new Promise((r) => setTimeout(r, 500));
    emit('sync-progress', { current: i + 1, total: toDownload.length });
  }

  return toDownload.length;
}

// ─── Mesh Search (broadcast to ALL relays) ───────────────────────────

export function searchMesh(query) {
  const requestId = 'search-' + Date.now();
  for (const [url, socket] of Object.entries(relays)) {
    if (socket?.connected) {
      socket.emit('search-mesh', { query, requestId });
    }
  }
  return requestId;
}

// ─── Getters ─────────────────────────────────────────────────────────

export function getKnowledgeRadius() {
  return meshStats;
}

export function getMeshPeers() {
  return meshPeers;
}

export function getAllPeersWithStatus() {
  return peerHistory;
}

export function isConnected() {
  return Object.values(relays).some((s) => s?.connected);
}

export function getConnectedRelays() {
  const connected = [];
  for (const [url, socket] of Object.entries(relays)) {
    if (socket?.connected) {
      connected.push(url);
    }
  }
  return connected;
}

// ─── Disconnect ──────────────────────────────────────────────────────

export function disconnectRelay(relayUrl) {
  const socket = relays[relayUrl];
  if (socket) {
    socket.disconnect();
    delete relays[relayUrl];
  }
  // Clean peers from that relay
  for (const [pid, peer] of Object.entries(meshPeers)) {
    if (peer.relayUrl === relayUrl) {
      delete meshPeers[pid];
    }
  }
  updateStats();
  emit('disconnected', { relayUrl });
}

export function disconnect() {
  for (const [url, socket] of Object.entries(relays)) {
    if (socket) socket.disconnect();
  }
  relays = {};
  meshPeers = {};
  meshStats = { totalPages: 0, totalDevices: 0 };
  // Mark all peers in history as inactive
  for (const pid of Object.keys(peerHistory)) {
    peerHistory[pid].active = false;
    peerHistory[pid].lastSeen = Date.now();
  }
  emit('disconnected', {});
}

// ─── Internal ────────────────────────────────────────────────────────

function updateStats() {
  const allPages = new Set();
  for (const peer of Object.values(meshPeers)) {
    for (const item of peer.catalog) {
      allPages.add(item.hash);
    }
  }
  meshStats = {
    totalPages: allPages.size,
    totalDevices: Object.keys(meshPeers).length,
  };
  emit('stats-update', meshStats);
}
