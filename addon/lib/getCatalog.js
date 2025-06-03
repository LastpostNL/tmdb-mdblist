require("dotenv").config();
const { MovieDb } = require("moviedb-promise");
const moviedb = new MovieDb(process.env.TMDB_API);
const { getGenreList } = require("./getGenreList");
const { getLanguages } = require("./getLanguages");
const { parseMedia } = require("../utils/parseProps");
const { getMeta } = require("./getMeta");
const CATALOG_TYPES = require("../static/catalog-types.json");
const axios = require("axios"); // Voor MDBList API-calls

async function getCatalog(type, language, page, id, genre, config) {
  if (id.startsWith("mdblist_")) {
    const parts = id.split("_");
    const listId = parts[1];
    const apiKey = config.mdblistkey;
    if (!apiKey) throw new Error("MDBList API-key ontbreekt in config!");

    const items = await fetchMDBListItems(listId, apiKey);

    const availableGenres = [
      ...new Set(items.flatMap(item => item.genre?.map(g => g.toLowerCase()) || []))
    ].sort();

    // Genre-filter toevoegen, als genre parameter is opgegeven
    const filteredItems = genre
      ? items.filter(item =>
          Array.isArray(item.genre) &&
          item.genre.map(g => g.toLowerCase()).includes(genre.toLowerCase())
        )
      : items;

    // Filter en map tegelijk!
    const metas = filteredItems
      .filter(item => {
        // Films: type = "movie", Series: type = "series"
        if (type === "movie") return item.mediatype === "movie";
        if (type === "series") return item.mediatype === "show";
        return false;
      })
      .map(item => ({
        id: item.id ? `tmdb:${item.id}` : (item.imdb_id ? `tt${item.imdb_id}` : undefined),
        name: item.title,
        type: type, // "movie" of "series", zoals Stremio verwacht!
        poster: item.poster,
        genre: item.genre,
        year: item.release_year,
        imdb_id: item.imdb_id,
      }))
      .filter(meta => meta.id && meta.name && meta.poster);

    return { metas, availableGenres };
  }

  // Normale TMDb-catalogus
  const genreList = await getGenreList(language, type);
  const parameters = await buildParameters(type, language, page, id, genre, genreList, config);

  const fetchFunction = type === "movie" ? moviedb.discoverMovie.bind(moviedb) : moviedb.discoverTv.bind(moviedb);

  return fetchFunction(parameters)
    .then((res) => ({
      metas: res.results.map(el => parseMedia(el, type, genreList))
    }))
    .catch(console.error);
}

// Helper: MDBList API-call om lijstitems op te halen (films of series)
async function fetchMDBListItems(listId, apiKey) {
  try {
    console.log("FETCH MDBLIST", listId, apiKey);
    const url = `https://api.mdblist.com/lists/${listId}/items?apikey=${apiKey}&append_to_response=genre,poster`;
    const response = await axios.get(url);
    console.log("MDBLIST RESPONSE", response.data);
    return [
      ...(response.data.movies || []),
      ...(response.data.shows || [])
    ];
  } catch (err) {
    console.error("Fout bij ophalen MDBList-items:", err.message, err);
    return [];
  }
}

async function buildParameters(type, language, page, id, genre, genreList, config) {
  const languages = await getLanguages();
  const parameters = { language, page, 'vote_count.gte': 10 };

  if (config.ageRating) {
    switch (config.ageRating) {
      case "G":
        parameters.certification_country = "US";
        parameters.certification = type === "movie" ? "G" : "TV-G";
        break;
      case "PG":
        parameters.certification_country = "US";
        parameters.certification = type === "movie" ? ["G", "PG"].join("|") : ["TV-G", "TV-PG"].join("|");
        break;
      case "PG-13":
        parameters.certification_country = "US";
        parameters.certification = type === "movie" ? ["G", "PG", "PG-13"].join("|") : ["TV-G", "TV-PG", "TV-14"].join("|");
        break;
      case "R":
        parameters.certification_country = "US";
        parameters.certification = type === "movie" ? ["G", "PG", "PG-13", "R"].join("|") : ["TV-G", "TV-PG", "TV-14", "TV-MA"].join("|");
        break;
      case "NC-17":
        break;
    }
  }

  if (id.includes("streaming")) {
    const provider = findProvider(id.split(".")[1]);
    parameters.with_genres = genre ? findGenreId(genre, genreList) : undefined;
    parameters.with_watch_providers = provider.watchProviderId;
    parameters.watch_region = provider.country;
    parameters.with_watch_monetization_types = "flatrate|free|ads";
  } else {
    switch (id) {
      case "tmdb.top":
        parameters.with_genres = genre ? findGenreId(genre, genreList) : undefined;
        if (type === "series") {
          parameters.watch_region = language.split("-")[1];
          parameters.with_watch_monetization_types = "flatrate|free|ads|rent|buy";
        }
        break;
      case "tmdb.year":
        const year = genre ? genre : new Date().getFullYear();
        parameters[type === "movie" ? "primary_release_year" : "first_air_date_year"] = year;
        break;
case "tmdb.language":
        parameters.with_genres = genre ? findGenreId(genre, genreList) : undefined;
        if (type === "series") {
          parameters.watch_region = language.split("-")[1];
          parameters.with_watch_monetization_types = "flatrate|free|ads|rent|buy";
        }
        break;
    }
  }
  return parameters;
}

function findGenreId(genreName, genreList) {
  const genreData = genreList.find(genre => genre.name === genreName);
  return genreData ? genreData.id : undefined;
}

function findLanguageCode(genre, languages) {
  const language = languages.find((lang) => lang.name === genre);
  return language ? language.iso_639_1.split("-")[0] : "";
}

function findProvider(providerId) {
  const provider = CATALOG_TYPES.streaming[providerId];
  if (!provider) throw new Error(`Could not find provider: ${providerId}`);
  return provider;
}

// Voeg fetchMDBListItems toe aan de exports!
console.log("EXPORT TEST", { fetchMDBListItems });
module.exports = { getCatalog, fetchMDBListItems };
