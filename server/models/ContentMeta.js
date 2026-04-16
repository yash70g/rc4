const mongoose = require('mongoose');

const contentMetaSchema = new mongoose.Schema({
  hash: { type: String, required: true, unique: true, index: true },
  url: { type: String, required: true },
  title: { type: String, default: 'Untitled' },
  mimeType: { type: String, default: 'text/html' },
  size: { type: Number, default: 0 },
  holders: [{ type: String }], // array of peerIds that hold this content
  accessCount: { type: Number, default: 1 },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('ContentMeta', contentMetaSchema);
