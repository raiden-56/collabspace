import { Router } from "express";
import { prisma, type Prisma } from "@collabspace/db";
import { AutomationRuleInput } from "@collabspace/shared";
import { z } from "zod";
import { h, parseBody, ok, created, noContent, requireParam } from "../lib/http.js";
import { forbidden, notFound } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { audit } from "../lib/audit.js";
import { requireWorkspaceRole } from "../services/access.js";
import { resolveExecution } from "../services/automation.js";
import { findWorkspace } from "./workspaces.js";

export const workspaceAutomationRouter = Router({ mergeParams: true });
export const automationRulesRouter = Router();
export const automationExecutionsRouter = Router();
workspaceAutomationRouter.use(requireAuth);
automationRulesRouter.use(requireAuth);
automationExecutionsRouter.use(requireAuth);

const ruleInclude = { createdBy: { select: { id: true, name: true } }, _count: { select: { executions: true } } } as const;

workspaceAutomationRouter.get(
  "/rules",
  h(async (req, res) => {
    const ws = await findWorkspace(requireParam(req, "workspaceId"));
    await requireWorkspaceRole(req.user, ws.id);
    const rules = await prisma.automationRule.findMany({ where: { workspaceId: ws.id }, orderBy: [{ isBuiltIn: "desc" }, { createdAt: "asc" }], include: ruleInclude });
    const pending = await prisma.automationExecution.findMany({ where: { rule: { workspaceId: ws.id }, status: "PENDING_APPROVAL" }, orderBy: { createdAt: "desc" }, take: 20, include: { rule: { select: { id: true, name: true, actions: true } } } });
    ok(res, { rules, pending });
  }),
);

workspaceAutomationRouter.post(
  "/rules",
  h(async (req, res) => {
    const ws = await findWorkspace(requireParam(req, "workspaceId"));
    await requireWorkspaceRole(req.user, ws.id, "ADMIN");
    const input = parseBody(AutomationRuleInput, req.body);
    const rule = await prisma.automationRule.create({ data: { workspaceId: ws.id, name: input.name, description: input.description ?? null, trigger: input.trigger, conditions: input.conditions as Prisma.InputJsonValue, actions: input.actions as Prisma.InputJsonValue, enabled: input.enabled, requiresApproval: input.requiresApproval, createdById: req.user!.id }, include: ruleInclude });
    await audit({ action: "automation.rule_created", workspaceId: ws.id, req, resourceType: "AUTOMATION_RULE", resourceId: rule.id, metadata: { trigger: rule.trigger } });
    created(res, rule);
  }),
);

automationRulesRouter.patch(
  "/:ruleId",
  h(async (req, res) => {
    const id = requireParam(req, "ruleId");
    const rule = await prisma.automationRule.findUnique({ where: { id } });
    if (!rule) throw notFound("Rule");
    await requireWorkspaceRole(req.user, rule.workspaceId, "ADMIN");
    const input = parseBody(AutomationRuleInput.partial(), req.body);
    if (rule.isBuiltIn && (input.trigger || input.actions)) throw forbidden("Built-in rules can only be enabled, disabled or renamed");
    const updated = await prisma.automationRule.update({ where: { id }, data: { name: input.name, description: input.description, trigger: input.trigger, conditions: input.conditions as Prisma.InputJsonValue | undefined, actions: input.actions as Prisma.InputJsonValue | undefined, enabled: input.enabled, requiresApproval: input.requiresApproval }, include: ruleInclude });
    await audit({ action: "automation.rule_updated", workspaceId: rule.workspaceId, req, resourceType: "AUTOMATION_RULE", resourceId: id, metadata: { fields: Object.keys(input) } });
    ok(res, updated);
  }),
);

automationRulesRouter.delete(
  "/:ruleId",
  h(async (req, res) => {
    const id = requireParam(req, "ruleId");
    const rule = await prisma.automationRule.findUnique({ where: { id } });
    if (!rule) throw notFound("Rule");
    await requireWorkspaceRole(req.user, rule.workspaceId, "ADMIN");
    if (rule.isBuiltIn) throw forbidden("Built-in rules cannot be deleted; disable them instead");
    await prisma.automationRule.delete({ where: { id } });
    noContent(res);
  }),
);

automationRulesRouter.get(
  "/:ruleId/executions",
  h(async (req, res) => {
    const id = requireParam(req, "ruleId");
    const rule = await prisma.automationRule.findUnique({ where: { id } });
    if (!rule) throw notFound("Rule");
    await requireWorkspaceRole(req.user, rule.workspaceId);
    ok(res, await prisma.automationExecution.findMany({ where: { ruleId: id }, orderBy: { createdAt: "desc" }, take: 100 }));
  }),
);

automationExecutionsRouter.post(
  "/:executionId/resolve",
  h(async (req, res) => {
    const id = requireParam(req, "executionId");
    const exec = await prisma.automationExecution.findUnique({ where: { id }, include: { rule: true } });
    if (!exec) throw notFound("Execution");
    await requireWorkspaceRole(req.user, exec.rule.workspaceId, "MEMBER");
    const { approve } = parseBody(z.object({ approve: z.boolean() }), req.body);
    await resolveExecution(id, approve);
    await audit({ action: approve ? "automation.approved" : "automation.rejected", workspaceId: exec.rule.workspaceId, req, resourceType: "AUTOMATION_EXECUTION", resourceId: id });
    ok(res, await prisma.automationExecution.findUnique({ where: { id } }));
  }),
);
