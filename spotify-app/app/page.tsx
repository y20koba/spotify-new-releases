"use client";

import { useEffect, useState, useRef } from "react";
import Image from "next/image";

type SpotifyAlbum = {
  id: string;
  name: string;
  artists: string[];
  releaseDate: string;
  type: string;
  image: string | null;
  spotifyUrl: string;
};

type ArtistCandidate = {
  id: string;
  name: string;
  image: string | null;
};

type FavoriteArtist = {
  id: string;
  name: string;
  genre: string;
  createdAt: string;
};

type ReleaseNotification = {
  artistId: string;
  albumId: string;
  albumName: string;
  releaseDate: string;
  isRead: number;
};

const genres = [
  { id: "hiphop", name: "HIPHOP" },
  { id: "jpop", name: "J-POP" },
  { id: "rnb", name: "R&B" },
  { id: "rock", name: "ロック" },
];

function getLocalDateString() {
  const today = new Date();
  const localDate = new Date(
    today.getTime() - today.getTimezoneOffset() * 60000
  );

  return localDate.toISOString().slice(0, 10);
}

export default function Home() {
  const [activeTab, setActiveTab] = useState("new-releases");
  const [selectedGenre, setSelectedGenre] = useState("hiphop");
  const selectedGenreRef = useRef("hiphop");
  const [query, setQuery] = useState("");
  const [albums, setAlbums] = useState<SpotifyAlbum[]>([]);
  const [newReleases, setNewReleases] = useState<SpotifyAlbum[]>([]);
  const [newReleaseType, setNewReleaseType] = useState("all");
  const [hasFetchedNewReleases, setHasFetchedNewReleases] = useState(false);
  const [genreCache, setGenreCache] = useState<
    Record<string, SpotifyAlbum[]>
  >({});
  const [newReleasesLoading, setNewReleasesLoading] = useState(false);
  const [newReleasesError, setNewReleasesError] = useState("");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState("all");
  const [selectedType, setSelectedType] = useState("all");
  const [selectedReleaseDate, setSelectedReleaseDate] = useState("");
  const [todayDate, setTodayDate] = useState("");
  useEffect(() => {
    const today = getLocalDateString();

    setSelectedReleaseDate(today);
    setTodayDate(today);
  }, []);
  const [hasMore, setHasMore] = useState(false);
  const [artistCandidates, setArtistCandidates] = useState<ArtistCandidate[]>([]);
  const [selectedArtistId, setSelectedArtistId] = useState<string | null>(null);
  const [favoriteArtists, setFavoriteArtists] = useState<FavoriteArtist[]>([]);
  const [notificationCheckLoading, setNotificationCheckLoading] = useState(false);
  const [favoriteQuery, setFavoriteQuery] = useState("");
  const [favoriteCandidates, setFavoriteCandidates] = useState<ArtistCandidate[]>([]);
  const [favoriteSearchLoading, setFavoriteSearchLoading] = useState(false);
  const [favoriteSearchError, setFavoriteSearchError] = useState("");
  const [favoriteGenre, setFavoriteGenre] = useState("hiphop");
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<ReleaseNotification[]>([]);

  useEffect(() => {
    async function loadNotifications() {
      try {
        const response = await fetch("/api/notifications");
        if (!response.ok) {
          throw new Error("通知の取得に失敗しました。");
        }
        const data = await response.json();
        setUnreadCount(data.unreadCount ?? 0);
        setNotifications(data.notifications ?? []);
      } catch (error) {
        console.error("通知取得エラー:", error);
      }
    }

    loadNotifications();
  }, []);

  async function searchFavoriteArtists() {
    const keyword = favoriteQuery.trim();

    if (!keyword) {
      setFavoriteSearchError("アーティスト名を入力してください。");
      return;
    }

    setFavoriteSearchLoading(true);
    setFavoriteSearchError("");
    setFavoriteCandidates([]);

    try {
      const response = await fetch(
        `/api/spotify-search?q=${encodeURIComponent(keyword)}`
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message ?? "検索に失敗しました。");
      }

      setFavoriteCandidates(data.artistCandidates ?? []);
    } catch (error) {
      setFavoriteSearchError(
        error instanceof Error
          ? error.message
          : "アーティストの検索に失敗しました。"
      );
    } finally {
      setFavoriteSearchLoading(false);
    }
  }

  async function registerFavoriteArtist(artist: ArtistCandidate) {
    try {
      const response = await fetch("/api/registered-artists", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: artist.id,
          name: artist.name,
          genre: favoriteGenre,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message ?? "登録に失敗しました。");
      }

      const listResponse = await fetch("/api/registered-artists");

      if (!listResponse.ok) {
        throw new Error("登録済み一覧の更新に失敗しました。");
      }

      const listData = await listResponse.json();
      setFavoriteArtists(listData.artists ?? []);

      // お気に入りを追加したジャンルのキャッシュを削除
      setGenreCache((prev) => {
        const updated = { ...prev };
        delete updated[favoriteGenre];
        return updated;
      });

      // 表示中のジャンルなら古い作品一覧もクリア
      if (selectedGenre === favoriteGenre) {
        setNewReleases([]);
        setHasFetchedNewReleases(false);
      }

    } catch (error) {
      setFavoriteSearchError(
        error instanceof Error
          ? error.message
          : "アーティストの登録に失敗しました。"
      );
    }
  }

  async function deleteFavoriteArtist(artist: FavoriteArtist) {
    const confirmed = window.confirm(
      `${artist.name} をお気に入りから削除しますか？`
    );

    if (!confirmed) return;

    try {
      const response = await fetch("/api/registered-artists", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id: artist.id }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message ?? "削除に失敗しました。");
      }

      setFavoriteArtists((current) =>
        current.filter((favorite) => favorite.id !== artist.id)
      );

      // 削除したアーティストのジャンルのキャッシュを削除
      setGenreCache((prev) => {
        const updated = { ...prev };
        delete updated[artist.genre];
        return updated;
      });

      // 表示中のジャンルなら古い作品一覧もクリア
      if (selectedGenre === artist.genre) {
        setNewReleases([]);
        setHasFetchedNewReleases(false);
      }

    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : "お気に入りの削除に失敗しました。"
      );
    }
  }

  useEffect(() => {
    async function loadFavoriteArtists() {
      try {
        const response = await fetch("/api/registered-artists");

        if (!response.ok) {
          throw new Error("お気に入りの取得に失敗しました。");
        }

        const data = await response.json();
        setFavoriteArtists(data.artists ?? []);
      } catch (error) {
        console.error("お気に入り取得エラー:", error);
      }
    }

    loadFavoriteArtists();
  }, []);

  async function refreshNotifications() {
    try {
      const response = await fetch("/api/notifications");

      if (!response.ok) {
        throw new Error("通知の取得に失敗しました。");
      }

      const data = await response.json();

      setNotifications(data.notifications);
      setUnreadCount(data.unreadCount);
    } catch (error) {
      console.error("通知の更新エラー:", error);
    }
  }

  async function checkArtistNotifications(artistId: string) {
    const response = await fetch("/api/notifications/check", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ artistId }),
    });

    const data = await response.json();

    if (!response.ok) {
      const retryAfter =
        response.headers.get("Retry-After") ??
        data.retryAfter;

      const retrySeconds = Number(retryAfter);

      if (
        response.status === 429 &&
        retryAfter != null &&
        Number.isFinite(retrySeconds) &&
        retrySeconds > 0
      ) {
        const retryMinutes = Math.ceil(retrySeconds / 60);

        throw new Error(
          `${data.message ?? "Spotify APIの利用制限中です。"}\n約${retryMinutes}分後に再試行してください。`
        );
      }

      throw new Error(
        data.message ?? "新着チェックに失敗しました。"
      );
    }

    await refreshNotifications();

    return data;
  }

  async function searchAlbums(artistId?: string, artistName?: string) {
    const keyword = (artistName ?? query).trim();

    if (!keyword) {
      setError("アーティスト名を入力してください。");
      return;
    }

    setLoading(true);
    setError("");
    setAlbums([]);
    setHasMore(false);
    setOffset(0);

    if (!artistId) {
      setArtistCandidates([]);
    }

    try {
      const response = await fetch(
        `/api/spotify-search?q=${encodeURIComponent(keyword)}${artistId ? `&artistId=${encodeURIComponent(artistId)}` : ""
        }`
      );
      const data = await response.json();

      console.log("Spotify APIの再試行待ち時間:", data.retryAfter);

      if (!response.ok) {
        throw new Error(data.message ?? "検索に失敗しました。");
      }

      const sortedAlbums = [...data.albums].sort((a, b) => {
        return b.releaseDate.localeCompare(a.releaseDate);
      });

      setAlbums(sortedAlbums);
      setOffset(data.fetchedCount);
      setHasMore(data.hasMore);
      setArtistCandidates(data.artistCandidates ?? []);
      setHasSearched(true);
      console.log("検索結果のページ情報:", data.hasMore, data.fetchedCount);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "予期しないエラーが発生しました。"
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadMoreAlbums() {
    if (loading) return;

    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `/api/spotify-search?q=${encodeURIComponent(query.trim())}&offset=${offset}${selectedArtistId
          ? `&artistId=${encodeURIComponent(selectedArtistId)}`
          : ""
        }`
      );
      const data = await response.json();

      console.log("追加読み込み結果:", { offset, data });

      if (!response.ok) {
        throw new Error(data.message ?? "追加取得に失敗しました。");
      }

      const combinedAlbums = [...albums, ...data.albums];

      const uniqueAlbums = Array.from(
        new Map(combinedAlbums.map((album) => [album.id, album])).values()
      );

      const sortedAlbums = uniqueAlbums.sort((a, b) =>
        b.releaseDate.localeCompare(a.releaseDate)
      );

      setAlbums(sortedAlbums);
      setOffset(offset + data.fetchedCount);
      setHasMore(data.hasMore);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "予期しないエラーが発生しました。"
      );
    } finally {
      setLoading(false);
    }
  }

  // Spotify APIにはアクセスせず、SQLiteの保存済み作品を読み込む
  async function loadCachedGenreReleases(genre: string) {
    try {
      const response = await fetch(
        `/api/cached-releases?genre=${encodeURIComponent(genre)}`
      );

      if (!response.ok) {
        throw new Error("保存済み作品の読み込みに失敗しました。");
      }

      const data = await response.json();
      const cachedAlbums: SpotifyAlbum[] = data.albums ?? [];

      setGenreCache((prev) => ({
        ...prev,
        [genre]: cachedAlbums,
      }));

      // 読み込み中に別のジャンルへ切り替わっていた場合は、
      // そのジャンルの表示を上書きしないようにする
      if (selectedGenreRef.current === genre) {
        setNewReleases(cachedAlbums);
        setHasFetchedNewReleases(cachedAlbums.length > 0);
      }

    } catch (error) {
      console.error("SQLiteキャッシュ読み込みエラー:", error);
    }
  }

  async function fetchGenreReleases(genre = selectedGenre) {
    setNewReleasesLoading(true);
    setNewReleasesError("");
    setHasFetchedNewReleases(false);

    try {
      const params = new URLSearchParams({
        genre: genre,
        offset: "0",
        releaseGroup: newReleaseType,
      });

      const response = await fetch(
        `/api/spotify-search?${params.toString()}`
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message ?? "ジャンル検索中にエラーが発生しました。"
        );
      }

      const fetchedAlbums: SpotifyAlbum[] = data.albums ?? [];

      setNewReleases(fetchedAlbums);

      setGenreCache((prev) => ({
        ...prev,
        [genre]: fetchedAlbums,
      }));

      setHasFetchedNewReleases(true);
      console.log("ジャンル検索結果:", data);
    } catch (err) {
      setNewReleasesError(
        err instanceof Error
          ? err.message
          : "新着作品の取得中にエラーが発生しました。"
      );
    } finally {
      setNewReleasesLoading(false);
    }
  }

  const filteredNewReleases = newReleases.filter((album) => {
    if (
      selectedReleaseDate &&
      album.releaseDate !== selectedReleaseDate
    ) {
      return false;
    }

    if (
      newReleaseType !== "all" &&
      album.type !== newReleaseType
    ) {
      return false;
    }

    return true;
  });

  const filteredAlbums = albums.filter((album) => {
    if (selectedType !== "all" && album.type !== selectedType) {
      return false;
    }

    if (selectedPeriod === "all") {
      return true;
    }

    // 発売日が日付まで分からない作品は、今回は除外する
    if (!/^\d{4}-\d{2}-\d{2}$/.test(album.releaseDate)) {
      return false;
    }

    const releaseDate = new Date(`${album.releaseDate}T00:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const daysAgo = new Date(today);
    daysAgo.setDate(today.getDate() - Number(selectedPeriod));

    return releaseDate >= daysAgo && releaseDate <= today;
  });

  return (
    <main className="min-h-screen bg-[#121212] px-6 py-10 text-white">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between lg:gap-16">
          <div className="shrink-0">
            <p className="text-sm font-bold uppercase tracking-widest text-[#1ed760]">
              Spotify Music Discovery
            </p>

            <h1 className="mt-3 text-4xl font-bold">
              Music Discovery
            </h1>
          </div>

          <div
            className="relative flex h-12 w-12 items-center justify-center rounded-full bg-[#242424]"
            aria-label={`未読通知 ${unreadCount}件`}
            role="status"
          >
            <span className="text-2xl">🔔</span>
            {unreadCount > 0 && (
              <span className="absolute -right-1 -top-1 flex min-h-6 min-w-6 items-center justify-center rounded-full bg-[#1ed760] px-1 text-xs font-bold text-black">
                {unreadCount}
              </span>
            )}
          </div>
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-3 border-b border-white/10 pb-3">
          <button
            type="button"
            onClick={() => setActiveTab("new-releases")}
            className={`rounded-lg px-5 py-3 font-semibold transition ${activeTab === "new-releases"
              ? "bg-[#1ed760] text-black"
              : "bg-[#242424] text-white hover:bg-[#333333]"
              }`}
          >
            新着作品を探す
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("search")}
            className={`rounded-lg px-5 py-3 font-semibold transition ${activeTab === "search"
              ? "bg-[#1ed760] text-black"
              : "bg-[#242424] text-white hover:bg-[#333333]"
              }`}
          >
            アーティスト検索
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("artist-management")}
            className={`ml-auto rounded-lg px-5 py-3 font-semibold transition ${activeTab === "artist-management"
              ? "bg-[#1ed760] text-black"
              : "bg-[#242424] text-white hover:bg-[#333333]"
              }`}
          >
            ♡ お気に入り
          </button>
        </div>

        {activeTab === "artist-management" && (
          <div className="mt-8 space-y-6">
            <section className="rounded-xl bg-[#181818] p-6">

              <div>
                <label
                  htmlFor="favorite-search"
                  className="mb-4 block text-2xl font-bold text-white"
                >
                  アーティストを追加
                </label>

                <input
                  id="favorite-search"
                  type="text"
                  value={favoriteQuery}
                  onChange={(event) => setFavoriteQuery(event.target.value)}
                  placeholder="アーティスト名を入力（例：Awich）"
                  className="w-full rounded-lg border border-white/10 bg-[#242424] px-5 py-3 text-white outline-none focus:border-[#1ed760]"
                />
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <label
                    htmlFor="favorite-genre"
                    className="text-sm font-semibold text-zinc-300"
                  >
                    登録するジャンル：
                  </label>

                  <select
                    id="favorite-genre"
                    value={favoriteGenre}
                    onChange={(event) => setFavoriteGenre(event.target.value)}
                    className="rounded-lg border border-white/10 bg-[#242424] px-4 py-2 text-white outline-none focus:border-[#1ed760]"
                  >
                    {genres.map((genre) => (
                      <option key={genre.id} value={genre.id}>
                        {genre.name}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={searchFavoriteArtists}
                    disabled={favoriteSearchLoading}
                    className="rounded-lg bg-[#1ed760] px-6 py-3 font-semibold text-black transition hover:bg-[#1bd15a] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {favoriteSearchLoading ? "検索中..." : "アーティストを検索"}
                  </button>
                </div>
                {favoriteSearchError && (
                  <p className="mt-3 text-sm text-red-400">
                    {favoriteSearchError}
                  </p>
                )}

                {favoriteCandidates.length > 0 && (
                  <div className="mt-5">
                    <h3 className="font-semibold">検索結果</h3>
                    <div className="flex flex-wrap gap-2">
                      {favoriteCandidates.map((artist) => (
                        <div
                          key={artist.id}
                          className="flex items-center gap-2 rounded-lg bg-[#242424] px-3 py-2"
                        >
                          {artist.image ? (
                            <Image
                              src={artist.image}
                              alt={artist.name}
                              width={32}
                              height={32}
                              unoptimized
                              className="h-8 w-8 rounded-full object-cover"
                            />
                          ) : (
                            <div className="h-8 w-8 rounded-full bg-[#333333]" />
                          )}

                          <span className="text-sm font-semibold">{artist.name}</span>
                          <button
                            type="button"
                            onClick={() => registerFavoriteArtist(artist)}
                            disabled={favoriteArtists.some((favorite) => favorite.id === artist.id)}
                            className="ml-2 rounded-md bg-[#1ed760] px-3 py-1 text-xs font-semibold text-black transition hover:bg-[#1bd15a] disabled:cursor-not-allowed disabled:bg-[#444444] disabled:text-zinc-400"
                          >
                            {favoriteArtists.some((favorite) => favorite.id === artist.id)
                              ? "登録済み"
                              : "＋ 追加"}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </section>
            <section className="rounded-xl bg-[#181818] p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-2xl font-bold">
                  ♡ お気に入りアーティスト
                </h2>
                <button
                  type="button"
                  disabled={true}
                  onClick={async () => {
                    if (notificationCheckLoading || favoriteArtists.length === 0) return;

                    setNotificationCheckLoading(true);

                    try {
                      const result = await checkArtistNotifications(favoriteArtists[0].id);

                      alert(
                        result.initialized
                          ? "初回チェックが完了しました。"
                          : `新着チェック完了！新しい作品：${result.newCount}件`
                      );
                    } catch (error) {
                      alert(
                        error instanceof Error
                          ? error.message
                          : "新着チェックに失敗しました。"
                      );
                    } finally {
                      setNotificationCheckLoading(false);
                    }
                  }}
                  className="rounded-lg bg-[#1ed760] px-4 py-2 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {notificationCheckLoading ? "チェック中..." : "🔔 新着をチェック"}
                </button>
              </div>

              <p className="mt-3 text-sm text-zinc-400">
                好きなアーティストを登録して、新着作品をチェックしよう。
              </p>

              <div className="mt-6 space-y-3">
                {favoriteArtists.length === 0 ? (
                  <p className="text-sm text-zinc-500">
                    まだお気に入りアーティストが登録されていません。
                  </p>
                ) : (
                  favoriteArtists.map((artist) => (
                    <div
                      key={artist.id}
                      className="flex items-center justify-between rounded-lg bg-[#242424] p-4"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-semibold">{artist.name}</p>
                          {notifications.some(
                            (notification) =>
                              notification.artistId === artist.id &&
                              notification.isRead === 0
                          ) && (
                              <span className="rounded-full bg-[#1ed760] px-2 py-0.5 text-xs font-bold text-black">
                                NEW
                              </span>
                            )}
                        </div>
                        <p className="mt-1 text-xs text-zinc-400">
                          {genres.find((genre) => genre.id === artist.genre)?.name ??
                            artist.genre}
                        </p>
                      </div>

                      <div className="flex items-center gap-4">
                        <span className="text-sm text-[#1ed760]">
                          登録済み
                        </span>

                        <button
                          type="button"
                          disabled={notificationCheckLoading}
                          onClick={async () => {
                            if (notificationCheckLoading) return;

                            setNotificationCheckLoading(true);

                            try {
                              const result = await checkArtistNotifications(artist.id);

                              alert(
                                result.initialized
                                  ? `${artist.name}の初回チェックが完了しました。`
                                  : `${artist.name}の新着チェック完了！新しい作品：${result.newCount}件`
                              );
                            } catch (error) {
                              alert(
                                error instanceof Error
                                  ? error.message
                                  : "新着チェックに失敗しました。"
                              );
                            } finally {
                              setNotificationCheckLoading(false);
                            }
                          }}
                          className="rounded-lg border border-[#1ed760] px-3 py-2 text-sm font-semibold text-[#1ed760] transition hover:bg-[#1ed760]/10 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {notificationCheckLoading ? "チェック中..." : "🔔 新着チェック"}
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setQuery(artist.name);
                            setSelectedArtistId(artist.id);
                            setActiveTab("search");
                            setArtistCandidates([]);
                            searchAlbums(artist.id, artist.name);
                          }}
                          className="rounded-lg bg-[#1ed760] px-3 py-2 text-sm font-semibold text-black transition hover:bg-[#1bd15a]"
                        >
                          作品を見る
                        </button>

                        <button
                          type="button"
                          onClick={() => deleteFavoriteArtist(artist)}
                          className="rounded-lg border border-red-500/40 px-3 py-2 text-sm font-semibold text-red-400 transition hover:bg-red-500/10"
                        >
                          削除
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        )}

        {activeTab === "new-releases" && (
          <div className="mt-6 flex flex-wrap items-center gap-3">
            {genres.map((genre) => (
              <button
                key={genre.id}
                type="button"
                onClick={() => {
                  if (newReleasesLoading) return;

                  selectedGenreRef.current = genre.id;
                  setSelectedGenre(genre.id);
                  setNewReleasesError("");

                  const cachedAlbums = genreCache[genre.id];

                  if (cachedAlbums !== undefined) {
                    setNewReleases(cachedAlbums);
                    setHasFetchedNewReleases(true);
                  } else {
                    setNewReleases([]);
                    setHasFetchedNewReleases(false);

                    void loadCachedGenreReleases(genre.id);
                  }
                }}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition ${selectedGenre === genre.id
                  ? "bg-[#1ed760] text-black"
                  : "bg-[#242424] text-white hover:bg-[#333333]"
                  }`}
              >
                {genre.name}
              </button>
            ))}

            <button
              type="button"
              onClick={() => fetchGenreReleases()}
              disabled={newReleasesLoading}
              className="rounded-lg bg-[#1ed760] px-5 py-3 font-semibold text-black transition hover:bg-[#1bd15a] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {newReleasesLoading
                ? "作品を取得中..."
                : hasFetchedNewReleases
                  ? "作品を再取得"
                  : "作品を取得"}
            </button>

            {hasFetchedNewReleases && newReleases.length > 0 && (
              <p className="text-sm text-zinc-400">
                直近30日間の新着作品を{newReleases.length}件取得しました。
              </p>
            )}
          </div>
        )}

        {activeTab === "search" && (
          <form
            className="mt-8 flex flex-wrap gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              setSelectedArtistId(null);
              searchAlbums();
            }}
          >
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="アーティスト名を入力（例：YOASOBI）"
              className="min-w-0 flex-1 rounded-full border border-white/10 bg-[#242424] px-5 py-3 text-white outline-none focus:border-[#1ed760]"
            />

            <button
              type="submit"
              disabled={loading}
              className="rounded-full bg-[#1ed760] px-6 py-3 font-bold text-black disabled:opacity-50"
            >
              {loading ? "検索中..." : "検索"}
            </button>
          </form>
        )}

        {activeTab === "new-releases" &&
          !hasFetchedNewReleases &&
          !newReleasesLoading &&
          !newReleasesError && (
            <p className="mt-8 text-center text-zinc-400">
              ジャンルを選択して新着作品をチェックしよう。
            </p>
          )}

        {activeTab === "new-releases" && newReleasesLoading && (
          <p className="mt-8 text-center text-zinc-400">
            新着作品を取得中です。しばらくお待ちください。
          </p>
        )}

        {activeTab === "new-releases" && newReleasesError && (
          <p className="mt-4 rounded-lg bg-red-950 p-4 text-red-300">
            {newReleasesError}
          </p>
        )}

        {activeTab === "new-releases" && newReleases.length > 0 && (
          <section className="mt-10">
            <h2 className="mb-5 text-2xl font-bold">
              {genres.find((genre) => genre.id === selectedGenre)?.name} 新着作品
            </h2>

            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <label
                  htmlFor="release-date"
                  className="text-sm text-zinc-300"
                >
                  発売日：
                </label>

                <input
                  id="release-date"
                  type="date"
                  value={selectedReleaseDate}
                  max={todayDate || undefined}
                  onChange={(event) =>
                    setSelectedReleaseDate(event.target.value)
                  }
                  className="w-[175px] rounded-lg border border-white/10 bg-[#242424] px-3 py-2 text-white"
                />

                <button
                  type="button"
                  onClick={() => setSelectedReleaseDate(todayDate)}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition ${selectedReleaseDate === todayDate
                    ? "bg-[#1ed760] text-black"
                    : "bg-[#242424] text-white hover:bg-[#333333]"
                    }`}
                >
                  今日
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedReleaseDate("")}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition ${selectedReleaseDate === ""
                    ? "bg-[#1ed760] text-black"
                    : "bg-[#242424] text-white hover:bg-[#333333]"
                    }`}
                >
                  すべての日付
                </button>
              </div>

              <div className="flex flex-wrap gap-3">
                {[
                  { label: "すべて", value: "all" },
                  { label: "アルバム", value: "album" },
                  { label: "シングル", value: "single" },
                ].map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setNewReleaseType(item.value)}
                    className={`rounded-full px-5 py-2 font-semibold transition ${newReleaseType === item.value
                      ? "bg-[#1ed760] text-black"
                      : "bg-[#242424] text-white hover:bg-[#333333]"
                      }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <p className="mb-4 text-sm text-zinc-400">
              {selectedReleaseDate
                ? selectedReleaseDate.replace(
                  /(\d{4})-(\d{2})-(\d{2})/,
                  "$1年$2月$3日"
                )
                : "すべての日付"}の新着作品：{filteredNewReleases.length}件
            </p>

            {filteredNewReleases.length === 0 && (
              <p className="mb-6 text-center text-zinc-400">
                選択した日付・作品の種類に一致する新着作品はありません。
              </p>
            )}

            <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {filteredNewReleases.map((album) => (
                <a
                  key={album.id}
                  href={album.spotifyUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 rounded-lg bg-[#181818] p-3 transition hover:bg-[#242424]"
                >
                  {album.image ? (
                    <Image
                      src={album.image}
                      alt={`${album.name} のジャケット`}
                      width={300}
                      height={300}
                      unoptimized
                      className="aspect-square w-full rounded-md object-cover"
                    />
                  ) : (
                    <div className="flex aspect-square items-center justify-center rounded-md bg-[#282828] text-zinc-500">
                      No Image
                    </div>
                  )}

                  <h3 className="mt-3 truncate font-semibold">
                    {album.name}
                  </h3>

                  <p className="mt-1 truncate text-sm text-zinc-400">
                    {album.artists.join(", ")}
                  </p>

                  <p className="mt-2 text-xs font-semibold text-[#1ed760]">
                    {album.type === "album" ? "アルバム" : "シングル"}
                  </p>

                  <p className="mt-2 text-sm text-zinc-400">
                    {album.releaseDate}
                  </p>
                </a>
              ))}
            </div>
          </section>
        )}

        {activeTab === "new-releases" &&
          hasFetchedNewReleases &&
          newReleases.length === 0 && (
            <p className="mt-8 text-center text-zinc-400">
              取得した作品はありません。
            </p>
          )}

        {activeTab === "search" && artistCandidates.length > 0 && (
          <div className="mt-6">
            <h2 className="mb-3 text-lg font-bold">
              アーティスト候補
            </h2>

            <div className="flex flex-wrap gap-4">
              {artistCandidates.map((artist) => (
                <button
                  type="button"
                  key={artist.id}
                  disabled={loading}
                  onClick={() => {
                    setSelectedArtistId(artist.id);
                    searchAlbums(artist.id);
                  }}
                  className={`flex items-center gap-3 rounded-lg p-3 disabled:cursor-not-allowed disabled:opacity-50 ${selectedArtistId === artist.id
                    ? "bg-[#1ed760] text-black"
                    : "bg-[#242424] text-white hover:bg-[#333333]"
                    }`}
                >
                  {artist.image ? (
                    <Image
                      src={artist.image}
                      alt={artist.name}
                      width={48}
                      height={48}
                      unoptimized
                      className="h-12 w-12 rounded-full object-cover"
                    />
                  ) : (
                    <div className="h-12 w-12 rounded-full bg-[#333333]" />
                  )}

                  <span className="text-sm font-semibold">
                    {artist.name}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {activeTab === "search" && (
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <label htmlFor="period" className="text-sm text-zinc-300">
              発売期間：
            </label>

            <select
              id="period"
              value={selectedPeriod}
              onChange={(event) => setSelectedPeriod(event.target.value)}
              className="rounded-full border border-white/10 bg-[#242424] px-4 py-2 text-white"
            >
              <option value="all">すべて</option>
              <option value="7">直近7日間</option>
              <option value="30">直近30日間</option>
            </select>

            <label htmlFor="type" className="text-sm text-zinc-300">
              作品の種類：
            </label>

            <select
              id="type"
              value={selectedType}
              onChange={(event) => setSelectedType(event.target.value)}
              className="rounded-full border border-white/10 bg-[#242424] px-4 py-2 text-white"
            >
              <option value="all">すべて</option>
              <option value="album">アルバム</option>
              <option value="single">シングル</option>
            </select>
          </div>
        )}

        {activeTab === "search" && error && (
          <p className="mt-5 rounded-lg bg-red-950 p-4 text-red-300">
            {error}
          </p>
        )}

        {activeTab === "search" && (
          <>
            <p className="mt-6 text-sm text-zinc-400">
              {loading
                ? "検索中..."
                : `表示件数：${filteredAlbums.length}件`}
            </p>

            <h2 className="mt-8 text-xl font-bold">
              アルバム・シングル一覧
            </h2>

            <div className="mt-8 grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {filteredAlbums.map((album) => (
                <a
                  key={album.id}
                  href={album.spotifyUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 rounded-lg bg-[#181818] p-3 transition hover:bg-[#242424]"
                >
                  {album.image ? (
                    <Image
                      src={album.image}
                      alt={`${album.name} のジャケット`}
                      width={300}
                      height={300}
                      unoptimized
                      className="aspect-square w-full rounded-md object-cover"
                    />
                  ) : (
                    <div className="flex aspect-square items-center justify-center rounded-md bg-[#282828] text-zinc-500">
                      No Image
                    </div>
                  )}

                  <h2 className="mt-3 truncate font-semibold">{album.name}</h2>

                  <p className="mt-1 truncate text-sm text-zinc-400">
                    {album.artists.join(", ")}
                  </p>

                  <p className="mt-2 text-xs font-semibold text-[#1ed760]">
                    {album.type === "album" ? "アルバム" : "シングル"}
                  </p>

                  <div className="mt-3 border-t border-white/10 pt-3">
                    <p className="text-xs text-zinc-500">発売日</p>
                    <p className="mt-1 text-sm font-medium text-zinc-300">
                      {album.releaseDate}
                    </p>
                  </div>
                </a>
              ))}
            </div>

            {hasMore && filteredAlbums.length > 0 && (
              <div className="mt-8 flex justify-center">
                <button
                  type="button"
                  onClick={loadMoreAlbums}
                  disabled={loading}
                  className="rounded-full border border-white/20 px-6 py-3 font-semibold text-white transition hover:bg-[#242424] disabled:opacity-50"
                >
                  {loading ? "読み込み中..." : "もっと読み込む"}
                </button>
              </div>
            )}

            {!loading && filteredAlbums.length === 0 && !error && (
              <p className="mt-10 text-center text-zinc-500">
                {!hasSearched
                  ? "アーティスト名を入力して検索してね。"
                  : albums.length === 0
                    ? "検索結果がありません。"
                    : "条件に一致する作品がありません。"}
              </p>
            )}
          </>
        )}
      </div>
    </main >
  );
}
