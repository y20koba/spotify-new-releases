
import { NextResponse } from "next/server";
import db from "@/lib/db";

type CachedRelease = {
    id: string;
    name: string;
    artists: string;
    releaseDate: string;
    type: string;
    image: string | null;
    spotifyUrl: string;
};

const SUPPORTED_GENRES = ["hiphop", "jpop", "rnb", "rock"];

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const genre = searchParams.get("genre");

    if (!genre || !SUPPORTED_GENRES.includes(genre)) {
        return NextResponse.json(
            { message: "対応していないジャンルです。" },
            { status: 400 }
        );
    }

    const cacheKeys = [
        `${genre}_v4`,
        `${genre}_v3`,
        `${genre}_v2`,
        genre,
    ];

    for (const cacheKey of cacheKeys) {
        const rows = db.prepare(`
            SELECT id, name, artists, releaseDate,
                   type, image, spotifyUrl
            FROM releases
            WHERE genre = ?
            ORDER BY releaseDate DESC
        `).all(cacheKey) as CachedRelease[];

        if (rows.length === 0) {
            continue;
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const thirtyDaysAgo = new Date(today);
        thirtyDaysAgo.setDate(today.getDate() - 30);

        const albums = rows
            .filter((row) => {
                if (!/^\d{4}-\d{2}-\d{2}$/.test(row.releaseDate)) {
                    return false;
                }

                const releaseDate = new Date(
                    `${row.releaseDate}T00:00:00`
                );

                return releaseDate >= thirtyDaysAgo &&
                    releaseDate <= today;
            })
            .map((row) => ({
                id: row.id,
                name: row.name,
                artists: JSON.parse(row.artists) as string[],
                releaseDate: row.releaseDate,
                type: row.type,
                image: row.image,
                spotifyUrl: row.spotifyUrl,
            }));

        return NextResponse.json({
            albums,
            fromCache: true,
            cacheKey,
            fetchedCount: albums.length,
        });
    }

    return NextResponse.json({
        albums: [],
        fromCache: false,
        fetchedCount: 0,
    });
}
