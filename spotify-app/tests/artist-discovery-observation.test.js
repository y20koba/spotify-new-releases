const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

// TypeScriptの純粋関数をメモリ上で変換して実行する。DB・Spotify APIは使わない。
const source = fs.readFileSync(
  path.join(__dirname, "../lib/artist-discovery-observation.ts"),
  "utf8"
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const exports = {};
vm.runInNewContext(compiled, { exports });
const { summarizeObservedReleases } = exports;

test("取得した作品の最古の日付と件数を集計する", () => {
  assert.deepEqual(
    { ...summarizeObservedReleases([
      { id: "a", releaseDate: "2026-11-10" },
      { id: "b", releaseDate: "2025-04-01" },
      { id: "c", releaseDate: "2026-01-05" },
    ]) },
    { oldestObservedReleaseDate: "2025-04-01", observedReleaseCount: 3 }
  );
});

test("同じ作品IDは重複カウントしない", () => {
  assert.deepEqual(
    { ...summarizeObservedReleases([
      { id: "a", releaseDate: "2026-01-01" },
      { id: "a", releaseDate: "2026-01-01" },
      { id: "b", releaseDate: "2026-02-01" },
    ]) },
    { oldestObservedReleaseDate: "2026-01-01", observedReleaseCount: 2 }
  );
});

test("日付が不正な作品やIDのない作品は除外する", () => {
  assert.deepEqual(
    { ...summarizeObservedReleases([
      { id: "a", releaseDate: "2026-02-30" },
      { id: "b", releaseDate: "2026" },
      { id: "", releaseDate: "2026-01-01" },
      { id: "c", releaseDate: "2026-02-28" },
    ]) },
    { oldestObservedReleaseDate: "2026-02-28", observedReleaseCount: 1 }
  );
});

test("作品がない場合は0件・最古日付なし", () => {
  assert.deepEqual(
    { ...summarizeObservedReleases([]) },
    { oldestObservedReleaseDate: null, observedReleaseCount: 0 }
  );
});
