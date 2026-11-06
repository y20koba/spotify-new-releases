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
`);

export default db;