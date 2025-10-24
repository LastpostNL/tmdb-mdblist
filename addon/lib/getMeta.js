// addon/lib/getMeta.js
require("dotenv").config();
const { MovieDb } = require("moviedb-promise");
const Utils = require("../utils/parseProps");
const moviedb = new MovieDb(process.env.TMDB_API);
const { getEpisodes } = require("./getEpisodes");
const { getLogo, getTvLogo } = require("./getLogo");
const { getImdbRating } = require("./getImdbRating");

// Configuration
const CACHE_TTL = 1000 * 60 * 60; // 1 hour
const blacklistLogoUrls = [
  "https://assets.fanart.tv/fanart/tv/0/hdtvlogo/-60a02798b7eea.png",
];

// Caches
const cache = new Map();
const imdbCache = new Map();

async function getCachedImdbRating(imdbId, type) {
  if (!imdbId) return null;
  if (imdbCache.has(imdbId)) return imdbCache.get(imdbId);
  try {
    const rating = await getImdbRating(imdbId, type);
    imdbCache.set(imdbId, rating);
    return rating;
  } catch (err) {
    console.error(`❌ Error fetching IMDb rating for ${imdbId}:`, err.message);
    return null;
  }
}

const getCacheKey = (type, language, tmdbId, rpdbkey) =>
  `${type}-${language}-${tmdbId}-${rpdbkey}`;

const processLogo = (logo) => {
  if (!logo || blacklistLogoUrls.includes(logo)) return null;
  return logo.replace("http://", "https://");
};

const buildLinks = (imdbRating, imdbId, title, type, genres, credits, language) => [
  Utils.parseImdbLink(imdbRating, imdbId),
  Utils.parseShareLink(title, imdbId, type),
  ...Utils.parseGenreLink(genres, type, language),
  ...Utils.parseCreditsLink(credits),
];

// Fallback video fetch (for trailer availability)
async function ensureVideosForLanguage(res, tmdbId, isMovie = true) {
  try {
    const hasVideos =
      res && res.videos && Array.isArray(res.videos.results) && res.videos.results.length > 0;
    if (hasVideos) return;

    const fallbackLang = "en-US";
    if (isMovie && typeof moviedb.movieVideos === "function") {
      const videosRes = await moviedb.movieVideos({ id: tmdbId, language: fallbackLang });
      if (videosRes && Array.isArray(videosRes.results) && videosRes.results.length > 0)
        res.videos = videosRes;
    } else if (!isMovie && typeof moviedb.tvVideos === "function") {
      const videosRes = await moviedb.tvVideos({ id: tmdbId, language: fallbackLang });
      if (videosRes && Array.isArray(videosRes.results) && videosRes.results.length > 0)
        res.videos = videosRes;
    }
  } catch (e) {
    console.warn(`⚠️ Fallback video fetch failed for ${tmdbId}:`, e.message);
  }
}

/* -------------------- MOVIE -------------------- */

const fetchMovieData = async (tmdbId, language) => {
  return await moviedb.movieInfo({
    id: tmdbId,
    language,
    append_to_response: "videos,credits,external_ids",
  });
};

const buildMovieResponse = async (res, type, language, tmdbId, rpdbkey) => {
  const [poster, logo, imdbRatingRaw] = await Promise.all([
    Utils.parsePoster(type, tmdbId, res.poster_path, language, rpdbkey),
    getLogo(tmdbId, language, res.original_language).catch((e) => {
      console.warn(`⚠️ Error fetching logo for movie ${tmdbId}:`, e.message);
      return null;
    }),
    getCachedImdbRating(res.external_ids?.imdb_id, type),
  ]);

  const imdbRating = imdbRatingRaw || res.vote_average?.toFixed(1) || "N/A";
  const imdbId = res.external_ids?.imdb_id || res.imdb_id || null;

  // Fallback videos
  await ensureVideosForLanguage(res, tmdbId, true);

  // Parse trailers and trailerStreams
const parsedTrailers = (res.videos?.results || [])
  .filter(v => v.site === "YouTube" && v.key)
  .map(v => ({
    name: v.name || "Trailer",
    externalUrl: `https://www.youtube.com/watch?v=${v.key}` // belangrijk!
  }));

// Laat trailerStreams leeg voor Android TV
const parsedTrailerStreams = [];

  return {
    id: `tmdb:${tmdbId}`,
    type,
    name: res.title,
    imdb_id: imdbId,
    imdbRating,
    description: res.overview,
    genre: Utils.parseGenres(res.genres),
    genres: Utils.parseGenres(res.genres),
    director: Utils.parseDirector(res.credits),
    writer: Utils.parseWriter(res.credits),
    released: res.release_date ? new Date(res.release_date) : null,
    releaseInfo: res.release_date ? res.release_date.substr(0, 4) : "",
    year: res.release_date ? res.release_date.substr(0, 4) : "",
    runtime: Utils.parseRunTime(res.runtime),
    country: Utils.parseCoutry(res.production_countries),
    slug: Utils.parseSlug(type, res.title, imdbId),
    poster,
    background: res.backdrop_path
      ? `https://image.tmdb.org/t/p/original${res.backdrop_path}`
      : null,
    logo: processLogo(logo),
    trailers: parsedTrailers, // web + mobile
    trailerStreams: parsedTrailerStreams, // Android TV
    links: buildLinks(imdbRating, imdbId, res.title, type, res.genres, res.credits, language),
    behaviorHints: {
      defaultVideoId: imdbId ? imdbId : `tmdb:${tmdbId}`,
      hasScheduledVideos: false,
    },
    app_extras: {
      cast: Utils.parseCast(res.credits),
    },
  };
};

