
const test = require("node:test");
const assert = require("node:assert/strict");

const {
    calculateRetryUntil,
    DEFAULT_RETRY_SECONDS,
} = require("../lib/spotify-rate-limit.ts");

const now = 1_000_000;

test("Retry-Afterが120秒なら120秒後を返す", () => {
    assert.equal(
        calculateRetryUntil("120", now),
        now + 120_000
    );
});

test("Retry-Afterが30秒なら30秒後を返す", () => {
    assert.equal(
        calculateRetryUntil("30", now),
        now + 30_000
    );
});

test("Retry-Afterがnullなら60秒後を返す", () => {
    assert.equal(
        calculateRetryUntil(null, now),
        now + DEFAULT_RETRY_SECONDS * 1000
    );
});

test("Retry-Afterが不正な文字列なら60秒後を返す", () => {
    assert.equal(
        calculateRetryUntil("invalid", now),
        now + DEFAULT_RETRY_SECONDS * 1000
    );
});

test("Retry-Afterが空文字なら60秒後を返す", () => {
    assert.equal(
        calculateRetryUntil("", now),
        now + DEFAULT_RETRY_SECONDS * 1000
    );
});

test("Retry-Afterが負の値なら60秒後を返す", () => {
    assert.equal(
        calculateRetryUntil("-10", now),
        now + DEFAULT_RETRY_SECONDS * 1000
    );
});

test("Retry-Afterが小数ならミリ秒に変換する", () => {
    assert.equal(
        calculateRetryUntil("1.5", now),
        now + 1500
    );
});
