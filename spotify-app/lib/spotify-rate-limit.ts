
// Retry-Afterが取得できない場合の待機時間（60秒）
export const DEFAULT_RETRY_SECONDS = 60;

// Spotify APIの待機終了時刻を計算する
export function calculateRetryUntil(
    retryAfter: string | null,
    now: number = Date.now()
): number {
    const parsedSeconds =
        retryAfter === null || retryAfter.trim() === ""
            ? NaN
            : Number(retryAfter);

    const retrySeconds =
        Number.isFinite(parsedSeconds) && parsedSeconds >= 0
            ? parsedSeconds
            : DEFAULT_RETRY_SECONDS;

    return now + Math.ceil(retrySeconds * 1000);
}
