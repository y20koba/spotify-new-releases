const test = require("node:test");
const assert = require("node:assert/strict");

const {
    getJstDateString,
    createReleaseFetchMetrics,
} = require("../lib/release-fetch-metrics.ts");

const now = new Date("2026-11-24T15:00:00Z");

test("日本時間0時の直前は前日として判定する", () => {
    assert.equal(
        getJstDateString(new Date("2026-11-24T14:59:59Z")),
        "2026-11-24"
    );
});

test("日本時間0時に日付が切り替わる", () => {
    assert.equal(
        getJstDateString(now),
        "2026-11-25"
    );
});

test("初期状態では作品数と取得効率が0になる", () => {
    const metrics = createReleaseFetchMetrics(now);

    assert.deepEqual(metrics.getSummary(0), {
        targetDate: "2026-11-25",
        fetchedReleaseCount: 0,
        todayReleaseCount: 0,
        todaySingleCount: 0,
        todayAlbumCount: 0,
        releasesPerWebApiRequest: 0,
    });
});

test("当日のシングルとアルバムを正しく集計する", () => {
    const metrics = createReleaseFetchMetrics(now);

    metrics.recordReleases([
        { id: "1", releaseDate: "2026-11-25", type: "single" },
        { id: "2", releaseDate: "2026-11-25", type: "album" },
        { id: "3", releaseDate: "2026-11-25", type: "single" },
    ]);

    const summary = metrics.getSummary(2);

    assert.equal(summary.fetchedReleaseCount, 3);
    assert.equal(summary.todayReleaseCount, 3);
    assert.equal(summary.todaySingleCount, 2);
    assert.equal(summary.todayAlbumCount, 1);
    assert.equal(summary.releasesPerWebApiRequest, 1.5);
});

test("同じ作品IDは複数回取得しても重複しない", () => {
    const metrics = createReleaseFetchMetrics(now);

    const release = {
        id: "1",
        releaseDate: "2026-11-25",
        type: "single",
    };

    metrics.recordReleases([release]);
    metrics.recordReleases([release, release]);

    const summary = metrics.getSummary(3);

    assert.equal(summary.fetchedReleaseCount, 1);
    assert.equal(summary.todayReleaseCount, 1);
    assert.equal(summary.releasesPerWebApiRequest, 0.333);
});

test("過去・未来・日付不明の作品は当日の新譜に含めない", () => {
    const metrics = createReleaseFetchMetrics(now);

    metrics.recordReleases([
        { id: "1", releaseDate: "2026-11-24", type: "single" },
        { id: "2", releaseDate: "2026-11-26", type: "album" },
        { id: "3", releaseDate: "2026-11", type: "album" },
        { id: "4", releaseDate: "", type: "single" },
        { id: "5", releaseDate: "2026-11-25", type: "single" },
    ]);

    const summary = metrics.getSummary(5);

    assert.equal(summary.fetchedReleaseCount, 5);
    assert.equal(summary.todayReleaseCount, 1);
    assert.equal(summary.releasesPerWebApiRequest, 0.2);
});

test("シングルとアルバム以外は当日の新譜に含めない", () => {
    const metrics = createReleaseFetchMetrics(now);

    metrics.recordReleases([
        { id: "1", releaseDate: "2026-11-25", type: "compilation" },
        { id: "2", releaseDate: "2026-11-25", type: "album" },
    ]);

    const summary = metrics.getSummary(2);

    assert.equal(summary.fetchedReleaseCount, 2);
    assert.equal(summary.todayReleaseCount, 1);
    assert.equal(summary.todayAlbumCount, 1);
});

test("作品IDがない場合は集計しない", () => {
    const metrics = createReleaseFetchMetrics(now);

    metrics.recordReleases([
        { id: "", releaseDate: "2026-11-25", type: "single" },
    ]);

    assert.equal(metrics.getSummary(1).fetchedReleaseCount, 0);
});

test("通信回数が0でもゼロ除算が発生しない", () => {
    const metrics = createReleaseFetchMetrics(now);

    metrics.recordReleases([
        { id: "1", releaseDate: "2026-11-25", type: "single" },
    ]);

    assert.equal(
        metrics.getSummary(0).releasesPerWebApiRequest,
        0
    );
});

test("取得処理ごとに計測データが独立する", () => {
    const first = createReleaseFetchMetrics(now);
    const second = createReleaseFetchMetrics(now);

    first.recordReleases([
        { id: "1", releaseDate: "2026-11-25", type: "single" },
    ]);

    assert.equal(first.getSummary(1).todayReleaseCount, 1);
    assert.equal(second.getSummary(0).todayReleaseCount, 0);
});