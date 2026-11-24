const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const Database = require("better-sqlite3");
const { reviewUnclassifiedArtist } = require("../lib/unclassified-artist-review.ts");
const { getJstDateString } = require("../lib/release-fetch-metrics.ts");

// 実際のrouteを実行し、DBと全fetchを差し替える。本番DBは開かない。
function setup({
  saved = false,
  manual = false,
  rejectedGenre = "rnb",
  rateLimitDiscovery = false,
  customReleases = false,
  rateLimitAlbums = false,
} = {}) {
  const db = new Database(":memory:");
  const schema = fs.readFileSync(path.join(__dirname, "../lib/db.ts"), "utf8")
    .match(/db\.exec\(`([\s\S]*?)`\);/)[1];
  db.exec(schema);
  db.prepare(`INSERT INTO unclassified_artists
    (id, name, sourceGenre, discoveryQuery, status)
    VALUES ('candidate', 'Candidate', ?, 'Japanese R&B', 'rejected')`).run(rejectedGenre);
  if (saved) {
    db.prepare("INSERT INTO discovered_artists (id, name, genre) VALUES ('candidate', 'Candidate', 'rnb')").run();
  }
  if (manual) {
    db.prepare("INSERT INTO registered_artists (id, name, genre) VALUES ('candidate', 'Candidate', 'rnb')").run();
    db.prepare("INSERT INTO artist_registration_sources (artistId, source) VALUES ('candidate', 'manual')").run();
  }
  const calls = [];
  const logs = [];
  const source = fs.readFileSync(path.join(__dirname, "../app/api/spotify-search/route.ts"), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require(name) {
      if (name === "next/server") return { NextResponse: { json: Response.json } };
      if (name === "@/lib/db") return { default: db };
      if (name.startsWith("@/lib/")) return require(`../lib/${name.slice(6)}.ts`);
      throw new Error(`Unexpected import: ${name}`);
    },
    URL, URLSearchParams, Buffer,
    process: { env: { SPOTIFY_CLIENT_ID: "test", SPOTIFY_CLIENT_SECRET: "test" } },
    console: {
      log(...args) { logs.push(args); },
      error() { },
    },
    async fetch(input) {
      const url = new URL(input);
      calls.push(url);
      if (url.href === "https://accounts.spotify.com/api/token") {
        return Response.json({ access_token: "mock", expires_in: 3600 });
      }
      assert.equal(url.origin, "https://api.spotify.com");
      if (url.pathname === "/v1/search") {
        if (rateLimitDiscovery && url.searchParams.get("q") === "Japanese R&B") {
          return Response.json({ error: "rate limited" }, {
            status: 429, headers: { "Retry-After": "120" },
          });
        }
        return Response.json({
          artists: {
            items: url.searchParams.get("q") === "Japanese R&B"
              ? [{ id: "candidate", name: "Candidate", genres: ["soul"] },
              { id: "other", name: "Other", genres: ["soul"] }]
              : []
          }
        });
      }
      assert.match(url.pathname, /^\/v1\/artists\/[^/]+\/albums$/);
      const id = url.pathname.split("/")[3];
            if (
        rateLimitAlbums &&
        calls.filter((url) =>
          url.pathname.endsWith("/albums")
        ).length >= 2
      ) {
        return Response.json(
          { error: "rate limited" },
          {
            status: 429,
            headers: { "Retry-After": "120" },
          }
        );
      }

      if (customReleases) {
        const today = getJstDateString();

        function makeRelease(releaseId, date, type) {
          return {
            id: releaseId,
            name: releaseId,
            release_date: date,
            album_type: type,
            images: [],
            artists: [{ name: id }],
            external_urls: {
              spotify: "https://open.spotify.com/album/mock",
            },
          };
        }

        return Response.json({
          items: [
            makeRelease("shared-single", today, "single"),
            makeRelease(`album-${id}`, today, "album"),
            makeRelease(`old-${id}`, "2020-01-01", "single"),
          ],
        });
      }
      return Response.json({
        items: [{
          id: `album-${id}`, name: id, release_date: new Date().toISOString().slice(0, 10),
          album_type: "single", images: [], artists: [{ name: id }],
          external_urls: { spotify: "https://open.spotify.com/album/mock" },
        }]
      });
    },
  });
  return {
    db, calls, logs,
    get: () => exports.GET(new Request("http://localhost/api/spotify-search?genre=rnb")),
    albumIds: () => calls.filter((url) => url.pathname.endsWith("/albums"))
      .map((url) => url.pathname.split("/")[3]),
  };
}

