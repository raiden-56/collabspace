import { canvasStaticParams } from "@/lib/guest/static-params";

// Pass-through server layout: the page is a client component, so the segment's
// generateStaticParams (only defined for the static export) lives here.
export const generateStaticParams = canvasStaticParams;

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
