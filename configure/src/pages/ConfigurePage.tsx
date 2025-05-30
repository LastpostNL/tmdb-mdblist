import { useManifestConfig } from "@/context/useManifestConfig";
import { useState } from "react";

export default function ConfigurePage() {
  const manifestConfig = useManifestConfig();
  const [manifestResponse, setManifestResponse] = useState<any>(null);

  const handleFetchManifest = async () => {
    const res = await fetch("/manifest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(manifestConfig),
    });
    const data = await res.json();
    setManifestResponse(data);
  };

  return (
    <div>
      {/* ...jouw configuratie UI... */}
      <button onClick={handleFetchManifest}>
        Manifest ophalen
      </button>
      {manifestResponse && (
        <pre>{JSON.stringify(manifestResponse, null, 2)}</pre>
      )}
    </div>
  );
}
