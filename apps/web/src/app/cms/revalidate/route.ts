import { revalidatePath, revalidateTag } from "next/cache";
import { HOMEPAGE_TAG } from "@/lib/sanity";
import { verifySanitySignature } from "@/lib/sanity-webhook";

/**
 * Sanity webhook: publish in the Studio and the homepage updates at once instead of within five
 * minutes. Lives under /cms, not /api, because the proxy sends /api/* to the API service.
 *
 * Sanity signs each delivery with the webhook's secret (header `sanity-webhook-signature`,
 * "t=<ms>,v1=<base64url HMAC-SHA256 of `${t}.${body}`>"); anything unsigned or stale is refused.
 */

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.SANITY_REVALIDATE_SECRET?.trim();
  if (!secret) return Response.json({ ok: false, message: "SANITY_REVALIDATE_SECRET is not set" }, { status: 503 });
  const body = await request.text();
  if (!verifySanitySignature(request.headers.get("sanity-webhook-signature"), body, secret)) {
    return Response.json({ ok: false, message: "Bad signature" }, { status: 401 });
  }
  revalidateTag(HOMEPAGE_TAG);
  revalidatePath("/");
  return Response.json({ ok: true, revalidated: true });
}
