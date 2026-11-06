import { authenticated, paymentUrl } from '@/lib/api';
import { isAdministrator } from '@/lib/telegram';

export async function GET(request: Request): Promise<Response> {
  return authenticated(request, async (user) => Response.json({
    user: { id: user.id, first_name: user.first_name },
    is_admin: isAdministrator(user.id),
    payment_url: paymentUrl(),
  }));
}
