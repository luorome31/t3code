import { createFileRoute } from "@tanstack/react-router";

import { HighlightsModalPage } from "../components/highlights/HighlightsModalPage";
import { validateHighlightsSearch } from "../components/highlights/highlightsWorkbench.logic";

export const Route = createFileRoute("/_chat/highlights")({
  validateSearch: validateHighlightsSearch,
  component: HighlightsRoute,
});

function HighlightsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <HighlightsModalPage
      initialSearch={search}
      onSearchChange={(next) => {
        void navigate({ search: next, replace: true, resetScroll: false });
      }}
    />
  );
}
