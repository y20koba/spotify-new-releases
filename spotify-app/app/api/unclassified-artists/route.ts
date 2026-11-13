
import { NextResponse } from "next/server";
import db from "@/lib/db";

type UnclassifiedArtist = {
    id: string;
    name: string;
    sourceGenre: string;
    discoveryQuery: string;
    status: string;
    createdAt: string;
};

export async function GET() {
    try {
        const artists = db.prepare(`
            SELECT
                id,
                name,
                sourceGenre,
                discoveryQuery,
                status,
                createdAt
            FROM unclassified_artists
            ORDER BY createdAt DESC, name ASC
        `).all() as UnclassifiedArtist[];

        return NextResponse.json({ artists });
    } catch (error) {
        console.error("未分類アーティスト取得エラー:", error);

        return NextResponse.json(
            { message: "新人候補の取得に失敗しました。" },
            { status: 500 }
        );
    }
}


const allowedGenres = ["hiphop", "jpop", "rnb", "rock"];
const allowedStatuses = ["approved", "pending", "rejected"];

export async function PATCH(request: Request) {
    try {
        const body = await request.json();
        const { id, sourceGenre, status } = body;

        if (
            typeof id !== "string" || !id.trim() ||
            typeof sourceGenre !== "string" ||
            !allowedGenres.includes(sourceGenre) ||
            typeof status !== "string" ||
            !allowedStatuses.includes(status)
        ) {
            return NextResponse.json(
                { message: "更新内容が正しくありません。" },
                { status: 400 }
            );
        }

        const artist = db.prepare(`
            SELECT id, name, sourceGenre, status
            FROM unclassified_artists
            WHERE id = ? AND sourceGenre = ?
        `).get(id.trim(), sourceGenre) as {
            id: string;
            name: string;
            sourceGenre: string;
            status: string;
        } | undefined;

        if (!artist) {
            return NextResponse.json(
                { message: "新人候補が見つかりません。" },
                { status: 404 }
            );
        }

        // 登録済みアーティストとの衝突を確認
        const registered = db.prepare(`
            SELECT genre FROM registered_artists WHERE id = ?
        `).get(artist.id) as { genre: string } | undefined;

        if (status === "approved" &&
            registered &&
            registered.genre !== sourceGenre) {
            return NextResponse.json(
                {
                    message:
                        "このアーティストは別ジャンルに登録済みです。",
                },
                { status: 409 }
            );
        }

        // 承認・保留・除外をまとめて安全に更新
        const update = db.transaction(() => {
            if (status === "approved") {
                db.prepare(`
                    INSERT OR IGNORE INTO registered_artists
                        (id, name, genre)
                    VALUES (?, ?, ?)
                `).run(artist.id, artist.name, sourceGenre);

                db.prepare(`
                    DELETE FROM genre_cache
                    WHERE genre = ?
                `).run(`${sourceGenre}_v4`);
            } else if (
                artist.status === "approved" &&
                registered?.genre === sourceGenre
            ) {
                // 以前承認した候補を保留・除外へ戻す
                db.prepare(`
                    DELETE FROM registered_artists
                    WHERE id = ?
                `).run(artist.id);

                db.prepare(`
                    DELETE FROM genre_cache
                    WHERE genre = ?
                `).run(`${sourceGenre}_v4`);
            }

            db.prepare(`
                UPDATE unclassified_artists
                SET status = ?
                WHERE id = ? AND sourceGenre = ?
            `).run(status, artist.id, sourceGenre);
        });

        update();

        return NextResponse.json({
            message: "新人候補を更新しました。",
            status,
        });
    } catch (error) {
        console.error("新人候補更新エラー:", error);

        return NextResponse.json(
            { message: "新人候補の更新に失敗しました。" },
            { status: 500 }
        );
    }
}
