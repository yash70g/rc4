const mongoose = require('mongoose');

const peerSchema = new mongoose.Schema({
  peerId: { type: String, required: true, unique: true },
  deviceName: { type: String, default: 'Unknown Device' },
  contentCount: { type: Number, default: 0 },
  lastSeen: { type: Date, default: Date.now },
});

// Auto-expire peers after 5 minutes of inactivity
peerSchema.index({ lastSeen: 1 }, { expireAfterSeconds: 300 });

module.exports = mongoose.model('Peer', peerSchema);
