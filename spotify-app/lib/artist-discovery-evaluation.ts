
import type { ArtistReleaseObservation } from "./artist-discovery-observation";

export type DiscoveryPriority =
  | "high"
  | "medium"
  | "low"
  | "unknown";

export type ArtistDiscoveryEvaluation = {
  priority: DiscoveryPriority;
  reason: string;
};

/**
 * 観測情報から新人候補の調査優先度を評価する。
 * 新人であることを断定するものではない。
 */
export function evaluateArtistDiscovery(
  observation: ArtistReleaseObservation | undefined,
  now: Date = new Date()
): ArtistDiscoveryEvaluation {
  if (
    !observation ||
    !Number.isInteger(observation.observedReleaseCount) ||
    observation.observedReleaseCount <= 0 ||
    !observation.oldestObservedReleaseDate
  ) {
    return {
      priority: "unknown",
      reason: "観測情報が不足しています",
    };
  }

  const oldestDate = observation.oldestObservedReleaseDate;

  const oldest = new Date(`${oldestDate}T00:00:00Z`);

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(oldestDate) ||
    Number.isNaN(oldest.getTime()) ||
    oldest.toISOString().slice(0, 10) !== oldestDate ||
    Number.isNaN(now.getTime())
  ) {
    return {
      priority: "unknown",
      reason: "日付情報が不正です",
    };
  }

  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  );

  const daysSinceOldest =
    (today - oldest.getTime()) / 86400000;

  if (daysSinceOldest < 0) {
    return {
      priority: "unknown",
      reason: "観測日付が未来の日付です",
    };
  }

  if (
    observation.observedReleaseCount <= 3 &&
    daysSinceOldest <= 365
  ) {
    return {
      priority: "high",
      reason: "観測作品が少なく、最古の作品も比較的新しい",
    };
  }

  if (daysSinceOldest <= 730) {
    return {
      priority: "medium",
      reason: "最古の観測作品が過去730日以内",
    };
  }

  return {
    priority: "low",
    reason: "730日より前の作品が確認されている",
  };
}
