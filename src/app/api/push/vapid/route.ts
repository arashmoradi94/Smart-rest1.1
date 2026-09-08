import { getVapidPublicKey } from "@/lib/push";
import { errorResponse, limit } from "@/lib/api";

export function GET(request: Request) {
  try {
    limit(request, undefined, "read");
    return Response.json({ publicKey: getVapidPublicKey() }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
