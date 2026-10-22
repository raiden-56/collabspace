"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Camera, LogOut, ShieldAlert, Trash2 } from "lucide-react";
import { get, patch, post, del, errorMessage, uploadFile } from "@/lib/api";
import { useApp } from "@/components/app-shell/workspace-context";
import { useHeader } from "@/lib/stores/header-store";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Switch, SimpleSelect } from "@/components/ui/controls";
import { UserAvatar } from "@/components/ui/avatar";
import { Card, PageHeader } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/ui/overlays";
import { USER_COLORS } from "@collabspace/shared";
import { cn, formatDate } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { realtime } from "@/lib/realtime";

interface Session {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

type Prefs = { emailMentions: boolean; emailAssignments: boolean; emailComments: boolean; emailDigest: boolean; inAppChat: boolean };
const DEFAULT_PREFS: Prefs = { emailMentions: true, emailAssignments: true, emailComments: false, emailDigest: false, inAppChat: true };

export default function SettingsPage() {
  const { user, me, refetchMe } = useApp();
  useHeader({ title: "Settings" });
  const qc = useQueryClient();
  const router = useRouter();
  const [name, setName] = useState(user?.name ?? "");
  const [color, setColor] = useState(user?.color ?? USER_COLORS[0]);
  const [timezone, setTimezone] = useState(user?.timezone ?? "UTC");
  const [prefs, setPrefs] = useState<Prefs>({ ...DEFAULT_PREFS, ...((user?.preferences as { notifications?: Partial<Prefs> })?.notifications ?? {}) });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pw, setPw] = useState({ current: "", next: "" });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const sessions = useQuery<Session[]>({ queryKey: ["sessions"], queryFn: () => get("/auth/sessions") });

  useEffect(() => {
    if (user) {
      setName(user.name);
      setColor(user.color);
      setTimezone(user.timezone ?? "UTC");
      setPrefs({ ...DEFAULT_PREFS, ...((user.preferences as { notifications?: Partial<Prefs> })?.notifications ?? {}) });
    }
  }, [user]);

