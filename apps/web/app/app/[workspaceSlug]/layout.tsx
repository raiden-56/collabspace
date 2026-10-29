import { workspaceStaticParams } from "@/lib/guest/static-params";
import { WorkspaceGate } from "./workspace-gate";

// Server layout so the segment can export generateStaticParams (only defined for the static export).
export const generateStaticParams = workspaceStaticParams;

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return <WorkspaceGate>{children}</WorkspaceGate>;
}
