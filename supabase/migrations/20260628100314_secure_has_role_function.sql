/*
# Secure has_role RPC endpoint

The `public.has_role(_user_id uuid, _role public.app_role)` function is a `SECURITY DEFINER`
function used internally by RLS policies to check whether a user has a given role (e.g. `admin`).
Because it is `SECURITY DEFINER`, it runs with elevated privileges. It was previously executable
by `anon` and `authenticated` roles via the PostgREST `/rest/v1/rpc/has_role` endpoint, which
allowed any client to probe role membership.

This migration revokes `EXECUTE` on the function from both `anon` and `authenticated` roles.
The function will continue to work inside RLS policies because those execute within the database
engine's policy evaluation context, not via the PostgREST RPC layer.

1. Security changes
- Revoke `EXECUTE` on `public.has_role` from `anon`.
- Revoke `EXECUTE` on `public.has_role` from `authenticated`.
*/

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM authenticated;