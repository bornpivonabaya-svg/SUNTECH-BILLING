import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import { prisma, type StoreOrder, type StoreProduct } from "@mashupkgrid/database";
import { successResponse, ForbiddenError, NotFoundError, UnauthorizedError } from "@mashupkgrid/shared";
import {
  createStoreOrder,
  findStoreOrderForBuyer,
  startStoreOrderPayment,
  verifyStoreOrderPayment,
  type StoreOrderItemSnapshot,
} from "@mashupkgrid/payments";
import { authenticate } from "../plugins/authenticate.js";
import { resolveTenant } from "../plugins/tenant.js";
import { checkMaintenance } from "../plugins/maintenance.js";
import { writeAuditLog } from "../lib/audit.js";
import { STORE_SEED_PRODUCTS, type SeedProduct } from "../lib/store-catalog-seed.js";

const CATEGORIES = ["routers", "switches", "wireless", "fiber", "solar", "cctv"] as const;

// --- Catalogue ------------------------------------------------------------------------------------

/** The store used to keep its catalogue in data/hardware-products.json. Fills an empty table once:
 *  from that file when a server still has it (keeping any price edits), otherwise from the seed. */
let catalogReady: Promise<void> | null = null;
function ensureStoreCatalog(): Promise<void> {
  catalogReady ??= (async () => {
    if ((await prisma.storeProduct.count()) > 0) return;
    let source: SeedProduct[] = STORE_SEED_PRODUCTS;
    const legacyFile = path.join(process.cwd(), "data", "hardware-products.json");
    try {
      if (fs.existsSync(legacyFile)) source = JSON.parse(fs.readFileSync(legacyFile, "utf-8")) as SeedProduct[];
    } catch {
      // Unreadable file: the seed is still a correct starting catalogue.
    }
    await prisma.storeProduct.createMany({
      data: source.map((p) => ({
        id: p.id,
        slug: p.slug,
        name: p.name,
        brand: p.brand,
        category: p.category,
        priceMinor: Math.round(p.price * 100),
        originalPriceMinor: p.originalPrice ? Math.round(p.originalPrice * 100) : null,
        stock: p.stock,
        badge: p.badge ?? null,
        shortDescription: p.shortDescription,
        description: p.description,
        imageUrl: p.imageUrl,
        specs: p.specs,
        warranty: p.warranty,
        featured: p.featured,
      })),
      skipDuplicates: true,
    });
  })().catch((err) => {
    catalogReady = null; // retry on the next request
    throw err;
  });
  return catalogReady;
}

