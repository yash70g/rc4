const express = require('express');
const router = express.Router();
const Peer = require('../models/Peer');

// GET /api/peers — list active peers
router.get('/', async (req, res) => {
  try {
    const peers = await Peer.find().sort({ lastSeen: -1 });
    res.json(peers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/peers/register — register or heartbeat
router.post('/register', async (req, res) => {
  try {
    const { peerId, deviceName, contentCount } = req.body;
    const peer = await Peer.findOneAndUpdate(
      { peerId },
      {
        peerId,
        deviceName: deviceName || 'Unknown Device',
        contentCount: contentCount || 0,
        lastSeen: new Date(),
      },
      { upsert: true, new: true }
    );
    res.json(peer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
