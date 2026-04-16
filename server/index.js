require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const compression = require('compression');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 5e6,
});

app.use(cors());
app.use(compression());
app.use(express.json({ limit: '5mb' }));

// ─── In-Memory State (no MongoDB needed for mesh) ────────────────────

const peers = new Map();       // socketId -> { peerId, deviceName, catalog, connectedAt }
const contentIndex = new Map(); // hash -> { url, title, size, holders: Set<peerId>, accessCount }
const peerHistory = new Map();  // peerId -> { deviceName, active, lastSeen, connectedAt }

// ─── REST API (lightweight, no DB) ───────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    role: 'relay-node',
    peers: peers.size,
    content: contentIndex.size,
    uptime: process.uptime(),
  });
});

app.get('/api/peers', (req, res) => {
  const list = [];
  peers.forEach((data) => {
    list.push({
      peerId: data.peerId,
      deviceName: data.deviceName,
      catalogSize: data.catalog.length,
      connectedAt: data.connectedAt,
    });
  });
  res.json(list);
});

app.get('/api/peers/all', (req, res) => {
  const list = [];
  peerHistory.forEach((data, peerId) => {
    list.push({ peerId, ...data });
  });
  res.json(list);
});

app.get('/api/content', (req, res) => {
  const { q } = req.query;
  let results = [];
  contentIndex.forEach((meta, hash) => {
    if (!q || meta.title.toLowerCase().includes(q.toLowerCase()) || meta.url.toLowerCase().includes(q.toLowerCase())) {
      results.push({
        hash,
        ...meta,
        holders: Array.from(meta.holders),
        holderCount: meta.holders.size,
      });
    }
  });
  results.sort((a, b) => (b.holderCount * b.accessCount) - (a.holderCount * a.accessCount));
  res.json(results.slice(0, 50));
});

app.get('/api/content/popular', (req, res) => {
  let results = [];
  contentIndex.forEach((meta, hash) => {
    results.push({
      hash,
      ...meta,
      holders: Array.from(meta.holders),
      holderCount: meta.holders.size,
      score: meta.holders.size * 5 + meta.accessCount,
    });
  });
  results.sort((a, b) => b.score - a.score);
  res.json(results.slice(0, 20));
});

