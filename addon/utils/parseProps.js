// parseProps.js
const urlExists = require("url-exists");

/*
  Utility parsers for TMDB -> Stremio meta transformations
  - Trailer handling updated to include embed URL + externalUrl for Android TV compatibility
  - Keeps backward-compatible fields: id: "youtube:<KEY>", ytId, name/title, site, source
*/

/* -------------------- Basic parsers -------------------- */

function parseCertification(release_dates, language) {
  try {
    const country = language && language.split("-")[1];
    const filtered = release_dates.results.filter(
      (releases) => releases.iso_3166_1 == country
    );
    return filtered[0].release_dates[0].certification;
  } catch (e) {
    return "";
  }
}

function parseCast(credits = {}) {
  if (!credits || !Array.isArray(credits.cast)) return [];
  return credits.cast.slice(0, 5).map((el) => {
    return {
      name: el.name,
      character: el.character,
      photo: el.profile_path
        ? `https://image.tmdb.org/t/p/w276_and_h350_face${el.profile_path}`
        : null,
    };
  });
}

function parseDirector(credits = {}) {
  if (!credits || !Array.isArray(credits.crew)) return [];
  return credits.crew
    .filter((x) => x.job === "Director")
    .map((el) => {
      return el.name;
    });
}

function parseWriter(credits = {}) {
  if (!credits || !Array.isArray(credits.crew)) return [];
  return credits.crew
    .filter((x) => x.job === "Writer")
    .map((el) => {
      return el.name;
    });
}

function parseSlug(type, title, imdb_id) {
  return `${type}/${title
    .toLowerCase()
    .replace(/ /g, "-")
    .replace(/[^a-z0-9\-]/g, "")}-${imdb_id ? imdb_id.replace("tt", "") : ""}`;
}

/* -------------------- Trailer selection -------------------- */

// Keywords that indicate non-trailer content
const EXCLUDE_KEYWORDS = [
  "review",
  "reaction",
  "analysis",
  "breakdown",
  "essay",
  "discussion",
  "shorts",
  "short",
  "scene",
  "clip",
  "fan",
  "spoiler",
  "interview",
  "featurette",
];

function titleHasExcludedKeyword(title = "") {
  const t = String(title).toLowerCase();
  return EXCLUDE_KEYWORDS.some((k) => t.includes(k));
}

function scoreVideoItem(el) {
  let score = 0;
  if (!el) return score;

  if (el.official === true) score += 100;

  if (el.type === "Trailer") score += 50;
  else if (el.type === "Teaser") score += 20;
  else if (el.type === "Featurette") score += 10;

  if (el.name && /trailer/i.test(el.name)) score += 10;

  if (el.size && Number(el.size)) {
    score += Math.min(Number(el.size), 2160) / 10;
  }

  if (el.iso_639_1 && String(el.iso_639_1).toLowerCase() === "en")
    score += 5;

  if (titleHasExcludedKeyword(el.name)) score -= 200;

  return score;
}

// Return parsed trailers prioritized and filtered
function parseTrailers(videos) {
  if (!videos || !Array.isArray(videos.results)) return [];

  // normalize/filter youtube items
  const ytItems = videos.results
    .filter(
      (el) =>
        el &&
        el.site &&
        typeof el.site === "string" &&
        el.site.toLowerCase() === "youtube"
    )
    .filter((el) => el && el.key)
    .map((el) => ({
      raw: el,
      key: String(el.key),
      score: scoreVideoItem(el),
    }))
    .filter((item) => item.score > -100);

  // dedupe by key keeping highest score
  const map = {};
  for (const item of ytItems) {
    if (!map[item.key] || map[item.key].score < item.score) {
      map[item.key] = item;
    }
  }

  const deduped = Object.values(map);

  // sort by score desc
  deduped.sort((a, b) => b.score - a.score);

  // map to expected trailer metadata; include url + externalUrl for Android TV compatibility
  return deduped.map((entry) => {
    const el = entry.raw;
    const key = String(el.key);
    const name = el.name || "Trailer";
    const site = el.site || "YouTube";
    return {
      id: `youtube:${key}`,
      name,
      type: el.type || "Trailer",
      site: site,
      source: key,
      url: `https://www.youtube.com/embed/${key}`, // embed is easier for web/mobile
      externalUrl: `https://www.youtube.com/watch?v=${key}`, // Android TV: open external app
      official: el.official === true,
      size: el.size || null,
      iso_639_1: el.iso_639_1 || null,
      iso_3166_1: el.iso_3166_1 || null,
    };
  });
}

