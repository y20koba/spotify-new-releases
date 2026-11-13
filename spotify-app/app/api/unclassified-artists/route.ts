
import { NextResponse } from "next/server";
import db from "@/lib/db";
import {
    reviewUnclassifiedArtist,
    ReviewError,
} from "@/lib/unclassified-artist-review";


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
const allowedStatuses = ["approved", "pending", "rejected"] as const;

export async function PATCH(request: Request) {
    try {
        const body = await request.json();
        const { id, sourceGenre, status } = body;

        if (
            typeof id !== "string" ||
            !id.trim() ||
            typeof sourceGenre !== "string" ||
            !allowedGenres.includes(sourceGenre) ||
            !allowedStatuses.some((value) => value === status)
        ) {
            return NextResponse.json(
                { message: "更新内容が正しくありません。" },
                { status: 400 }
            );
        }

        const result = reviewUnclassifiedArtist(
            db,
            id.trim(),
            sourceGenre,
            status as "approved" | "pending" | "rejected"
        );

        return NextResponse.json({
            message: "新人候補を更新しました。",
            status: result.status,
        });
    } catch (error) {
        if (error instanceof ReviewError) {
            return NextResponse.json(
                { message: error.message },
                { status: error.statusCode }
            );
        }

        console.error("新人候補更新エラー:", error);

        return NextResponse.json(
            { message: "新人候補の更新に失敗しました。" },
            { status: 500 }
        );
    }
}
