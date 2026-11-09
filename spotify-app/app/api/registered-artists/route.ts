import { NextResponse } from "next/server";
import db from "@/lib/db";

// 登録済みアーティストの一覧を取得する
export async function GET() {
    try {
        const artists = db.prepare(`
            SELECT id, name, genre, createdAt
            FROM registered_artists
            ORDER BY createdAt DESC
        `).all();

        return NextResponse.json({ artists });
    } catch (error) {
        console.error("登録アーティスト取得エラー:", error);

        return NextResponse.json(
            { message: "登録アーティストの取得に失敗しました。" },
            { status: 500 }
        );
    }
}

// アーティストを新しく登録する
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { id, name, genre } = body;

        // 必須項目を確認
        if (
            typeof id !== "string" || !id.trim() ||
            typeof name !== "string" || !name.trim() ||
            typeof genre !== "string" ||
            !["hiphop", "jpop", "rnb", "rock"].includes(genre)
        ) {
            return NextResponse.json(
                { message: "アーティスト情報が正しくありません。" },
                { status: 400 }
            );
        }

        // SQLiteに登録
        db.prepare(`
            INSERT OR IGNORE INTO registered_artists (id, name, genre)
            VALUES (?, ?, ?)
        `).run(id.trim(), name.trim(), genre);

        // お気に入りを追加したジャンルのキャッシュを無効にする
        db.prepare(`
            DELETE FROM genre_cache
            WHERE genre = ?
        `).run(`${genre}_v4`);

        return NextResponse.json({
            message: "アーティストを登録しました。",
        });
    } catch (error) {
        console.error("アーティスト登録エラー:", error);

        return NextResponse.json(
            { message: "アーティストの登録に失敗しました。" },
            { status: 500 }
        );
    }
}

// 登録済みアーティストを削除する
export async function DELETE(request: Request) {
    try {
        const body = await request.json();
        const { id } = body;

        // 削除対象のアーティストが属するジャンルを取得
        const artist = db.prepare(`
            SELECT genre
            FROM registered_artists
            WHERE id = ?
        `).get(id) as { genre: string } | undefined;

        if (typeof id !== "string" || !id.trim()) {
            return NextResponse.json(
                { message: "アーティストIDが正しくありません。" },
                { status: 400 }
            );
        }

        const result = db.prepare(`
      DELETE FROM registered_artists
      WHERE id = ?
    `).run(id.trim());

        if (result.changes === 0) {
            return NextResponse.json(
                { message: "アーティストが見つかりません。" },
                { status: 404 }
            );
        }

        // 削除したアーティストのジャンルのキャッシュを無効にする
        if (artist) {
            db.prepare(`
                DELETE FROM genre_cache
                WHERE genre = ?
            `).run(`${artist.genre}_v4`);
        }

        return NextResponse.json({
            message: "お気に入りから削除しました。",
        });
    } catch (error) {
        console.error("アーティスト削除エラー:", error);

        return NextResponse.json(
            { message: "削除に失敗しました。" },
            { status: 500 }
        );
    }
}