/** What the web store works with: whole shillings, as it always has. */
function toPublicProduct(p: StoreProduct) {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    brand: p.brand,
    category: p.category,
    price: p.priceMinor / 100,
    originalPrice: p.originalPriceMinor ? p.originalPriceMinor / 100 : undefined,
    stock: p.stock,
    inStock: p.stock > 0,
    badge: p.badge ?? undefined,
    shortDescription: p.shortDescription,
    description: p.description,
    imageUrl: p.imageUrl,
    specs: p.specs,
    warranty: p.warranty,
    featured: p.featured,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

/** An order as the buyer and the admin see it. `id` is the order number, which both use. */
function toPublicOrder(o: StoreOrder, opts: { includeContact?: boolean } = {}) {
  const items = (o.items as unknown as StoreOrderItemSnapshot[]).map((i) => ({ productId: i.productId, name: i.name, quantity: i.quantity, price: i.priceMinor / 100 }));
  return {
    id: o.orderNumber,
    orderNumber: o.orderNumber,
    customerName: o.customerName,
    // The buyer already knows their own number; only the admin list gets it in full.
    phone: opts.includeContact ? o.phone : `•••${o.phone.slice(-3)}`,
    email: opts.includeContact ? o.email ?? undefined : undefined,
    county: o.county,
    deliveryAddress: o.deliveryAddress,
    items,
    subtotal: o.subtotalMinor / 100,
    shippingFee: o.shippingMinor / 100,
    totalAmount: o.totalMinor / 100,
    paymentMethod: o.paymentMethod,
    status: o.status,
    mpesaReceiptNumber: o.mpesaReceiptNumber ?? undefined,
    paymentNote: o.paymentNote ?? undefined,
    /** An M-Pesa prompt is out and not yet answered. */
    awaitingMpesa: o.status === "PENDING" && o.paymentMethod === "MPESA" && Boolean(o.checkoutRequestId),
    paidAt: o.paidAt ?? undefined,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

// Only platform super admins change the catalogue or orders; tenants never set prices.
function assertSuperAdmin(request: FastifyRequest) {
  if (!request.user) throw new UnauthorizedError();
  if (request.user.tenantId) {
    throw new ForbiddenError("Only Suntech platform admins can change the store catalogue or its orders.");
  }
}

const productFields = {
  name: z.string().min(2),
  brand: z.string().min(1),
  category: z.enum(CATEGORIES),
  price: z.number().positive("Price must be greater than 0"),
  originalPrice: z.number().positive().nullable(),
  stock: z.number().int().nonnegative(),
  badge: z.string().nullable(),
  shortDescription: z.string().min(5),
  description: z.string().min(10),
  imageUrl: z.string().url(),
  specs: z.array(z.string()),
  warranty: z.string().min(1),
  featured: z.boolean(),
};

const createProductSchema = z.object({
  ...productFields,
  brand: productFields.brand.default("Suntech"),
  originalPrice: productFields.originalPrice.optional(),
  stock: productFields.stock.default(0),
  badge: productFields.badge.optional(),
  specs: productFields.specs.default([]),
  warranty: productFields.warranty.default("1 year"),
  featured: productFields.featured.default(false),
});
const updateProductSchema = z.object(productFields).partial();

function productData(p: Partial<z.infer<typeof updateProductSchema>>) {
  return {
    ...(p.name !== undefined ? { name: p.name } : {}),
    ...(p.brand !== undefined ? { brand: p.brand } : {}),
    ...(p.category !== undefined ? { category: p.category } : {}),
    ...(p.price !== undefined ? { priceMinor: Math.round(p.price * 100) } : {}),
    ...(p.originalPrice !== undefined ? { originalPriceMinor: p.originalPrice === null ? null : Math.round(p.originalPrice * 100) } : {}),
    ...(p.stock !== undefined ? { stock: p.stock } : {}),
    ...(p.badge !== undefined ? { badge: p.badge || null } : {}),
    ...(p.shortDescription !== undefined ? { shortDescription: p.shortDescription } : {}),
    ...(p.description !== undefined ? { description: p.description } : {}),
    ...(p.imageUrl !== undefined ? { imageUrl: p.imageUrl } : {}),
    ...(p.specs !== undefined ? { specs: p.specs } : {}),
    ...(p.warranty !== undefined ? { warranty: p.warranty } : {}),
    ...(p.featured !== undefined ? { featured: p.featured } : {}),
  };
}

// --- Orders ---------------------------------------------------------------------------------------

const createOrderSchema = z.object({
  customerName: z.string().trim().min(2),
  phone: z.string().min(9),
  email: z.string().email().optional().or(z.literal("").transform(() => undefined)),
  county: z.string().min(2),
  deliveryAddress: z.string().trim().min(5),
  items: z.array(z.object({ productId: z.string(), quantity: z.number().int().positive().max(100) })).min(1, "Your cart is empty."),
  paymentMethod: z.enum(["MPESA", "PAY_ON_DELIVERY"]),
});

const buyerQuerySchema = z.object({ phone: z.string().min(9), verify: z.enum(["true", "false"]).optional() });
const orderParams = z.object({ orderNumber: z.string().min(4).max(20) });
const statusSchema = z.object({ status: z.enum(["PENDING", "PAID", "PROCESSING", "DISPATCHED", "DELIVERED", "CANCELLED"]) });

export async function productRoutes(app: FastifyInstance): Promise<void> {
  const preHandler = [authenticate, resolveTenant, checkMaintenance];

  // PUBLIC: the catalogue, optionally by category or search text.
  app.get("/", async (request, reply) => {
    await ensureStoreCatalog();
    const query = z.object({ category: z.string().optional(), search: z.string().optional() }).parse(request.query ?? {});
    const search = query.search?.trim();
    const products = await prisma.storeProduct.findMany({
      where: {
        ...(query.category && query.category !== "all" ? { category: query.category } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { brand: { contains: search, mode: "insensitive" } },
                { shortDescription: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: [{ featured: "desc" }, { createdAt: "asc" }],
    });
    reply.send(successResponse(products.map(toPublicProduct), request.id));
  });

  // PUBLIC: place an order. For M-Pesa the payment prompt goes out in the same call.
  app.post("/orders", { preHandler: [checkMaintenance] }, async (request, reply) => {
    await ensureStoreCatalog();
    const body = createOrderSchema.parse(request.body);
    const { order, paymentError } = await createStoreOrder(body);
    reply.status(201).send(successResponse({ order: toPublicOrder(order), paymentError }, request.id));
  });

  // PUBLIC: track an order by its number (or M-Pesa receipt) plus the phone it was placed with.
  app.get("/orders/track", async (request, reply) => {
    const { q, phone } = z.object({ q: z.string().min(4), phone: z.string().min(9) }).parse(request.query ?? {});
    const byReceipt = await prisma.storeOrder.findUnique({ where: { mpesaReceiptNumber: q.trim().toUpperCase() }, select: { orderNumber: true } });
    const order = await findStoreOrderForBuyer(byReceipt?.orderNumber ?? q, phone);
    reply.send(successResponse(toPublicOrder(order), request.id));
  });

  // SUPER ADMIN: every order, newest first.
  app.get("/orders", { preHandler }, async (request, reply) => {
    assertSuperAdmin(request);
    const orders = await prisma.storeOrder.findMany({ orderBy: { createdAt: "desc" }, take: 500 });
    reply.send(successResponse(orders.map((o) => toPublicOrder(o, { includeContact: true })), request.id));
  });

  // PUBLIC: the buyer checking on their order; verify=true asks M-Pesa directly ("I've paid").
  app.get("/orders/:orderNumber", async (request, reply) => {
    const { orderNumber } = orderParams.parse(request.params);
    const { phone, verify } = buyerQuerySchema.parse(request.query ?? {});
    let order = await findStoreOrderForBuyer(orderNumber, phone);
    if (verify === "true") order = await verifyStoreOrderPayment(order.orderNumber);
    reply.send(successResponse(toPublicOrder(order), request.id));
  });

  // PUBLIC: send the M-Pesa prompt again (after a cancel, a timeout or a failed send).
  app.post("/orders/:orderNumber/pay", { preHandler: [checkMaintenance] }, async (request, reply) => {
    const { orderNumber } = orderParams.parse(request.params);
    const { phone } = z.object({ phone: z.string().min(9) }).parse(request.body);
    const order = await findStoreOrderForBuyer(orderNumber, phone);
    reply.send(successResponse(toPublicOrder(await startStoreOrderPayment(order.orderNumber)), request.id));
  });

  // SUPER ADMIN: move an order along. Marking PAID by hand is for money taken on delivery.
  app.put("/orders/:orderNumber/status", { preHandler }, async (request, reply) => {
    assertSuperAdmin(request);
    const { orderNumber } = orderParams.parse(request.params);
    const { status } = statusSchema.parse(request.body);
    const existing = await prisma.storeOrder.findUnique({ where: { orderNumber } });
    if (!existing) throw new NotFoundError("Order");
    const updated = await prisma.storeOrder.update({
      where: { orderNumber },
      data: { status, ...(status === "PAID" && !existing.paidAt ? { paidAt: new Date() } : {}) },
    });
    await writeAuditLog({
      tenantId: null,
      actorUserId: request.user!.id,
      action: "platform.store_order.status_changed",
      resourceType: "StoreOrder",
      resourceId: updated.id,
      before: { status: existing.status },
      after: { status: updated.status },
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"] ?? null,
    });
    reply.send(successResponse(toPublicOrder(updated, { includeContact: true }), request.id));
  });

  // PUBLIC: one product, by id or slug.
  app.get("/:id", async (request, reply) => {
    await ensureStoreCatalog();
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const product = await prisma.storeProduct.findFirst({ where: { OR: [{ id }, { slug: id }] } });
    if (!product) throw new NotFoundError("Product");
    reply.send(successResponse(toPublicProduct(product), request.id));
  });

  // SUPER ADMIN: add a product.
  app.post("/", { preHandler }, async (request, reply) => {
    assertSuperAdmin(request);
    await ensureStoreCatalog();
    const parsed = createProductSchema.parse(request.body);
    const base = parsed.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const slug = (await prisma.storeProduct.findUnique({ where: { slug: base } })) ? `${base}-${Date.now().toString(36)}` : base;
    const created = await prisma.storeProduct.create({
      data: {
        id: `prod_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        slug,
        ...(productData(parsed) as Omit<Parameters<typeof prisma.storeProduct.create>[0]["data"], "id" | "slug">),
      },
    });
    await writeAuditLog({
      tenantId: null,
      actorUserId: request.user!.id,
      action: "platform.product.created",
      resourceType: "StoreProduct",
      resourceId: created.id,
      after: toPublicProduct(created),
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"] ?? null,
    });
    reply.status(201).send(successResponse(toPublicProduct(created), request.id));
  });

  // SUPER ADMIN: edit a product, including its price.
  app.put("/:id", { preHandler }, async (request, reply) => {
    assertSuperAdmin(request);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const parsed = updateProductSchema.parse(request.body);
    const existing = await prisma.storeProduct.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Product");
    const updated = await prisma.storeProduct.update({ where: { id }, data: productData(parsed) });
    await writeAuditLog({
      tenantId: null,
      actorUserId: request.user!.id,
      action: "platform.product.updated",
      resourceType: "StoreProduct",
      resourceId: id,
      before: { price: existing.priceMinor / 100, stock: existing.stock },
      after: { price: updated.priceMinor / 100, stock: updated.stock },
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"] ?? null,
    });
    reply.send(successResponse(toPublicProduct(updated), request.id));
  });

  // SUPER ADMIN: remove a product. Past orders keep their own copy of it.
  app.delete("/:id", { preHandler }, async (request, reply) => {
    assertSuperAdmin(request);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const existing = await prisma.storeProduct.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Product");
    await prisma.storeProduct.delete({ where: { id } });
    await writeAuditLog({
      tenantId: null,
      actorUserId: request.user!.id,
      action: "platform.product.deleted",
      resourceType: "StoreProduct",
      resourceId: id,
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"] ?? null,
    });
    reply.send(successResponse({ deleted: true, id }, request.id));
  });
}
