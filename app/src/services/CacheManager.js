import * as FileSystem from 'expo-file-system/legacy';
import * as SQLite from 'expo-sqlite';
import { hashContent } from './ContentHasher';

const CACHE_DIR = `${FileSystem.documentDirectory}rc-cache/`;
const MAX_CACHE_SIZE = 100 * 1024 * 1024; // 100MB

let db = null;
let initPromise = null;

/**
 * Sanitizes parameters for SQLite to ensure no 'undefined' values are passed,
 * which causes NullPointerException in NativeDatabase.prepareAsync on Android.
 */
function sanitize(params) {
  return params.map(p => {
    if (p === undefined || p === null) return '';
    if (typeof p === 'number' || typeof p === 'string') return p;
    return String(p);
  });
}

/**
 * Initialize the cache: create directory and SQLite tables
 */
export async function initCache() {
  console.log('[Cache] Initializing...');
  try {
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

    console.log('[Cache] Ready.');
    return db;
  } catch (err) {
    console.error('[Cache] Init failed:', err);
    initPromise = null; // Allow retry
    throw err;
  }
}

/**
 * Get the database (initialize if needed, with singleton guard)
 */
async function getDb() {
  if (db) return db;
  if (!initPromise) {
    initPromise = initCache();
  }
  return initPromise;
}

/**
 * Store processed HTML snapshot
 */
export async function storeSnapshot(url, title, html) {
  console.log('[Cache] Storing snapshot for:', url);
  const database = await getDb();
  const hash = await hashContent(html);
  
  const safeTitle = title || 'Untitled';
  const safeUrl = url || 'about:blank';

  // Check for duplicate
  const existing = await database.getFirstAsync(
    'SELECT * FROM pages WHERE hash = ?',
    sanitize([hash])
  );

  if (existing) {
    await database.runAsync(
      'UPDATE pages SET accessCount = accessCount + 1, lastAccessed = ? WHERE hash = ?',
      sanitize([Date.now(), hash])
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
    sanitize([hash, safeUrl, safeTitle, 'text/html', size, filePath, Date.now(), 1, 'local', Date.now()])
  );

  await evictLRU();
  return { hash, url: safeUrl, title: safeTitle, size, localPath: filePath, deduplicated: false };
}

/**
 * Store content received from a mesh peer
 */
export async function storeMeshContent(hash, url, title, html) {
  const database = await getDb();
  
  const safeTitle = title || 'Untitled';
  const safeUrl = url || 'about:blank';

  const existing = await database.getFirstAsync(
    'SELECT * FROM pages WHERE hash = ?',
    sanitize([hash])
  );
  if (existing) return { ...existing, deduplicated: true };

  const filePath = `${CACHE_DIR}${hash}.html`;
  await FileSystem.writeAsStringAsync(filePath, html, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  const size = html.length;

  await database.runAsync(
    `INSERT INTO pages (hash, url, title, mimeType, size, localPath, lastAccessed, accessCount, source, createdAt) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    sanitize([hash, safeUrl, safeTitle, 'text/html', size, filePath, Date.now(), 1, 'mesh', Date.now()])
  );

  await evictLRU();
  return { hash, url: safeUrl, title: safeTitle, size, localPath: filePath, deduplicated: false };
}

/**
 * Get cached content by hash
 */
export async function getByHash(hash) {
  const database = await getDb();
  const row = await database.getFirstAsync(
    'SELECT * FROM pages WHERE hash = ?',
    sanitize([hash])
  );
  if (!row) return null;

  await database.runAsync(
    'UPDATE pages SET accessCount = accessCount + 1, lastAccessed = ? WHERE hash = ?',
    sanitize([Date.now(), hash])
  );

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
  return await database.getAllAsync(
    'SELECT id, hash, url, title, size, accessCount, source, createdAt FROM pages ORDER BY lastAccessed DESC'
  );
}

/**
 * Search cached pages by title or URL
 */
export async function search(query) {
  const database = await getDb();
  const q = `%${query || ''}%`;
  return await database.getAllAsync(
    `SELECT id, hash, url, title, size, accessCount, source, createdAt 
     FROM pages 
     WHERE title LIKE ? OR url LIKE ? 
     ORDER BY accessCount DESC`,
    sanitize([q, q])
  );
}

/**
 * Delete a cached page
 */
export async function deletePage(hash) {
  const database = await getDb();
  const row = await database.getFirstAsync(
    'SELECT localPath FROM pages WHERE hash = ?',
    sanitize([hash])
  );
  if (row) {
    try {
      await FileSystem.deleteAsync(row.localPath, { idempotent: true });
    } catch (e) {}
    await database.runAsync('DELETE FROM pages WHERE hash = ?', sanitize([hash]));
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
 * Get the content catalog for mesh sharing
 */
export async function getCatalog() {
  const database = await getDb();
  return await database.getAllAsync(
    'SELECT hash, url, title, size, accessCount FROM pages ORDER BY accessCount DESC'
  );
}

/**
 * Read raw HTML for a given hash
 */
export async function readHtml(hash) {
  const database = await getDb();
  const row = await database.getFirstAsync(
    'SELECT localPath FROM pages WHERE hash = ?',
    sanitize([hash])
  );
  if (!row) return null;
  return await FileSystem.readAsStringAsync(row.localPath, {
    encoding: FileSystem.EncodingType.UTF8,
  });
}

/**
 * LRU eviction
 */
async function evictLRU() {
  const database = await getDb();
  const stats = await getStats();
  if (stats.totalSize <= MAX_CACHE_SIZE) return;

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
    await database.runAsync('DELETE FROM pages WHERE hash = ?', sanitize([row.hash]));
    freed += row.size;
  }
}

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
