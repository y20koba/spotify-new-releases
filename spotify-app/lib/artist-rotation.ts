
export type Artist = {
    id: string;
    name: string;
};

export function selectArtists(
    artists: Artist[],
    discoveredArtistIds: Set<string>,
    todayIndex: number
): Artist[] {
    const uniqueArtists = Array.from(
        new Map(artists.map((artist) => [artist.id, artist])).values()
    );

    const discoveredArtists = uniqueArtists.filter(
        (artist) => discoveredArtistIds.has(artist.id)
    );

    // 日ごとに自動発見アーティストをローテーション
    const discoveredStartIndex =
        discoveredArtists.length > 0
            ? (todayIndex * 2) % discoveredArtists.length
            : 0;

    const rotatedDiscoveredArtists = [
        ...discoveredArtists.slice(discoveredStartIndex),
        ...discoveredArtists.slice(0, discoveredStartIndex),
    ];

    // 最大2人を発見枠として優先する
    const prioritizedDiscoveredArtists =
        rotatedDiscoveredArtists.slice(0, 2);

    // 優先枠で選ばれたアーティストは通常枠から除外
    const rotationCandidates = uniqueArtists.filter(
        (artist) =>
            !prioritizedDiscoveredArtists.some(
                (discovered) => discovered.id === artist.id
            )
    );

    const rotationCount = 5 - prioritizedDiscoveredArtists.length;

    const startIndex =
        rotationCandidates.length > 0
            ? (todayIndex * rotationCount) % rotationCandidates.length
            : 0;

    const rotatedArtists = [
        ...rotationCandidates.slice(startIndex),
        ...rotationCandidates.slice(0, startIndex),
    ];

    return [
        ...prioritizedDiscoveredArtists,
        ...rotatedArtists.slice(0, rotationCount),
    ];
}