// ─── Socket.IO Distributed Mesh Relay ────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[+] Connected: ${socket.id}`);

  // ── Join Mesh ──────────────────────────────────────────────────────
  socket.on('join-mesh', ({ peerId, deviceName }) => {
    peers.set(socket.id, {
      peerId,
      deviceName: deviceName || 'Unknown',
      catalog: [],
      connectedAt: Date.now(),
    });

    // Track in peer history
    peerHistory.set(peerId, {
      deviceName: deviceName || 'Unknown',
      active: true,
      lastSeen: Date.now(),
      connectedAt: Date.now(),
    });
    socket.join('mesh');
    console.log(`[Mesh] ${deviceName} joined (${peers.size} peers)`);

    // Send this peer the FULL state: all other peers + global content index
    const peerList = [];
    const allCatalogs = {};
    peers.forEach((data, sid) => {
      if (sid !== socket.id) {
        peerList.push({
          peerId: data.peerId,
          deviceName: data.deviceName,
          catalogSize: data.catalog.length,
        });
        // Send each peer's catalog so the new device has full mesh state
        allCatalogs[data.peerId] = {
          deviceName: data.deviceName,
          catalog: data.catalog,
        };
      }
    });
    socket.emit('mesh-state', { peers: peerList, catalogs: allCatalogs });

    // Send full peer history (including inactive) to the new client
    const history = [];
    peerHistory.forEach((data, pid) => {
      if (pid !== peerId) {
        history.push({ peerId: pid, ...data });
      }
    });
    socket.emit('peer-history', history);

    // Notify everyone else
    socket.to('mesh').emit('peer-joined', {
      peerId,
      deviceName,
      totalPeers: peers.size,
    });
  });

  // ── Catalog Share (gossip) ─────────────────────────────────────────
  // When a device shares its catalog, this relay:
  //   1. Updates the global content index
  //   2. Forwards to ALL other connected peers (gossip)
  socket.on('catalog-share', (catalog) => {
    const peer = peers.get(socket.id);
    if (!peer) return;

    peer.catalog = catalog || [];

    // Update global content index
    for (const item of catalog) {
      if (contentIndex.has(item.hash)) {
        const existing = contentIndex.get(item.hash);
        existing.holders.add(peer.peerId);
        existing.accessCount = Math.max(existing.accessCount, item.accessCount || 1);
      } else {
        contentIndex.set(item.hash, {
          url: item.url,
          title: item.title,
          size: item.size,
          holders: new Set([peer.peerId]),
          accessCount: item.accessCount || 1,
        });
      }
    }

    console.log(`[Gossip] ${peer.deviceName} shared ${catalog.length} items → forwarding to ${peers.size - 1} peers`);

    // GOSSIP: forward to ALL other peers
    socket.to('mesh').emit('catalog-update', {
      peerId: peer.peerId,
      deviceName: peer.deviceName,
      catalog,
    });
  });

  // ── Content Request → Route to holder ──────────────────────────────
  socket.on('request-content', ({ targetPeerId, hash }) => {
    const requester = peers.get(socket.id);
    if (!requester) return;

    // Find ANY peer that has this content (not just targetPeerId)
    // This is distributed — if targetPeerId is gone, find another holder
    let targetSocket = null;
    let actualTarget = targetPeerId;

    // First try the requested peer
    for (const [sid, data] of peers) {
      if (data.peerId === targetPeerId) {
        targetSocket = sid;
        break;
      }
    }

    // If not found, find ANY holder (distributed fallback)
    if (!targetSocket) {
      const meta = contentIndex.get(hash);
      if (meta) {
        for (const holderId of meta.holders) {
          for (const [sid, data] of peers) {
            if (data.peerId === holderId && sid !== socket.id) {
              targetSocket = sid;
              actualTarget = holderId;
              break;
            }
          }
          if (targetSocket) break;
        }
      }
    }

    if (targetSocket) {
      console.log(`[Relay] ${requester.deviceName} → requesting ${hash.substring(0, 8)}... from ${actualTarget}`);
      io.to(targetSocket).emit('content-requested', {
        requesterPeerId: requester.peerId,
        requesterSocketId: socket.id,
        hash,
      });
    } else {
      socket.emit('content-unavailable', { hash });
    }
  });

  // ── Content Relay (chunked) ────────────────────────────────────────
  socket.on('send-content-chunk', ({ targetSocketId, hash, chunkIndex, totalChunks, data }) => {
    io.to(targetSocketId).emit('content-chunk', { hash, chunkIndex, totalChunks, data });
  });

  socket.on('send-content-complete', ({ targetSocketId, hash, title, url, mimeType, size }) => {
    io.to(targetSocketId).emit('content-complete', { hash, title, url, mimeType, size });

    // Update content index — new holder
    const receiver = null;
    for (const [sid, data] of peers) {
      if (sid === targetSocketId && contentIndex.has(hash)) {
        contentIndex.get(hash).holders.add(data.peerId);
        break;
      }
    }

    // GOSSIP: notify all peers about the new holder
    const senderPeer = peers.get(socket.id);
    if (senderPeer) {
      io.to('mesh').emit('content-propagated', {
        hash,
        holderCount: contentIndex.has(hash) ? contentIndex.get(hash).holders.size : 1,
      });
    }
  });

  // ── Mesh Search (broadcast) ────────────────────────────────────────
  socket.on('search-mesh', ({ query, requestId }) => {
    const requester = peers.get(socket.id);
    if (!requester) return;

    // Broadcast to all peers
    socket.to('mesh').emit('search-query', {
      query,
      requestId,
      requesterSocketId: socket.id,
    });

    // Also search our own global index and return results
    const indexResults = [];
    contentIndex.forEach((meta, hash) => {
      if (meta.title.toLowerCase().includes(query.toLowerCase()) ||
          meta.url.toLowerCase().includes(query.toLowerCase())) {
        indexResults.push({
          hash,
          url: meta.url,
          title: meta.title,
          size: meta.size,
          accessCount: meta.accessCount,
          holderCount: meta.holders.size,
        });
      }
    });
    if (indexResults.length > 0) {
      socket.emit('search-response', { requestId, results: indexResults, source: 'index' });
    }
  });

  socket.on('search-results', ({ targetSocketId, requestId, results }) => {
    io.to(targetSocketId).emit('search-response', { requestId, results, source: 'peer' });
  });

  // ── Disconnect ─────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    const peer = peers.get(socket.id);
    peers.delete(socket.id);
    if (peer) {
      console.log(`[-] ${peer.deviceName} left (${peers.size} peers)`);

      // Mark inactive in history (don't delete)
      if (peerHistory.has(peer.peerId)) {
        peerHistory.get(peer.peerId).active = false;
        peerHistory.get(peer.peerId).lastSeen = Date.now();
      }

      // DON'T remove from content index — other peers may still have the content
      // This is key to distributed resilience

      io.to('mesh').emit('peer-left', {
        peerId: peer.peerId,
        totalPeers: peers.size,
      });
    }
  });
});

// ─── Start ───────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;

// Try to connect to MongoDB if available, but DON'T require it
let mongoConnected = false;
if (process.env.MONGO_URI) {
  try {
    const mongoose = require('mongoose');
    mongoose.connect(process.env.MONGO_URI)
      .then(() => {
        mongoConnected = true;
        console.log('📦 MongoDB connected (optional persistence)');
      })
      .catch(() => {
        console.log('⚠️  MongoDB not available — running in-memory only (this is fine)');
      });
  } catch (e) {
    // mongoose not installed, that's fine
  }
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════════════╗
║       ⚡ Reality Cache — Relay Node              ║
║──────────────────────────────────────────────────║
║  URL:  http://0.0.0.0:${PORT}                       ║
║  Role: Distributed relay (not a central server)  ║
║                                                  ║
║  This is just ONE node in the mesh.              ║
║  Any machine can run this to extend the network. ║
║  Devices relay content to each other through     ║
║  whichever relay nodes they're connected to.     ║
╚══════════════════════════════════════════════════╝
  `);
});
