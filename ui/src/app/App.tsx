import { useState } from "react";
import { ProjectLibraryScreen } from "../screens/ProjectLibraryScreen";
import { InputScreen } from "../screens/InputScreen";
import { AnnotationScreen } from "../screens/AnnotationScreen";
import { ResultScreen } from "../screens/ResultScreen";
import type { Screen } from "./screens";

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: "library" });

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: "1rem" }}>
      <header style={{ borderBottom: "1px solid #ddd", paddingBottom: "0.5rem", marginBottom: "1rem" }}>
        <h1 style={{ margin: 0, fontSize: "1.5rem" }}>sprite-gen</h1>
        <small>Local PoC — fish sprite animation generator</small>
      </header>
      {screen.name === "library" && <ProjectLibraryScreen onNavigate={setScreen} />}
      {screen.name === "input" && <InputScreen projectId={screen.projectId} onNavigate={setScreen} />}
      {screen.name === "annotation" && (
        <AnnotationScreen projectId={screen.projectId} onNavigate={setScreen} />
      )}
      {screen.name === "result" && (
        <ResultScreen projectId={screen.projectId} onNavigate={setScreen} />
      )}
    </div>
  );
}
