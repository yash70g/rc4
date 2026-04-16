/**
 * EmbeddedRelay — Runs a lightweight HTTP relay server ON the phone.
 *
 * Each phone runs this server so other devices can:
 *   - Discover it via /api/health
 *   - Get the peer list via /api/peers/all
 *   - Exchange catalogs via POST /api/catalog
 *   - Request content via POST /api/content/request
 *   - Receive content via POST /api/content/push
 *
 * No Socket.IO — pure HTTP REST. Phones poll each other.
 */

import * as HttpServer from 'expo-http-server';
import * as Network from 'expo-network';
import * as CacheManager from './CacheManager';

const RELAY_PORT = 4040;

// ── State ────────────────────────────────────────────────────────────
let isRunning = false;
let myIp = null;
let myDeviceName = 'Phone';
let myPeerId = null;

// Known peers: ip -> { peerId, deviceName, catalog, active, lastSeen }
const knownPeers = {};

// Event listeners
const listeners = {};

function emit(event, data) {
  if (!listeners[event]) return;
  listeners[event].forEach((cb) => cb(data));
}

export function on(event, cb) {
  if (!listeners[event]) listeners[event] = [];
  listeners[event].push(cb);
}

export function off(event, cb) {
  if (!listeners[event]) return;
  listeners[event] = listeners[event].filter((c) => c !== cb);
}

// ── Start Relay Server ───────────────────────────────────────────────

export async function startRelay(deviceName, peerId) {
  if (isRunning) return;

  myDeviceName = deviceName;
  myPeerId = peerId;

  try {
    // Get device IP
    const ip = await Network.getIpAddressAsync();
    myIp = ip;

    // Setup server
    HttpServer.setup(RELAY_PORT, (event) => {
      console.log(`[Relay] Status: ${event.status} - ${event.message}`);
      if (event.status === 'STARTED') {
        isRunning = true;
        emit('relay-started', { ip: myIp, port: RELAY_PORT });
      } else if (event.status === 'STOPPED' || event.status === 'ERROR') {
        isRunning = false;
        emit('relay-stopped', { message: event.message });
      }
    });

    // ── Routes ─────────────────────────────────────────────────────

    // Health check (used for LAN discovery)
    HttpServer.route('/api/health', 'GET', async () => ({
      statusCode: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        role: 'phone-relay',
        peerId: myPeerId,
        deviceName: myDeviceName,
        peers: Object.keys(knownPeers).length,
        uptime: Date.now(),
      }),
    }));

    // Get all known peers (for map consistency)
    HttpServer.route('/api/peers/all', 'GET', async () => {
      const list = [];

      // Add self
      list.push({
        peerId: myPeerId,
        deviceName: myDeviceName,
        active: true,
        lastSeen: Date.now(),
        isSelf: true,
      });

      // Add known peers
      for (const [ip, peer] of Object.entries(knownPeers)) {
        list.push({
          peerId: peer.peerId,
          deviceName: peer.deviceName,
          active: peer.active,
          lastSeen: peer.lastSeen,
          ip,
        });
      }

      return {
        statusCode: 200,
        contentType: 'application/json',
        body: JSON.stringify(list),
      };
    });

    // Receive catalog from another peer (gossip)
    HttpServer.route('/api/catalog', 'POST', async (req) => {
      try {
        const data = JSON.parse(req.body);
        const { peerId, deviceName, catalog, ip } = data;

        if (peerId === myPeerId) {
          return { statusCode: 200, body: '{"ok":true,"skipped":"self"}' };
        }

        // Update known peers
        const peerIp = ip || 'unknown';
        knownPeers[peerIp] = {
          peerId,
          deviceName,
          catalog: catalog || [],
          active: true,
          lastSeen: Date.now(),
        };

        emit('catalog-update', { peerId, deviceName, catalog });

        return {
          statusCode: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, received: catalog?.length || 0 }),
        };
      } catch (e) {
        return { statusCode: 400, body: JSON.stringify({ error: e.message }) };
      }
    });

    // Content request — another peer asks us for a cached page
    HttpServer.route('/api/content/request', 'POST', async (req) => {
      try {
        const { hash } = JSON.parse(req.body);
        const html = await CacheManager.readHtml(hash);

        if (!html) {
          return {
            statusCode: 404,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Content not found' }),
          };
        }

        const pages = await CacheManager.getCatalog();
        const page = pages.find((p) => p.hash === hash);

        return {
          statusCode: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            hash,
            title: page?.title || 'Untitled',
            url: page?.url || '',
            html,
            size: html.length,
          }),
        };
      } catch (e) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
      }
    });

    // Heartbeat — peers ping us to confirm we're alive
    HttpServer.route('/api/ping', 'POST', async (req) => {
      try {
        const { peerId, deviceName, ip } = JSON.parse(req.body);
        if (peerId && peerId !== myPeerId) {
          knownPeers[ip || 'unknown'] = {
            ...knownPeers[ip || 'unknown'],
            peerId,
            deviceName,
            active: true,
            lastSeen: Date.now(),
          };
        }
      } catch (e) {}

      return {
        statusCode: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          peerId: myPeerId,
          deviceName: myDeviceName,
          timestamp: Date.now(),
        }),
      };
    });

    // Start the server
    HttpServer.start();
    console.log(`[Relay] Starting on ${myIp}:${RELAY_PORT}`);
  } catch (e) {
    console.log('[Relay] Failed to start:', e.message);
    emit('relay-error', { message: e.message });
  }
}