// For playable streams, return minimal structure Stremio expects: title + ytId + url + externalUrl
function parseTrailerStream(videos) {
  if (!videos || !Array.isArray(videos.results)) return [];

  const items = videos.results
    .filter(
      (el) =>
        el &&
        el.site &&
        typeof el.site === "string" &&
        el.site.toLowerCase() === "youtube"
    )
    .filter((el) => el && el.key)
    .map((el) => ({
      raw: el,
      key: String(el.key),
      score: scoreVideoItem(el),
    }))
    .filter((item) => item.score > -100)
    .reduce((acc, item) => {
      if (!acc.map[item.key] || acc.map[item.key].score < item.score) {
        acc.map[item.key] = item;
      }
      return acc;
    }, { map: {} });

  const deduped = Object.values(items.map);

  deduped.sort((a, b) => b.score - a.score);

  return deduped.map((entry) => {
    const el = entry.raw;
    const key = String(el.key);
    return {
      title: el.name || "Trailer",
      ytId: key,
      url: `https://www.youtube.com/embed/${key}`, // primary: embed
      externalUrl: `https://www.youtube.com/watch?v=${key}`, // fallback to open YouTube app on TV
      id: `youtube:${key}`,
    };
  });
}

// optional: still produce external links (kept for compatibility / fallback)
function parseTrailerLinks(videos) {
  if (!videos || !Array.isArray(videos.results)) return [];

  const seen = new Set();
  const links = [];

  for (const el of videos.results) {
    if (!el || !el.key || !el.site) continue;
    if (String(el.site).toLowerCase() !== "youtube") continue;

    const key = el.key;
    if (seen.has(key)) continue;
    seen.add(key);

    const name = el.name || "Trailer";
    links.push({
      name,
      category: "Trailer",
      url: `https://www.youtube.com/embed/${key}`,
      externalUrl: `https://www.youtube.com/watch?v=${key}`,
    });
  }

  return links;
}

/* -------------------- Other link parsers -------------------- */

function parseImdbLink(vote_average, imdb_id) {
  return {
    name: vote_average,
    category: "imdb",
    url: `https://imdb.com/title/${imdb_id}`,
  };
}

function parseShareLink(title, imdb_id, type) {
  return {
    name: title,
    category: "share",
    url: `https://www.strem.io/s/${parseSlug(type, title, imdb_id)}`,
  };
}

function parseGenreLink(genres, type, language) {
  return genres.map((genre) => {
    return {
      name: genre.name,
      category: "Genres",
      url: `stremio:///discover/${encodeURIComponent(
        process.env.HOST_NAME
      )}%2F${language}%2Fmanifest.json/${type}/tmdb.top?genre=${encodeURIComponent(
        genre.name
      )}`,
    };
  });
}

function parseCreditsLink(credits = {}) {
  const castData = parseCast(credits);
  const Cast = castData.map((actor) => {
    return {
      name: actor.name,
      category: "Cast",
      url: `stremio:///search?search=${encodeURIComponent(actor.name)}`,
    };
  });
  const Director = parseDirector(credits).map((director) => {
    return {
      name: director,
      category: "Directors",
      url: `stremio:///search?search=${encodeURIComponent(director)}`,
    };
  });
  const Writer = parseWriter(credits).map((writer) => {
    return {
      name: writer,
      category: "Writers",
      url: `stremio:///search?search=${encodeURIComponent(writer)}`,
    };
  });
  return new Array(...Cast, ...Director, ...Writer);
}

/* -------------------- Misc parsers -------------------- */

function parseCoutry(production_countries = []) {
  return production_countries.map((country) => country.name).join(", ");
}

function parseGenres(genres = []) {
  return genres.map((el) => {
    return el.name;
  });
}

function parseYear(status, first_air_date, last_air_date) {
  if (status === "Ended") {
    return first_air_date && last_air_date
      ? first_air_date.substr(0, 5) + last_air_date.substr(0, 4)
      : "";
  } else {
    return first_air_date ? first_air_date.substr(0, 5) : "";
  }
}

