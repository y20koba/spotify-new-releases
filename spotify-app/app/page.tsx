"use client";

import { useState } from "react";

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

const hiphopArtists = [
  "MIKADO",
  "LEX",
  "Watson",
  "¥ellow Bucks",
];

export default function Home() {
  const [query, setQuery] = useState("");
  const [albums, setAlbums] = useState<SpotifyAlbum[]>([]);
  const [newReleases, setNewReleases] = useState<SpotifyAlbum[]>([]);
  const [hasFetchedNewReleases, setHasFetchedNewReleases] = useState(false);
  const [newReleasesLoading, setNewReleasesLoading] = useState(false);
  const [newReleasesError, setNewReleasesError] = useState("");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState("all");
  const [selectedType, setSelectedType] = useState("all");
  const [hasMore, setHasMore] = useState(false);
  const [artistCandidates, setArtistCandidates] = useState<ArtistCandidate[]>([]);
  const [selectedArtistId, setSelectedArtistId] = useState<string | null>(null);

  async function searchAlbums(artistId?: string) {
    const keyword = query.trim();

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

  async function fetchNewReleases() {
    setNewReleases([]);
    setHasFetchedNewReleases(false);
    setNewReleasesLoading(true);
    setNewReleasesError("");

    try {
      const allReleases: SpotifyAlbum[] = [];
      const failedArtists: string[] = [];

      for (const artistName of hiphopArtists) {
        console.log("新着作品を取得するアーティスト:", artistName);

        await new Promise((resolve) => setTimeout(resolve, 1000));

        const artistIds: Record<string, string> = {
          LEX: "2KpK4apOMD6evPHoPggSVF",
        };

        for (const releaseGroup of ["album", "single"]) {
          const params = new URLSearchParams({
            q: artistName,
            releaseGroup,
          });

          if (artistIds[artistName]) {
            params.set("artistId", artistIds[artistName]);
          }

          const response = await fetch(
            `/api/spotify-search?${params.toString()}`
          );

          if (!response.ok) {
            const errorData = await response.json();

            console.warn(`${artistName} の${releaseGroup}取得に失敗`, {
              status: response.status,
              details: errorData.details,
              retryAfter: errorData.retryAfter,
            });

            if (response.status === 429) {
              const retryAfter = Number(errorData.retryAfter);

              const waitMessage =
                errorData.retryAfter != null &&
                  Number.isFinite(retryAfter) &&
                  retryAfter > 0
                  ? `約${Math.ceil(retryAfter / 60)}分後に再度お試しください。`
                  : "時間を空けて再度お試しください。";

              setNewReleasesError(
                `Spotify APIの利用制限に達しました。${waitMessage}`
              );
              return;
            }

            failedArtists.push(`${artistName} (${releaseGroup})`);
            continue;
          }

          const data = await response.json();

          console.log(`${artistName} の${releaseGroup}取得結果:`, {
            fetchedCount: data.fetchedCount,
            hasMore: data.hasMore,
            albums: (data.albums ?? []).map((album: SpotifyAlbum) => ({
              name: album.name,
              releaseDate: album.releaseDate,
            })),
          });

          allReleases.push(...(data.albums ?? []));

          // Spotify APIへの連続アクセスを少し抑える
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      allReleases.sort((a, b) =>
        b.releaseDate.localeCompare(a.releaseDate)
      );

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const thirtyDaysAgo = new Date(today);
      thirtyDaysAgo.setDate(today.getDate() - 30);

      const recentReleases = allReleases.filter((album) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(album.releaseDate)) {
          return false;
        }

        const releaseDate = new Date(`${album.releaseDate}T00:00:00`);

        return releaseDate >= thirtyDaysAgo && releaseDate <= today;
      });

      setNewReleases(recentReleases);
      setHasFetchedNewReleases(true);

      if (failedArtists.length > 0) {
        setNewReleasesError(
          `一部のアーティストの作品を取得できませんでした：${failedArtists.join(", ")}`
        );
      }

    } catch (err) {
      console.error("新着作品の取得中にエラーが発生しました:", err);
      setNewReleasesError("新着作品の取得中にエラーが発生しました。");
    } finally {
      setNewReleasesLoading(false);
    }
  }

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
        <p className="text-sm font-bold uppercase tracking-widest text-[#1ed760]">
          Spotify Music Discovery
        </p>

        <h1 className="mt-3 text-4xl font-bold">
          Spotify Album Search
        </h1>

        <p className="mt-3 text-zinc-400">
          アーティスト名を検索して、アルバムや楽曲をチェックしよう。
        </p>

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

        <div className="mt-6">
          <button
            type="button"
            onClick={fetchNewReleases}
            disabled={newReleasesLoading}
            className="rounded-full bg-[#1ed760] px-6 py-3 font-bold text-black transition hover:bg-[#1bd15a] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {newReleasesLoading
              ? "新着作品を取得中..."
              : "HIPHOPの新着作品を取得"}
          </button>
        </div>

        {newReleasesError && (
          <p className="mt-4 rounded-lg bg-red-950 p-4 text-red-300">
            {newReleasesError}
          </p>
        )}

        {newReleases.length > 0 && (
          <section className="mt-10">
            <h2 className="mb-5 text-2xl font-bold">
              HIPHOP 新着作品
            </h2>

            <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {newReleases.map((album) => (
                <a
                  key={album.id}
                  href={album.spotifyUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 rounded-lg bg-[#181818] p-3 transition hover:bg-[#242424]"
                >
                  {album.image ? (
                    <img
                      src={album.image}
                      alt={`${album.name} のジャケット`}
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

        {hasFetchedNewReleases && newReleases.length === 0 && (
          <p className="mt-8 text-center text-zinc-400">
            直近30日間の新着作品はありません。
          </p>
        )}

        {artistCandidates.length > 0 && (
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
                    <img
                      src={artist.image}
                      alt={artist.name}
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

        {error && (
          <p className="mt-5 rounded-lg bg-red-950 p-4 text-red-300">
            {error}
          </p>
        )}

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
                <img
                  src={album.image}
                  alt={`${album.name} のジャケット`}
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
      </div>
    </main>
  );
}
