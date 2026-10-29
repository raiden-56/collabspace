/**
 * Stable identifiers of the guest-mode sample workspace.
 *
 * Kept in a dependency-free module because the server layouts import it for `generateStaticParams`
 * (the static export can only serve routes whose params are listed at build time), while the
 * browser-side mock API uses the same IDs for its data.
 */

export const GUEST_WORKSPACE_SLUG = "demo-team";
export const GUEST_WORKSPACE_ID = "ws_demo";

export const GUEST_USER_IDS = { alice: "u_alice", bob: "u_bob", carol: "u_carol", dan: "u_dan", priya: "u_priya" } as const;

export const GUEST_PROJECT_IDS = { launch: "p_launch", website: "p_website", mobile: "p_mobile", onboarding: "p_onboarding" } as const;
export const GUEST_BOARD_IDS = { launch: "b_launch", website: "b_website", mobile: "b_mobile", onboarding: "b_onboarding" } as const;

export const GUEST_DOCUMENT_IDS = {
  designDoc: "d_design_doc",
  releaseChecklist: "d_release_checklist",
  launchBrief: "d_launch_brief",
  brandGuide: "d_brand_guide",
  betaPlan: "d_beta_plan",
  handbook: "d_handbook",
  syncNotes: "d_sync_notes",
  designReviewNotes: "d_design_review_notes",
  planningNotes: "d_planning_notes",
} as const;

export const GUEST_CANVAS_IDS = { brainstorm: "c_brainstorm", architecture: "c_architecture", roadmap: "c_roadmap", retro: "c_retro", signupFlow: "c_signup_flow" } as const;

export const GUEST_MEETING_IDS = { weeklySync: "m_weekly_sync", designReview: "m_design_review", sprintPlanning: "m_sprint_planning", customerInterview: "m_customer_interview", goNoGo: "m_go_no_go" } as const;

/**
 * Pre-generated IDs handed out to resources created during a guest session. The static export
 * contains a page for each of them, so navigating to something the guest just created works
 * even though there is no server to render unknown IDs.
 */
const spares = (prefix: string, n = 5) => Array.from({ length: n }, (_, i) => `${prefix}_new_${i + 1}`);
export const GUEST_SPARE_IDS = {
  project: spares("p"),
  board: spares("b"),
  document: spares("d", 8),
  canvas: spares("c"),
  meeting: spares("m"),
} as const;