/* -------------------- TV SHOW -------------------- */

const fetchTvData = async (tmdbId, language) => {
  return await moviedb.tvInfo({
    id: tmdbId,
    language,
    append_to_response: "videos,credits,external_ids",
  });
};

const buildTvResponse = async (res, type, language, tmdbId, rpdbkey, config) => {
  const runtime =
    res.episode_run_time?.[0] ??
    res.last_episode_to_air?.runtime ??
    res.next_episode_to_air?.runtime ??
    null;

  const [poster, logo, imdbRatingRaw, episodes] = await Promise.all([
    Utils.parsePoster(type, tmdbId, res.poster_path, language, rpdbkey),
    getTvLogo(res.external_ids?.tvdb_id, res.id, language, res.original_language).catch((e) => {
      console.warn(`⚠️ Error fetching logo for show ${tmdbId}:`, e.message);
      return null;
    }),
    getCachedImdbRating(res.external_ids?.imdb_id, type),
    getEpisodes(language, tmdbId, res.external_ids?.imdb_id, res.seasons, {
      hideEpisodeThumbnails: config.hideEpisodeThumbnails,
    }).catch((e) => {
      console.warn(`⚠️ Error fetching episodes for show ${tmdbId}:`, e.message);
      return [];
    }),
  ]);

  const imdbRating = imdbRatingRaw || res.vote_average?.toFixed(1) || "N/A";
  const imdbId = res.external_ids?.imdb_id || null;

await ensureVideosForLanguage(res, tmdbId, false);

const parsedTrailers = (res.videos?.results || [])
  .filter(v => v.site === "YouTube" && v.key)
  .map(v => ({
    name: v.name || "Trailer",
    externalUrl: `https://www.youtube.com/watch?v=${v.key}`
  }));

const parsedTrailerStreams = []; // Android TV: open in externe YouTube-app

  return {
    id: `tmdb:${tmdbId}`,
    type,
    name: res.name,
    imdb_id: imdbId,
    imdbRating,
    description: res.overview,
    genre: Utils.parseGenres(res.genres),
    genres: Utils.parseGenres(res.genres),
    writer: Utils.parseCreatedBy(res.created_by),
    released: res.first_air_date ? new Date(res.first_air_date) : null,
    releaseInfo: Utils.parseYear(res.status, res.first_air_date, res.last_air_date),
    year: Utils.parseYear(res.status, res.first_air_date, res.last_air_date),
    runtime: Utils.parseRunTime(runtime),
    country: Utils.parseCoutry(res.production_countries),
    status: res.status,
    slug: Utils.parseSlug(type, res.name, imdbId),
    poster,
    background: res.backdrop_path
      ? `https://image.tmdb.org/t/p/original${res.backdrop_path}`
      : null,
    logo: processLogo(logo),
    videos: episodes || [],
    trailers: parsedTrailers,
    trailerStreams: parsedTrailerStreams,
    links: buildLinks(imdbRating, imdbId, res.name, type, res.genres, res.credits, language),
    behaviorHints: {
      defaultVideoId: null,
      hasScheduledVideos: true,
    },
    app_extras: {
      cast: Utils.parseCast(res.credits),
    },
  };
};

/* -------------------- MAIN FUNCTION -------------------- */

async function getMeta(type, language, tmdbId, rpdbkey, config = {}) {
  const cacheKey = getCacheKey(type, language, tmdbId, rpdbkey);
  const cachedData = cache.get(cacheKey);

  if (cachedData && Date.now() - cachedData.timestamp < CACHE_TTL) {
    return { meta: cachedData.data };
  }

  try {
    const meta =
      type === "movie"
        ? await fetchMovieData(tmdbId, language).then((res) =>
            buildMovieResponse(res, type, language, tmdbId, rpdbkey)
          )
        : await fetchTvData(tmdbId, language).then((res) =>
            buildTvResponse(res, type, language, tmdbId, rpdbkey, config)
          );

    cache.set(cacheKey, { data: meta, timestamp: Date.now() });
    return { meta };
  } catch (error) {
    console.error(`❌ Error in getMeta(${type}:${tmdbId}): ${error.message}`);
    throw error;
  }
}

module.exports = { getMeta };
