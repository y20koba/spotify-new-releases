/**
 * Spotifyから取得できた作品だけを集計する。
 * 全作品数やデビュー日を推定するものではない。
 */
export type ObservedRelease = {
  id: string;
  releaseDate: string;
};

export type ArtistReleaseObservation = {
  oldestObservedReleaseDate: string | null;
  observedReleaseCount: number;
};

export function summarizeObservedReleases(
  releases: ObservedRelease[]
): ArtistReleaseObservation {
  const uniqueDates = new Map<string, string>();

  for (const release of releases) {
    if (!release.id || !/^\d{4}-\d{2}-\d{2}$/.test(release.releaseDate)) {
      continue;
    }

    const date = new Date(`${release.releaseDate}T00:00:00Z`);
    if (
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== release.releaseDate
    ) {
      continue;
    }

    uniqueDates.set(release.id, release.releaseDate);
  }

  const dates = [...uniqueDates.values()];

  return {
    oldestObservedReleaseDate:
      dates.length > 0 ? dates.sort()[0] : null,
    observedReleaseCount: dates.length,
  };
}
