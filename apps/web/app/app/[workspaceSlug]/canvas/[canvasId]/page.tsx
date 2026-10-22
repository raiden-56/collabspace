"use client";

import { use } from "react";
import dynamic from "next/dynamic";
import { Spinner } from "@/components/ui/skeleton";

const CanvasEditor = dynamic(() => import("@/components/canvas/canvas-editor").then((m) => m.CanvasEditor), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center">
      <Spinner className="size-6" />
    </div>
  ),
});

export default function CanvasPage({ params }: { params: Promise<{ canvasId: string }> }) {
  const { canvasId } = use(params);
  return (
    <div className="h-full">
      <CanvasEditor canvasId={canvasId} />
    </div>
  );
}
