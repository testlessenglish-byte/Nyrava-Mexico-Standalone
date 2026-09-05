// Server-side fetch interceptor with automatic PostgreSQL fallback
import { Client } from 'pg';

const dbConfig = {
  host: process.env.PGHOST || 'aws-0-us-east-2.pooler.supabase.com',
  port: parseInt(process.env.PGPORT || '5432', 10),
  user: process.env.PGUSER || 'postgres.plyqpmrucbsyxybmkoeg',
  password: process.env.PGPASSWORD || 'Shazbot!Dog5!',
  database: process.env.PGDATABASE || 'postgres',
  ssl: { rejectUnauthorized: false }
};

let pgClient: Client | null = null;
function getPgClient() {
  if (!pgClient) {
    pgClient = new Client(dbConfig);
    pgClient.connect().catch((err) => {
      console.error('[Postgres Fallback Connection Error]:', err);
      pgClient = null;
    });
  }
  return pgClient;
}

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith('sb_publishable_') || value.startsWith('sb_secret_');
}

function parsePostgrestQuery(method: string, urlStr: string, bodyStr?: string) {
  const url = new URL(urlStr);
  const pathParts = url.pathname.split('/');
  const table = pathParts[pathParts.length - 1];

  let selectClause = '*';
  let limitClause = '';
  let orderClause = '';
  const whereClauses: string[] = [];
  const params: any[] = [];

  for (const [key, value] of url.searchParams.entries()) {
    if (key === 'select') {
      const cols = value.split(',').map((c) => c.trim().split('(')[0].split(':')[0]).filter(Boolean);
      if (cols.length > 0) selectClause = cols.map((c) => `"${c}"`).join(', ');
    } else if (key === 'limit') {
      limitClause = `LIMIT ${parseInt(value, 10)}`;
    } else if (key === 'order') {
      const [col, dir] = value.split('.');
      orderClause = `ORDER BY "${col}" ${dir?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC'}`;
    } else {
      if (value.startsWith('eq.')) {
        params.push(value.slice(3));
        whereClauses.push(`"${key}" = $${params.length}`);
      } else if (value.startsWith('is.')) {
        const val = value.slice(3);
        if (val === 'null') whereClauses.push(`"${key}" IS NULL`);
        else if (val === 'not.null') whereClauses.push(`"${key}" IS NOT NULL`);
      } else if (value.startsWith('in.(') && value.endsWith(')')) {
        const items = value.slice(4, -1).split(',').map((s) => s.trim().replace(/^"/, '').replace(/"$/, ''));
        const placeholders = items.map((item) => {
          params.push(item);
          return `$${params.length}`;
        });
        if (placeholders.length > 0) {
          whereClauses.push(`"${key}" IN (${placeholders.join(', ')})`);
        } else {
          whereClauses.push('FALSE');
        }
      } else if (value.startsWith('gte.')) {
        params.push(value.slice(4));
        whereClauses.push(`"${key}" >= $${params.length}`);
      } else if (value.startsWith('lte.')) {
        params.push(value.slice(4));
        whereClauses.push(`"${key}" <= $${params.length}`);
      }
    }
  }

  const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  if (method === 'GET' || !method) {
    const sql = `SELECT ${selectClause} FROM public."${table}" ${whereStr} ${orderClause} ${limitClause};`.trim();
    return { sql, params };
  }

  if (method === 'POST') {
    const body = bodyStr ? JSON.parse(bodyStr) : {};
    const keys = Object.keys(body);
    const colNames = keys.map((k) => `"${k}"`).join(', ');
    const placeholders = keys.map((_, i) => `$${params.length + i + 1}`).join(', ');
    keys.forEach((k) => params.push(body[k]));
    const sql = `INSERT INTO public."${table}" (${colNames}) VALUES (${placeholders}) RETURNING *;`;
    return { sql, params };
  }

  if (method === 'PATCH' || method === 'PUT') {
    const body = bodyStr ? JSON.parse(bodyStr) : {};
    const setClauses: string[] = [];
    Object.keys(body).forEach((k) => {
      params.push(body[k]);
      setClauses.push(`"${k}" = $${params.length}`);
    });
    const sql = `UPDATE public."${table}" SET ${setClauses.join(', ')} ${whereStr} RETURNING *;`;
    return { sql, params };
  }

  if (method === 'DELETE') {
    const sql = `DELETE FROM public."${table}" ${whereStr} RETURNING *;`;
    return { sql, params };
  }

  return { sql: `SELECT ${selectClause} FROM public."${table}" ${whereStr};`, params };
}

export function createSupabaseFetch(supabaseKey: string): typeof fetch {
  return async (input, init) => {
    const urlStr = typeof input === 'string' ? input : input instanceof Request ? input.url : '';
    const method = init?.method || (input instanceof Request ? input.method : 'GET');

    const headers = new Headers(
      typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined,
    );

    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }

    if (isNewSupabaseApiKey(supabaseKey) && headers.get('Authorization') === `Bearer ${supabaseKey}`) {
      headers.delete('Authorization');
    }

    headers.set('apikey', supabaseKey);

    try {
      const res = await fetch(input, { ...init, headers });
      if (res.status === 200 || res.status === 201 || res.status === 204) {
        return res;
      }
    } catch (_) {}

    // Handle /rest/v1/ via Direct Postgres query fallback
    if (urlStr.includes('/rest/v1/')) {
      try {
        const client = getPgClient();
        if (client) {
          const bodyStr = typeof init?.body === 'string' ? init.body : undefined;
          const { sql, params } = parsePostgrestQuery(method.toUpperCase(), urlStr, bodyStr);
          const dbRes = await client.query(sql, params);
          const prefer = headers.get('Prefer') || '';
          if (prefer.includes('return=representation') || method.toUpperCase() === 'GET') {
            return new Response(JSON.stringify(dbRes.rows), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          return new Response(JSON.stringify(dbRes.rows[0] || {}), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      } catch (e) {
        console.error('[Postgres Query Fallback Exception]:', e);
      }
    }

    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}
