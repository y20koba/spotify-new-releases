import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

// データベースを保存するフォルダ
const dataDir = path.join(process.cwd(), "data");

// フォルダがなければ作成
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// データベースファイル
const dbPath = path.join(dataDir, "spotify.db");

// データベースを開く
const db = new Database(dbPath);

// テーブルを作成
db.exec(`
  CREATE TABLE IF NOT EXISTS releases (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    artists TEXT NOT NULL,
    releaseDate TEXT NOT NULL,
    type TEXT NOT NULL,
    image TEXT,
    spotifyUrl TEXT NOT NULL,
    genre TEXT NOT NULL,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS genre_cache (
    genre TEXT PRIMARY KEY,
    lastFetchedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS spotify_rate_limit (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    retryUntil INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS registered_artists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    genre TEXT NOT NULL,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS discovered_artists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    genre TEXT NOT NULL,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS artist_discovery_cache (
    genre TEXT PRIMARY KEY,
    lastSearchedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS release_notifications (
    artistId TEXT NOT NULL,
    albumId TEXT NOT NULL,
    albumName TEXT NOT NULL,
    releaseDate TEXT NOT NULL,
    isRead INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (artistId, albumId)
  );

  CREATE TABLE IF NOT EXISTS checked_releases (
    artistId TEXT NOT NULL,
    albumId TEXT NOT NULL,
    checkedAt TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (artistId, albumId)
  );

  CREATE TABLE IF NOT EXISTS notification_check_state (
    artistId TEXT PRIMARY KEY,
    lastCheckedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS notification_check_attempts (
    artistId TEXT PRIMARY KEY,
    lastAttemptAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS notification_check_progress (
    artistId TEXT PRIMARY KEY,
    nextOffset INTEGER NOT NULL DEFAULT 0,
    startedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    firstPageIds TEXT,
    verifiedOffset INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS notification_check_items (
    artistId TEXT NOT NULL,
    albumId TEXT NOT NULL,
    albumName TEXT NOT NULL,
    releaseDate TEXT NOT NULL,
    fetchPosition INTEGER,
    PRIMARY KEY (artistId, albumId)
  );

  CREATE TABLE IF NOT EXISTS notification_check_pages (
    artistId TEXT NOT NULL,
    requestOffset INTEGER NOT NULL,
    nextOffset INTEGER NOT NULL,
    itemCount INTEGER NOT NULL,
    PRIMARY KEY (artistId, requestOffset)
  );
`);

export default db;