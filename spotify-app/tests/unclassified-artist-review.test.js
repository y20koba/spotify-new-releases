
const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

const {
  reviewUnclassifiedArtist,
} = require("../lib/unclassified-artist-review.ts");

function createTestDb() {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE registered_artists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      genre TEXT NOT NULL
    );

    CREATE TABLE artist_registration_sources (
      artistId TEXT PRIMARY KEY,
      source TEXT NOT NULL
    );

    CREATE TABLE unclassified_artists (
      id TEXT NOT NULL,
      name TEXT NOT NULL,
      sourceGenre TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      PRIMARY KEY (id, sourceGenre)
    );

    CREATE TABLE genre_cache (
      genre TEXT PRIMARY KEY,
      lastFetchedAt TEXT NOT NULL
    );
  `);

  return db;
}

function addCandidate(db, id, genre = "hiphop") {
  db.prepare(`
    INSERT INTO unclassified_artists
      (id, name, sourceGenre)
    VALUES (?, ?, ?)
  `).run(id, `Artist ${id}`, genre);
}

function getRegistration(db, id) {
  return db.prepare(`
    SELECT * FROM registered_artists WHERE id = ?
  `).get(id);
}

function getStatus(db, id, genre = "hiphop") {
  return db.prepare(`
    SELECT status FROM unclassified_artists
    WHERE id = ? AND sourceGenre = ?
  `).get(id, genre)?.status;
}

test("新人候補を承認すると登録される", () => {
  const db = createTestDb();
  try {
    addCandidate(db, "artist1");

    reviewUnclassifiedArtist(db, "artist1", "hiphop", "approved");

    assert.equal(getRegistration(db, "artist1").genre, "hiphop");
    assert.equal(getStatus(db, "artist1"), "approved");

    const source = db.prepare(`
      SELECT source FROM artist_registration_sources
      WHERE artistId = ?
    `).get("artist1");

    assert.equal(source.source, "discovery");
  } finally {
    db.close();
  }
});

test("新人候補の承認を取り消すと登録が削除される", () => {
  const db = createTestDb();
  try {
    addCandidate(db, "artist2");

    reviewUnclassifiedArtist(db, "artist2", "hiphop", "approved");
    reviewUnclassifiedArtist(db, "artist2", "hiphop", "pending");

    assert.equal(getRegistration(db, "artist2"), undefined);
    assert.equal(getStatus(db, "artist2"), "pending");
  } finally {
    db.close();
  }
});

test("手動登録したお気に入りは削除されない", () => {
  const db = createTestDb();
  try {
    addCandidate(db, "artist3");

    db.prepare(`
      INSERT INTO registered_artists VALUES (?, ?, ?)
    `).run("artist3", "Favorite Artist", "hiphop");

    db.prepare(`
      INSERT INTO artist_registration_sources VALUES (?, ?)
    `).run("artist3", "manual");

    reviewUnclassifiedArtist(db, "artist3", "hiphop", "approved");
    reviewUnclassifiedArtist(db, "artist3", "hiphop", "rejected");

    assert.ok(getRegistration(db, "artist3"));
    assert.equal(getStatus(db, "artist3"), "rejected");
  } finally {
    db.close();
  }
});

test("登録元が不明な既存データも保護する", () => {
  const db = createTestDb();
  try {
    addCandidate(db, "artist4");

    db.prepare(`
      INSERT INTO registered_artists VALUES (?, ?, ?)
    `).run("artist4", "Existing Favorite", "hiphop");

    reviewUnclassifiedArtist(db, "artist4", "hiphop", "approved");
    reviewUnclassifiedArtist(db, "artist4", "hiphop", "pending");

    assert.ok(getRegistration(db, "artist4"));
  } finally {
    db.close();
  }
});

test("別ジャンルへの二重承認を防ぐ", () => {
  const db = createTestDb();
  try {
    addCandidate(db, "artist5", "hiphop");
    addCandidate(db, "artist5", "rock");

    reviewUnclassifiedArtist(db, "artist5", "hiphop", "approved");

    assert.throws(
      () => reviewUnclassifiedArtist(db, "artist5", "rock", "approved"),
      { statusCode: 409 }
    );

    assert.equal(getStatus(db, "artist5", "hiphop"), "approved");
    assert.equal(getStatus(db, "artist5", "rock"), "pending");
    assert.equal(getRegistration(db, "artist5").genre, "hiphop");
  } finally {
    db.close();
  }
});

test("除外した候補を保留に戻せる", () => {
  const db = createTestDb();
  try {
    addCandidate(db, "artist6");

    reviewUnclassifiedArtist(db, "artist6", "hiphop", "rejected");
    assert.equal(getStatus(db, "artist6"), "rejected");

    reviewUnclassifiedArtist(db, "artist6", "hiphop", "pending");
    assert.equal(getStatus(db, "artist6"), "pending");
    assert.equal(getRegistration(db, "artist6"), undefined);
  } finally {
    db.close();
  }
});
