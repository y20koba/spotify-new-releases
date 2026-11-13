
import type Database from "better-sqlite3";

export type ReviewStatus = "approved" | "pending" | "rejected";

export class ReviewError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "ReviewError";
    this.statusCode = statusCode;
  }
}

type Candidate = {
  id: string;
  name: string;
  sourceGenre: string;
  status: string;
};

type Registration = {
  genre: string;
};

type RegistrationSource = {
  source: string;
};

export function reviewUnclassifiedArtist(
  db: Database.Database,
  id: string,
  sourceGenre: string,
  status: ReviewStatus
) {
  return db.transaction(() => {
    const artist = db.prepare(`
      SELECT id, name, sourceGenre, status
      FROM unclassified_artists
      WHERE id = ? AND sourceGenre = ?
    `).get(id, sourceGenre) as Candidate | undefined;

    if (!artist) {
      throw new ReviewError(
        "新人候補が見つかりません。",
        404
      );
    }

    const registered = db.prepare(`
      SELECT genre
      FROM registered_artists
      WHERE id = ?
    `).get(id) as Registration | undefined;

    const registrationSource = db.prepare(`
      SELECT source
      FROM artist_registration_sources
      WHERE artistId = ?
    `).get(id) as RegistrationSource | undefined;

    if (status === "approved") {
      // 別ジャンルに登録済みなら承認しない
      if (
        registered &&
        registered.genre !== sourceGenre
      ) {
        throw new ReviewError(
          "このアーティストは別ジャンルに登録済みです。",
          409
        );
      }

      // 同じアーティストの別ジャンル承認も防ぐ
      const otherApproval = db.prepare(`
        SELECT sourceGenre
        FROM unclassified_artists
        WHERE id = ?
          AND sourceGenre <> ?
          AND status = 'approved'
        LIMIT 1
      `).get(id, sourceGenre);

      if (otherApproval) {
        throw new ReviewError(
          "別ジャンルですでに承認されています。",
          409
        );
      }

      const result = db.prepare(`
        INSERT OR IGNORE INTO registered_artists
          (id, name, genre)
        VALUES (?, ?, ?)
      `).run(id, artist.name, sourceGenre);

      // この承認で新規作成した登録だけを記録
      if (result.changes > 0) {
        db.prepare(`
          INSERT INTO artist_registration_sources
            (artistId, source)
          VALUES (?, 'discovery')
          ON CONFLICT(artistId)
          DO UPDATE SET source = 'discovery'
        `).run(id);
      }

      db.prepare(`
        DELETE FROM genre_cache
        WHERE genre = ?
      `).run(`${sourceGenre}_v4`);
    } else if (artist.status === "approved") {
      // 他の承認済み候補がある場合は登録を残す
      const otherApproval = db.prepare(`
        SELECT 1
        FROM unclassified_artists
        WHERE id = ?
          AND sourceGenre <> ?
          AND status = 'approved'
        LIMIT 1
      `).get(id, sourceGenre);

      if (
        !otherApproval &&
        registered?.genre === sourceGenre &&
        registrationSource?.source === "discovery"
      ) {
        db.prepare(`
          DELETE FROM registered_artists
          WHERE id = ?
        `).run(id);

        db.prepare(`
          DELETE FROM artist_registration_sources
          WHERE artistId = ?
        `).run(id);

        db.prepare(`
          DELETE FROM genre_cache
          WHERE genre = ?
        `).run(`${sourceGenre}_v4`);
      }
    }

    db.prepare(`
      UPDATE unclassified_artists
      SET status = ?
      WHERE id = ? AND sourceGenre = ?
    `).run(status, id, sourceGenre);

    return { status };
  })();
}
