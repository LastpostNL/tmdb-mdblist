import { useConfig } from "@/contexts/ConfigContext";

// Helper om MDBList-catalogs te genereren uit geselecteerde lijsten
export function useManifestConfig() {
  const {
    catalogs,
    mdblistkey,
    mdblistLists,
    mdblistSelectedLists,
    rpdbkey,
    includeAdult,
    provideImdbId,
    tmdbPrefix,
    hideEpisodeThumbnails,
    language,
    sessionId,
    streaming,
    ageRating,
    searchEnabled,
  } = useConfig();

  // Genereer catalogs voor geselecteerde MDBList-lijsten
  const mdbListCatalogs = mdblistSelectedLists.map(sel => {
    const list = mdblistLists.find(l => l.id === sel.id);
    if (!list) return null;
    return {
      id: `mdblist_${list.id}_${list.mediatype}`
      type: list.mediatype === "movie" ? "movie" : "series",
      name: list.name,
      enabled: true,
      showInHome: sel.showInHome,
    };
  }).filter(Boolean);

  // Voeg deze toe aan de bestaande catalogs
  const manifestConfig = {
    rpdbkey,
    mdblistUserToken: mdblistkey,
    includeAdult,
    provideImdbId,
    tmdbPrefix,
    hideEpisodeThumbnails,
    language,
    sessionId,
    streaming,
    ageRating,
    searchEnabled,
    catalogs: [
      ...catalogs.filter(c => !c.id.startsWith("mdblist_")), // voorkom dubbele
      ...mdbListCatalogs,
    ],
    mdblistSelectedLists, // optioneel: handig voor sessie
    mdblistLists, // optioneel: handig voor sessie
  };

  return manifestConfig;
}
