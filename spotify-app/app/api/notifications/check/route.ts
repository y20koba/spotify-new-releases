
import { NextResponse } from "next/server";
import db from "@/lib/db";

type Release = {
    id: string;
    name: string;
    releaseDate: string;
};

type SpotifyAlbumsResponse = {
    albums: Release[];
    hasMore: boolean;
    fetchedCount: number;
    nextOffset?: number | null;
    message?: string;
};

const MAX_RELEASE_PAGES = 5;

const MAX_SPOTIFY_REQUESTS = 10;

const NOTIFICATION_CHECK_INTERVAL = 60 * 60 * 1000;

const NOTIFICATION_ATTEMPT_INTERVAL = 5 * 60 * 1000;

function areSameReleaseIds(
    savedIds: string[],
    currentIds: string[]
): boolean {
    return (
        savedIds.length === currentIds.length &&
        savedIds.every((id, index) => id === currentIds[index])
    );
}

function getSavedPageIds(
    releases: (Release & { fetchPosition: number | null })[],
    offset: number,
    pageSize = 10
): string[] {
    return releases
        .filter(
            (release) =>
                release.fetchPosition !== null &&
                release.fetchPosition >= offset &&
                release.fetchPosition < offset + pageSize
        )
        .map((release) => release.id);
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { artistId } = body;

        if (
            typeof artistId !== "string" ||
            !artistId.trim()
        ) {
            return NextResponse.json(
                { message: "作品情報が正しくありません。" },
                { status: 400 }
            );
        }

        const artist = db.prepare(`
            SELECT id FROM registered_artists WHERE id = ?
        `).get(artistId) as { id: string } | undefined;

        if (!artist) {
            return NextResponse.json(
                { message: "お気に入りアーティストが見つかりません。" },
                { status: 404 }
            );
        }

        const lastCheck = db.prepare(`
            SELECT lastCheckedAt
            FROM notification_check_state
            WHERE artistId = ?
        `).get(artistId) as { lastCheckedAt: string } | undefined;

        if (lastCheck) {
            const lastCheckedTime = new Date(`${lastCheck.lastCheckedAt}Z`).getTime();

            if (
                Number.isFinite(lastCheckedTime) &&
                Date.now() - lastCheckedTime < NOTIFICATION_CHECK_INTERVAL
            ) {
                return NextResponse.json(
                    { message: "前回のチェックから1時間経過していません。" },
                    { status: 429 }
                );
            }
        }

        const attemptResult = db.prepare(`
            INSERT INTO notification_check_attempts (artistId, lastAttemptAt)
            VALUES (?, CURRENT_TIMESTAMP)
            ON CONFLICT(artistId)
            DO UPDATE SET lastAttemptAt = CURRENT_TIMESTAMP
            WHERE (julianday('now') - julianday(lastAttemptAt)) * 86400000 >= ?
        `).run(artistId, NOTIFICATION_ATTEMPT_INTERVAL);

        if (attemptResult.changes === 0) {
            return NextResponse.json(
                { message: "前回のチェック開始から5分経過していません。" },
                { status: 429 }
            );
        }

        const saveProgress = db.transaction((
            artistId: string,
            releases: Release[],
            requestOffset: number,
            nextOffset: number,
            firstPageIds: string | null
        ) => {
            const insertItem = db.prepare(`
                INSERT OR IGNORE INTO notification_check_items
                (artistId, albumId, albumName, releaseDate, fetchPosition)
                VALUES (?, ?, ?, ?, ?)
            `);

            db.prepare(`
                INSERT INTO notification_check_pages
                (artistId, requestOffset, nextOffset, itemCount)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(artistId, requestOffset)
                DO UPDATE SET
                    nextOffset = excluded.nextOffset,
                    itemCount = excluded.itemCount
            `).run(
                artistId,
                requestOffset,
                nextOffset,
                releases.length
            );

            const startPosition = requestOffset;

            for (const [index, release] of releases.entries()) {
                insertItem.run(
                    artistId,
                    release.id,
                    release.name,
                    release.releaseDate,
                    startPosition + index
                );
            }

            db.prepare(`
                INSERT INTO notification_check_progress
                (artistId, nextOffset, firstPageIds)
                VALUES (?, ?, ?)
                ON CONFLICT(artistId)
                DO UPDATE SET
                    nextOffset = excluded.nextOffset,
                    firstPageIds = COALESCE(
                        excluded.firstPageIds,
                        notification_check_progress.firstPageIds
                    ),
                    updatedAt = CURRENT_TIMESTAMP
            `).run(artistId, nextOffset, firstPageIds);
        });

        const updateVerifiedOffset = db.prepare(`
            UPDATE notification_check_progress
            SET verifiedOffset = @verifiedOffset,
                updatedAt = CURRENT_TIMESTAMP
            WHERE artistId = @artistId
            AND verifiedOffset <= @verifiedOffset
            AND nextOffset >= @verifiedOffset
            AND @verifiedOffset >= 0
            AND @verifiedOffset % 10 = 0
        `);

        const savedProgress = db.prepare(`
                SELECT nextOffset, startedAt, updatedAt, firstPageIds, verifiedOffset
                FROM notification_check_progress
                WHERE artistId = ?
            `).get(artistId) as {
            nextOffset: number;
            startedAt: string;
            updatedAt: string;
            firstPageIds: string | null;
            verifiedOffset: number;
        } | undefined;

        let hasValidFirstPageIds = false;
        let savedFirstPageIds: string[] = [];

        if (savedProgress?.firstPageIds !== null &&
            savedProgress?.firstPageIds !== undefined) {
            try {
                const parsed: unknown = JSON.parse(savedProgress.firstPageIds);

                hasValidFirstPageIds =
                    Array.isArray(parsed) &&
                    parsed.length > 0 &&
                    parsed.length <= 10 &&
                    parsed.every(
                        (id) => typeof id === "string" && id.trim().length > 0
                    );
                if (hasValidFirstPageIds) {
                    savedFirstPageIds = parsed as string[];
                }
            } catch {
                hasValidFirstPageIds = false;
            }
        }

        const hasValidProgress =
            savedProgress !== undefined &&
            Number.isSafeInteger(savedProgress.nextOffset) &&
            savedProgress.nextOffset >= 0 &&
            savedProgress.nextOffset % 10 === 0;

        const savedItemsCount = db.prepare(`
            SELECT COUNT(*) AS count
            FROM notification_check_items
            WHERE artistId = ?
        `).get(artistId) as { count: number };

        const hasValidVerifiedOffset =
            savedProgress === undefined ||
            (
                Number.isSafeInteger(savedProgress.verifiedOffset) &&
                savedProgress.verifiedOffset >= 0 &&
                savedProgress.verifiedOffset % 10 === 0 &&
                savedProgress.verifiedOffset <= savedProgress.nextOffset
            );

        const hasConsistentProgress =
            hasValidProgress &&
            hasValidFirstPageIds &&
            savedProgress !== undefined &&
            savedProgress.nextOffset > 0 &&
            savedItemsCount.count > 0;

        if (savedProgress && !hasValidVerifiedOffset) {
            console.error("通知チェックの照合位置が不正です:", {
                artistId,
                nextOffset: savedProgress.nextOffset,
                verifiedOffset: savedProgress.verifiedOffset,
            });

            return NextResponse.json(
                {
                    message:
                        "保存済みの照合位置に問題があります。安全のため通知チェックを中止しました。",
                },
                { status: 409 }
            );
        }

        if (savedProgress && !hasConsistentProgress) {
            console.error("通知チェックの保存済み進捗が不正です:", {
                artistId,
                nextOffset: savedProgress.nextOffset,
                savedItemsCount: savedItemsCount.count,
            });

            return NextResponse.json(
                {
                    message: "保存済みの取得進捗に問題があります。通知チェックを中止しました。",
                },
                { status: 409 }
            );
        }

        if (!savedProgress && savedItemsCount.count > 0) {
            console.error("通知チェックの一時保存作品に対応する進捗がありません:", {
                artistId,
                savedItemsCount: savedItemsCount.count,
            });

            return NextResponse.json(
                {
                    message: "一時保存作品に対応する取得進捗がありません。通知チェックを中止しました。",
                },
                { status: 409 }
            );
        }

        console.log("通知チェック保存済み進捗:", {
            artistId,
            nextOffset: savedProgress?.nextOffset ?? 0,
            verifiedOffset: savedProgress?.verifiedOffset ?? 0,
            startedAt: savedProgress?.startedAt ?? null,
            updatedAt: savedProgress?.updatedAt ?? null,
            hasValidProgress,
            savedItemsCount: savedItemsCount.count,
            hasConsistentProgress,
        });

        const savedReleases = db.prepare(`
            SELECT
                albumId AS id,
                albumName AS name,
                releaseDate,
                fetchPosition
            FROM notification_check_items
            WHERE artistId = ?
            ORDER BY fetchPosition ASC
        `).all(artistId) as (Release & {
            fetchPosition: number | null;
        })[];

        const hasValidFetchPositions =
            savedReleases.every(
                (release, index) =>
                    Number.isSafeInteger(release.fetchPosition) &&
                    release.fetchPosition !== null &&
                    release.fetchPosition >= 0 &&
                    release.fetchPosition < (savedProgress?.nextOffset ?? 0) &&
                    (
                        index === 0 ||
                        release.fetchPosition >
                        (savedReleases[index - 1].fetchPosition ?? -1)
                    )
            );

        console.log("通知チェック保存済み取得位置:", {
            artistId,
            savedCount: savedReleases.length,
            hasValidFetchPositions,
        });

        if (savedProgress && !hasValidFetchPositions) {
            console.error("通知チェックの取得位置に不整合があります:", {
                artistId,
                nextOffset: savedProgress.nextOffset,
                savedCount: savedReleases.length,
            });

            return NextResponse.json(
                {
                    message: "保存済み作品の取得位置に問題があります。安全のため通知チェックを中止しました。",
                },
                { status: 409 }
            );
        }

        const savedPages = db.prepare(`
            SELECT requestOffset, nextOffset, itemCount
            FROM notification_check_pages
            WHERE artistId = ?
            ORDER BY requestOffset ASC
        `).all(artistId) as {
            requestOffset: number;
            nextOffset: number;
            itemCount: number;
        }[];

        const hasValidSavedPages =
            savedPages.length === 0
                ? savedProgress === undefined
                : savedProgress !== undefined &&
                savedPages[0].requestOffset === 0 &&
                savedPages.every((page, index) => {
                    const previousPage = savedPages[index - 1];

                    return (
                        Number.isSafeInteger(page.requestOffset) &&
                        Number.isSafeInteger(page.nextOffset) &&
                        Number.isSafeInteger(page.itemCount) &&
                        page.requestOffset >= 0 &&
                        page.nextOffset === page.requestOffset + 10 &&
                        page.itemCount >= 0 &&
                        page.itemCount <= 10 &&
                        savedReleases.filter(
                            (release) =>
                                release.fetchPosition !== null &&
                                release.fetchPosition >= page.requestOffset &&
                                release.fetchPosition < page.nextOffset
                        ).length === page.itemCount &&
                        (
                            index === 0 ||
                            previousPage.nextOffset === page.requestOffset
                        )
                    );
                }) &&
                savedPages[savedPages.length - 1].nextOffset ===
                savedProgress.nextOffset;

        // ここから追加
        if (!hasValidSavedPages) {
            console.error("通知チェックの保存済みページ情報が不正です:", {
                artistId,
                savedPages,
                nextOffset: savedProgress?.nextOffset ?? null,
            });

            return NextResponse.json(
                {
                    message:
                        "保存済みページ情報に問題があります。安全のため通知チェックを中止しました。",
                },
                { status: 409 }
            );
        }
        // ここまで追加

        const savedReleaseIds = new Set(
            savedReleases.map((release) => release.id)
        );

        console.log("通知チェック保存済み作品ID:", {
            artistId,
            savedIdsCount: savedReleaseIds.size,
        });

        console.log("通知チェック一時保存作品数:", savedReleases.length);

        const releases: Release[] = [];

        const resumeOffset = savedProgress?.nextOffset ?? 0;

        const verifiedOffset = savedProgress?.verifiedOffset ?? 0;

        const completedPages = Math.floor(resumeOffset / 10);

        const pagesPerRequest = MAX_RELEASE_PAGES;

        console.log("通知チェック取得ページ管理:", {
            artistId,
            resumeOffset,
            completedPages,
            pagesPerRequest,
        });

        let finalPageReleases: Release[] = [];

        let finalPageStartOffset = 0;

        let offset = 0;
        let hasMore = true;
        let complete = false;
        let nextFetchOffset = savedProgress ? verifiedOffset : 0;

        let verifiedPages = 0;
        let newlyFetchedPages = 0;

        let spotifyRequestCount = 0;

        console.log("通知チェック再開予定位置:", {
            artistId,
            resumeOffset,
            verifiedOffset,
        });

        for (
            let page = 0;
            page < Math.min(
                MAX_SPOTIFY_REQUESTS,
                MAX_RELEASE_PAGES + savedPages.length
            );
            page++
        ) {
            const isFirstPage = page === 0;
            const requestOffset = isFirstPage ? 0 : nextFetchOffset;

            // 新規取得の上限に達したら、次のAPIリクエストを行わない
            if (
                requestOffset >= resumeOffset &&
                newlyFetchedPages >= MAX_RELEASE_PAGES
            ) {
                break;
            }

            const url = new URL(
                "/api/spotify-search",
                "http://127.0.0.1:3000"
            );

            url.searchParams.set("artistId", artistId);
            url.searchParams.set("q", artistId);
            url.searchParams.set("offset", String(requestOffset));

            spotifyRequestCount++;

            const spotifyResponse = await fetch(url, {
                cache: "no-store",
            });

            if (!spotifyResponse.ok) {
                const retryAfter = spotifyResponse.headers.get("Retry-After");

                return NextResponse.json(
                    {
                        message:
                            spotifyResponse.status === 429
                                ? "Spotify APIの利用制限中です。時間をおいて再試行してください。"
                                : "Spotifyから作品情報を取得できませんでした。",
                        retryAfter,
                    },
                    {
                        status: spotifyResponse.status,
                        ...(spotifyResponse.status === 429 && retryAfter
                            ? {
                                headers: {
                                    "Retry-After": retryAfter,
                                },
                            }
                            : {}),
                    }
                );
            }

            const spotifyData: SpotifyAlbumsResponse =
                await spotifyResponse.json();

            if (
                !Array.isArray(spotifyData.albums) ||
                typeof spotifyData.hasMore !== "boolean" ||
                !Number.isSafeInteger(spotifyData.fetchedCount) ||
                spotifyData.fetchedCount !== spotifyData.albums.length ||
                spotifyData.fetchedCount > 10 ||
                (
                    spotifyData.hasMore &&
                    (
                        !Number.isSafeInteger(spotifyData.nextOffset) ||
                        spotifyData.nextOffset === null ||
                        spotifyData.nextOffset === undefined
                    )
                ) ||
                !spotifyData.albums.every(
                    (release) =>
                        release &&
                        typeof release.id === "string" &&
                        release.id.trim().length > 0 &&
                        typeof release.name === "string" &&
                        release.name.trim().length > 0 &&
                        typeof release.releaseDate === "string" &&
                        /^\d{4}-\d{2}-\d{2}$/.test(release.releaseDate) &&
                        Number.isFinite(
                            new Date(
                                `${release.releaseDate}T00:00:00Z`
                            ).getTime()
                        )
                )
            ) {
                return NextResponse.json(
                    {
                        message:
                            "取得した作品データが正しくありません。",
                    },
                    { status: 502 }
                );
            }

            const currentIds = spotifyData.albums.map(
                (release) => release.id
            );

            if (new Set(currentIds).size !== currentIds.length) {
                return NextResponse.json(
                    {
                        message:
                            "取得ページ内に重複作品があります。",
                    },
                    { status: 409 }
                );
            }

            const isSavedPage =
                savedProgress !== undefined &&
                requestOffset < resumeOffset;

            if (isSavedPage) {
                const savedPage = savedPages.find(
                    (page) => page.requestOffset === requestOffset
                );

                const expectedNextOffset = spotifyData.hasMore
                    ? spotifyData.nextOffset
                    : requestOffset + spotifyData.fetchedCount;

                if (
                    !savedPage ||
                    savedPage.itemCount !== spotifyData.fetchedCount ||
                    savedPage.nextOffset !== expectedNextOffset
                ) {
                    return NextResponse.json(
                        {
                            message:
                                "保存済みページ情報とSpotifyの取得結果が一致しません。通知チェックを中止しました。",
                        },
                        { status: 409 }
                    );
                }

                const savedIds = getSavedPageIds(
                    savedReleases,
                    requestOffset
                );

                if (!areSameReleaseIds(savedIds, currentIds)) {
                    return NextResponse.json(
                        {
                            message:
                                "保存済み作品とSpotifyの作品一覧が一致しません。通知チェックを中止しました。",
                        },
                        { status: 409 }
                    );
                }

                if (
                    isFirstPage &&
                    !areSameReleaseIds(
                        savedFirstPageIds,
                        currentIds
                    )
                ) {
                    return NextResponse.json(
                        {
                            message:
                                "先頭ページが変更されています。通知チェックを中止しました。",
                        },
                        { status: 409 }
                    );
                }

                verifiedPages++;

                // 先頭ページの確認で再開位置を戻さない
                if (isFirstPage && verifiedOffset > 0) {
                    nextFetchOffset = verifiedOffset;
                } else {
                    nextFetchOffset = savedPage.nextOffset;

                    const updateResult = updateVerifiedOffset.run({
                        artistId,
                        verifiedOffset: nextFetchOffset,
                    });

                    if (updateResult.changes !== 1) {
                        return NextResponse.json(
                            {
                                message:
                                    "照合位置を保存できませんでした。",
                            },
                            { status: 409 }
                        );
                    }
                }

                if (
                    !spotifyData.hasMore &&
                    requestOffset + spotifyData.fetchedCount <
                    resumeOffset
                ) {
                    return NextResponse.json(
                        {
                            message:
                                "保存済み作品の途中で一覧が終了しました。",
                        },
                        { status: 409 }
                    );
                }

                if (!spotifyData.hasMore) {
                    const pageEndOffset =
                        requestOffset + spotifyData.fetchedCount;

                    if (pageEndOffset !== resumeOffset) {
                        return NextResponse.json(
                            {
                                message:
                                    "保存済み作品の件数とSpotifyの取得結果が一致しません。通知チェックを中止しました。",
                            },
                            { status: 409 }
                        );
                    }

                    complete = true;
                    hasMore = false;
                    offset = pageEndOffset;
                    break;
                }

                offset = nextFetchOffset;
                continue;
            }

            // 保存済みの範囲を超えたページだけ新規保存
            if (
                savedProgress &&
                newlyFetchedPages === 0 &&
                requestOffset !== resumeOffset
            ) {
                return NextResponse.json(
                    {
                        message:
                            "取得位置に不整合があります。",
                    },
                    { status: 409 }
                );
            }

            if (
                spotifyData.albums.some(
                    (release) => savedReleaseIds.has(release.id)
                )
            ) {
                return NextResponse.json(
                    {
                        message:
                            "新規取得ページに保存済み作品が含まれています。",
                    },
                    { status: 409 }
                );
            }

            const nextOffset = spotifyData.hasMore
                ? spotifyData.nextOffset
                : requestOffset + spotifyData.fetchedCount;

            if (
                !Number.isSafeInteger(nextOffset) ||
                nextOffset === null ||
                nextOffset === undefined ||
                nextOffset < requestOffset ||
                (spotifyData.hasMore && nextOffset !== requestOffset + 10)
            ) {
                return NextResponse.json(
                    {
                        message: "Spotifyの次ページ位置が正しくありません。",
                    },
                    { status: 502 }
                );
            }

            // 完了ページが10件未満の場合は、
            // 次回再開用の不完全な位置を保存しない
            if (
                spotifyData.hasMore ||
                spotifyData.fetchedCount === 10
            ) {
                const firstPageIds =
                    requestOffset === 0
                        ? JSON.stringify(currentIds)
                        : null;

                saveProgress(
                    artistId,
                    spotifyData.albums,
                    requestOffset,
                    nextOffset,
                    firstPageIds
                );

                newlyFetchedPages++;

                for (const id of currentIds) {
                    savedReleaseIds.add(id);
                }
            } else {
                // 10件未満の最終ページはDBに途中保存しない
                finalPageReleases = spotifyData.albums;
                finalPageStartOffset = requestOffset;
                newlyFetchedPages++;
            }

            releases.push(...spotifyData.albums);

            offset = nextOffset;
            nextFetchOffset = nextOffset;
            hasMore = spotifyData.hasMore;

            if (!hasMore) {
                complete = true;
                break;
            }
        }

        console.log("通知チェックページ処理結果:", {
            artistId,
            spotifyRequestCount,
            verifiedPages,
            newlyFetchedPages,
            resumeOffset,
            finalOffset: offset,
        });

        console.log("通知チェック取得結果:", {
            artistId,
            totalFetched: releases.length,
            recentReleases: releases.filter((release) => {
                const releaseTime = new Date(`${release.releaseDate}T00:00:00Z`).getTime();
                const daysSinceRelease = (Date.now() - releaseTime) / (24 * 60 * 60 * 1000);
                return daysSinceRelease >= 0 && daysSinceRelease <= 30;
            }).length,
            oldestReleaseDate: releases[releases.length - 1]?.releaseDate ?? null,
            hasMore,
        });

        // 保存済み作品の照合が完了しているか確認
        if (savedProgress && complete) {
            const currentProgress = db.prepare(`
            SELECT nextOffset, verifiedOffset
            FROM notification_check_progress
            WHERE artistId = ?
        `).get(artistId) as {
                nextOffset: number;
                verifiedOffset: number;
            } | undefined;

            if (
                !currentProgress ||
                currentProgress.verifiedOffset <
                Math.min(resumeOffset, currentProgress.nextOffset)
            ) {
                return NextResponse.json(
                    {
                        message:
                            "保存済み作品の照合が完了していません。通知チェックを中止しました。",
                    },
                    { status: 409 }
                );
            }
        }

        if (!complete) {
            return NextResponse.json(
                {
                    message: "取得途中の作品を保存しました。通知チェックはまだ完了していません。",
                    nextOffset: nextFetchOffset,
                },
                { status: 409 }
            );
        }

        const result = db.transaction(() => {

            // 最終ページの作品を通知確定と同じトランザクションで保存
            const insertFinalPage = db.prepare(`
                INSERT OR IGNORE INTO notification_check_items
                (artistId, albumId, albumName, releaseDate, fetchPosition)
                VALUES (?, ?, ?, ?, ?)
            `);

            for (const [index, release] of finalPageReleases.entries()) {
                insertFinalPage.run(
                    artistId,
                    release.id,
                    release.name,
                    release.releaseDate,
                    finalPageStartOffset + index
                );
            }

            const allReleases = db.prepare(`
                SELECT
                    albumId AS id,
                    albumName AS name,
                    releaseDate
                FROM notification_check_items
                WHERE artistId = ?
            `).all(artistId) as Release[];

            const previousCheck = db.prepare(`
                SELECT artistId
                FROM notification_check_state
                WHERE artistId = ?
            `).get(artistId) as { artistId: string } | undefined;

            const isFirstCheck = !previousCheck;

            const insertChecked = db.prepare(`
                INSERT OR IGNORE INTO checked_releases (artistId, albumId)
                VALUES (?, ?)
            `);

            const insertNotification = db.prepare(`
                INSERT OR IGNORE INTO release_notifications
                (artistId, albumId, albumName, releaseDate)
                VALUES (?, ?, ?, ?)
            `);

            let newCount = 0;

            for (const release of allReleases) {
                const inserted = insertChecked.run(artistId, release.id);

                const releaseTime = new Date(`${release.releaseDate}T00:00:00Z`).getTime();
                const daysSinceRelease = (Date.now() - releaseTime) / (24 * 60 * 60 * 1000);
                const isRecentRelease =
                    Number.isFinite(releaseTime) &&
                    daysSinceRelease >= 0 &&
                    daysSinceRelease <= 30;

                if (!isFirstCheck && inserted.changes > 0 && isRecentRelease) {
                    const notified = insertNotification.run(
                        artistId,
                        release.id,
                        release.name,
                        release.releaseDate
                    );
                    newCount += notified.changes;
                }
            }

            db.prepare(`
                INSERT INTO notification_check_state (artistId, lastCheckedAt)
                VALUES (?, CURRENT_TIMESTAMP)
                ON CONFLICT(artistId)
                DO UPDATE SET lastCheckedAt = CURRENT_TIMESTAMP
            `).run(artistId);

            db.prepare(`
                DELETE FROM notification_check_progress
                WHERE artistId = ?
            `).run(artistId);

            db.prepare(`
                DELETE FROM notification_check_items
                WHERE artistId = ?
            `).run(artistId);

            db.prepare(`
                DELETE FROM notification_check_pages
                WHERE artistId = ?
            `).run(artistId);

            return {
                initialized: isFirstCheck,
                newCount,
            };
        })()

        return NextResponse.json(result);
    } catch (error) {
        console.error("通知チェックエラー:", error);

        return NextResponse.json(
            { message: "通知チェックに失敗しました。" },
            { status: 500 }
        );
    }
}
