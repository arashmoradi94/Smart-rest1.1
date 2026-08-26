import { getVapidPublicKey } from "@/lib/push";

export function GET() {
  return Response.json({ publicKey: getVapidPublicKey() });
}
