require("dotenv").config();
const { MovieDb } = require("moviedb-promise");
const Utils = require("../utils/parseProps");
const moviedb = new MovieDb(process.env.TMDB_API);
const { getEpisodes } = require("./getEpisodes");
const { getLogo, getTvLogo } = require("./getLogo");
const { getImdbRating } = require("./getImdbRating");

// Configuration
const CACHE_TTL = 1000 * 60 * 60; // 1 hour
const blacklistLogoUrls = [ "https://assets.fanart.tv/fanart/tv/0/hdtvlogo/-60a02798b7eea.png" ];

// Cache
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
    console.error(`Erro ao buscar IMDb rating para ${imdbId}:`, err.message);
    return null;
  }
}

// Helper functions
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
  ...Utils.parseCreditsLink(credits)
];

// If videos are empty for the requested language, try a fallback to en-US and use those videos.
// This improves trailer availability when TMDB only has trailers in en-US.
async function ensureVideosForLanguage(res, tmdbId, isMovie = true) {
  try {
    const hasVideos = res && res.videos && Array.isArray(res.videos.results) && res.videos.results.length > 0;
    if (hasVideos) return;

    // Fetch videos explicitly in en-US as a fallback
    if (isMovie && typeof moviedb.movieVideos === "function") {
      const videosRes = await moviedb.movieVideos({ id: tmdbId, language: "en-US" });
      if (videosRes && Array.isArray(videosRes.results) && videosRes.results.length > 0) {
        res.videos = videosRes;
      }
    } else if (!isMovie && typeof moviedb.tvVideos === "function") {
      const videosRes = await moviedb.tvVideos({ id: tmdbId, language: "en-US" });
      if (videosRes && Array.isArray(videosRes.results) && videosRes.results.length > 0) {
        res.videos = videosRes;
      }
    }
  } catch (e) {
    // Do not fail the meta call just because fallback failed; log for debugging.
    console.warn(`Fallback video fetch failed for ${tmdbId}:`, e.message);
  }
}

// Movie specific functions
const fetchMovieData = async (tmdbId, language) => {
  return await moviedb.movieInfo({
    id: tmdbId,
    language,
    append_to_response: "videos,credits,external_ids"
  });
};

const buildMovieResponse = async (res, type, language, tmdbId, rpdbkey) => {
  const [poster, logo, imdbRatingRaw] = await Promise.all([
    Utils.parsePoster(type, tmdbId, res.poster_path, language, rpdbkey),
    getLogo(tmdbId, language, res.original_language).catch(e => {
      console.warn(`Erro ao buscar logo para filme ${tmdbId}:`, e.message);
      return null;
    }),
    getCachedImdbRating(res.external_ids?.imdb_id, type),
  ]);

  const imdbRating = imdbRatingRaw || res.vote_average?.toFixed(1) || "N/A";

  // Ensure videos exist (fallback to en-US if needed) before parsing trailers
  await ensureVideosForLanguage(res, tmdbId, true);

  // Parse trailers and trailerStreams (no direct youtube.com URLs in trailerStreams)
  const parsedTrailers = (res.videos?.results || [])
    .filter((v) => v.site === "YouTube" && v.key)
    .map((v) => ({
      name: v.name || "Trailer",
      externalUrl: `https://www.youtube.com/watch?v=${v.key}`,
    }));

  const parsedTrailerStreams = []; // Android TV: open in external YouTube app

  return {
    imdb_id: res.imdb_id,
    country: Utils.parseCoutry(res.production_countries),
    description: res.overview,
    director: Utils.parseDirector(res.credits),
    genre: Utils.parseGenres(res.genres),
    imdbRating,
    name: res.title,
    released: new Date(res.release_date),
    slug: Utils.parseSlug(type, res.title, res.imdb_id),
    type,
    writer: Utils.parseWriter(res.credits),
    year: res.release_date ? res.release_date.substr(0, 4) : "",
    // Provide trailers + trailerStreams where trailerStreams contain {title, ytId}
    trailers: parsedTrailers,
    trailerStreams: parsedTrailerStreams,
    background: `https://image.tmdb.org/t/p/original${res.backdrop_path}`,
    poster,
    runtime: Utils.parseRunTime(res.runtime),
    id: `tmdb:${tmdbId}`,
    genres: Utils.parseGenres(res.genres),
    releaseInfo: res.release_date ? res.release_date.substr(0, 4) : "",
    links: buildLinks(imdbRating, res.imdb_id, res.title, type, res.genres, res.credits, language),
    behaviorHints: {
      defaultVideoId: res.imdb_id ? res.imdb_id : `tmdb:${res.id}`,
      hasScheduledVideos: false
    },
    logo: processLogo(logo),
    app_extras: {
      cast: Utils.parseCast(res.credits)
    }
  };
};