test("新規発掘の除外済みIDは保存・作品取得されない", async () => {
  const app = setup();
  try {
    assert.equal((await app.get()).status, 200);
    assert.deepEqual(app.albumIds(), ["other"]);
    assert.equal(app.db.prepare("SELECT id FROM discovered_artists WHERE id = 'candidate'").get(), undefined);
    assert.equal(app.calls.filter((url) => url.pathname === "/v1/search").length, 8);
    const count = app.calls.length;
    await app.get();
    assert.equal(app.calls.length, count, "24時間作品キャッシュではAPIを呼ばない");
  } finally { app.db.close(); }
});

test("保存済み自動発見も除外され、pendingに戻すと発掘キャッシュ内でも復帰する", async () => {
  const app = setup({ saved: true });
  try {
    // 発掘検索は24時間以内。保存済み候補だけでも除外されることを確認。
    app.db.prepare("INSERT INTO artist_discovery_cache VALUES ('rnb', ?)").run(new Date().toISOString());
    app.db.prepare("INSERT INTO registered_artists (id, name, genre) VALUES ('other', 'Other', 'rnb')").run();
    await app.get();
    assert.deepEqual(app.albumIds(), ["other"]);
    reviewUnclassifiedArtist(app.db, "candidate", "rnb", "pending");
    assert.equal(app.db.prepare("SELECT * FROM genre_cache WHERE genre = 'rnb_v4'").get(), undefined);
    app.calls.length = 0;
    await app.get();
    assert.ok(app.albumIds().includes("candidate"));
    assert.equal(app.calls.some((url) => url.searchParams.get("q") === "Japanese R&B"), false);
    assert.ok(app.db.prepare("SELECT id FROM discovered_artists WHERE id = 'candidate'").get());
  } finally { app.db.close(); }
});

test("手動お気に入りは除外後も削除されず作品取得対象に残る", async () => {
  const app = setup({ saved: true, manual: true });
  try {
    reviewUnclassifiedArtist(app.db, "candidate", "rnb", "pending");
    reviewUnclassifiedArtist(app.db, "candidate", "rnb", "rejected");
    await app.get();
    assert.ok(app.albumIds().includes("candidate"));
    assert.ok(app.db.prepare("SELECT id FROM registered_artists WHERE id = 'candidate'").get());
    assert.equal(app.db.prepare("SELECT source FROM artist_registration_sources WHERE artistId = 'candidate'").get().source, "manual");
  } finally { app.db.close(); }
});

test("別ジャンルの除外は新規・保存済みの発掘に影響しない", async () => {
  for (const saved of [false, true]) {
    const app = setup({ saved, rejectedGenre: "rock" });
    try {
      await app.get();
      assert.ok(app.albumIds().includes("candidate"));
    } finally { app.db.close(); }
  }
});

test("除外への変更は対象ジャンルの作品キャッシュだけを無効化する", () => {
  const app = setup({ saved: true });
  try {
    reviewUnclassifiedArtist(app.db, "candidate", "rnb", "pending");
    for (const key of ["rnb_v4", "rock_v4"]) {
      app.db.prepare("INSERT INTO genre_cache VALUES (?, ?)").run(key, new Date().toISOString());
    }
    app.db.prepare("INSERT INTO artist_discovery_cache VALUES ('rnb', ?)").run(new Date().toISOString());
    reviewUnclassifiedArtist(app.db, "candidate", "rnb", "rejected");
    assert.equal(app.db.prepare("SELECT * FROM genre_cache WHERE genre = 'rnb_v4'").get(), undefined);
    assert.ok(app.db.prepare("SELECT * FROM genre_cache WHERE genre = 'rock_v4'").get());
    assert.ok(app.db.prepare("SELECT * FROM artist_discovery_cache WHERE genre = 'rnb'").get());
    assert.ok(app.db.prepare("SELECT * FROM discovered_artists WHERE id = 'candidate'").get());
  } finally { app.db.close(); }
});

