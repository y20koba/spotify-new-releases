
export const DISCOVERY_CACHE_DURATION = 24 * 60 * 60 * 1000;

// 最終検索日時から、再検索が必要か判定する
export function isDiscoveryCacheExpired(
    lastSearchedAt: string | undefined,
    now: number = Date.now()
): boolean {
    // キャッシュが存在しない場合
    if (!lastSearchedAt) {
        return true;
    }

    const lastSearched = new Date(lastSearchedAt).getTime();

    // 日付が不正な場合
    if (!Number.isFinite(lastSearched)) {
        return true;
    }

    // 24時間以上経過していれば再検索が必要
    return now - lastSearched >= DISCOVERY_CACHE_DURATION;
}
