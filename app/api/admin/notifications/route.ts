import { authenticated, requireAdmin } from '@/lib/api';
import { tryFlushNotifications } from '@/lib/notifications';

export async function POST(request: Request): Promise<Response> {
  return authenticated(request, async (user) => {
    requireAdmin(user);
    await tryFlushNotifications();
    return Response.json({ attempted: true });
  });
}