// ── Stop Relay ───────────────────────────────────────────────────────

export function stopRelay() {
  if (!isRunning) return;
  HttpServer.stop();
  isRunning = false;
  emit('relay-stopped', {});
}

// ── Push catalog to a peer ───────────────────────────────────────────

export async function pushCatalog(peerIp, catalog) {
  try {
    const res = await fetch(`http://${peerIp}:${RELAY_PORT}/api/catalog`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        peerId: myPeerId,
        deviceName: myDeviceName,
        catalog,
        ip: myIp,
      }),
    });
    return await res.json();
  } catch (e) {
    // Peer unreachable — mark inactive
    if (knownPeers[peerIp]) {
      knownPeers[peerIp].active = false;
      knownPeers[peerIp].lastSeen = Date.now();
    }
    return null;
  }
}

// ── Request content from a peer ──────────────────────────────────────

export async function requestContentFromPeer(peerIp, hash) {
  try {
    emit('download-started', { hash, peerIp });
    const res = await fetch(`http://${peerIp}:${RELAY_PORT}/api/content/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash }),
    });

    if (!res.ok) {
      emit('content-unavailable', { hash });
      return null;
    }

    const data = await res.json();

    // Store the received content
    const result = await CacheManager.storeMeshContent(hash, data.url, data.title, data.html);
    emit('content-received', {
      hash: data.hash,
      title: data.title,
      url: data.url,
      size: data.size,
      deduplicated: result.deduplicated,
    });

    return data;
  } catch (e) {
    emit('content-unavailable', { hash });
    return null;
  }
}

// ── Ping a peer (heartbeat) ──────────────────────────────────────────

export async function pingPeer(peerIp) {
  try {
    const res = await fetch(`http://${peerIp}:${RELAY_PORT}/api/ping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        peerId: myPeerId,
        deviceName: myDeviceName,
        ip: myIp,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      knownPeers[peerIp] = {
        ...knownPeers[peerIp],
        peerId: data.peerId,
        deviceName: data.deviceName,
        active: true,
        lastSeen: Date.now(),
      };
      return data;
    }
  } catch (e) {
    if (knownPeers[peerIp]) {
      knownPeers[peerIp].active = false;
    }
  }
  return null;
}

// ── Gossip catalog to ALL known peers ────────────────────────────────

export async function gossipCatalog() {
  const catalog = await CacheManager.getCatalog();
  const activePeers = Object.entries(knownPeers).filter(([, p]) => p.active);

  for (const [ip] of activePeers) {
    pushCatalog(ip, catalog);
  }
}

// ── Getters ──────────────────────────────────────────────────────────

export function getMyIp() { return myIp; }
export function getPort() { return RELAY_PORT; }
export function isRelayRunning() { return isRunning; }
export function getKnownPeers() { return knownPeers; }
export function getMyPeerId() { return myPeerId; }
export function getMyDeviceName() { return myDeviceName; }
