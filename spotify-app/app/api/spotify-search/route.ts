import { NextResponse } from "next/server";
import db from "@/lib/db";

// 登録済みアーティストをSQLiteから取得する
function getRegisteredArtists(genre: string) {
    return db.prepare(`
        SELECT id, name
        FROM registered_artists
        WHERE genre = ?
        ORDER BY createdAt DESC
    `).all(genre) as { id: string; name: string }[];
}

// 自動発見したアーティストをSQLiteに保存する
function saveDiscoveredArtist(
    genre: string,
    artist: { id: string; name: string }
) {
    db.prepare(`
        INSERT OR IGNORE INTO discovered_artists (
            id,
            name,
            genre
        )
        VALUES (?, ?, ?)
    `).run(artist.id, artist.name, genre);
}

// 保存済みの自動発見アーティストを取得する
function getDiscoveredArtists(genre: string) {
    return db.prepare(`
        SELECT id, name
        FROM discovered_artists
        WHERE genre = ?
        ORDER BY createdAt DESC
    `).all(genre) as { id: string; name: string }[];
}

// 自動発見検索のキャッシュ有効期間（24時間）
const DISCOVERY_CACHE_DURATION = 24 * 60 * 60 * 1000;

// 自動発見検索が必要か判定する
function shouldDiscoverArtists(genre: string) {
    const cache = db.prepare(`
        SELECT lastSearchedAt
        FROM artist_discovery_cache
        WHERE genre = ?
    `).get(genre) as { lastSearchedAt: string } | undefined;

    if (!cache) return true;

    const lastSearched = new Date(cache.lastSearchedAt).getTime();

    return !Number.isFinite(lastSearched) ||
        Date.now() - lastSearched >= DISCOVERY_CACHE_DURATION;
}

// 自動発見検索の最終実行日時を保存する
function saveDiscoveryCache(genre: string) {
    db.prepare(`
        INSERT OR REPLACE INTO artist_discovery_cache (
            genre,
            lastSearchedAt
        )
        VALUES (?, ?)
    `).run(genre, new Date().toISOString());
}

db.exec(`
    CREATE TABLE IF NOT EXISTS spotify_rate_limit (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        retryUntil INTEGER NOT NULL
    )
`);

function saveSpotifyRateLimit(retryUntil: number) {
    db.prepare(`
        INSERT OR REPLACE INTO spotify_rate_limit (id, retryUntil)
        VALUES (1, ?)
    `).run(retryUntil);
}

function getSpotifyRateLimitUntil(): number {
    const row = db
        .prepare("SELECT retryUntil FROM spotify_rate_limit WHERE id = 1")
        .get() as { retryUntil: number } | undefined;

    return row?.retryUntil ?? 0;
}

// キャッシュの有効期間（24時間）
const CACHE_DURATION = 24 * 60 * 60 * 1000;

// Spotifyアクセストークンの一時保存
let cachedAccessToken: string | null = null;
let tokenExpiresAt = 0;
let spotifyRateLimitUntil = 0;

// ジャンルのキャッシュを確認する
function getGenreCache(genre: string) {
    const cache = db
        .prepare("SELECT lastFetchedAt FROM genre_cache WHERE genre = ?")
        .get(genre) as { lastFetchedAt: string } | undefined;

    if (!cache) {
        return false;
    }

    const lastFetchedTime = new Date(cache.lastFetchedAt).getTime();

    return Date.now() - lastFetchedTime < CACHE_DURATION;
}

// SQLiteからジャンル別の作品情報を取得する
function getCachedReleases(genre: string) {
    const rows = db
        .prepare(`
            SELECT *
            FROM releases
            WHERE genre = ?
            ORDER BY releaseDate DESC
        `)
        .all(genre) as {
            id: string;
            name: string;
            artists: string;
            releaseDate: string;
            type: string;
            image: string | null;
            spotifyUrl: string;
            genre: string;
        }[];

    return rows.map((row) => ({
        id: row.id,
        name: row.name,
        artists: JSON.parse(row.artists) as string[],
        releaseDate: row.releaseDate,
        type: row.type,
        image: row.image,
        spotifyUrl: row.spotifyUrl,
    }));
}