function parseRunTime(runtime) {
  if (runtime === 0 || !runtime) {
    return "";
  }

  const hours = Math.floor(runtime / 60);
  const minutes = runtime % 60;

  if (runtime > 60) {
    return hours > 0 ? `${hours}h${minutes}min` : `${minutes}min`;
  } else {
    return `${runtime}min`;
  }
}

function parseCreatedBy(created_by = []) {
  return Array.isArray(created_by) ? created_by.map((el) => el.name) : [];
}

/* -------------------- Config / poster helpers -------------------- */

function parseConfig(catalogChoices) {
  let config = {};
  try {
    config = JSON.parse(catalogChoices);
  } catch (e) {
    if (catalogChoices) {
      config.language = catalogChoices;
    }
  }
  return config;
}

async function parsePoster(type, id, poster, language, rpdbkey) {
  const tmdbImage = `https://image.tmdb.org/t/p/w500${poster}`;
  if (rpdbkey) {
    const rpdbImage = getRpdbPoster(type, id, language, rpdbkey);
    const exists = await checkIfExists(rpdbImage);
    return exists ? rpdbImage : tmdbImage;
  }
  return tmdbImage;
}

function parseMedia(el, type, genreList = []) {
  const genres = Array.isArray(el.genre_ids)
    ? el.genre_ids.map(
        (genre) => genreList.find((x) => x.id === genre)?.name || "Unknown"
      )
    : [];

  return {
    id: `tmdb:${el.id}`,
    name: type === "movie" ? el.title : el.name,
    genre: genres,
    poster: `https://image.tmdb.org/t/p/w500${el.poster_path}`,
    background: `https://image.tmdb.org/t/p/original${el.backdrop_path}`,
    posterShape: "regular",
    imdbRating: el.vote_average ? el.vote_average.toFixed(1) : "N/A",
    year:
      type === "movie"
        ? el.release_date
          ? el.release_date.substr(0, 4)
          : ""
        : el.first_air_date
        ? el.first_air_date.substr(0, 4)
        : "",
    type: type === "movie" ? type : "series",
    description: el.overview,
  };
}

function getRpdbPoster(type, id, language, rpdbkey) {
  const tier = rpdbkey.split("-")[0];
  const lang = language.split("-")[0];
  if (tier === "t0" || tier === "t1" || lang === "en") {
    return `https://api.ratingposterdb.com/${rpdbkey}/tmdb/poster-default/${type}-${id}.jpg?fallback=true`;
  } else {
    return `https://api.ratingposterdb.com/${rpdbkey}/tmdb/poster-default/${type}-${id}.jpg?fallback=true&lang=${lang}`;
  }
}

function parseMDBListItemsToStremioItems(data) {
  const results = [];

  if (data.movies) {
    for (const m of data.movies) {
      results.push({
        id: String(m.id),
        type: "movie",
        name: m.title,
        year: m.release_year,
        imdb_id: m.imdb_id || undefined,
      });
    }
  }

  if (data.shows) {
    for (const s of data.shows) {
      results.push({
        id: String(s.id),
        type: "series",
        name: s.title,
        year: s.release_year,
        imdb_id: s.imdb_id || undefined,
      });
    }
  }

  return results;
}

/* -------------------- Existence check (rpdb) -------------------- */

async function checkIfExists(rpdbImage) {
  return new Promise((resolve) => {
    urlExists(rpdbImage, (err, exists) => {
      if (exists) {
        resolve(true);
      } else {
        resolve(false);
      }
    });
  });
}

/* -------------------- Exports -------------------- */

module.exports = {
  parseCertification,
  parseCast,
  parseDirector,
  parseSlug,
  parseWriter,
  parseTrailers,
  parseTrailerStream,
  parseTrailerLinks,
  parseImdbLink,
  parseShareLink,
  parseGenreLink,
  parseCreditsLink,
  parseCoutry,
  parseGenres,
  parseYear,
  parseRunTime,
  parseCreatedBy,
  parseConfig,
  parsePoster,
  parseMedia,
  getRpdbPoster,
  parseMDBListItemsToStremioItems,
  checkIfExists,
};
