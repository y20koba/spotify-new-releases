export type SpotifyRequestType =
    | "token"
    | "artistSearch"
    | "artistDiscovery"
    | "albumFetch";

export function createSpotifyApiMetrics() {
    const counts: Record<SpotifyRequestType, number> = {
        token: 0,
        artistSearch: 0,
        artistDiscovery: 0,
        albumFetch: 0,
    };

    let rateLimitCount = 0;

    function recordRequest(type: SpotifyRequestType) {
        counts[type]++;
    }

    function recordResponse(status: number) {
        if (status === 429) {
            rateLimitCount++;
        }
    }

    function getSummary() {
        const webApiRequests =
            counts.artistSearch +
            counts.artistDiscovery +
            counts.albumFetch;

        return {
            totalRequests: counts.token + webApiRequests,
            webApiRequests,
            tokenRequests: counts.token,
            artistSearchRequests: counts.artistSearch,
            artistDiscoveryRequests: counts.artistDiscovery,
            albumFetchRequests: counts.albumFetch,
            rateLimitCount,
        };
    }

    return {
        recordRequest,
        recordResponse,
        getSummary,
    };
}
