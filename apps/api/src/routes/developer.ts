import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@mashupkgrid/database";
import {
  successResponse,
  ConflictError,
  NotFoundError,
  ForbiddenError,
  ValidationError,
  generateSecureToken,
  hashToken,
  encryptAtRest,
  decryptAtRest,
  PERMISSIONS,
  WEBHOOK_EVENT_TYPES,
  assertPublicHttpUrl,
  type PermissionKey,
  type WebhookEventType,
} from "@mashupkgrid/shared";
import { env } from "@mashupkgrid/config";
import { authenticate } from "../plugins/authenticate.js";
import { resolveTenant } from "../plugins/tenant.js";
import { checkMaintenance } from "../plugins/maintenance.js";
import { requirePermission } from "../plugins/authorize.js";
import { getCachedPermissions } from "../lib/permission-cache.js";
import { writeAuditLog } from "../lib/audit.js";
import { enqueueDeliverWebhookEvent } from "../lib/queue.js";

const preHandler = [authenticate, resolveTenant, checkMaintenance, requirePermission("settings.manage")];

const API_KEY_PREFIX = "mkg_";

function requireTenant(tenantId: string | null): string {
  if (tenantId === null) {
    throw new ConflictError("Platform administration has no developer settings of its own");
  }
  return tenantId;
}

const PERMISSION_SET = new Set<string>(PERMISSIONS);
const WEBHOOK_EVENT_SET = new Set<string>(WEBHOOK_EVENT_TYPES);

function assertValidScopes(scopes: string[]): asserts scopes is PermissionKey[] {
  const invalid = scopes.filter((s) => !PERMISSION_SET.has(s));
  if (invalid.length > 0) throw new ValidationError(`Unknown permission key(s): ${invalid.join(", ")}`);
}

function assertValidEvents(events: string[]): asserts events is WebhookEventType[] {
  const invalid = events.filter((e) => !WEBHOOK_EVENT_SET.has(e));
  if (invalid.length > 0) throw new ValidationError(`Unknown webhook event type(s): ${invalid.join(", ")}`);
}

const createApiKeySchema = z.object({
  name: z.string().min(1).max(80),
  scopes: z.array(z.string()).optional(),
});

const createWebhookSchema = z.object({
  url: z.string().url(),
  description: z.string().max(200).nullable().optional(),
  events: z.array(z.string()).min(1),
});

const updateWebhookSchema = z.object({
  url: z.string().url().optional(),
  description: z.string().max(200).nullable().optional(),
  events: z.array(z.string()).min(1).optional(),
  isActive: z.boolean().optional(),
});

