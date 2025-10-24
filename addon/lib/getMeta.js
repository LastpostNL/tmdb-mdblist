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
    console.error(`Error fetching IMDb rating for ${imdbId}:`, err.message);
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

// Build clickable YouTube trailer links in Markdown
const buildTrailerLinks = (trailerStreams) => {
  if (!trailerStreams || trailerStreams.length === 0) return "";
  return trailerStreams
    .map(t => `- [${t.title}](https://www.youtube.com/watch?v=${t.ytId})`)
    .join("\n");
};

// Build full summary with directors, cast, overview, and trailers
const buildSummaryWithTrailers = (overview, directors, cast, trailerStreams) => {
  const directorLine = directors && directors.length ? `Director${directors.length > 1 ? 's' : ''}: ${directors.join(', ')}` : '';
  const castLine = cast && cast.length ? `Cast: ${cast.join(', ')}` : '';
  const trailerLines = trailerStreams && trailerStreams.length
    ? 'Trailers:\n' + trailerStreams.map(t => `- [${t.title}](https://www.youtube.com/watch?v=${t.ytId})`).join('\n')
    : '';
  return [directorLine, castLine, overview || '', trailerLines].filter(Boolean).join('\n\n');
};

// Ensure videos exist for language fallback
async function ensureVideosForLanguage(res, tmdbId, isMovie = true) {
  try {
    const hasVideos = res && res.videos && Array.isArray(res.videos.results) && res.videos.results.length > 0;
    if (hasVideos) return;

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
      console.warn(`Error fetching logo for movie ${tmdbId}:`, e.message);
      return null;
    }),
    getCachedImdbRating(res.external_ids?.imdb_id, type),
  ]);

  const imdbRating = imdbRatingRaw || res.vote_average?.toFixed(1) || "N/A";

  await ensureVideosForLanguage(res, tmdbId, true);

  const parsedTrailers = Utils.parseTrailers(res.videos);
  const parsedTrailerStreams = Utils.parseTrailerStream(res.videos);

  const directors = Utils.parseDirector(res.credits);
  const cast = Utils.parseCast(res.credits);

  const summaryWithTrailers = buildSummaryWithTrailers(
    res.overview,
    directors,
    cast,
    parsedTrailerStreams
  );

  return {
    imdb_id: res.imdb_id,
    country: Utils.parseCoutry(res.production_countries),
    description: res.overview,
    director: directors,
    genre: Utils.parseGenres(res.genres),
    imdbRating,
    name: res.title,
    released: new Date(res.release_date),
    slug: Utils.parseSlug(type, res.title, res.imdb_id),
    type,
    writer: Utils.parseWriter(res.credits),
    year: res.release_date ? res.release_date.substr(0, 4) : "",
    summary: summaryWithTrailers,
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
      cast
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
      console.warn(`Error fetching logo for TV ${tmdbId}:`, e.message);
      return null;
    }),
    getCachedImdbRating(res.external_ids?.imdb_id, type),
    getEpisodes(language, tmdbId, res.external_ids?.imdb_id, res.seasons, {
      hideEpisodeThumbnails: config.hideEpisodeThumbnails
    }).catch(e => {
      console.warn(`Error fetching episodes for TV ${tmdbId}:`, e.message);
      return [];
    })
  ]);

  const imdbRating = imdbRatingRaw || res.vote_average?.toFixed(1) || "N/A";

  await ensureVideosForLanguage(res, tmdbId, false);

  const parsedTrailers = Utils.parseTrailers(res.videos);
  const parsedTrailerStreams = Utils.parseTrailerStream(res.videos);

  const directors = Utils.parseDirector(res.credits);
  const cast = Utils.parseCast(res.credits);

  const summaryWithTrailers = buildSummaryWithTrailers(
    res.overview,
    directors,
    cast,
    parsedTrailerStreams
  );

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
    summary: summaryWithTrailers,
    behaviorHints: {
      defaultVideoId: null,
      hasScheduledVideos: true
    },
    logo: processLogo(logo),
    director: directors,
    app_extras: { cast }
  };
};

// Main function
async function getMeta(type, language, tmdbId, rpdbkey, config = {}) {
  const cacheKey = getCacheKey(type, language, tmdbId, rpdbkey);
  const cachedData = cache.get(cacheKey);
  
  if (cachedData && (Date.now() - cachedData.timestamp) < CACHE_TTL) {
    return { meta: cachedData.data };
  }

  try {
    const meta = await (type === "movie" ? 
      fetchMovieData(tmdbId, language).then(res => buildMovieResponse(res, type, language, tmdbId, rpdbkey)) :
      fetchTvData(tmdbId, language).then(res => buildTvResponse(res, type, language, tmdbId, rpdbkey, config))
    );

    cache.set(cacheKey, { data: meta, timestamp: Date.now() });
    return { meta };
  } catch (error) {
    console.error(`Error in getMeta: ${error.message}`);
    throw error;
  }
}

module.exports = { getMeta };
