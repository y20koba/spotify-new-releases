import { NextResponse } from "next/server";

export async function GET(request: Request) {
    const clientId = process.env.SPOTIFY_CLIENT_ID;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        return NextResponse.json(
            { message: "Spotifyの認証情報が設定されていません。" },
            { status: 500 }
        );
    }

    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q")?.trim();
    const artistId = searchParams.get("artistId")?.trim();
    const offset = Math.max(0, Number(searchParams.get("offset") ?? "0") || 0);

    const releaseGroup = searchParams.get("releaseGroup");

    const includeGroups =
        releaseGroup === "single"
            ? "single"
            : releaseGroup === "album"
                ? "album"
                : "album,single";

    if (!query) {
        return NextResponse.json(
            { message: "検索キーワードを指定してください。例：?q=YOASOBI" },
            { status: 400 }
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
                { message: "Spotifyの認証に失敗しました。" },
                { status: 502 }
            );
        }

        const tokenData = await tokenResponse.json();


        let artistCandidates: {
            id: string;
            name: string;
            image: string | null;
        }[] = [];

        let targetArtistId = artistId;

        if (!targetArtistId) {
            const searchUrl = new URL("https://api.spotify.com/v1/search");

            searchUrl.searchParams.set("q", query);
            searchUrl.searchParams.set("type", "artist");
            searchUrl.searchParams.set("limit", "10");
            searchUrl.searchParams.set("offset", "0");

            const searchResponse = await fetch(searchUrl, {
                headers: {
                    Authorization: `Bearer ${tokenData.access_token}`,
                },
                cache: "no-store",
            });

            const searchData = await searchResponse.json();

            console.log("Spotify検索ステータス:", searchResponse.status);

            if (!searchResponse.ok) {
                console.error("Spotify検索エラー詳細:", searchData);

                return NextResponse.json(
                    {
                        message: "Spotifyの検索に失敗しました。",
                        status: searchResponse.status,
                        details: searchData.error?.message ?? "詳細不明",
                        retryAfter: searchResponse.headers.get("Retry-After"),
                    },
                    { status: searchResponse.status }
                );
            }

            const artists = searchData.artists?.items ?? [];

            artistCandidates = artists.map(
                (artist: {
                    id: string;
                    name: string;
                    images?: { url: string }[];
                }) => ({
                    id: artist.id,
                    name: artist.name,
                    image: artist.images?.[0]?.url ?? null,
                })
            );

            const matchedArtist = artists.find(
                (artist: { id: string; name: string }) =>
                    artist.name.trim().toLowerCase() ===
                    query.trim().toLowerCase()
            );

            console.log("一致したアーティスト:", matchedArtist);
            console.log(
                "Spotifyのアーティスト候補:",
                artists.map((artist: { name: string }) => artist.name)
            );

            if (!matchedArtist) {
                return NextResponse.json({
                    albums: [],
                    artistCandidates,
                    hasMore: false,
                    fetchedCount: 0,
                });
            }

            targetArtistId = matchedArtist.id;
        }

        console.log("作品取得対象のアーティストID:", targetArtistId);


        const albumsUrl = new URL(
            `https://api.spotify.com/v1/artists/${targetArtistId}/albums`
        );

        albumsUrl.searchParams.set("include_groups", includeGroups);
        albumsUrl.searchParams.set("limit", "10");
        albumsUrl.searchParams.set("offset", String(offset));

        const albumsResponse = await fetch(albumsUrl, {
            headers: {
                Authorization: `Bearer ${tokenData.access_token}`,
            },
            cache: "no-store",
        });

        const albumsData = await albumsResponse.json();

        if (!albumsResponse.ok) {
            const retryAfter = albumsResponse.headers.get("Retry-After");

            console.error("Spotify作品取得エラー:", {
                artist: query,
                artistId: targetArtistId,
                status: albumsResponse.status,
                details: albumsData.error?.message,
                retryAfter,
            });

            return NextResponse.json(
                {
                    message: "Spotifyから作品情報を取得できませんでした。",
                    status: albumsResponse.status,
                    details: albumsData.error?.message ?? "詳細不明",
                    retryAfter,
                },
                { status: albumsResponse.status === 429 ? 429 : 502 }
            );
        }

        console.log("アーティストの作品情報:", albumsData);

        const albums = (albumsData.items ?? [])
            .map(
                (album: {
                    id: string;
                    name: string;
                    release_date: string;
                    album_type: string;
                    images: { url: string; width: number | null; height: number | null }[];
                    artists: { name: string }[];
                    external_urls: { spotify: string };
                }) => ({
                    id: album.id,
                    name: album.name,
                    artists: album.artists.map((artist) => artist.name),
                    releaseDate: album.release_date,
                    type: album.album_type,
                    image: album.images[0]?.url ?? null,
                    spotifyUrl: album.external_urls.spotify,
                })
            );

        console.log("Spotifyページ情報:", {
            total: albumsData.total,
            next: albumsData.next,
            offset: albumsData.offset,
            limit: albumsData.limit,
        });

        return NextResponse.json({
            albums,
            artistCandidates,
            hasMore: Boolean(albumsData.next),
            fetchedCount: (albumsData.items ?? []).length,
        });
    } catch {
        return NextResponse.json(
            { message: "Spotifyへの接続中にエラーが発生しました。" },
            { status: 500 }
        );
    }
}
