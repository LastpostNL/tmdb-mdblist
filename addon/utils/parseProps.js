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

// Improved trailer parsing so Stremio reliably detects trailers.
// Keeps compatibility with existing usage but returns richer fields:
// - id (youtube:KEY), url (full YouTube URL), name, type, site, source (youtube key)
function parseTrailers(videos) {
  if (!videos || !Array.isArray(videos.results)) return [];

  // Prefer official trailers, but accept other trailer-like items.
  const preferredTypes = ["Trailer", "Teaser", "Clip"];

  const results = videos.results
    .filter((el) => el.site && typeof el.site === "string" && el.site.toLowerCase() === "youtube")
    .filter((el) => el.key) // must have youtube key
    // keep those with typical types but don't strictly exclude others
    .filter((el) => !el.type || preferredTypes.includes(el.type))
    .map((el) => {
      return {
        id: `youtube:${el.key}`,
        name: el.name || "Trailer",
        type: el.type || "Trailer",
        site: el.site || "YouTube",
        source: el.key, // legacy compatibility
        url: `https://www.youtube.com/watch?v=${el.key}`,
        // Include 'official' flag if present so clients can prioritize
        official: el.official === true
      };
    });

  // If none matched the preferredTypes filter (rare), fall back to any YouTube item
  if (results.length === 0 && videos.results.length > 0) {
    return videos.results
      .filter((el) => el.site && typeof el.site === "string" && el.site.toLowerCase() === "youtube")
      .filter((el) => el.key)
      .map((el) => ({
        id: `youtube:${el.key}`,
        name: el.name || "Trailer",
        type: el.type || "Trailer",
        site: el.site || "YouTube",
        source: el.key,
        url: `https://www.youtube.com/watch?v=${el.key}`,
        official: el.official === true
      }));
  }

  return results;
}

// Keep trailerStreams compatible with existing consumers but add url and id.
function parseTrailerStream(videos) {
  if (!videos || !Array.isArray(videos.results)) return [];

  return videos.results
    .filter((el) => el.site && typeof el.site === "string" && el.site.toLowerCase() === "youtube")
    .filter((el) => el.key)
    .map((el) => {
      return {
        id: `youtube:${el.key}`,
        title: el.name || "Trailer",
        ytId: el.key,
        url: `https://www.youtube.com/watch?v=${el.key}`,
        source: "YouTube",
      };
    });
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
