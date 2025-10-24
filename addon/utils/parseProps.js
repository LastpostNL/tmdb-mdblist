const urlExists = require("url-exists");

function parseCertification(release_dates, language) {
  return release_dates.results.filter(
    (releases) => releases.iso_3166_1 == language.split("-")[1]
  )[0].release_dates[0].certification;
}

function parseCast(credits) {
  return credits.cast.slice(0, 5).map((el) => {
    return {
      name: el.name,
      character: el.character,
      photo: el.profile_path ? `https://image.tmdb.org/t/p/w276_and_h350_face${el.profile_path}` : null
    };
  });
}

function parseDirector(credits) {
  return credits.crew
    .filter((x) => x.job === "Director")
    .map((el) => {
      return el.name;
    });
}

function parseWriter(credits) {
  return credits.crew
    .filter((x) => x.job === "Writer")
    .map((el) => {
      return el.name;
    });
}

function parseSlug(type, title, imdb_id) {
  return `${type}/${title.toLowerCase().replace(/ /g, "-")}-${imdb_id ? imdb_id.replace("tt", "") : ""
    }`;
}

/*
  Trailer selection & prioritization logic to reduce "noise" (reviews/shorts/clips/etc.)
  - Exclude items whose title contains blacklisted keywords (review, reaction, short, clip, scene, fan, etc.)
  - Score items and sort by score: official + type 'Trailer' + size + title contains 'trailer'
  - Deduplicate by YouTube key
*/

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
  "featurette"
];

function titleHasExcludedKeyword(title = "") {
  const t = String(title).toLowerCase();
  return EXCLUDE_KEYWORDS.some(k => t.includes(k));
}

function scoreVideoItem(el) {
  let score = 0;

  if (!el) return score;

  // official flag is strong indicator
  if (el.official === true) score += 100;

  // type preference
  if (el.type === "Trailer") score += 50;
  else if (el.type === "Teaser") score += 20;
  else if (el.type === "Featurette") score += 10;

  // title contains 'trailer' is a positive sign
  if (el.name && /trailer/i.test(el.name)) score += 10;

  // prefer larger sizes (numerical)
  if (el.size && Number(el.size)) {
    score += Math.min(Number(el.size), 2160) / 10; // normalized contribution
  }

  // language preference: prefer en or unspecified (slight)
  if (el.iso_639_1 && String(el.iso_639_1).toLowerCase() === "en") score += 5;

  // penalize if title likely indicates non-trailer
  if (titleHasExcludedKeyword(el.name)) score -= 200;

  return score;
}

// Return parsed trailers prioritized and filtered
function parseTrailers(videos) {
  if (!videos || !Array.isArray(videos.results)) return [];

  // map to items with score
  const items = videos.results
    .filter((el) => el && el.site && typeof el.site === "string" && el.site.toLowerCase() === "youtube")
    .filter((el) => el && el.key)
    .map(el => {
      return {
        raw: el,
        key: el.key,
        score: scoreVideoItem(el)
      };
    })
    // remove items with very low score (likely non-trailer)
    .filter(item => item.score > -100)
    // dedupe by key - keep best scored one
    .reduce((acc, item) => {
      if (!acc.map[item.key] || acc.map[item.key].score < item.score) {
        acc.map[item.key] = item;
      }
      return acc;
    }, { map: {} });

  // convert back to array
  const deduped = Object.values(items.map);

  // sort by descending score
  deduped.sort((a, b) => b.score - a.score);

  // map to the expected trailer metadata structure, keep richer fields
  return deduped.map(entry => {
    const el = entry.raw;
    return {
      id: `youtube:${el.key}`,
      name: el.name || "Trailer",
      type: el.type || "Trailer",
      site: el.site || "YouTube",
      source: el.key,
      official: el.official === true,
      size: el.size || null,
      // keep iso fields so callers can make language decisions if desired
      iso_639_1: el.iso_639_1 || null,
      iso_3166_1: el.iso_3166_1 || null
    };
  });
}