test("発掘検索の429で打ち切り、待機中の再呼び出しを防ぐ", async () => {
  const app = setup({ rateLimitDiscovery: true });
  try {
    const before = Date.now();
    assert.equal((await app.get()).status, 429);
    assert.deepEqual(app.albumIds(), []);
    assert.ok(app.db.prepare("SELECT retryUntil FROM spotify_rate_limit").get().retryUntil >= before + 120000);
    const count = app.calls.length;
    assert.equal((await app.get()).status, 429);
    assert.equal(app.calls.length, count);
  } finally { app.db.close(); }
});

test("除外した保存済みIDは固定名の再検索も増やさない", async () => {
  const app = setup({ saved: true });
  try {
    app.db.prepare("UPDATE discovered_artists SET name = 'iri' WHERE id = 'candidate'").run();
    await app.get();
    assert.equal(app.calls.some((url) => url.searchParams.get("q") === "artist:iri"), false);
    assert.equal(app.calls.filter((url) => url.pathname === "/v1/search").length, 7);
    assert.equal(app.albumIds().includes("candidate"), false);
  } finally { app.db.close(); }
});


test("Spotifyから取得した作品の観測情報がSQLiteに保存される", async () => {
  const app = setup();

  try {
    const response = await app.get();
    assert.equal(response.status, 200);

    // モックAPIから作品を取得したアーティストを確認
    assert.deepEqual(app.albumIds(), ["other"]);

    // route.ts が観測結果を保存したか確認
    const observation = app.db.prepare(`
      SELECT artistId, genre, oldestObservedReleaseDate,
             observedReleaseCount
      FROM artist_discovery_scores
      WHERE artistId = ? AND genre = ?
    `).get("other", "rnb");

    assert.ok(observation, "観測情報がSQLiteに保存されている");
    assert.equal(observation.artistId, "other");
    assert.equal(observation.genre, "rnb");
    assert.equal(observation.observedReleaseCount, 1);
    assert.equal(
      observation.oldestObservedReleaseDate,
      new Date().toISOString().slice(0, 10)
    );
  } finally {
    app.db.close();
  }
});
function getMetricsLogs(app) {
  return app.logs
    .filter(([value]) =>
      value &&
      typeof value === "object" &&
      typeof value.totalRequests === "number" &&
      typeof value.rateLimitCount === "number"
    )
    .map(([value]) => value);
}

test("通常取得時のAPI通信回数が実際の呼び出し回数と一致する", async () => {
  const app = setup();

  try {
    const response = await app.get();
    assert.equal(response.status, 200);

    const logs = getMetricsLogs(app);
    assert.equal(logs.length, 1);

    const metrics = logs[0];

    assert.equal(metrics.genre, "rnb");
    assert.equal(metrics.totalRequests, app.calls.length);
    assert.equal(metrics.tokenRequests, 1);
    assert.equal(metrics.webApiRequests, app.calls.length - 1);
    assert.equal(metrics.albumFetchRequests, app.albumIds().length);
    assert.equal(
      metrics.artistSearchRequests + metrics.artistDiscoveryRequests,
      app.calls.filter(url => url.pathname === "/v1/search").length
    );
    assert.equal(metrics.rateLimitCount, 0);
  } finally {
    app.db.close();
  }
});

test("キャッシュ利用時はAPI通信回数が0になる", async () => {
  const app = setup();

  try {
    assert.equal((await app.get()).status, 200);

    const count = app.calls.length;

    assert.equal((await app.get()).status, 200);
    assert.equal(app.calls.length, count);

    const logs = getMetricsLogs(app);
    assert.equal(logs.length, 2);

    const metrics = logs[1];

    assert.equal(metrics.totalRequests, 0);
    assert.equal(metrics.webApiRequests, 0);
    assert.equal(metrics.tokenRequests, 0);
    assert.equal(metrics.artistSearchRequests, 0);
    assert.equal(metrics.artistDiscoveryRequests, 0);
    assert.equal(metrics.albumFetchRequests, 0);
    assert.equal(metrics.rateLimitCount, 0);
  } finally {
    app.db.close();
  }
});

