const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const Database = require("better-sqlite3");

// 本番のspotify.dbは開かず、メモリ内SQLiteだけで検証する。
const source = fs.readFileSync(
  path.join(__dirname, "../lib/artist-discovery-store.ts"), "utf8"
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const moduleExports = {};
vm.runInNewContext(compiled, { exports: moduleExports });
const { saveArtistObservation, getArtistObservation } = moduleExports;

function setup() {
  const db = new Database(":memory:");
  const schema = fs.readFileSync(
    path.join(__dirname, "../lib/db.ts"), "utf8"
  ).match(/db\.exec\(`([\s\S]*?)`\);/)[1];
  db.exec(schema);
  return db;
}

test("評価結果を保存して読み込める", () => {
  const db = setup();
  try {
    saveArtistObservation(db, "artist-1", "hiphop", {
      oldestObservedReleaseDate: "2025-04-01",
      observedReleaseCount: 3,
    });
    const stored = getArtistObservation(db, "artist-1", "hiphop");
    assert.equal(stored.artistId, "artist-1");
    assert.equal(stored.genre, "hiphop");
    assert.equal(stored.oldestObservedReleaseDate, "2025-04-01");
    assert.equal(stored.observedReleaseCount, 3);
    assert.ok(stored.evaluatedAt);
  } finally {
    db.close();
  }
});

test("同じアーティスト・ジャンルは重複せず更新する", () => {
  const db = setup();
  try {
    saveArtistObservation(db, "artist-1", "hiphop", {
      oldestObservedReleaseDate: "2026-01-01",
      observedReleaseCount: 1,
    });
    saveArtistObservation(db, "artist-1", "hiphop", {
      oldestObservedReleaseDate: "2025-01-01",
      observedReleaseCount: 4,
    });
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM artist_discovery_scores").get().count,
      1
    );
    const stored = getArtistObservation(db, "artist-1", "hiphop");
    assert.equal(stored.oldestObservedReleaseDate, "2025-01-01");
    assert.equal(stored.observedReleaseCount, 4);
  } finally {
    db.close();
  }
});

test("同じアーティストでもジャンル別に保存する", () => {
  const db = setup();
  try {
    saveArtistObservation(db, "artist-1", "hiphop", {
      oldestObservedReleaseDate: "2025-01-01",
      observedReleaseCount: 2,
    });
    saveArtistObservation(db, "artist-1", "rnb", {
      oldestObservedReleaseDate: null,
      observedReleaseCount: 0,
    });
    assert.equal(getArtistObservation(db, "artist-1", "hiphop").observedReleaseCount, 2);
    assert.equal(getArtistObservation(db, "artist-1", "rnb").observedReleaseCount, 0);
    assert.equal(getArtistObservation(db, "artist-1", "rnb").oldestObservedReleaseDate, null);
  } finally {
    db.close();
  }
});

test("未保存の場合はundefined、既存の登録情報は変更しない", () => {
  const db = setup();
  try {
    assert.equal(getArtistObservation(db, "missing", "hiphop"), undefined);
    db.prepare("INSERT INTO registered_artists (id, name, genre) VALUES (?, ?, ?)")
      .run("artist-1", "Original Name", "hiphop");
    saveArtistObservation(db, "artist-1", "hiphop", {
      oldestObservedReleaseDate: null,
      observedReleaseCount: 0,
    });
    assert.deepEqual(
      db.prepare("SELECT name, genre FROM registered_artists WHERE id = ?")
        .get("artist-1"),
      { name: "Original Name", genre: "hiphop" }
    );
  } finally {
    db.close();
  }
});
