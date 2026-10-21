// Standalone entry for portal builds (GameMonetize etc.): mounts the game page without the
// TanStack Start server, so the build is plain static files with index.html at the root.
import { createRoot } from "react-dom/client";
import type { ComponentType } from "react";
import "./styles.css";
import "./static-fonts.css";
import { Route } from "./routes/index";

const Game = Route.options.component as ComponentType;
createRoot(document.getElementById("root")!).render(<Game />);
