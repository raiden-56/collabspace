import { Card } from "@/components/ui/skeleton";

export function AuthCard({ title, description, children, footer }: { title: string; description?: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <Card className="p-8 shadow-lg">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-sm text-text-secondary">{description}</p> : null}
      </div>
      {children}
      {footer ? <div className="mt-6 text-center text-sm text-text-secondary">{footer}</div> : null}
    </Card>
  );
}
