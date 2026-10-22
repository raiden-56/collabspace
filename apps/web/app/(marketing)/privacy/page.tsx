export const metadata = { title: "Privacy policy" };

export default function PrivacyPage() {
  return (
    <article className="prose-sm mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight">Privacy policy</h1>
      <p className="mt-2 text-sm text-text-muted">Last updated: {new Date().toISOString().slice(0, 10)}</p>
      <div className="mt-8 space-y-6 text-[15px] leading-relaxed text-text-secondary [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-text">
        <h2>What we store</h2>
        <p>CollabSpace stores the account details you provide (name, email, avatar), the content you and your team create (canvases, documents, tasks, comments, messages, meetings, files) and operational records needed to run the service (sessions, audit logs, notifications).</p>
        <h2>Real-time data</h2>
        <p>Presence information such as cursor positions and who is viewing a resource is shared with collaborators in the same resource while you are connected. It is transient and is not stored as document content.</p>
        <h2>AI features</h2>
        <p>Content is sent to the configured AI provider only when you explicitly run an AI action (for example, summarizing a meeting after confirming the consent prompt). The administrator of your deployment chooses the provider; the built-in offline provider sends nothing outside the server. AI requests are recorded in the audit log without storing the prompt content.</p>
        <h2>Email</h2>
        <p>We send transactional emails for verification, password resets, invitations and notifications you have enabled. You can adjust notification emails in Settings.</p>
        <h2>Cookies</h2>
        <p>A single HttpOnly session cookie keeps you signed in. We do not use advertising or tracking cookies. Theme and layout preferences are kept in your browser&apos;s local storage.</p>
        <h2>Retention and deletion</h2>
        <p>Deleted files are recoverable for 30 days before permanent removal. Version history is retained according to your plan. You can delete your account from Settings after transferring ownership of shared workspaces; your personal data is anonymized and sessions are revoked.</p>
        <h2>Security</h2>
        <p>Passwords are hashed with Argon2id, all authorization is enforced on the server, and share links use unguessable tokens with optional expiry. Report security concerns to your workspace administrator.</p>
        <h2>Contact</h2>
        <p>For questions about this policy, contact the operator of your CollabSpace deployment.</p>
      </div>
    </article>
  );
}
