"use client";

import { useEffect, useState } from "react";

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

const genreArtists: Record<string, string[]> = {
  hiphop: [
    "MIKADO",
    "LEX",
    "Watson",
    "¥ellow Bucks",
  ],
  jpop: [],
  rnb: [],
  rock: [],
};
const hiphopArtists = genreArtists.hiphop;

const genres = [
  { id: "hiphop", name: "HIPHOP" },
  { id: "jpop", name: "J-POP" },
  { id: "rnb", name: "R&B" },
  { id: "rock", name: "ロック" },
];

export default function Home() {
  const [activeTab, setActiveTab] = useState("new-releases");
  const [selectedGenre, setSelectedGenre] = useState("hiphop");
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
  const [hasMore, setHasMore] = useState(false);
  const [artistCandidates, setArtistCandidates] = useState<ArtistCandidate[]>([]);
  const [selectedArtistId, setSelectedArtistId] = useState<string | null>(null);

  useEffect(() => {
    const today = new Date();
    const localDate = new Date(
      today.getTime() - today.getTimezoneOffset() * 60000
    );
    const dateString = localDate.toISOString().slice(0, 10);

    setTodayDate(dateString);
    setSelectedReleaseDate(dateString);
  }, []);

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
          let offset = 0;
          const maxPages = 2;

          for (let page = 0; page < maxPages; page++) {
            const params = new URLSearchParams({
              q: artistName,
              releaseGroup,
              offset: String(offset),
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
              break;
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

            // 次のページを取得するためにoffsetを更新
            offset += data.fetchedCount;

            // 続きがない場合は繰り返しを終了
            if (!data.hasMore || data.fetchedCount === 0) {
              break;
            }

            // Spotify APIへの連続アクセスを少し抑える
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }
      }

      const uniqueReleases = Array.from(
        new Map(allReleases.map((album) => [album.id, album])).values()
      );

      uniqueReleases.sort((a, b) =>
        b.releaseDate.localeCompare(a.releaseDate)
      );

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const thirtyDaysAgo = new Date(today);
      thirtyDaysAgo.setDate(today.getDate() - 30);

      const recentReleases = uniqueReleases.filter((album) => {
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
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-start lg:gap-16">
          <div className="shrink-0">
            <p className="text-sm font-bold uppercase tracking-widest text-[#1ed760]">
              Spotify Music Discovery
            </p>

            <h1 className="mt-3 text-4xl font-bold">
              Music Discovery
            </h1>
          </div>
        </div>

        <div className="mt-8 flex gap-3 border-b border-white/10 pb-3">
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
        </div>

        {activeTab === "new-releases" && (
          <div className="mt-6 flex flex-wrap items-center gap-3">
            {genres.map((genre) => (
              <button
                key={genre.id}
                type="button"
                onClick={() => {
                  if (newReleasesLoading) return;

                  setSelectedGenre(genre.id);
                  setNewReleasesError("");

                  const cachedAlbums = genreCache[genre.id];

                  if (cachedAlbums !== undefined) {
                    setNewReleases(cachedAlbums);
                    setHasFetchedNewReleases(true);
                  } else {
                    setNewReleases([]);
                    setHasFetchedNewReleases(false);
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
          </>
        )}
      </div>
    </main >
  );
}
