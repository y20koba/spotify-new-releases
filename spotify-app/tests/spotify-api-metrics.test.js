
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const source = fs.readFileSync(
    path.join(__dirname, "../lib/spotify-api-metrics.ts"),
    "utf8"
);

const compiled = ts.transpileModule(source, {
    compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
    },
}).outputText;

const loadedModule = { exports: {} };

new Function("module", "exports", compiled)(
    loadedModule,
    loadedModule.exports
);

const { createSpotifyApiMetrics } = loadedModule.exports;

test("初期状態ではすべての通信回数が0", () => {
    const metrics = createSpotifyApiMetrics();

    assert.deepEqual(metrics.getSummary(), {
        totalRequests: 0,
        webApiRequests: 0,
        tokenRequests: 0,
        artistSearchRequests: 0,
        artistDiscoveryRequests: 0,
        albumFetchRequests: 0,
        rateLimitCount: 0,
    });
});

test("処理別のAPI通信回数を正しく集計する", () => {
    const metrics = createSpotifyApiMetrics();

    metrics.recordRequest("token");
    metrics.recordRequest("artistSearch");
    metrics.recordRequest("artistSearch");
    metrics.recordRequest("artistDiscovery");
    metrics.recordRequest("albumFetch");
    metrics.recordRequest("albumFetch");
    metrics.recordRequest("albumFetch");

    assert.deepEqual(metrics.getSummary(), {
        totalRequests: 7,
        webApiRequests: 6,
        tokenRequests: 1,
        artistSearchRequests: 2,
        artistDiscoveryRequests: 1,
        albumFetchRequests: 3,
        rateLimitCount: 0,
    });
});

test("429レスポンスだけを制限回数として集計する", () => {
    const metrics = createSpotifyApiMetrics();

    metrics.recordResponse(200);
    metrics.recordResponse(400);
    metrics.recordResponse(429);
    metrics.recordResponse(500);
    metrics.recordResponse(429);

    assert.equal(metrics.getSummary().rateLimitCount, 2);
});

test("計測データは取得処理ごとに独立する", () => {
    const first = createSpotifyApiMetrics();
    const second = createSpotifyApiMetrics();

    first.recordRequest("albumFetch");
    first.recordResponse(429);

    assert.equal(first.getSummary().totalRequests, 1);
    assert.equal(first.getSummary().rateLimitCount, 1);
    assert.equal(second.getSummary().totalRequests, 0);
    assert.equal(second.getSummary().rateLimitCount, 0);
});

test("取得済みの集計結果は後続の計測で変化しない", () => {
    const metrics = createSpotifyApiMetrics();

    metrics.recordRequest("albumFetch");

    const before = metrics.getSummary();

    metrics.recordRequest("albumFetch");

    assert.equal(before.totalRequests, 1);
    assert.equal(metrics.getSummary().totalRequests, 2);
});
