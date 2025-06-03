require("dotenv").config();
const { getGenreList } = require("./getGenreList");
const { getLanguages } = require("./getLanguages");
const packageJson = require("../../package.json");
const catalogsTranslations = require("../static/translations.json");
const CATALOG_TYPES = require("../static/catalog-types.json");
const DEFAULT_LANGUAGE = "en-US";

// Uitgebreide mapping van Engelse MDBList-genres naar Nederlands
const MDBLIST_GENRE_TRANSLATIONS = {
  "action": "Actie",
  "adventure": "Avontuur",
  "animation": "Animatie",
  "biography": "Biografie",
  "comedy": "Komedie",
  "crime": "Misdaad",
  "drama": "Drama",
  "family": "Familie",
  "fantasy": "Fantasie",
  "history": "Historisch",
  "holiday": "Feestdag",
  "horror": "Horror",
  "music": "Muziek",
  "musical": "Musical",
  "mystery": "Mysterie",
  "romance": "Romantiek",
  "sci-fi": "Sciencefiction",
  "science-fiction": "Sciencefiction",
  "sport": "Sport",
  "superhero": "Superheld",
  "thriller": "Thriller",
  "war": "Oorlog",
  "western": "Western",
  "documentary": "Documentaire",
  "short": "Korte film",
  "tv-movie": "Tv-film",
  "reality": "Reality-tv",
  "reality-tv": "Reality-tv"
};

// Reverse mapping: Nederlands -> Engels (voor filtering)
const REVERSE_MDBLIST_GENRE_TRANSLATIONS = Object.fromEntries(
  Object.entries(MDBLIST_GENRE_TRANSLATIONS).map(([en, nl]) => [nl, en])
);

// Importeer je fetchMDBListItems helper (zorg dat pad klopt)
const { fetchMDBListItems } = require("./getCatalog");

// Helper: unieke genres ophalen uit MDBList, met mapping naar Nederlands (hardcoded)
// Onbekende genres worden als nette "Title Case" weergegeven.
function toTitleCase(str) {
  return str.replace(/\w\S*/g, (txt) =>
    txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
  );
}

async function getGenresFromMDBList(listId, apiKey) {
  try {
    const items = await fetchMDBListItems(listId, apiKey);
    const genres = [
      ...new Set(
        items.flatMap(item =>
          (item.genre || [])
            .map(g => {
              if (!g || typeof g !== "string") return null;
              const lower = g.toLowerCase();
              // Gebruik mapping, anders fallback naar Title Case
              return MDBLIST_GENRE_TRANSLATIONS[lower] || toTitleCase(g);
            })
            .filter(Boolean)
        )
      )
    ].sort();
    return genres;
  } catch(err) {
    console.error("ERROR in getGenresFromMDBList:", err);
    return [];
  }
}

function generateArrayOfYears(maxYears) {
  const max = new Date().getFullYear();
  const min = max - maxYears;
  const years = [];
  for (let i = max; i >= min; i--) {
    years.push(i.toString());
  }
  return years;
}

function setOrderLanguage(language, languagesArray) {
  const languageObj = languagesArray.find((lang) => lang.iso_639_1 === language);
  const fromIndex = languagesArray.indexOf(languageObj);
  const element = languagesArray.splice(fromIndex, 1)[0];
  languagesArray = languagesArray.sort((a, b) => (a.name > b.name ? 1 : -1));
  languagesArray.splice(0, 0, element);
  return [...new Set(languagesArray.map((el) => el.name))];
}

function loadTranslations(language) {
  const defaultTranslations = catalogsTranslations[DEFAULT_LANGUAGE] || {};
  const selectedTranslations = catalogsTranslations[language] || {};
  return { ...defaultTranslations, ...selectedTranslations };
}

function createCatalog(id, type, catalogDef, options, tmdbPrefix, translatedCatalogs, showInHome = false) {
  const extra = [];
  if (catalogDef.extraSupported.includes("genre")) {
    if (catalogDef.defaultOptions) {
      const formattedOptions = catalogDef.defaultOptions.map(option => {
        if (option.includes('.')) {
          const [field, order] = option.split('.');
          if (translatedCatalogs[field] && translatedCatalogs[order]) {
            return `${translatedCatalogs[field]} (${translatedCatalogs[order]})`;
          }
          return option;
        }
        return translatedCatalogs[option] || option;
      });
      extra.push({ name: "genre", options: formattedOptions, isRequired: showInHome ? false : true });
    } else {
      extra.push({ name: "genre", options, isRequired: showInHome ? false : true });
    }
  }
  if (catalogDef.extraSupported.includes("search")) {
    extra.push({ name: "search" });
  }
  if (catalogDef.extraSupported.includes("skip")) {
    extra.push({ name: "skip" });
  }

  return {
    id,
    type,
    name: `${tmdbPrefix ? "TMDB - " : ""}${translatedCatalogs[catalogDef.nameKey]}`,
    pageSize: 20,
    extra
  };
}

function getCatalogDefinition(catalogId) {
  const [provider, type] = catalogId.split('.');
  for (const category of Object.keys(CATALOG_TYPES)) {
    if (CATALOG_TYPES[category][type]) {
      return CATALOG_TYPES[category][type];
    }
  }
  return null;
}