// TV show specific functions
const fetchTvData = async (tmdbId, language) => {
  return await moviedb.tvInfo({
    id: tmdbId,
    language,
    append_to_response: "videos,credits,external_ids"
  });
};

const buildTvResponse = async (res, type, language, tmdbId, rpdbkey, config) => {
  const runtime = res.episode_run_time?.[0] ?? res.last_episode_to_air?.runtime ?? res.next_episode_to_air?.runtime ?? null;

  const [poster, logo, imdbRatingRaw, episodes] = await Promise.all([
    Utils.parsePoster(type, tmdbId, res.poster_path, language, rpdbkey),
    getTvLogo(res.external_ids?.tvdb_id, res.id, language, res.original_language).catch(e => {
      console.warn(`Erro ao buscar logo para série ${tmdbId}:`, e.message);
      return null;
    }),
    getCachedImdbRating(res.external_ids?.imdb_id, type),
    getEpisodes(language, tmdbId, res.external_ids?.imdb_id, res.seasons, {
      hideEpisodeThumbnails: config.hideEpisodeThumbnails
    }).catch(e => {
      console.warn(`Erro ao buscar episódios da série ${tmdbId}:`, e.message);
      return [];
    })
  ]);

  const imdbRating = imdbRatingRaw || res.vote_average?.toFixed(1) || "N/A";

  // Ensure videos exist (fallback to en-US if needed) before parsing trailers
  await ensureVideosForLanguage(res, tmdbId, false);

  const parsedTrailers = (res.videos?.results || [])
    .filter((v) => v.site === "YouTube" && v.key)
    .map((v) => ({
      name: v.name || "Trailer",
      externalUrl: `https://www.youtube.com/watch?v=${v.key}`,
    }));

  const parsedTrailerStreams = []; // Android TV: open in external YouTube app

  return {
    country: Utils.parseCoutry(res.production_countries),
    description: res.overview,
    genre: Utils.parseGenres(res.genres),
    imdbRating,
    imdb_id: res.external_ids.imdb_id,
    name: res.name,
    poster,
    released: new Date(res.first_air_date),
    runtime: Utils.parseRunTime(runtime),
    status: res.status,
    type,
    writer: Utils.parseCreatedBy(res.created_by),
    year: Utils.parseYear(res.status, res.first_air_date, res.last_air_date),
    background: `https://image.tmdb.org/t/p/original${res.backdrop_path}`,
    slug: Utils.parseSlug(type, res.name, res.external_ids.imdb_id),
    id: `tmdb:${tmdbId}`,
    genres: Utils.parseGenres(res.genres),
    releaseInfo: Utils.parseYear(res.status, res.first_air_date, res.last_air_date),
    videos: episodes || [],
    links: buildLinks(imdbRating, res.external_ids.imdb_id, res.name, type, res.genres, res.credits, language),
    trailers: parsedTrailers,
    trailerStreams: parsedTrailerStreams,
    behaviorHints: {
      defaultVideoId: null,
      hasScheduledVideos: true
    },
    logo: processLogo(logo),
    app_extras: {
      cast: Utils.parseCast(res.credits)
    }
  };
};

// Main function
async function getMeta(type, language, tmdbId, rpdbkey, config = {}) {
  const cacheKey = getCacheKey(type, language, tmdbId, rpdbkey);
  const cachedData = cache.get(cacheKey);
  
  if (cachedData && (Date.now() - cachedData.timestamp) < CACHE_TTL) {
    return Promise.resolve({ meta: cachedData.data });
  }

  try {
    const meta = await (type === "movie" ? 
      fetchMovieData(tmdbId, language).then(res => buildMovieResponse(res, type, language, tmdbId, rpdbkey)) :
      fetchTvData(tmdbId, language).then(res => buildTvResponse(res, type, language, tmdbId, rpdbkey, config))
    );

    cache.set(cacheKey, { data: meta, timestamp: Date.now() });
    return Promise.resolve({ meta });
  } catch (error) {
    console.error(`Error in getMeta: ${error.message}`);
    throw error;
  }
}

module.exports = { getMeta };
