
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync(
  path.join(__dirname, "../lib/artist-discovery-evaluation.ts"),
  "utf8"
);

const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;

const moduleExports = {};

vm.runInNewContext(compiled, {
  exports: moduleExports,
});

const { evaluateArtistDiscovery } = moduleExports;

// 評価基準日を固定して、実行日による結果の変化を防ぐ。
const now = new Date("2026-11-24T00:00:00Z");

function evaluate(count, daysAgo) {
  const date = new Date(
    now.getTime() - daysAgo * 86400000
  ).toISOString().slice(0, 10);

  return evaluateArtistDiscovery({
    oldestObservedReleaseDate: date,
    observedReleaseCount: count,
  }, now);
}

test("作品数が少なく最古の作品が新しい場合はhigh", () => {
  const result = evaluate(2, 180);
  assert.equal(result.priority, "high");
  assert.ok(result.reason);
});

test("作品数が4件以上の場合はmedium", () => {
  assert.equal(evaluate(4, 180).priority, "medium");
});

test("最古の作品が365日より前の場合はmedium", () => {
  assert.equal(evaluate(3, 500).priority, "medium");
});

test("最古の作品が730日より前の場合はlow", () => {
  assert.equal(evaluate(5, 900).priority, "low");
});

test("観測情報がない場合はunknown", () => {
  assert.equal(
    evaluateArtistDiscovery(undefined, now).priority,
    "unknown"
  );
});

test("作品数が0件の場合はunknown", () => {
  assert.equal(evaluate(0, 180).priority, "unknown");
});

test("日付が不明の場合はunknown", () => {
  const result = evaluateArtistDiscovery({
    oldestObservedReleaseDate: null,
    observedReleaseCount: 2,
  }, now);

  assert.equal(result.priority, "unknown");
});

test("不正な日付の場合はunknown", () => {
  for (const date of ["invalid", "2026-02-30", "2026-13-01"]) {
    const result = evaluateArtistDiscovery({
      oldestObservedReleaseDate: date,
      observedReleaseCount: 2,
    }, now);

    assert.equal(result.priority, "unknown");
  }
});

test("未来の日付の場合はunknown", () => {
  assert.equal(evaluate(2, -1).priority, "unknown");
});

test("不正な作品数の場合はunknown", () => {
  for (const count of [-1, 1.5, NaN, Infinity]) {
    assert.equal(evaluate(count, 180).priority, "unknown");
  }
});

test("365日と366日の境界を正しく判定する", () => {
  assert.equal(evaluate(3, 365).priority, "high");
  assert.equal(evaluate(3, 366).priority, "medium");
});

test("730日と731日の境界を正しく判定する", () => {
  assert.equal(evaluate(3, 730).priority, "medium");
  assert.equal(evaluate(3, 731).priority, "low");
});

test("3件と4件の境界を正しく判定する", () => {
  assert.equal(evaluate(3, 180).priority, "high");
  assert.equal(evaluate(4, 180).priority, "medium");
});