function getOptionsForCatalog(catalogDef, type, showInHome, { years, genres_movie, genres_series, filterLanguages }) {
  if (catalogDef.defaultOptions) return catalogDef.defaultOptions;
  const movieGenres = showInHome ? [...genres_movie] : ["Top", ...genres_movie];
  const seriesGenres = showInHome ? [...genres_series] : ["Top", ...genres_series];
  switch (catalogDef.nameKey) {
    case 'year':
      return years;
    case 'language':
      // Toon géén talen, maar de genres (net als bij populaire catalogus)
      return type === 'movie' ? movieGenres : seriesGenres;
    case 'popular':
      return type === 'movie' ? movieGenres : seriesGenres;
    default:
      return type === 'movie' ? movieGenres : seriesGenres;
  }
}

async function getManifest(config) {
  const language = config.language || DEFAULT_LANGUAGE;
  const tmdbPrefix = config.tmdbPrefix === "true";
  const provideImdbId = config.provideImdbId === "true";
  const sessionId = config.sessionId;
  const userCatalogs = config.catalogs || getDefaultCatalogs();
  const translatedCatalogs = loadTranslations(language);

  const years = generateArrayOfYears(20);
  const genres_movie_list = await getGenreList(language, "movie");
  const genres_series_list = await getGenreList(language, "series");

  const genres_movie = genres_movie_list.map(el => el.name).sort();
  const genres_series = genres_series_list.map(el => el.name).sort();

  const languagesArray = await getLanguages();
  const filterLanguages = setOrderLanguage(language, languagesArray);

  const options = { years, genres_movie, genres_series, filterLanguages };

  // Let op: hele mapping is nu async
  let catalogs = await Promise.all(userCatalogs
    .filter(userCatalog => userCatalog.enabled !== false)
    .filter(userCatalog => {
      const catalogDef = getCatalogDefinition(userCatalog.id);
      // Voor MDBList catalogDef is mogelijk null, die mag dan gewoon door
      if (userCatalog.id.startsWith("mdblist_")) return true;
      if (!catalogDef) return false;
      if (catalogDef.requiresAuth && !sessionId) return false;
      return true;
    })
    .map(async userCatalog => {
      // Speciale handling voor MDBList: direct doorsluizen + genres ophalen (nu met hardcoded mapping)
      if (userCatalog.id.startsWith("mdblist_")) {
        const listId = userCatalog.id.split("_")[1];
        const genres = await getGenresFromMDBList(listId, config.mdblistkey);
        return {
          id: userCatalog.id,
          type: userCatalog.type,
          name: userCatalog.name,
          pageSize: 20,
          extra: [
            { name: "genre", options: genres, isRequired: false },
            { name: "skip" },
            { name: "search", isRequired: false }
          ],
          showInHome: userCatalog.showInHome,
        };
      }
      // Standaard catalogs:
      const catalogDef = getCatalogDefinition(userCatalog.id);
      const catalogOptions = getOptionsForCatalog(catalogDef, userCatalog.type, userCatalog.showInHome, options);
      return createCatalog(
        userCatalog.id,
        userCatalog.type,
        catalogDef,
        catalogOptions,
        tmdbPrefix,
        translatedCatalogs,
        userCatalog.showInHome
      );
    })
  );

  // ➜ Search-catalogs toevoegen als dat aanstaat
  if (config.searchEnabled !== "false") {
    const searchCatalogMovie = {
      id: "tmdb.search",
      type: "movie",
      name: `${tmdbPrefix ? "TMDB - " : ""}${translatedCatalogs.search}`,
      extra: [{ name: "search", isRequired: true, options: [] }]
    };
    const searchCatalogSeries = {
      id: "tmdb.search",
      type: "series",
      name: `${tmdbPrefix ? "TMDB - " : ""}${translatedCatalogs.search}`,
      extra: [{ name: "search", isRequired: true, options: [] }]
    };
    catalogs = [...catalogs, searchCatalogMovie, searchCatalogSeries];
  }

  const activeConfigs = [
    `Language: ${language}`,
    `TMDB Account: ${sessionId ? 'Connected' : 'Not Connected'}`,
    `MDBList: ${config.mdblistUserToken ? 'Connected' : 'Not Connected'}`,
    `IMDb Integration: ${provideImdbId ? 'Enabled' : 'Disabled'}`,
    `RPDB Integration: ${config.rpdbkey ? 'Enabled' : 'Disabled'}`,
    `Search: ${config.searchEnabled !== "false" ? 'Enabled' : 'Disabled'}`,
    `Active Catalogs: ${catalogs.length}`
  ].join(' | ');

  return {
    id: packageJson.name,
    version: packageJson.version,
    favicon: `${process.env.HOST_NAME}/favicon.png`,
    logo: `${process.env.HOST_NAME}/logo.png`,
    background: `${process.env.HOST_NAME}/background.png`,
    name: "The Movie Database",
    description: "Stremio addon that provides rich metadata for movies and TV shows from TMDB, featuring customizable catalogs, MDBList lists, multi-language support, watchlist, ratings, and IMDb integration. Current settings: " + activeConfigs,
    resources: ["catalog", "meta"],
    types: ["movie", "series"],
    idPrefixes: provideImdbId ? ["tmdb:", "tt"] : ["tmdb:"],
    behaviorHints: {
      configurable: true,
      configurationRequired: false,
    },
    catalogs,
  };
}

function getDefaultCatalogs() {
  const defaultTypes = ['movie', 'series'];
  const defaultCatalogs = Object.keys(CATALOG_TYPES.default);
  return defaultCatalogs.flatMap(id =>
    defaultTypes.map(type => ({
      id: `tmdb.${id}`,
      type,
      showInHome: true
    }))
  );
}

// Export ook de mappings voor gebruik in je catalog handler!
module.exports = {
  getManifest,
  DEFAULT_LANGUAGE,
  MDBLIST_GENRE_TRANSLATIONS,
  REVERSE_MDBLIST_GENRE_TRANSLATIONS
};
