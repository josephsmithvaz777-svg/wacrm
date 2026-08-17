import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/**
 * GET /auth/callback
 *
 * Supabase Auth redirects here after email links (password recovery,
 * confirm signup, etc.) with a PKCE `?code=`. Exchange it for a
 * session cookie, then send the user to `?next=` (default /dashboard).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type');
  const nextRaw = searchParams.get('next') || '/dashboard';
  // Only allow same-origin relative paths (open-redirect guard).
  const next =
    nextRaw.startsWith('/') && !nextRaw.startsWith('//')
      ? nextRaw
      : '/dashboard';

  const forwardedHost = request.headers.get('x-forwarded-host');
  const isLocal = process.env.NODE_ENV === 'development';
  const base =
    !isLocal && forwardedHost ? `https://${forwardedHost}` : origin;

  const successUrl = `${base}${next}`;
  const errorUrl = `${base}/login?error=${encodeURIComponent('auth_callback_failed')}`;

  let response = NextResponse.redirect(successUrl);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return response;
    }
    console.error('[auth/callback] exchangeCodeForSession failed:', error.message);
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type: type as 'recovery' | 'signup' | 'invite' | 'magiclink' | 'email',
      token_hash: tokenHash,
    });
    if (!error) {
      return response;
    }
    console.error('[auth/callback] verifyOtp failed:', error.message);
  }

  return NextResponse.redirect(errorUrl);
}