test("Spotifyの429発生時も通信回数と制限回数が記録される", async () => {
  const app = setup({ rateLimitDiscovery: true });

  try {
    assert.equal((await app.get()).status, 429);

    const logs = getMetricsLogs(app);
    assert.equal(logs.length, 1);

    const metrics = logs[0];

    assert.equal(metrics.totalRequests, app.calls.length);
    assert.equal(metrics.rateLimitCount, 1);
    assert.equal(metrics.albumFetchRequests, 0);
    assert.ok(metrics.artistDiscoveryRequests > 0);
  } finally {
    app.db.close();
  }
});

test("API制限中の再取得では通信せず計測値もリセットされる", async () => {
  const app = setup({ rateLimitDiscovery: true });

  try {
    assert.equal((await app.get()).status, 429);

    const count = app.calls.length;

    assert.equal((await app.get()).status, 429);
    assert.equal(app.calls.length, count);

    const logs = getMetricsLogs(app);
    assert.equal(logs.length, 2);

    assert.equal(logs[0].rateLimitCount, 1);
    assert.equal(logs[1].totalRequests, 0);
    assert.equal(logs[1].webApiRequests, 0);
    assert.equal(logs[1].rateLimitCount, 0);
  } finally {
    app.db.close();
  }
});

test("当日の新譜数と取得効率が正しく計測される", async () => {
  const app = setup({ customReleases: true });

  try {
    assert.equal((await app.get()).status, 200);

    const metrics = getMetricsLogs(app)[0];

    assert.equal(metrics.targetDate, getJstDateString());
    assert.equal(metrics.fetchedReleaseCount, 3);
    assert.equal(metrics.todayReleaseCount, 2);
    assert.equal(metrics.todaySingleCount, 1);
    assert.equal(metrics.todayAlbumCount, 1);

    assert.equal(
      metrics.releasesPerWebApiRequest,
      Number((2 / metrics.webApiRequests).toFixed(3))
    );
  } finally {
    app.db.close();
  }
});

test("複数アーティストの共通作品は重複計測されない", async () => {
  const app = setup({
    customReleases: true,
    rejectedGenre: "rock",
  });

  try {
    assert.equal((await app.get()).status, 200);
    assert.equal(app.albumIds().length, 2);

    const metrics = getMetricsLogs(app)[0];

    assert.equal(metrics.fetchedReleaseCount, 5);
    assert.equal(metrics.todayReleaseCount, 3);
    assert.equal(metrics.todaySingleCount, 1);
    assert.equal(metrics.todayAlbumCount, 2);

    assert.equal(
      metrics.releasesPerWebApiRequest,
      Number((3 / metrics.webApiRequests).toFixed(3))
    );
  } finally {
    app.db.close();
  }
});

test("キャッシュ利用時は新規取得作品として計測しない", async () => {
  const app = setup({ customReleases: true });

  try {
    assert.equal((await app.get()).status, 200);
    assert.equal((await app.get()).status, 200);

    const logs = getMetricsLogs(app);

    assert.equal(logs.length, 2);
    assert.equal(logs[0].todayReleaseCount, 2);

    const metrics = logs[1];

    assert.equal(metrics.webApiRequests, 0);
    assert.equal(metrics.fetchedReleaseCount, 0);
    assert.equal(metrics.todayReleaseCount, 0);
    assert.equal(metrics.todaySingleCount, 0);
    assert.equal(metrics.todayAlbumCount, 0);
    assert.equal(metrics.releasesPerWebApiRequest, 0);
  } finally {
    app.db.close();
  }
});

test("作品取得途中の429でも取得済み作品数が計測される", async () => {
  const app = setup({
    customReleases: true,
    rejectedGenre: "rock",
    rateLimitAlbums: true,
  });

  try {
    assert.equal((await app.get()).status, 429);
    assert.equal(app.albumIds().length, 2);

    const metrics = getMetricsLogs(app)[0];

    assert.equal(metrics.rateLimitCount, 1);
    assert.equal(metrics.fetchedReleaseCount, 3);
    assert.equal(metrics.todayReleaseCount, 2);
    assert.equal(metrics.todaySingleCount, 1);
    assert.equal(metrics.todayAlbumCount, 1);

    assert.equal(
      metrics.releasesPerWebApiRequest,
      Number((2 / metrics.webApiRequests).toFixed(3))
    );
  } finally {
    app.db.close();
  }
});