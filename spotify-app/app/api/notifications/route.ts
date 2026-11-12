
import { NextResponse } from "next/server";
import db from "@/lib/db";

// 保存されている新着通知を取得する
export async function GET() {
    try {
        const notifications = db.prepare(`
            SELECT
                n.artistId,
                a.name AS artistName,
                n.albumId,
                n.albumName,
                n.releaseDate,
                n.isRead
            FROM release_notifications n
            INNER JOIN registered_artists a
                ON n.artistId = a.id
            ORDER BY n.releaseDate DESC, n.createdAt DESC
        `).all();

        const unreadCount = notifications.filter(
            (notification) =>
                (notification as { isRead: number }).isRead === 0
        ).length;

        return NextResponse.json({
            notifications,
            unreadCount,
        });
    } catch (error) {
        console.error("通知取得エラー:", error);

        return NextResponse.json(
            { message: "通知の取得に失敗しました。" },
            { status: 500 }
        );
    }
}
