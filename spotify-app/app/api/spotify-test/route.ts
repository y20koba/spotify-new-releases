
import { NextResponse } from "next/server";

export async function GET() {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { message: "Spotifyの認証情報が設定されていません。" },
      { status: 500 }
    );
  }

  try {
    const credentials = Buffer.from(
      `${clientId}:${clientSecret}`
    ).toString("base64");

    const tokenResponse = await fetch(
      "https://accounts.spotify.com/api/token",
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "client_credentials",
        }),
        cache: "no-store",
      }
    );

    if (!tokenResponse.ok) {
      return NextResponse.json(
        {
          message: "Spotifyの認証に失敗しました。",
          status: tokenResponse.status,
        },
        { status: 502 }
      );
    }

    const tokenData = await tokenResponse.json();

    return NextResponse.json({
      message: "Spotifyの認証に成功しました！",
      tokenReceived: Boolean(tokenData.access_token),
      expiresIn: tokenData.expires_in,
    });
  } catch {
    return NextResponse.json(
      { message: "Spotifyへの接続中にエラーが発生しました。" },
      { status: 500 }
    );
  }
}
