
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const Database = require("better-sqlite3");

const {
  saveArtistObservation,
} = require("../lib/artist-discovery-store.ts");

// 実際のGET APIをメモリ上のSQLiteで検証する。
function setup() {
  const db = new Database(":memory:");

  const schema = fs
    .readFileSync(path.join(__dirname, "../lib/db.ts"), "utf8")
    .match(/db\.exec\(`([\s\S]*?)`\);/)[1];

  db.exec(schema);

  const source = fs.readFileSync(
    path.join(__dirname, "../app/api/unclassified-artists/route.ts"),
    "utf8"
  );

  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;

  const exports = {};

  vm.runInNewContext(compiled, {
    exports,
    require(name) {
      if (name === "next/server") {
        return { NextResponse: { json: Response.json } };
      }

      if (name === "@/lib/db") {
        return { default: db };
      }

      if (name.startsWith("@/lib/")) {
        return require(`../lib/${name.slice(6)}.ts`);
      }

      throw new Error(`Unexpected import: ${name}`);
    },
    console,
    fetch() {
      throw new Error("外部APIを呼び出してはいけません");
    },
  });

  return {
    db,
    get: () => exports.GET(),
  };
}

// テスト用の新人候補を登録する。
function addArtist(
  db,
  id,
  name,
  genre,
  status = "pending",
  createdAt = "2026-11-24 00:00:00"
) {
  db.prepare(`
    INSERT INTO unclassified_artists
      (id, name, sourceGenre, discoveryQuery, status, createdAt)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, name, genre, "Test Query", status, createdAt);
}

// 現在の日付を基準に観測情報を作成する。
function addObservation(db, id, genre, count, daysAgo) {
  const date = new Date(
    Date.now() - daysAgo * 86400000
  ).toISOString().slice(0, 10);

  saveArtistObservation(db, id, genre, {
    oldestObservedReleaseDate: date,
    observedReleaseCount: count,
  });
}

async function getArtists(app) {
  const response = await app.get();

  assert.equal(response.status, 200);

  const body = await response.json();

  assert.ok(Array.isArray(body.artists));

  return body.artists;
}

test("観測情報がある候補には評価結果が返される", async () => {
  const app = setup();

  try {
    addArtist(app.db, "artist-1", "Artist One", "hiphop");
    addObservation(app.db, "artist-1", "hiphop", 2, 180);

    const artists = await getArtists(app);

    assert.equal(artists.length, 1);
    assert.equal(artists[0].evaluation.priority, "high");
    assert.ok(artists[0].evaluation.reason);
    assert.equal(artists[0].observation.observedReleaseCount, 2);
    assert.equal(artists[0].observation.artistId, "artist-1");
    assert.equal(artists[0].observation.genre, "hiphop");
  } finally {
    app.db.close();
  }
});

test("観測情報がない候補もunknownとして返される", async () => {
  const app = setup();

  try {
    addArtist(app.db, "artist-1", "Artist One", "hiphop");

    const artists = await getArtists(app);

    assert.equal(artists.length, 1);
    assert.equal(artists[0].observation, null);
    assert.equal(artists[0].evaluation.priority, "unknown");
    assert.ok(artists[0].evaluation.reason);
  } finally {
    app.db.close();
  }
});

test("同じアーティストでもジャンル別に評価される", async () => {
  const app = setup();

  try {
    addArtist(app.db, "artist-1", "Artist One", "hiphop");
    addArtist(app.db, "artist-1", "Artist One", "rnb");

    addObservation(app.db, "artist-1", "hiphop", 2, 180);
    addObservation(app.db, "artist-1", "rnb", 5, 900);

    const artists = await getArtists(app);

    assert.equal(artists.length, 2);

    const hiphop = artists.find(
      (artist) => artist.sourceGenre === "hiphop"
    );

    const rnb = artists.find(
      (artist) => artist.sourceGenre === "rnb"
    );

    assert.equal(hiphop.evaluation.priority, "high");
    assert.equal(rnb.evaluation.priority, "low");

    assert.equal(hiphop.observation.genre, "hiphop");
    assert.equal(rnb.observation.genre, "rnb");
  } finally {
    app.db.close();
  }
});

test("既存の候補情報とDBの内容は変更されない", async () => {
  const app = setup();

  try {
    addArtist(
      app.db,
      "artist-1",
      "Artist One",
      "rock",
      "rejected"
    );

    addObservation(app.db, "artist-1", "rock", 4, 180);

    const before = app.db.prepare(`
      SELECT * FROM unclassified_artists
    `).all();

    const observationsBefore = app.db.prepare(`
      SELECT * FROM artist_discovery_scores
    `).all();

    const artists = await getArtists(app);

    assert.equal(artists[0].id, "artist-1");
    assert.equal(artists[0].name, "Artist One");
    assert.equal(artists[0].sourceGenre, "rock");
    assert.equal(artists[0].discoveryQuery, "Test Query");
    assert.equal(artists[0].status, "rejected");
    assert.equal(artists[0].createdAt, "2026-11-24 00:00:00");
    assert.equal(artists[0].evaluation.priority, "medium");

    const after = app.db.prepare(`
      SELECT * FROM unclassified_artists
    `).all();

    const observationsAfter = app.db.prepare(`
      SELECT * FROM artist_discovery_scores
    `).all();

    assert.deepEqual(after, before);
    assert.deepEqual(observationsAfter, observationsBefore);
  } finally {
    app.db.close();
  }
});

test("既存の候補表示順序が維持される", async () => {
  const app = setup();

  try {
    addArtist(
      app.db, "a", "Alpha", "hiphop",
      "pending", "2026-11-23 00:00:00"
    );

    addArtist(
      app.db, "b", "Beta", "hiphop",
      "pending", "2026-11-24 00:00:00"
    );

    addArtist(
      app.db, "c", "Charlie", "hiphop",
      "pending", "2026-11-24 00:00:00"
    );

    addObservation(app.db, "a", "hiphop", 2, 180);
    addObservation(app.db, "b", "hiphop", 5, 900);

    const artists = await getArtists(app);

    assert.deepEqual(
      artists.map((artist) => artist.id),
      ["b", "c", "a"]
    );
  } finally {
    app.db.close();
  }
});

test("候補が0件でも空の配列が返される", async () => {
  const app = setup();

  try {
    const artists = await getArtists(app);

    assert.deepEqual(artists, []);
  } finally {
    app.db.close();
  }
});
