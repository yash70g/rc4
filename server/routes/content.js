const express = require('express');
const router = express.Router();
const ContentMeta = require('../models/ContentMeta');

// GET /api/content — list/search content
router.get('/', async (req, res) => {
  try {
    const { q, limit = 50 } = req.query;
    let filter = {};
    if (q) {
      filter = {
        $or: [
          { title: { $regex: q, $options: 'i' } },
          { url: { $regex: q, $options: 'i' } },
        ],
      };
    }
    const content = await ContentMeta.find(filter)
      .sort({ accessCount: -1 })
      .limit(parseInt(limit));
    res.json(content);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/content/popular — top content by access count + holder count
router.get('/popular', async (req, res) => {
  try {
    const content = await ContentMeta.aggregate([
      {
        $addFields: {
          holderCount: { $size: '$holders' },
          popularityScore: {
            $add: ['$accessCount', { $multiply: [{ $size: '$holders' }, 5] }],
          },
        },
      },
      { $sort: { popularityScore: -1 } },
      { $limit: 20 },
    ]);
    res.json(content);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/content — register content metadata
router.post('/', async (req, res) => {
  try {
    const { hash, url, title, mimeType, size, holders } = req.body;

    // Upsert: if hash exists, add new holders and bump access count
    const existing = await ContentMeta.findOne({ hash });
    if (existing) {
      const newHolders = (holders || []).filter(
        (h) => !existing.holders.includes(h)
      );
      if (newHolders.length > 0) {
        existing.holders.push(...newHolders);
      }
      existing.accessCount += 1;
      await existing.save();
      return res.json({ ...existing.toObject(), deduplicated: true });
    }

    const content = new ContentMeta({
      hash,
      url,
      title,
      mimeType,
      size,
      holders: holders || [],
    });
    await content.save();
    res.status(201).json(content);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/content/:hash
router.delete('/:hash', async (req, res) => {
  try {
    await ContentMeta.findOneAndDelete({ hash: req.params.hash });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
