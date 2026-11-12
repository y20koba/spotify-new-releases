
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

    const newlyDiscoveredArtists = discoveredArtists.slice(0, 2);

    const rotationCandidates = uniqueArtists.filter(
        (artist) =>
            !newlyDiscoveredArtists.some(
                (discovered) => discovered.id === artist.id
            )
    );

    const rotationCount = 5 - newlyDiscoveredArtists.length;

    const startIndex = rotationCandidates.length > 0
        ? (todayIndex * rotationCount) % rotationCandidates.length
        : 0;

    const rotatedArtists = [
        ...rotationCandidates.slice(startIndex),
        ...rotationCandidates.slice(0, startIndex),
    ];

    return [
        ...newlyDiscoveredArtists,
        ...rotatedArtists.slice(0, rotationCount),
    ];
}
