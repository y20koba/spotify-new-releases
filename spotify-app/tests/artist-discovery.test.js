
const { test } = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

// 本番DBを変更しないため、メモリ上のSQLiteを使用
function createTestDb() {
    const db = new Database(":memory:");

    db.exec(`
        CREATE TABLE artist_discovery_cache (
            genre TEXT PRIMARY KEY,
            lastSearchedAt TEXT NOT NULL
        );
    `);

    return db;
}

// 現在のroute.tsと同じキャッシュ判定ロジック
function shouldDiscoverArtists(db, genre) {
    const cache = db.prepare(`
        SELECT lastSearchedAt
        FROM artist_discovery_cache
        WHERE genre = ?
    `).get(genre);

    if (!cache) return true;

    const lastSearched = new Date(cache.lastSearchedAt).getTime();

    return !Number.isFinite(lastSearched) ||
        Date.now() - lastSearched >= 24 * 60 * 60 * 1000;
}

test("キャッシュがなければ検索が必要", () => {
    const db = createTestDb();

    try {
        assert.equal(shouldDiscoverArtists(db, "hiphop"), true);
    } finally {
        db.close();
    }
});

test("24時間以内なら再検索しない", () => {
    const db = createTestDb();

    try {
        db.prepare(`
            INSERT INTO artist_discovery_cache
            (genre, lastSearchedAt)
            VALUES (?, ?)
        `).run("hiphop", new Date().toISOString());

        assert.equal(shouldDiscoverArtists(db, "hiphop"), false);
    } finally {
        db.close();
    }
});

test("24時間以上経過したら再検索する", () => {
    const db = createTestDb();

    try {
        const oldDate = new Date(
            Date.now() - 25 * 60 * 60 * 1000
        ).toISOString();

        db.prepare(`
            INSERT INTO artist_discovery_cache
            (genre, lastSearchedAt)
            VALUES (?, ?)
        `).run("hiphop", oldDate);

        assert.equal(shouldDiscoverArtists(db, "hiphop"), true);
    } finally {
        db.close();
    }
});

test("同じIDのアーティストは重複除外される", () => {
    const artists = [
        { id: "artist-1", name: "Artist A" },
        { id: "artist-2", name: "Artist B" },
        { id: "artist-1", name: "Artist A" },
        { id: "artist-3", name: "Artist C" },
    ];

    // route.ts と同じ重複除外ロジック
    const uniqueArtists = Array.from(
        new Map(
            artists.map((artist) => [artist.id, artist])
        ).values()
    );

    assert.equal(uniqueArtists.length, 3);

    assert.deepEqual(
        uniqueArtists.map((artist) => artist.id),
        ["artist-1", "artist-2", "artist-3"]
    );
});

// route.ts と同じローテーション処理
function selectArtists(artists, discoveredArtistIds, todayIndex) {
    const uniqueArtists = Array.from(
        new Map(artists.map((artist) => [artist.id, artist])).values()
    );

    const discoveredArtists = uniqueArtists.filter(
        (artist) => discoveredArtistIds.has(artist.id)
    );

    const newlyDiscoveredArtists = discoveredArtists.slice(0, 2);

    const rotationCandidates = uniqueArtists.filter(
        (artist) =>
            !newlyDiscoveredArtists.some(
                (discovered) => discovered.id === artist.id
            )
    );

    const rotationCount = 5 - newlyDiscoveredArtists.length;

    const startIndex = rotationCandidates.length > 0
        ? (todayIndex * rotationCount) % rotationCandidates.length
        : 0;

    const rotatedArtists = [
        ...rotationCandidates.slice(startIndex),
        ...rotationCandidates.slice(0, startIndex),
    ];

    return [
        ...newlyDiscoveredArtists,
        ...rotatedArtists.slice(0, rotationCount),
    ];
}

test("取得対象は最大5人で重複しない", () => {
    const artists = Array.from({ length: 12 }, (_, i) => ({
        id: `artist-${i}`,
        name: `Artist ${i}`,
    }));

    const result = selectArtists(artists, new Set(), 100);

    assert.equal(result.length, 5);
    assert.equal(new Set(result.map((artist) => artist.id)).size, 5);
});

test("新しく発見したアーティストを最大2人優先する", () => {
    const artists = Array.from({ length: 10 }, (_, i) => ({
        id: `artist-${i}`,
        name: `Artist ${i}`,
    }));

    const discoveredIds = new Set([
        "artist-7",
        "artist-8",
        "artist-9",
    ]);

    const result = selectArtists(artists, discoveredIds, 100);

    assert.deepEqual(
        result.slice(0, 2).map((artist) => artist.id),
        ["artist-7", "artist-8"]
    );

    assert.equal(result.length, 5);
});

test("日付が変わると取得対象が切り替わる", () => {
    const artists = Array.from({ length: 20 }, (_, i) => ({
        id: `artist-${i}`,
        name: `Artist ${i}`,
    }));

    const day1 = selectArtists(artists, new Set(), 100);
    const day2 = selectArtists(artists, new Set(), 101);

    assert.notDeepEqual(
        day1.map((artist) => artist.id),
        day2.map((artist) => artist.id)
    );
});

test("候補が5人未満でも正常に取得できる", () => {
    const artists = [
        { id: "artist-1", name: "Artist A" },
        { id: "artist-2", name: "Artist B" },
    ];

    const result = selectArtists(artists, new Set(), 100);

    assert.equal(result.length, 2);
});