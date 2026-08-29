import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/help")({
  component: HelpLayout,
});

function HelpLayout() {
  return <Outlet />;
}
