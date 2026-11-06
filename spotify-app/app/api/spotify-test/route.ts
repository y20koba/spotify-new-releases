import { NextResponse } from "next/server";
import db from "@/lib/db";

export async function GET() {
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all();

    return NextResponse.json({
      message: "SQLiteの接続に成功しました！",
      tables,
    });
  } catch (error) {
    return NextResponse.json(
      {
        message: "SQLiteの接続に失敗しました。",
        error: String(error),
      },
      { status: 500 }
    );
  }
}