  const saveProfile = async () => {
    setSaving(true);
    try {
      await patch("/users/me", { name: name.trim(), color, timezone });
      refetchMe();
      toast.success("Profile updated");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  const savePrefs = async (next: Prefs) => {
    setPrefs(next);
    try {
      await patch("/users/me", { preferences: { notifications: next } });
      refetchMe();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const onAvatar = async (file: File) => {
    const ws = me?.workspaces[0];
    if (!ws) return toast.error("Join a workspace before uploading an avatar");
    setUploading(true);
    try {
      const asset = await uploadFile(file, { workspaceId: ws.id });
      await patch("/users/me", { avatarUrl: `${location.origin}/api/v1/files/${asset.id}/download` });
      refetchMe();
      toast.success("Avatar updated");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setUploading(false);
    }
  };
  const changePassword = async () => {
    try {
      const r = await post<{ otherSessionsRevoked: number }>("/users/me/password", { currentPassword: pw.current, newPassword: pw.next });
      toast.success(`Password changed. ${r.otherSessionsRevoked} other session(s) signed out.`);
      setPw({ current: "", next: "" });
      void qc.invalidateQueries({ queryKey: ["sessions"] });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const deleteAccount = async () => {
    try {
      await del("/users/me");
      realtime.disable();
      qc.clear();
      router.replace("/");
    } catch (err) {
      toast.error(errorMessage(err));
      setConfirmDelete(false);
    }
  };

  const tzOptions = (typeof Intl !== "undefined" && "supportedValuesOf" in Intl ? (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf("timeZone") : ["UTC"]).map((z) => ({ value: z, label: z }));

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6">
      <PageHeader title="Personal settings" description="Your profile, notifications and security." />

      <Card className="p-6" id="profile">
        <h2 className="mb-4 text-base font-semibold">Profile</h2>
        <div className="flex flex-col gap-6 sm:flex-row">
          <div className="flex flex-col items-center gap-2">
            <UserAvatar user={{ name: name || "?", color, avatarUrl: user?.avatarUrl }} size="xl" />
            <label className={cn("inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-primary hover:underline", uploading && "opacity-50")}>
              <Camera className="size-3.5" /> {uploading ? "Uploading…" : "Change photo"}
              <input type="file" accept="image/*" className="sr-only" disabled={uploading} onChange={(e) => e.target.files?.[0] && void onAvatar(e.target.files[0])} />
            </label>
          </div>
          <div className="flex-1 space-y-4">
            <Field label="Name" htmlFor="name">
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Email" htmlFor="email" hint={user?.emailVerified ? "Verified" : "Not verified"}>
              <div className="flex gap-2">
                <Input id="email" value={user?.email ?? ""} readOnly className="bg-surface-2" />
                {!user?.emailVerified ? (
                  <Button
                    variant="outline"
                    onClick={async () => {
                      const r = await post<{ sent?: boolean; devVerificationToken?: string }>("/auth/resend-verification");
                      toast.success(r.devVerificationToken ? `Verification link (dev): /verify-email?token=${r.devVerificationToken}` : "Verification email sent");
                    }}
                  >
                    Resend verification
                  </Button>
                ) : null}
              </div>
            </Field>
            <div>
              <p className="mb-2 text-sm font-medium">Cursor & avatar color</p>
              <div className="flex flex-wrap gap-2">
                {USER_COLORS.map((c) => (
                  <button key={c} aria-label={`Color ${c}`} aria-pressed={color === c} onClick={() => setColor(c)} className={cn("size-7 rounded-full ring-offset-2 ring-offset-surface", color === c && "ring-2 ring-primary")} style={{ background: c }} />
                ))}
              </div>
            </div>
            <Field label="Timezone">
              <SimpleSelect value={timezone} onChange={setTimezone} options={tzOptions} />
            </Field>
            <div className="flex justify-end">
              <Button onClick={() => void saveProfile()} loading={saving}>
                Save changes
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-6" id="preferences">
        <h2 className="mb-1 text-base font-semibold">Notifications</h2>
        <p className="mb-4 text-sm text-text-secondary">In-app notifications are always delivered to your inbox. Choose which ones also send an email.</p>
        <ul className="divide-y divide-border">
          {(
            [
              ["emailMentions", "Email me when I'm mentioned"],
              ["emailAssignments", "Email me when a task is assigned to me"],
              ["emailComments", "Email me about new comments and replies"],
              ["emailDigest", "Send a daily digest of activity"],
              ["inAppChat", "Show in-app notifications for direct messages"],
            ] as Array<[keyof Prefs, string]>
          ).map(([key, label]) => (
            <li key={key} className="flex items-center justify-between py-3">
              <span className="text-sm">{label}</span>
              <Switch checked={prefs[key]} onCheckedChange={(v) => void savePrefs({ ...prefs, [key]: v })} aria-label={label} />
            </li>
          ))}
        </ul>
      </Card>

      <Card className="p-6" id="security">
        <h2 className="mb-4 text-base font-semibold">Security</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Current password" htmlFor="pw-current">
            <Input id="pw-current" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          </Field>
          <Field label="New password" htmlFor="pw-next" hint="At least 10 characters with letters and numbers.">
            <Input id="pw-next" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          </Field>
        </div>
        <div className="mt-3 flex justify-end">
          <Button variant="outline" disabled={!pw.current || pw.next.length < 10} onClick={() => void changePassword()}>
            Change password
          </Button>
        </div>
        <h3 className="mb-2 mt-6 text-sm font-semibold">Active sessions</h3>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {sessions.data?.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate">
                  {s.userAgent ?? "Unknown device"} {s.current ? <span className="ml-1 rounded bg-success-soft px-1.5 py-0.5 text-[10px] font-medium text-success">This device</span> : null}
                </p>
                <p className="text-xs text-text-muted">
                  {s.ip ?? ""} · last active {formatDate(s.lastSeenAt, true)}
                </p>
              </div>
              {!s.current ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    await del(`/auth/sessions/${s.id}`);
                    void qc.invalidateQueries({ queryKey: ["sessions"] });
                  }}
                >
                  <LogOut /> Sign out
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>

      <Card className="border-error/40 p-6">
        <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-error">
          <ShieldAlert className="size-4" /> Danger zone
        </h2>
        <p className="mb-4 text-sm text-text-secondary">Deleting your account anonymizes your profile and signs you out everywhere. Transfer ownership of shared workspaces first.</p>
        <Button variant="destructive" onClick={() => setConfirmDelete(true)}>
          <Trash2 /> Delete my account
        </Button>
        <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} title="Delete your account?" description="This cannot be undone. Your personal data will be anonymized." confirmLabel="Delete account" destructive onConfirm={deleteAccount} />
      </Card>
    </div>
  );
}
