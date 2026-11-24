export type FetchedRelease = {
    id: string;
    releaseDate: string;
    type: string;
};

export function getJstDateString(now: Date = new Date()): string {
    const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);

    return jst.toISOString().slice(0, 10);
}

export function createReleaseFetchMetrics(now: Date = new Date()) {
    const targetDate = getJstDateString(now);
    const releases = new Map<string, FetchedRelease>();

    function recordReleases(items: FetchedRelease[]) {
        for (const item of items) {
            if (!item.id) {
                continue;
            }

            releases.set(item.id, { ...item });
        }
    }

    function getSummary(webApiRequests: number) {
        const uniqueReleases = [...releases.values()];

        const todayReleases = uniqueReleases.filter(
            (release) =>
                release.releaseDate === targetDate &&
                (release.type === "single" ||
                    release.type === "album")
        );

        const todaySingleCount = todayReleases.filter(
            (release) => release.type === "single"
        ).length;

        const todayAlbumCount = todayReleases.filter(
            (release) => release.type === "album"
        ).length;

        const todayReleaseCount = todayReleases.length;

        return {
            targetDate,
            fetchedReleaseCount: uniqueReleases.length,
            todayReleaseCount,
            todaySingleCount,
            todayAlbumCount,
            releasesPerWebApiRequest:
                webApiRequests > 0
                    ? Number(
                        (todayReleaseCount / webApiRequests).toFixed(3)
                    )
                    : 0,
        };
    }

    return {
        recordReleases,
        getSummary,
    };
}