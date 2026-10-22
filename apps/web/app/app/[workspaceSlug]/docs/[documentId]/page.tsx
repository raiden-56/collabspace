"use client";

import { use } from "react";
import dynamic from "next/dynamic";
import { Spinner } from "@/components/ui/skeleton";

const DocumentEditor = dynamic(() => import("@/components/editor/document-editor").then((m) => m.DocumentEditor), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center">
      <Spinner className="size-6" />
    </div>
  ),
});

export default function DocumentPage({ params }: { params: Promise<{ documentId: string }> }) {
  const { documentId } = use(params);
  return (
    <div className="h-full">
      <DocumentEditor documentId={documentId} />
    </div>
  );
}