export async function developerRoutes(app: FastifyInstance): Promise<void> {
  // ---------------------------------------------------------------------------------------
  // API keys — Bearer tokens external clients can use in place of a session access token
  // (see plugins/authenticate.ts). A key acts as the staff member who created it: its
  // effective permissions are that user's *current* permissions, optionally narrowed further
  // by the key's own `scopes`.
  // ---------------------------------------------------------------------------------------

  app.get("/api-keys", { config: { audience: "staff" }, preHandler }, async (request, reply) => {
    const tenantId = requireTenant(request.user!.tenantId);
    const keys = await prisma.apiKey.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        scopes: true,
        lastUsedAt: true,
        revokedAt: true,
        createdAt: true,
        createdBy: { select: { email: true } },
      },
    });
    reply.send(successResponse(keys, request.id));
  });

  app.post("/api-keys", { config: { audience: "staff" }, preHandler }, async (request, reply) => {
    const tenantId = requireTenant(request.user!.tenantId);
    const body = createApiKeySchema.parse(request.body);

    // A key can never grant more than the issuing user currently has — silently dropping
    // requested scopes the caller doesn't hold would be surprising, so this rejects instead.
    if (body.scopes && body.scopes.length > 0) {
      assertValidScopes(body.scopes);
      const callerPermissions = await getCachedPermissions(request.user!.id, tenantId);
      const notHeld = body.scopes.filter((scope) => !callerPermissions.has(scope));
      if (notHeld.length > 0) {
        throw new ForbiddenError(`Cannot issue a token scoped for permissions you don't hold: ${notHeld.join(", ")}`);
      }
    }

    const rawToken = `${API_KEY_PREFIX}${generateSecureToken(24)}`;
    const key = await prisma.apiKey.create({
      data: {
        tenantId,
        name: body.name,
        keyPrefix: rawToken.slice(0, 12),
        keyHash: hashToken(rawToken),
        scopes: body.scopes ?? [],
        createdByUserId: request.user!.id,
      },
    });

    await writeAuditLog({
      tenantId,
      actorUserId: request.user!.id,
      action: "developer.api_key.created",
      resourceType: "ApiKey",
      resourceId: key.id,
      after: { name: key.name, scopes: key.scopes },
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"] ?? null,
    });

    // The only point in this key's lifetime the raw token is ever available — the DB only ever
    // holds its hash from here on.
    reply.code(201).send(successResponse({ ...key, token: rawToken }, request.id));
  });

  app.delete("/api-keys/:id", { config: { audience: "staff" }, preHandler }, async (request, reply) => {
    const tenantId = requireTenant(request.user!.tenantId);
    const { id } = request.params as { id: string };
    const key = await prisma.apiKey.findFirst({ where: { id, tenantId } });
    if (!key) throw new NotFoundError("API key");

    await prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
    await writeAuditLog({
      tenantId,
      actorUserId: request.user!.id,
      action: "developer.api_key.revoked",
      resourceType: "ApiKey",
      resourceId: id,
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"] ?? null,
    });
    reply.code(204).send();
  });

  // ---------------------------------------------------------------------------------------
  // Webhooks — outbound event delivery, signed with an HMAC secret. Delivery itself happens
  // in the worker (apps/worker/src/jobs/deliver-webhook.ts); these routes only manage
  // subscriptions and let staff inspect/replay recent delivery attempts.
  // ---------------------------------------------------------------------------------------

  app.get("/webhooks", { config: { audience: "staff" }, preHandler }, async (request, reply) => {
    const tenantId = requireTenant(request.user!.tenantId);
    const endpoints = await prisma.webhookEndpoint.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        url: true,
        description: true,
        events: true,
        isActive: true,
        lastTriggeredAt: true,
        lastStatusCode: true,
        consecutiveFailures: true,
        createdAt: true,
      },
    });
    reply.send(successResponse(endpoints, request.id));
  });

  app.get("/webhooks/events", { config: { audience: "staff" }, preHandler }, async (_request, reply) => {
    reply.send(successResponse(WEBHOOK_EVENT_TYPES, _request.id));
  });

  app.post("/webhooks", { config: { audience: "staff" }, preHandler }, async (request, reply) => {
    const tenantId = requireTenant(request.user!.tenantId);
    const body = createWebhookSchema.parse(request.body);
    assertValidEvents(body.events);
    await assertPublicHttpUrl(body.url);
    const secret = `whsec_${generateSecureToken(24)}`;

    const endpoint = await prisma.webhookEndpoint.create({
      data: {
        tenantId,
        url: body.url,
        description: body.description ?? null,
        events: body.events,
        secretEncrypted: encryptAtRest(secret, env.ENCRYPTION_KEY),
        createdByUserId: request.user!.id,
      },
    });

    await writeAuditLog({
      tenantId,
      actorUserId: request.user!.id,
      action: "developer.webhook.created",
      resourceType: "WebhookEndpoint",
      resourceId: endpoint.id,
      after: { url: endpoint.url, events: endpoint.events },
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"] ?? null,
    });

    const { secretEncrypted: _secretEncrypted, ...safeEndpoint } = endpoint;
    reply.code(201).send(successResponse({ ...safeEndpoint, secret }, request.id));
  });

  app.get("/webhooks/:id/secret", { config: { audience: "staff" }, preHandler }, async (request, reply) => {
    const tenantId = requireTenant(request.user!.tenantId);
    const { id } = request.params as { id: string };
    const endpoint = await prisma.webhookEndpoint.findFirst({ where: { id, tenantId } });
    if (!endpoint) throw new NotFoundError("Webhook endpoint");
    reply.send(successResponse({ secret: decryptAtRest(endpoint.secretEncrypted, env.ENCRYPTION_KEY) }, request.id));
  });

  app.patch("/webhooks/:id", { config: { audience: "staff" }, preHandler }, async (request, reply) => {
    const tenantId = requireTenant(request.user!.tenantId);
    const { id } = request.params as { id: string };
    const body = updateWebhookSchema.parse(request.body);
    if (body.events) assertValidEvents(body.events);
    if (body.url) await assertPublicHttpUrl(body.url);
    const existing = await prisma.webhookEndpoint.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundError("Webhook endpoint");

    const updated = await prisma.webhookEndpoint.update({
      where: { id },
      data: {
        url: body.url,
        description: body.description,
        events: body.events,
        isActive: body.isActive,
      },
    });

    const { secretEncrypted: _secretEncrypted2, ...safeUpdated } = updated;
    reply.send(successResponse(safeUpdated, request.id));
  });

  app.delete("/webhooks/:id", { config: { audience: "staff" }, preHandler }, async (request, reply) => {
    const tenantId = requireTenant(request.user!.tenantId);
    const { id } = request.params as { id: string };
    const existing = await prisma.webhookEndpoint.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundError("Webhook endpoint");

    await prisma.webhookEndpoint.delete({ where: { id } });
    await writeAuditLog({
      tenantId,
      actorUserId: request.user!.id,
      action: "developer.webhook.deleted",
      resourceType: "WebhookEndpoint",
      resourceId: id,
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"] ?? null,
    });
    reply.code(204).send();
  });

  app.post("/webhooks/:id/test", { config: { audience: "staff" }, preHandler }, async (request, reply) => {
    const tenantId = requireTenant(request.user!.tenantId);
    const { id } = request.params as { id: string };
    const endpoint = await prisma.webhookEndpoint.findFirst({ where: { id, tenantId } });
    if (!endpoint) throw new NotFoundError("Webhook endpoint");

    await enqueueDeliverWebhookEvent({
      webhookEndpointId: endpoint.id,
      eventType: "webhook.test",
      payload: { message: "This is a test event from Suntech Billing.", sentAt: new Date().toISOString() },
    });
    reply.send(successResponse({ enqueued: true }, request.id));
  });

  app.get("/webhooks/:id/deliveries", { config: { audience: "staff" }, preHandler }, async (request, reply) => {
    const tenantId = requireTenant(request.user!.tenantId);
    const { id } = request.params as { id: string };
    const endpoint = await prisma.webhookEndpoint.findFirst({ where: { id, tenantId } });
    if (!endpoint) throw new NotFoundError("Webhook endpoint");

    const deliveries = await prisma.webhookDelivery.findMany({
      where: { webhookEndpointId: id },
      orderBy: { attemptedAt: "desc" },
      take: 25,
    });
    reply.send(successResponse(deliveries, request.id));
  });
}
