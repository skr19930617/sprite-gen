export type Screen =
  | { name: "library" }
  | { name: "input"; projectId?: string }
  | { name: "annotation"; projectId: string }
  | { name: "result"; projectId: string };

export type NavigateFn = (screen: Screen) => void;