// Spotifyから取得した作品情報をSQLiteに保存する
function saveReleases(genre: string, albums: {
    id: string;
    name: string;
    artists: string[];
    releaseDate: string;
    type: string;
    image: string | null;
    spotifyUrl: string;
}[]) {
    const insert = db.prepare(`
        INSERT OR REPLACE INTO releases (
            id,
            name,
            artists,
            releaseDate,
            type,
            image,
            spotifyUrl,
            genre
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const saveTransaction = db.transaction(() => {
        for (const album of albums) {
            insert.run(
                album.id,
                album.name,
                JSON.stringify(album.artists),
                album.releaseDate,
                album.type,
                album.image,
                album.spotifyUrl,
                genre
            );
        }
    });

    saveTransaction();

    // 最終取得日時を記録する
    db.prepare(`
        INSERT OR REPLACE INTO genre_cache (genre, lastFetchedAt)
        VALUES (?, ?)
    `).run(genre, new Date().toISOString());
}

// アーティスト一覧を変更した際にキャッシュを更新するためのバージョン

const ARTIST_CACHE_VERSION = "4";

// アーティスト一覧のバージョンごとにキャッシュを区別する
function getGenreCacheKey(genre: string) {
    return `${genre}_v${ARTIST_CACHE_VERSION}`;
}

// 保存済みの作品データがあるキャッシュを探す
function getAvailableGenreCacheKey(genre: string): string | null {
    const keys = [
        getGenreCacheKey(genre),
        `${genre}_v3`,
        `${genre}_v2`,
        genre,
    ];

    for (const key of keys) {
        if (getCachedReleases(key).length > 0) {
            return key;
        }
    }

    return null;
}

const japaneseArtistSeeds: Record<string, string[]> = {

    hiphop: [
        "Creepy Nuts",
        "Awich",
        "¥ellow Bucks",
        "JP THE WAVY",
        "Kohjiya",
        "LEX",
        "kZm",
        "OZworld",
        "ZORN",
        "PUNPEE",
        "Watson",
        "MIKADO",
        "BAD HOP",
        "舐達麻",
        "Tohji",
        "ralph",
        "Bonbero",
        "Jin Dogg",
        "ANARCHY",
        "唾奇",
        "千葉雄喜",
        "JUMADIBA",
        "STUTS",
        "Daichi Yamamoto",
        "KEIJU",
    ],

    jpop: [
        "YOASOBI",
        "Ado",
        "Vaundy",
        "米津玄師",
        "藤井風",
        "あいみょん",
        "King Gnu",
        "Mrs. GREEN APPLE",
        "Official髭男dism",
        "back number",
    ],
    rnb: [
        "iri",
        "SIRUP",
        "eill",
        "TENDRE",
        "Yo-Sea",
        "MALIYA",
        "宇多田ヒカル",
    ],
    rock: [
        "ONE OK ROCK",
        "RADWIMPS",
        "BUMP OF CHICKEN",
        "ASIAN KUNG-FU GENERATION",
        "Saucy Dog",
        "[Alexandros]",
        "MY FIRST STORY",
    ],
};

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const genre = searchParams.get("genre")?.trim();
    const releaseDate = searchParams.get("date")?.trim();
    const requestedType = searchParams.get("releaseGroup") ?? "all";

    // ジャンル別キャッシュの有無を確認する
    const genreCacheKey = genre ? getGenreCacheKey(genre) : null;
    const hasGenreCache = genreCacheKey
        ? getGenreCache(genreCacheKey)
        : false;

    // 24時間以内のキャッシュがあればSQLiteから取得する
    if (hasGenreCache) {
        console.log("SQLiteのキャッシュを使用:", genreCacheKey);

        const cachedAlbums = getCachedReleases(genreCacheKey!);

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const thirtyDaysAgo = new Date(today);
        thirtyDaysAgo.setDate(today.getDate() - 30);

        const filteredAlbums = cachedAlbums.filter((album) => {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(album.releaseDate)) {
                return false;
            }

            if (releaseDate && album.releaseDate !== releaseDate) {
                return false;
            }

            if (
                requestedType !== "all" &&
                album.type !== requestedType
            ) {
                return false;
            }

            const albumDate = new Date(`${album.releaseDate}T00:00:00`);

            return albumDate >= thirtyDaysAgo && albumDate <= today;
        });

        return NextResponse.json({
            albums: filteredAlbums.sort((a, b) =>
                b.releaseDate.localeCompare(a.releaseDate)
            ),
            hasMore: false,
            fetchedCount: filteredAlbums.length,
        });
    }

    // SQLiteに保存された待機終了時刻を読み込む
    spotifyRateLimitUntil = Math.max(
        spotifyRateLimitUntil,
        getSpotifyRateLimitUntil()
    );

    // Spotify APIが利用制限中かどうかを判定する
    const isRateLimited = Date.now() < spotifyRateLimitUntil;

    // API制限中は古いキャッシュも探す
    const fallbackCacheKey =
        isRateLimited && genre && !hasGenreCache
            ? getAvailableGenreCacheKey(genre)
            : null;

    // API制限中は保存済みの古い作品情報を返す
    if (fallbackCacheKey) {
        const cachedAlbums = getCachedReleases(fallbackCacheKey);
        const releaseDate = searchParams.get("date")?.trim();
        const requestedType = searchParams.get("releaseGroup") ?? "all";

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const thirtyDaysAgo = new Date(today);
        thirtyDaysAgo.setDate(today.getDate() - 30);

        const filteredAlbums = cachedAlbums.filter((album) => {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(album.releaseDate)) {
                return false;
            }

            if (releaseDate && album.releaseDate !== releaseDate) {
                return false;
            }

            if (requestedType !== "all" && album.type !== requestedType) {
                return false;
            }

            const albumDate = new Date(`${album.releaseDate}T00:00:00`);
            return albumDate >= thirtyDaysAgo && albumDate <= today;
        });

        return NextResponse.json({
            albums: filteredAlbums.sort((a, b) =>
                b.releaseDate.localeCompare(a.releaseDate)
            ),
            hasMore: false,
            fetchedCount: filteredAlbums.length,
            fromCache: true,
        });
    }

    // 利用できるキャッシュがない場合は429エラーを返す
    if (!hasGenreCache && !fallbackCacheKey && isRateLimited) {
        const remainingSeconds = Math.ceil(
            (spotifyRateLimitUntil - Date.now()) / 1000
        );

        console.log("Spotify API制限中・残り秒数:", remainingSeconds);

        return NextResponse.json(
            {
                message: "Spotify APIの利用制限中です。時間をおいて再試行してください。",
                status: 429,
                retryAfter: String(remainingSeconds),
            },
            {
                status: 429,
                headers: {
                    "Retry-After": String(remainingSeconds),
                },
            }
        );
    }

    const clientId = process.env.SPOTIFY_CLIENT_ID;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        return NextResponse.json(
            { message: "Spotifyの認証情報が設定されていません。" },
            { status: 500 }
        );
    }

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

    if (!query && !genre) {
        return NextResponse.json(
            { message: "検索キーワードを指定してください。例：?q=YOASOBI" },
            { status: 400 }
        );
    }

    try {
        let tokenData: {
            access_token: string;
            expires_in?: number;
        };

        // 保存済みトークンが有効なら再利用する
        if (cachedAccessToken && Date.now() < tokenExpiresAt) {
            console.log("保存済みのSpotifyアクセストークンを使用");

            tokenData = {
                access_token: cachedAccessToken,
            };
        } else {
            console.log("Spotifyアクセストークンを新規取得");

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

            tokenData = await tokenResponse.json();

            // トークンと有効期限を保存する
            cachedAccessToken = tokenData.access_token;

            const expiresIn = tokenData.expires_in ?? 3600;

            // 有効期限の60秒前に更新する
            tokenExpiresAt = Date.now() + (expiresIn - 60) * 1000;
        }

        if (genre) {
            const spotifyGenres: Record<string, string> = {
                hiphop: "hip-hop",
                jpop: "j-pop",
                rnb: "r-n-b",
                rock: "rock",
            };

            const spotifyGenre = spotifyGenres[genre];

            const artistSeeds = japaneseArtistSeeds[genre] ?? [];

            console.log("ジャンル別アーティスト候補:", artistSeeds);

            if (!spotifyGenre) {
                return NextResponse.json(
                    { message: "対応していないジャンルです。" },
                    { status: 400 }
                );
            }

            const manualArtistsByGenre: Record<
                string,
                { id: string; name: string }[]
            > = {

                hiphop: [
                    { id: "2KpK4apOMD6evPHoPggSVF", name: "LEX" },
                    { id: "4hg5WX4ro6OVIg66dcYUk4", name: "kZm" },
                    { id: "0pWR7TsFhvSCnbmHDjWgrE", name: "Creepy Nuts" },
                    { id: "0FnDCrmcQT8qz5TEsZIYw5", name: "Awich" },
                    { id: "1Fe6FA7A57suR2KAaERpqH", name: "¥ellow Bucks" },
                    { id: "0hBYSjDjcAaAuSZcpN8jk9", name: "JP THE WAVY" },
                    { id: "1jn7KGhS5f79E6efpgukdK", name: "Kohjiya" },
                    { id: "34tJ8UnaAbWcrug3Nym7ZO", name: "OZworld" },
                    { id: "1HPfjeInjrDEMW1ffZv33C", name: "ZORN" },
                    { id: "0mP8A1qIoufScrsxq18Cw6", name: "PUNPEE" },
                    { id: "0pq3BIPRIccDxXRCzlCePX", name: "Watson" },
                    { id: "2snBLq7pgphB4ObS2otWiM", name: "MIKADO" },
                    { id: "3FCZbxRcaSgYfklG2HCFh2", name: "BAD HOP" },
                    { id: "7nDfh01E30OkhgsPKSQzCx", name: "舐達麻" },
                    { id: "7j7kL8K4GE1z5Cdxl7ucBF", name: "Tohji" },
                    { id: "62z45XSe0e3HqK8VbhfFT0", name: "Ralph" },
                    { id: "4XOzeKvdkxm12dE22GJrpM", name: "Bonbero" },
                    { id: "05mWue0RvlBL9VqcG3xCwK", name: "Jin Dogg" },
                    { id: "1zHcoqaTvlZdEd7CUjk2eI", name: "ANARCHY" },
                    { id: "08M0FfjBpFDb302KNq76RL", name: "唾奇" },
                ],

                jpop: [
                    { id: "6bDWAcdtVR3WHz2xtiIPUi", name: "藤井風" },
                    { id: "5kVZa4lFUmAQlBogl1fkd6", name: "あいみょん" },
                    { id: "5Vo1hnCRmCM6M4thZCInCj", name: "Official髭男dism" },
                ],
            };

            // コード内の固定アーティストとSQLiteの登録アーティストを統合
            const artists = [
                ...(manualArtistsByGenre[genre] ?? []),
                ...getRegisteredArtists(genre),
                ...getDiscoveredArtists(genre),
            ];

            for (const artistName of artistSeeds) {
                // IDが登録済みならSpotify検索を省略
                if (
                    artists.some(
                        (artist) =>
                            artist.name.toLowerCase() === artistName.toLowerCase()
                    )
                ) {
                    console.log("登録済みIDを使用:", artistName);
                    continue;
                }

                const artistSearchUrl = new URL(
                    "https://api.spotify.com/v1/search"
                );

                artistSearchUrl.searchParams.set(
                    "q",
                    `artist:${artistName}`
                );
                artistSearchUrl.searchParams.set("type", "artist");
                artistSearchUrl.searchParams.set("limit", "5");
                artistSearchUrl.searchParams.set("market", "JP");

                const artistResponse = await fetch(artistSearchUrl, {
                    headers: {
                        Authorization: `Bearer ${tokenData.access_token}`,
                    },
                    cache: "no-store",
                });

                const artistData = await artistResponse.json();

                if (!artistResponse.ok) {
                    console.error("アーティスト検索エラー:", artistName, artistData);

                    if (artistResponse.status === 429) {
                        const retryAfter = artistResponse.headers.get("Retry-After");
                        const retrySeconds = Number(retryAfter);

                        if (
                            retryAfter !== null &&
                            Number.isFinite(retrySeconds) &&
                            retrySeconds >= 0
                        ) {
                            spotifyRateLimitUntil = Date.now() + retrySeconds * 1000;
                            saveSpotifyRateLimit(spotifyRateLimitUntil);
                        }

                        console.log("Spotify API制限・待機時間（秒）:", retryAfter);

                        return NextResponse.json(
                            {
                                message: "Spotify APIの利用制限に達しました。",
                                status: 429,
                                retryAfter,
                            },
                            { status: 429 }
                        );
                    }

                    continue;
                }

                const matchedArtist = (artistData.artists?.items ?? []).find(
                    (item: { id: string; name: string }) =>
                        item.name.trim().toLowerCase() ===
                        artistName.trim().toLowerCase()
                );

                console.log(
                    `Spotify検索結果 (${artistName}):`,
                    (artistData.artists?.items ?? []).map(
                        (item: { name: string }) => item.name
                    )
                );

                if (matchedArtist) {
                    artists.push({
                        id: matchedArtist.id,
                        name: matchedArtist.name,
                    });
                } else {
                    console.log("アーティストが見つかりません:", artistName);
                }
            }

            // ジャンル別に新しいアーティストを探すための検索キーワード
            const discoveryQueries: Record<string, string[]> = {
                hiphop: ["Japanese hip hop", "Japanese rap"],
                jpop: ["J-pop"],
                rnb: ["Japanese R&B"],
                rock: ["Japanese rock"],
            };

            const searchKeywords = discoveryQueries[genre] ?? [];

            // 自動発見したアーティストを別に記録する
            const discoveredArtistIds = new Set<string>();

            // 検索キーワードから新しいアーティスト候補を発見する
            const needsDiscovery = shouldDiscoverArtists(genre);
            let discoverySucceeded = true;

            for (const keyword of needsDiscovery ? searchKeywords : []) {
                const discoveryUrl = new URL(
                    "https://api.spotify.com/v1/search"
                );

                discoveryUrl.searchParams.set("q", keyword);
                discoveryUrl.searchParams.set("type", "artist");
                discoveryUrl.searchParams.set("limit", "10");
                discoveryUrl.searchParams.set("market", "JP");

                const discoveryResponse = await fetch(discoveryUrl, {
                    headers: {
                        Authorization: `Bearer ${tokenData.access_token}`,
                    },
                    cache: "no-store",
                });

                if (!discoveryResponse.ok) {
                    console.log("自動発見検索エラー:", keyword, discoveryResponse.status);

                    discoverySucceeded = false;

                    // 利用制限に達したら、それ以上の検索を行わない
                    if (discoveryResponse.status === 429) {
                        const retryAfter = discoveryResponse.headers.get("Retry-After");
                        const retrySeconds = Number(retryAfter);

                        if (
                            retryAfter !== null &&
                            Number.isFinite(retrySeconds) &&
                            retrySeconds >= 0
                        ) {
                            spotifyRateLimitUntil = Date.now() + retrySeconds * 1000;
                            saveSpotifyRateLimit(spotifyRateLimitUntil);
                        }

                        return NextResponse.json(
                            { message: "Spotify APIの利用制限に達しました。" },
                            { status: 429 }
                        );
                    }

                    continue;
                }

                const discoveryData = await discoveryResponse.json();

                for (const artist of (discoveryData.artists?.items ?? []).slice(0, 5)) {
                    if (!artist.id || !artist.name) {
                        continue;
                    }

                    // Spotifyのジャンル情報を確認
                    const artistGenres: string[] = artist.genres ?? [];

                    const genreKeywords: Record<string, string[]> = {
                        hiphop: ["hip hop", "hip-hop", "rap", "trap"],
                        jpop: ["j-pop", "japanese pop"],
                        rnb: ["r&b", "rnb", "soul"],
                        rock: ["rock"],
                    };

                    const keywords = genreKeywords[genre] ?? [];

                    const matchesGenre = artistGenres.some((artistGenre) =>
                        keywords.some((keyword) =>
                            artistGenre.toLowerCase().includes(keyword)
                        )
                    );

                    if (!matchesGenre) {
                        continue;
                    }

                    const discoveredArtist = {
                        id: artist.id,
                        name: artist.name,
                    };

                    artists.push(discoveredArtist);

                    discoveredArtistIds.add(artist.id);

                    // 次回以降にIDを再利用できるよう保存
                    saveDiscoveredArtist(genre, discoveredArtist);
                }
            }

            // 全検索が成功した場合のみ検索日時を更新する
            if (needsDiscovery && discoverySucceeded) {
                saveDiscoveryCache(genre);
            }

            // 固定・お気に入り・自動発見の候補から重複を除外
            const uniqueArtists = Array.from(
                new Map(artists.map((artist) => [artist.id, artist])).values()
            );

            // 自動発見したアーティストを抽出
            const discoveredArtists = uniqueArtists.filter(
                (artist) => discoveredArtistIds.has(artist.id)
            );

            // 今回新しく発見したアーティストを最大2人優先
            const newlyDiscoveredArtists = discoveredArtists.slice(0, 2);

            // それ以外の候補をローテーション対象にする
            // 保存済みの自動発見アーティストも含まれる
            const rotationCandidates = uniqueArtists.filter(
                (artist) =>
                    !newlyDiscoveredArtists.some(
                        (discovered) => discovered.id === artist.id
                    )
            );

            // 日ごとに取得対象を切り替える
            const todayIndex = Math.floor(Date.now() / (24 * 60 * 60 * 1000));

            const rotationCount = 5 - newlyDiscoveredArtists.length;

            const startIndex = rotationCandidates.length > 0
                ? (todayIndex * rotationCount) % rotationCandidates.length
                : 0;

            const rotatedArtists = [
                ...rotationCandidates.slice(startIndex),
                ...rotationCandidates.slice(0, startIndex),
            ];

            // 新規発見を優先しつつ、合計最大5人を取得
            const prioritizedArtists = [
                ...newlyDiscoveredArtists,
                ...rotatedArtists.slice(0, rotationCount),
            ];

            console.log("今回の作品取得対象:", prioritizedArtists.map((artist) => artist.name));

            console.log("候補リストから取得したアーティスト:", artists);

            const allAlbums: {
                id: string;
                name: string;
                releaseDate: string;
                type: string;
                image: string | null;
                artists: string[];
                spotifyUrl: string;
            }[] = [];

            for (const artist of prioritizedArtists) {
                const artistName = artist.name;

                let matchedArtist: {
                    id: string;
                    name: string;
                } | undefined;

                // IDが登録されていれば直接使用
                if (artist.id) {
                    matchedArtist = {
                        id: artist.id,
                        name: artist.name,
                    };
                } else {
                    // IDがなければ名前でSpotify検索
                    const artistSearchUrl = new URL(
                        "https://api.spotify.com/v1/search"
                    );

                    artistSearchUrl.searchParams.set(
                        "q",
                        artistName === "LEX" || artistName === "kZm"
                            ? artistName
                            : `artist:${artistName}`
                    );
                    artistSearchUrl.searchParams.set("type", "artist");
                    artistSearchUrl.searchParams.set("limit", "10");
                    artistSearchUrl.searchParams.set("market", "JP");

                    const artistResponse = await fetch(artistSearchUrl, {
                        headers: {
                            Authorization: `Bearer ${tokenData.access_token}`,
                        },
                        cache: "no-store",
                    });

                    const artistData = await artistResponse.json();

                    if (!artistResponse.ok) {
                        console.error("アーティスト検索エラー:", artistName, artistData);
                        continue;
                    }

                    matchedArtist = (artistData.artists?.items ?? []).find(
                        (item: { name: string }) =>
                            item.name.trim().toLowerCase() ===
                            artistName.trim().toLowerCase()
                    );
                }

                if (!matchedArtist) {
                    console.log("アーティストが見つかりません:", artistName);
                    continue;
                }

                console.log("作品取得対象:", matchedArtist.name);

                // アーティストの作品を取得
                const albumsUrl = new URL(
                    `https://api.spotify.com/v1/artists/${matchedArtist.id}/albums`
                );

                albumsUrl.searchParams.set("include_groups", includeGroups);
                albumsUrl.searchParams.set("limit", "10");
                albumsUrl.searchParams.set("offset", String(offset));

                console.log("Spotify作品取得URL:", albumsUrl.toString());

                const albumsResponse = await fetch(albumsUrl, {
                    headers: {
                        Authorization: `Bearer ${tokenData.access_token}`,
                    },
                    cache: "no-store",
                });

                const albumsData = await albumsResponse.json();

                if (!albumsResponse.ok) {
                    console.error("作品取得エラー:", artistName, albumsData);

                    if (albumsResponse.status === 429) {
                        const retryAfter = albumsResponse.headers.get("Retry-After");
                        const retrySeconds = Number(retryAfter);

                        // Spotifyが指定した待機時間を記録する
                        if (
                            retryAfter !== null &&
                            Number.isFinite(retrySeconds) &&
                            retrySeconds >= 0
                        ) {
                            spotifyRateLimitUntil = Date.now() + retrySeconds * 1000;
                            saveSpotifyRateLimit(spotifyRateLimitUntil);
                        }

                        console.log("Spotify API制限・待機時間（秒）:", retryAfter);

                        return NextResponse.json(

                            {
                                message: "Spotify APIの利用制限に達しました。",
                                status: 429,
                                retryAfter: albumsResponse.headers.get("Retry-After"),
                            },

                            {
                                status: 429,
                                headers: {
                                    "Retry-After": albumsResponse.headers.get("Retry-After") ?? "60",
                                },
                            }

                        );
                    }
                    continue;
                }

                const albums = (albumsData.items ?? []).map(
                    (album: {
                        id: string;
                        name: string;
                        release_date: string;
                        album_type: string;
                        images: { url: string }[];
                        artists: { name: string }[];
                        external_urls: { spotify: string };
                    }) => ({
                        id: album.id,
                        name: album.name,
                        releaseDate: album.release_date,
                        type: album.album_type,
                        image: album.images?.[0]?.url ?? null,
                        artists: album.artists.map(
                            (item) => item.name
                        ),
                        spotifyUrl: album.external_urls.spotify,
                    })
                );
                allAlbums.push(...albums);
            }

            // 重複作品を除外
            const uniqueAlbums = Array.from(
                new Map(
                    allAlbums.map((album) => [album.id, album])
                ).values()
            );

            if (uniqueAlbums.length === 0) {
                return NextResponse.json(
                    {
                        message: "作品を取得できませんでした。Spotify APIの取得状況を確認してください。",
                    },
                    { status: 502 }
                );
            }

            // 取得した作品情報をバージョン別にSQLiteへ保存
            saveReleases(getGenreCacheKey(genre), uniqueAlbums);

            // 発売日と作品タイプで絞り込み
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const thirtyDaysAgo = new Date(today);
            thirtyDaysAgo.setDate(today.getDate() - 30);

            const filteredAlbums = uniqueAlbums.filter((album) => {
                if (!/^\d{4}-\d{2}-\d{2}$/.test(album.releaseDate)) {
                    return false;
                }

                if (releaseDate && album.releaseDate !== releaseDate) {
                    return false;
                }

                if (
                    requestedType !== "all" &&
                    album.type !== requestedType
                ) {
                    return false;
                }

                const albumDate = new Date(`${album.releaseDate}T00:00:00`);
                return albumDate >= thirtyDaysAgo && albumDate <= today;
            });

            filteredAlbums.sort((a, b) => {
                // まず発売日の新しい順
                const dateComparison = b.releaseDate.localeCompare(a.releaseDate);

                if (dateComparison !== 0) {
                    return dateComparison;
                }

                // 発売日が同じなら作品名順
                return a.name.localeCompare(b.name, "ja");
            });

            console.log("取得したアーティスト数:", artists.length);
            console.log("取得した作品数:", uniqueAlbums.length);
            console.log("取得した作品の日付:", uniqueAlbums.map((album) => ({
                name: album.name,
                date: album.releaseDate,
            })));
            console.log("絞り込み後の作品数:", filteredAlbums.length);

            return NextResponse.json({
                albums: filteredAlbums,
                hasMore: false,
                fetchedCount: filteredAlbums.length,
            });
        }

        let artistCandidates: {
            id: string;
            name: string;
            image: string | null;
        }[] = [];

        let targetArtistId = artistId;

        if (!targetArtistId) {
            const searchUrl = new URL("https://api.spotify.com/v1/search");

            searchUrl.searchParams.set("q", query ?? "");
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

                if (searchResponse.status === 429) {
                    const retryAfter = searchResponse.headers.get("Retry-After");
                    const retrySeconds = Number(retryAfter);

                    if (retryAfter !== null && Number.isFinite(retrySeconds) && retrySeconds >= 0) {
                        spotifyRateLimitUntil = Date.now() + retrySeconds * 1000;
                        saveSpotifyRateLimit(spotifyRateLimitUntil);
                    }
                }

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
                    (query ?? "").trim().toLowerCase()
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

            if (albumsResponse.status === 429) {
                const retrySeconds = Number(retryAfter);

                if (retryAfter !== null && Number.isFinite(retrySeconds) && retrySeconds >= 0) {
                    spotifyRateLimitUntil = Date.now() + retrySeconds * 1000;
                    saveSpotifyRateLimit(spotifyRateLimitUntil);
                }
            }

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
                {
                    status: albumsResponse.status === 429 ? 429 : 502,
                    ...(albumsResponse.status === 429 && retryAfter
                        ? {
                            headers: {
                                "Retry-After": retryAfter,
                            },
                        }
                        : {}),
                }
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
            )
            .filter(
                (album: { releaseDate: string }) =>
                    !releaseDate || album.releaseDate === releaseDate
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
            nextOffset: albumsData.next
                ? Number(new URL(albumsData.next).searchParams.get("offset"))
                : null,
        });
    } catch {
        return NextResponse.json(
            { message: "Spotifyへの接続中にエラーが発生しました。" },
            { status: 500 }
        );
    }
}