// For playable streams, return minimal structure Stremio expects: title + ytId
function parseTrailerStream(videos) {
  if (!videos || !Array.isArray(videos.results)) return [];

  const items = videos.results
    .filter((el) => el && el.site && typeof el.site === "string" && el.site.toLowerCase() === "youtube")
    .filter((el) => el && el.key)
    .map(el => ({
      raw: el,
      key: el.key,
      score: scoreVideoItem(el)
    }))
    .filter(item => item.score > -100)
    .reduce((acc, item) => {
      if (!acc.map[item.key] || acc.map[item.key].score < item.score) {
        acc.map[item.key] = item;
      }
      return acc;
    }, { map: {} });

  const deduped = Object.values(items.map);

  deduped.sort((a, b) => b.score - a.score);

  return deduped.map(entry => {
    const el = entry.raw;
    return {
      title: el.name || "Trailer",
      ytId: el.key
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
      url: `https://www.youtube.com/watch?v=${key}`,
    });
  }

  return links;
}

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

function parseCreditsLink(credits) {
  const castData = parseCast(credits);
  const Cast = castData.map((actor) => {
    return {
      name: actor.name,
      category: "Cast",
      url: `stremio:///search?search=${encodeURIComponent(actor.name)}`
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

function parseCoutry(production_countries) {
  return production_countries.map((country) => country.name).join(", ");
}

function parseGenres(genres) {
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

function parseCreatedBy(created_by) {
  return created_by.map((el) => el.name);
}

function parseConfig(catalogChoices) {
  let config = {}
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
  const tmdbImage = `https://image.tmdb.org/t/p/w500${poster}`
  if (rpdbkey) {
    const rpdbImage = getRpdbPoster(type, id, language, rpdbkey)
    return await checkIfExists(rpdbImage) ? rpdbImage : tmdbImage;
  }
  return tmdbImage;
}

function parseMedia(el, type, genreList = []) {
  const genres = Array.isArray(el.genre_ids) 
    ? el.genre_ids.map(genre => genreList.find((x) => x.id === genre)?.name || 'Unknown')
    : [];

  return {
    id: `tmdb:${el.id}`,
    name: type === 'movie' ? el.title : el.name,
    genre: genres,
    poster: `https://image.tmdb.org/t/p/w500${el.poster_path}`,
    background: `https://image.tmdb.org/t/p/original${el.backdrop_path}`,
    posterShape: "regular",
    imdbRating: el.vote_average ? el.vote_average.toFixed(1) : 'N/A',
    year: type === 'movie' ? (el.release_date ? el.release_date.substr(0, 4) : "") : (el.first_air_date ? el.first_air_date.substr(0, 4) : ""),
    type: type === 'movie' ? type : 'series',
    description: el.overview,
  };
}

function getRpdbPoster(type, id, language, rpdbkey) {
  const tier = rpdbkey.split("-")[0]
  const lang = language.split("-")[0]
  if (tier === "t0" || tier === "t1" || lang === "en") {
    return `https://api.ratingposterdb.com/${rpdbkey}/tmdb/poster-default/${type}-${id}.jpg?fallback=true`
  } else {
    return `https://api.ratingposterdb.com/${rpdbkey}/tmdb/poster-default/${type}-${id}.jpg?fallback=true&lang=${lang}`
  }
}

function parseMDBListItemsToStremioItems(data) {
  const results = [];

  if (data.movies) {
    for (const m of data.movies) {
      results.push({
        id: String(m.id),
        type: 'movie',
        name: m.title,
        year: m.release_year,
        imdb_id: m.imdb_id || undefined,
        // poster kan je eventueel later toevoegen via extra API call
      });
    }
  }

  if (data.shows) {
    for (const s of data.shows) {
      results.push({
        id: String(s.id),
        type: 'series',
        name: s.title,
        year: s.release_year,
        imdb_id: s.imdb_id || undefined,
      });
    }
  }

  return results;
}

async function checkIfExists(rpdbImage) {
  return new Promise((resolve) => {
    urlExists(rpdbImage, (err, exists) => {
      if (exists) {
        resolve(true)
      } else {
        resolve(false);
      }
    })
  });
}

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
  checkIfExists
};
