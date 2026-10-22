export const metadata = { title: "Terms of service" };

export default function TermsPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight">Terms of service</h1>
      <p className="mt-2 text-sm text-text-muted">Last updated: {new Date().toISOString().slice(0, 10)}</p>
      <div className="mt-8 space-y-6 text-[15px] leading-relaxed text-text-secondary [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-text">
        <h2>Your account</h2>
        <p>You are responsible for keeping your credentials secure and for activity under your account. Workspace owners and admins are responsible for who they invite and what they share.</p>
        <h2>Your content</h2>
        <p>You retain ownership of everything you create in CollabSpace. You grant the service the rights needed to store, synchronize and display that content to the people you choose to collaborate with.</p>
        <h2>Acceptable use</h2>
        <p>Do not use CollabSpace to store unlawful content, to harass others, to attempt unauthorized access to other workspaces or to disrupt the service. Rate limits protect shared infrastructure; automated abuse may lead to suspension.</p>
        <h2>AI features</h2>
        <p>AI-generated summaries and suggestions can be wrong. They are presented as drafts for your review and never replace your judgment. You are responsible for content you confirm or publish.</p>
        <h2>Availability and changes</h2>
        <p>We aim for high availability but do not guarantee uninterrupted service. Features may change over time; material changes to these terms will be announced in the application.</p>
        <h2>Termination</h2>
        <p>You may delete your account at any time. We may suspend accounts that violate these terms. Upon termination, data is deleted according to the retention policy described in the privacy policy.</p>
        <h2>Liability</h2>
        <p>The service is provided &quot;as is&quot; to the maximum extent permitted by law. Our liability is limited to the amount you paid for the service in the preceding twelve months.</p>
      </div>
    </article>
  );
}
