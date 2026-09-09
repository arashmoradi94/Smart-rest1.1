import { requireAuth } from "@/lib/auth";
import { errorResponse, limit, readJson } from "@/lib/api";
import { validate, profileUpdateSchema } from "@/lib/validators";
import { getOwnProfile, updateOwnProfile } from "@/services/profile-service";

export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    limit(request, user.id, "read");
    return Response.json(await getOwnProfile(user.id));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireAuth();
    limit(request, user.id, "write");
    const { name } = validate(profileUpdateSchema, await readJson(request));
    return Response.json(await updateOwnProfile(user.id, name));
  } catch (e) {
    return errorResponse(e);
  }
}
