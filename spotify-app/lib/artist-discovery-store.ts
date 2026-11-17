import type Database from "better-sqlite3";
import type { ArtistReleaseObservation } from "./artist-discovery-observation";

export type StoredArtistObservation = ArtistReleaseObservation & {
  artistId: string;
  genre: string;
  evaluatedAt: string;
};

/** 観測結果をジャンルごとに保存する。既存の作品・登録データは変更しない。 */
export function saveArtistObservation(
  db: Database.Database,
  artistId: string,
  genre: string,
  observation: ArtistReleaseObservation
): void {
  db.prepare(`
    INSERT INTO artist_discovery_scores (
      artistId, genre, oldestObservedReleaseDate, observedReleaseCount, evaluatedAt
    ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(artistId, genre) DO UPDATE SET
      oldestObservedReleaseDate = excluded.oldestObservedReleaseDate,
      observedReleaseCount = excluded.observedReleaseCount,
      evaluatedAt = CURRENT_TIMESTAMP
  `).run(
    artistId,
    genre,
    observation.oldestObservedReleaseDate,
    observation.observedReleaseCount
  );
}

/** 未保存ならundefinedを返す。 */
export function getArtistObservation(
  db: Database.Database,
  artistId: string,
  genre: string
): StoredArtistObservation | undefined {
  return db.prepare(`
    SELECT artistId, genre, oldestObservedReleaseDate,
           observedReleaseCount, evaluatedAt
    FROM artist_discovery_scores
    WHERE artistId = ? AND genre = ?
  `).get(artistId, genre) as StoredArtistObservation | undefined;
}
