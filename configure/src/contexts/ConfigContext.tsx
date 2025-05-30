import React, { createContext, useContext, useEffect, useState } from "react";
import { 
  baseCatalogs, 
  authCatalogs, 
  streamingCatalogs 
} from "@/data/catalogs";

const allCatalogs = [
  ...baseCatalogs,
  ...authCatalogs,
  ...Object.values(streamingCatalogs).flat()
];

export interface CatalogConfig {
  id: string;
  type: string;
  name: string;
  enabled?: boolean;
  showInHome?: boolean;
}

export interface MDBListSelected {
  id: number;
  showInHome: boolean;
}

export interface ConfigContextType {
  rpdbkey: string;
  setRpdbkey: (v: string) => void;
  mdblistkey: string;
  setMdblistkey: (v: string) => void;
  includeAdult: boolean;
  setIncludeAdult: (v: boolean) => void;
  provideImdbId: boolean;
  setProvideImdbId: (v: boolean) => void;
  tmdbPrefix: boolean;
  setTmdbPrefix: (v: boolean) => void;
  hideEpisodeThumbnails: boolean;
  setHideEpisodeThumbnails: (v: boolean) => void;
  language: string;
  setLanguage: (v: string) => void;
  sessionId: string;
  setSessionId: (v: string) => void;
  streaming: string[];
  setStreaming: (v: string[]) => void;
  catalogs: CatalogConfig[];
  setCatalogs: (v: CatalogConfig[]) => void;
  ageRating?: string;
  setAgeRating: (v: string | undefined) => void;
  searchEnabled: boolean;
  setSearchEnabled: (v: boolean) => void;
  loadConfigFromUrl: () => void;
  mdblistLists: any[];
  setMdblistLists: (lists: any[]) => void;
  mdblistSelectedLists: MDBListSelected[];
  setMdblistSelectedLists: (lists: MDBListSelected[]) => void;
}

export const ConfigContext = createContext<ConfigContextType>(null as any);

export function ConfigProvider({ children }: { children: React.ReactNode }) {
  const [rpdbkey, setRpdbkey] = useState("");
  const [mdblistkey, setMdblistkey] = useState("");
  const [includeAdult, setIncludeAdult] = useState(false);
  const [provideImdbId, setProvideImdbId] = useState(false);
  const [tmdbPrefix, setTmdbPrefix] = useState(false);
  const [hideEpisodeThumbnails, setHideEpisodeThumbnails] = useState(false);
  const [language, setLanguage] = useState("en-US");
  const [sessionId, setSessionId] = useState("");
  const [streaming, setStreaming] = useState<string[]>([]);
  const [catalogs, setCatalogs] = useState<CatalogConfig[]>([]);
  const [ageRating, setAgeRating] = useState<string | undefined>(undefined);
  const [searchEnabled, setSearchEnabled] = useState<boolean>(true);

  // MDBList gerelateerd
  const [mdblistLists, setMdblistLists] = useState<any[]>([]);
  const [mdblistSelectedLists, setMdblistSelectedLists] = useState<MDBListSelected[]>([]);

  const loadDefaultCatalogs = () => {
    const defaultCatalogs = baseCatalogs.map(catalog => ({
      ...catalog,
      enabled: true,
      showInHome: true
    }));
    setCatalogs(defaultCatalogs);
  };

  const loadConfigFromUrl = () => {
    try {
      const path = window.location.pathname.split('/')[1];
      const decodedConfig = decodeURIComponent(path);
      const config = JSON.parse(decodedConfig);
      
      if (config.rpdbkey) setRpdbkey(config.rpdbkey);
      if (config.includeAdult) setIncludeAdult(config.includeAdult === "true");
      if (config.language) setLanguage(config.language);
      
      if (config.catalogs) {
        const catalogsWithNames = config.catalogs.map((catalog: CatalogConfig) => {
          const existingCatalog = allCatalogs.find(
            c => c.id === catalog.id && c.type === catalog.type
          );
          return {
            ...catalog,
            name: existingCatalog?.name || catalog.id,
            enabled: catalog.enabled || false 
          };
        });
        setCatalogs(catalogsWithNames);

        const selectedStreamingServices = new Set(
          catalogsWithNames
            .filter(catalog => catalog.id.startsWith('streaming.'))
            .map(catalog => catalog.id.split('.')[1])
        );

        setStreaming(Array.from(selectedStreamingServices) as string[]);
      } else {
        loadDefaultCatalogs(); 
      }
      
      if (config.searchEnabled) setSearchEnabled(config.searchEnabled === "true");

      // -- MDBList uit URL laden (optioneel) --
      if (config.mdblistSelectedLists) {
        setMdblistSelectedLists(config.mdblistSelectedLists);
      }
      if (config.mdblistLists) {
        setMdblistLists(config.mdblistLists);
      }
      
      window.history.replaceState({}, '', '/configure');
    } catch (error) {
      console.error('Error loading config from URL:', error);
      loadDefaultCatalogs(); 
    }
  };

  useEffect(() => {
    const path = window.location.pathname;
    if (path.includes('configure')) {
      loadConfigFromUrl();
    } else {
      loadDefaultCatalogs();
    }
  }, []);

  const value: ConfigContextType = {
    rpdbkey,
    setRpdbkey,
    mdblistkey,
    setMdblistkey,
    includeAdult,
    setIncludeAdult,
    provideImdbId,
    setProvideImdbId,
    tmdbPrefix,
    setTmdbPrefix,
    hideEpisodeThumbnails,
    setHideEpisodeThumbnails,
    language,
    setLanguage,
    sessionId,
    setSessionId,
    streaming,
    setStreaming,
    catalogs,
    setCatalogs,
    ageRating,
    setAgeRating,
    searchEnabled,
    setSearchEnabled,
    loadConfigFromUrl,
    mdblistLists,
    setMdblistLists,
    mdblistSelectedLists,
    setMdblistSelectedLists,
  };

  return (
    <ConfigContext.Provider value={value}>
      {children}
    </ConfigContext.Provider>
  );
}

export const useConfig = () => useContext(ConfigContext);
