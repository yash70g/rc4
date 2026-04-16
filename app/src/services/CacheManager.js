import * as FileSystem from 'expo-file-system/legacy';
import * as SQLite from 'expo-sqlite';
import { hashContent } from './ContentHasher';

const CACHE_DIR = `${FileSystem.documentDirectory}rc-cache/`;
const MAX_CACHE_SIZE = 100 * 1024 * 1024; // 100MB
let db = null;

/**
 * Initialize the cache: create directory and SQLite tables
 */
export async function initCache() {
  // Ensure cache directory exists
  const dirInfo = await FileSystem.getInfoAsync(CACHE_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
  }

  // Open SQLite database
  db = await SQLite.openDatabaseAsync('realitycache.db');
  
  // Initialize schema
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT UNIQUE NOT NULL,
      url TEXT NOT NULL,
      title TEXT DEFAULT 'Untitled',
      mimeType TEXT DEFAULT 'text/html',
      size INTEGER DEFAULT 0,
      localPath TEXT NOT NULL,
      lastAccessed INTEGER DEFAULT 0,
      accessCount INTEGER DEFAULT 1,
      source TEXT DEFAULT 'local',
      createdAt INTEGER DEFAULT 0
    )
  `);
  
  await db.execAsync('CREATE INDEX IF NOT EXISTS idx_hash ON pages(hash)');
  await db.execAsync('CREATE INDEX IF NOT EXISTS idx_url ON pages(url)');

  return db;
}

/**
 * Get the database (initialize if needed)
 */
async function getDb() {
  if (!db) await initCache();
  return db;
}

/**
 * Store processed HTML snapshot
 */
export async function storeSnapshot(url, title, html) {
  const database = await getDb();
  const hash = await hashContent(html);

  // Check for duplicate
  const existing = await database.getFirstAsync(
    'SELECT * FROM pages WHERE hash = ?',
    [hash]
  );
  if (existing) {
    // Update access count
    await database.runAsync(
      'UPDATE pages SET accessCount = accessCount + 1, lastAccessed = ? WHERE hash = ?',
      [Date.now(), hash]
    );
    return { ...existing, deduplicated: true };
  }

  // Store file
  const filePath = `${CACHE_DIR}${hash}.html`;
  await FileSystem.writeAsStringAsync(filePath, html, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  const size = html.length;

  // Insert into SQLite
  await database.runAsync(
    `INSERT INTO pages (hash, url, title, mimeType, size, localPath, lastAccessed, accessCount, source, createdAt) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [hash, url, title, 'text/html', size, filePath, Date.now(), 1, 'local', Date.now()]
  );

  // Evict if over limit
  await evictLRU();

  return { hash, url, title, size, localPath: filePath, deduplicated: false };
}

/**
 * Store content received from a mesh peer
 */
export async function storeMeshContent(hash, url, title, html) {
  const database = await getDb();

  const existing = await database.getFirstAsync(
    'SELECT * FROM pages WHERE hash = ?',
    [hash]
  );
  if (existing) {
    return { ...existing, deduplicated: true };
  }

  const filePath = `${CACHE_DIR}${hash}.html`;
  await FileSystem.writeAsStringAsync(filePath, html, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  const size = html.length;

  await database.runAsync(
    `INSERT INTO pages (hash, url, title, mimeType, size, localPath, lastAccessed, accessCount, source, createdAt) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [hash, url, title, 'text/html', size, filePath, Date.now(), 1, 'mesh', Date.now()]
  );

  await evictLRU();

  return { hash, url, title, size, localPath: filePath, deduplicated: false };
}

/**
 * Get cached content by hash
 */
export async function getByHash(hash) {
  const database = await getDb();
  const row = await database.getFirstAsync(
    'SELECT * FROM pages WHERE hash = ?',
    [hash]
  );
  if (!row) return null;

  // Update access
  await database.runAsync(
    'UPDATE pages SET accessCount = accessCount + 1, lastAccessed = ? WHERE hash = ?',
    [Date.now(), hash]
  );

  // Read file content
  const html = await FileSystem.readAsStringAsync(row.localPath, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  return { ...row, html };
}

/**
 * List all cached pages
 */
export async function listAll() {
  const database = await getDb();
  const rows = await database.getAllAsync(
    'SELECT id, hash, url, title, size, accessCount, source, createdAt FROM pages ORDER BY lastAccessed DESC'
  );
  return rows;
}

/**
 * Search cached pages by title or URL
 */
export async function search(query) {
  const database = await getDb();
  const rows = await database.getAllAsync(
    `SELECT id, hash, url, title, size, accessCount, source, createdAt 
     FROM pages 
     WHERE title LIKE ? OR url LIKE ? 
     ORDER BY accessCount DESC`,
    [`%${query}%`, `%${query}%`]
  );
  return rows;
}

/**
 * Delete a cached page
 */
export async function deletePage(hash) {
  const database = await getDb();
  const row = await database.getFirstAsync(
    'SELECT localPath FROM pages WHERE hash = ?',
    [hash]
  );
  if (row) {
    try {
      await FileSystem.deleteAsync(row.localPath, { idempotent: true });
    } catch (e) {
      // File might already be gone
    }
    await database.runAsync('DELETE FROM pages WHERE hash = ?', [hash]);
  }
}

/**
 * Get cache stats
 */
export async function getStats() {
  const database = await getDb();
  const result = await database.getFirstAsync(
    'SELECT COUNT(*) as count, COALESCE(SUM(size), 0) as totalSize FROM pages'
  );
  return {
    count: result?.count || 0,
    totalSize: result?.totalSize || 0,
  };
}

/**
 * Get the content catalog for mesh sharing (lightweight metadata only)
 */
export async function getCatalog() {
  const database = await getDb();
  const rows = await database.getAllAsync(
    'SELECT hash, url, title, size, accessCount FROM pages ORDER BY accessCount DESC'
  );
  return rows;
}

/**
 * Read raw HTML for a given hash (for mesh transfer)
 */
export async function readHtml(hash) {
  const database = await getDb();
  const row = await database.getFirstAsync(
    'SELECT localPath FROM pages WHERE hash = ?',
    [hash]
  );
  if (!row) return null;
  const html = await FileSystem.readAsStringAsync(row.localPath, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  return html;
}

/**
 * LRU eviction — remove least-recently-accessed pages if over limit
 */
async function evictLRU() {
  const database = await getDb();
  const stats = await getStats();
  if (stats.totalSize <= MAX_CACHE_SIZE) return;

  // Get oldest pages first
  const rows = await database.getAllAsync(
    'SELECT hash, localPath, size FROM pages ORDER BY lastAccessed ASC'
  );

  let freed = 0;
  const target = stats.totalSize - MAX_CACHE_SIZE;

  for (const row of rows) {
    if (freed >= target) break;
    try {
      await FileSystem.deleteAsync(row.localPath, { idempotent: true });
    } catch (e) {}
    await database.runAsync('DELETE FROM pages WHERE hash = ?', [row.hash]);
    freed += row.size;
  }
}

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
