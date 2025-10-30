/**
 * URL Shortener - Cloudflare Workers
 * 
 * A fast, scalable URL shortening service with password protection and analytics.
 * Features:
 * - URL shortening with custom codes
 * - Password-protected web interface
 * - Redirect tracking and analytics
 * - CORS-enabled API
 * 
 * Run `npm run dev` to start development server
 * Run `npm run deploy` to deploy to Cloudflare
 */

interface UrlRecord {
  originalUrl: string;
  shortCode: string;
  description: string;
  createdAt: number;
  redirectCount: number;
  lastAccessed?: number;
  expiresAt?: number; // Unix timestamp in milliseconds; undefined means the record does not expire.
  locked?: boolean; // When true, the record is protected from deletion until unlocked.
}

interface Env {
  URLS: KVNamespace;
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.slice(1); // Remove leading slash

    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    try {
      // API routes
      if (path.startsWith('api/')) {
        return await handleApiRequest(request, env, path.slice(4));
      }

      // History page
      if (path === 'history') {
        return await serveHistoryPage(request);
      }

      // Short URL redirect
      if (path && path.length > 0) {
        return await handleRedirect(request, env, path);
      }

      // Serve the main page
      return await serveMainPage(request);
    } catch (error) {
      console.error('Error handling request:', error);
      return new Response('Internal Server Error', { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;

async function handleApiRequest(request: Request, env: Env, endpoint: string): Promise<Response> {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  switch (endpoint) {
    case 'urls':
      if (request.method === 'POST') {
        return await createShortUrl(request, env, corsHeaders);
      } else if (request.method === 'GET') {
        return await listUrls(request, env, corsHeaders);
      } else if (request.method === 'DELETE') {
        return await deleteShortUrl(request, env, corsHeaders);
      }
      break;

    case 'urls/bulk-delete':
      if (request.method === 'POST') {
        return await bulkDeleteUrls(request, env, corsHeaders);
      }
      break;

    case 'urls/lock':
      if (request.method === 'POST' || request.method === 'PUT' || request.method === 'PATCH') {
        return await updateLockState(request, env, corsHeaders);
      }
      break;

    case 'urls/stats':
      if (request.method === 'GET') {
        return await getUrlStats(request, env, corsHeaders);
      }
      break;

    case 'urls/search':
      if (request.method === 'GET') {
        return await searchUrls(request, env, corsHeaders);
      }
      break;
  }

  return new Response('Not Found', { 
    status: 404,
    headers: corsHeaders
  });
}


async function createShortUrl(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  try {
    const body = await request.json() as { url: string; description?: string; expirationType?: string };

    if (!body.url) {
      return new Response(JSON.stringify({ error: 'URL is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Validate URL
    let originalUrl: string;
    try {
      const url = new URL(body.url);
      originalUrl = url.toString();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid URL' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const description = (body.description ?? '').trim();

    // Generate short code
    let shortCode = generateShortCode();

    // Ensure uniqueness
    let attempts = 0;
    while (await env.URLS.get(shortCode) && attempts < 10) {
      shortCode = generateShortCode();
      attempts++;
    }

    let expiresAt: number | undefined;
    if (body.expirationType === '30days') {
      expiresAt = Date.now() + (30 * 24 * 60 * 60 * 1000);
    }

    const urlRecord: UrlRecord = {
      originalUrl,
      shortCode,
      description,
      createdAt: Date.now(),
      redirectCount: 0,
      expiresAt,
      locked: false,
    };

    await env.URLS.put(shortCode, JSON.stringify(urlRecord), getKvPutOptions(urlRecord));

    const shortUrl = `${new URL(request.url).origin}/${shortCode}`;

    return new Response(JSON.stringify({
      shortUrl,
      originalUrl,
      shortCode,
      description: urlRecord.description,
      createdAt: urlRecord.createdAt,
      expiresAt,
    }), {
      status: 201,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error creating short URL:', error);
    return new Response(JSON.stringify({ error: 'Failed to create short URL' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}



async function listUrls(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  try {
    const url = new URL(request.url);
    const rawLimit = url.searchParams.get('limit');
    let limit = Number.parseInt(rawLimit ?? '', 10);

    if (!Number.isInteger(limit) || limit <= 0) {
      limit = 50;
    }

    limit = Math.min(limit, 1000);

    const cursor = url.searchParams.get('cursor') || undefined;

    const listResult = await env.URLS.list({ limit, cursor });
    const urls: UrlRecord[] = [];

    for (const key of listResult.keys) {
      const value = await env.URLS.get(key.name);
      if (!value) {
        continue;
      }

      const record = JSON.parse(value) as UrlRecord;
      record.locked = Boolean(record.locked);

      if (record.expiresAt && Date.now() > record.expiresAt) {
        continue;
      }

      urls.push(record);
    }

    urls.sort((a, b) => b.createdAt - a.createdAt);

    return new Response(JSON.stringify({
      urls,
      cursor: listResult.list_complete ? undefined : listResult.cursor,
      listComplete: listResult.list_complete,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error listing URLs:', error);
    return new Response(JSON.stringify({ error: 'Failed to list URLs' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}



async function deleteShortUrl(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  try {
    const url = new URL(request.url);
    const shortCode = url.searchParams.get('code');

    if (!shortCode) {
      return new Response(JSON.stringify({ error: 'Short code is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const value = await env.URLS.get(shortCode);
    if (!value) {
      return new Response(JSON.stringify({ error: 'URL not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const record: UrlRecord = JSON.parse(value);
    if (record.locked) {
      return new Response(JSON.stringify({ error: 'Record is locked' }), {
        status: 423,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    await env.URLS.delete(shortCode);

    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  } catch (error) {
    console.error('Error deleting URL:', error);
    return new Response(JSON.stringify({ error: 'Failed to delete URL' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

async function bulkDeleteUrls(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  try {
    let body: any = null;
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' } as Record<string, string>;
    const codesInput = Array.isArray(body?.codes) ? body.codes : undefined;
    const uniqueCodes = codesInput
      ? Array.from(new Set(codesInput.map((code: unknown) => typeof code === 'string' ? code.trim() : '').filter((code) => code.length > 0)))
      : undefined;

    const result = { deleted: 0, skippedLocked: 0, notFound: 0 };

    if (uniqueCodes && uniqueCodes.length > 0) {
      for (const shortCode of uniqueCodes) {
        const value = await env.URLS.get(shortCode);
        if (!value) {
          result.notFound++;
          continue;
        }

        const record: UrlRecord = JSON.parse(value);
        if (record.locked) {
          result.skippedLocked++;
          continue;
        }

        await env.URLS.delete(shortCode);
        result.deleted++;
      }

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: jsonHeaders,
      });
    }

    const olderThanDays = typeof body?.olderThanDays === 'number' && body.olderThanDays > 0 ? body.olderThanDays : 120;
    const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;

    let cursor: string | undefined;
    do {
      const listResult = await env.URLS.list({ cursor, limit: 1000 });
      cursor = listResult.cursor;

      for (const key of listResult.keys) {
        const value = await env.URLS.get(key.name);
        if (!value) {
          result.notFound++;
          continue;
        }

        const record: UrlRecord = JSON.parse(value);
        const createdAt = typeof record.createdAt === 'number' ? record.createdAt : 0;

        if (createdAt >= cutoff) {
          continue;
        }

        if (record.locked) {
          result.skippedLocked++;
          continue;
        }

        await env.URLS.delete(key.name);
        result.deleted++;
      }

      if (listResult.list_complete || !cursor) {
        break;
      }
    } while (true);

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: jsonHeaders,
    });
  } catch (error) {
    console.error('Error bulk deleting URLs:', error);
    return new Response(JSON.stringify({ error: 'Failed to bulk delete URLs' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

async function updateLockState(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  try {
    let body: any;
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const shortCode = typeof body?.code === 'string' ? body.code.trim() : '';
    if (!shortCode) {
      return new Response(JSON.stringify({ error: 'Short code is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (typeof body?.locked !== 'boolean') {
      return new Response(JSON.stringify({ error: 'Locked flag must be a boolean' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const value = await env.URLS.get(shortCode);
    if (!value) {
      return new Response(JSON.stringify({ error: 'URL not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const record: UrlRecord = JSON.parse(value);
    const currentLocked = Boolean(record.locked);
    const nextLocked = body.locked as boolean;

    if (currentLocked === nextLocked) {
      return new Response(JSON.stringify({ shortCode, locked: currentLocked }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    record.locked = nextLocked;
    await env.URLS.put(shortCode, JSON.stringify(record), getKvPutOptions(record));

    return new Response(JSON.stringify({ shortCode, locked: nextLocked }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error updating lock state:', error);
    return new Response(JSON.stringify({ error: 'Failed to update lock state' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

async function searchUrls(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  try {
    const url = new URL(request.url);
    const query = url.searchParams.get('q');

    if (!query) {
      return new Response(JSON.stringify({ error: 'Search query is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const listLimit = 1000;
    const maxScan = 5000;
    let scanned = 0;
    let cursor: string | undefined;
    let scanLimitHit = false;
    const matches: UrlRecord[] = [];
    const normalizedQuery = query.toLowerCase();

    do {
      const listResult = await env.URLS.list({ cursor, limit: listLimit });
      cursor = listResult.cursor;
      scanned += listResult.keys.length;

      for (const key of listResult.keys) {
        const value = await env.URLS.get(key.name);
        if (!value) {
          continue;
        }

        const record = JSON.parse(value) as UrlRecord;
        record.locked = Boolean(record.locked);
        if (record.expiresAt && Date.now() > record.expiresAt) {
          continue;
        }

        if (record.description && record.description.toLowerCase().includes(normalizedQuery)) {
          matches.push(record);
        }
      }

      if (!listResult.list_complete && scanned >= maxScan) {
        scanLimitHit = true;
        break;
      }

      if (listResult.list_complete || !cursor) {
        break;
      }
    } while (true);

    matches.sort((a, b) => b.createdAt - a.createdAt);

    return new Response(JSON.stringify({
      urls: matches,
      query,
      total: matches.length,
      scanLimitHit,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error searching URLs:', error);
    return new Response(JSON.stringify({ error: 'Failed to search URLs' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}



async function getUrlStats(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  try {
    const url = new URL(request.url);
    const shortCode = url.searchParams.get('code');

    if (!shortCode) {
      return new Response(JSON.stringify({ error: 'Short code is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const value = await env.URLS.get(shortCode);
    if (!value) {
      return new Response(JSON.stringify({ error: 'URL not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const urlRecord: UrlRecord = JSON.parse(value);

    return new Response(JSON.stringify({
      shortCode: urlRecord.shortCode,
      originalUrl: urlRecord.originalUrl,
      redirectCount: urlRecord.redirectCount ?? 0,
      createdAt: urlRecord.createdAt,
      lastAccessed: urlRecord.lastAccessed ?? null,
      expiresAt: urlRecord.expiresAt ?? null,
      locked: Boolean(urlRecord.locked),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error getting URL stats:', error);
    return new Response(JSON.stringify({ error: 'Failed to get URL stats' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}




function getKvPutOptions(record: UrlRecord): KVNamespacePutOptions | undefined {
  if (record.expiresAt) {
    return { expiration: Math.floor(record.expiresAt / 1000) };
  }
  return undefined;
}

async function handleRedirect(request: Request, env: Env, shortCode: string): Promise<Response> {
  try {
    const value = await env.URLS.get(shortCode);
    if (!value) {
      return new Response('URL not found', { status: 404 });
    }

    const urlRecord: UrlRecord = JSON.parse(value);

    if (urlRecord.expiresAt && Date.now() > urlRecord.expiresAt) {
      await env.URLS.delete(shortCode);
      return new Response('URL has expired', { status: 410 });
    }

    urlRecord.redirectCount = (urlRecord.redirectCount ?? 0) + 1;
    urlRecord.lastAccessed = Date.now();

    await env.URLS.put(shortCode, JSON.stringify(urlRecord), getKvPutOptions(urlRecord));

    return new Response(null, {
      status: 302,
      headers: {
        'Location': urlRecord.originalUrl,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      }
    });
  } catch (error) {
    console.error('Error handling redirect:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}


async function serveMainPage(request: Request): Promise<Response> {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>URL Shortener</title>
    <style>
        /* Material Design Typography */
        @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap');
        
        * {
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Roboto', -apple-system, BlinkMacSystemFont, sans-serif;
            margin: 0;
            padding: 0;
            background: #fafafa;
            min-height: 100vh;
            color: #202124;
            line-height: 1.5;
        }
        
        /* Material Design Elevation */
        .elevation-1 {
            box-shadow: 0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24);
        }
        
        .elevation-2 {
            box-shadow: 0 3px 6px rgba(0,0,0,0.16), 0 3px 6px rgba(0,0,0,0.23);
        }
        
        .elevation-3 {
            box-shadow: 0 10px 20px rgba(0,0,0,0.19), 0 6px 6px rgba(0,0,0,0.23);
        }
        
        .elevation-4 {
            box-shadow: 0 14px 28px rgba(0,0,0,0.25), 0 10px 10px rgba(0,0,0,0.22);
        }
        
        /* Layout */
        .app-container {
            max-width: 1000px;
            margin: 0 auto;
            padding: 16px;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
        }
        
        /* Password Screen */
        .password-screen {
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            background: #fafafa;
        }
        
        .password-card {
            background: white;
            border-radius: 12px;
            padding: 48px;
            width: 100%;
            max-width: 400px;
            text-align: center;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        
        .password-card:hover {
            transform: translateY(-2px);
        }
        
        .password-card h1 {
            color: #202124;
            font-size: 28px;
            font-weight: 400;
            margin: 0 0 16px 0;
            letter-spacing: 0.25px;
        }
        
        .password-card p {
            color: #5f6368;
            font-size: 14px;
            margin: 0 0 32px 0;
            font-weight: 400;
        }
        
        /* Form Elements */
        .form-group {
            margin-bottom: 16px;
        }
        
        .form-row {
            display: flex;
            gap: 16px;
            margin-bottom: 16px;
        }
        
        .form-group-description {
            flex: 2;
        }
        
        .form-group-expiration {
            flex: 1;
        }
        
        .form-row .form-group {
            margin-bottom: 0;
        }
        
        .form-label {
            display: block;
            color: #202124;
            font-size: 14px;
            font-weight: 500;
            margin-bottom: 6px;
            letter-spacing: 0.25px;
        }
        
        .form-input, .form-select {
            width: 100%;
            padding: 12px;
            border: 1px solid #dadce0;
            border-radius: 6px;
            font-size: 14px;
            font-family: 'Roboto', sans-serif;
            background: white;
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            color: #202124;
        }
        
        .form-input:focus, .form-select:focus {
            outline: none;
            border-color: #1a73e8;
            box-shadow: 0 0 0 2px rgba(26, 115, 232, 0.2);
        }
        
        .form-input::placeholder {
            color: #9aa0a6;
        }
        
        /* Buttons */
        .btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 10px 20px;
            border: none;
            border-radius: 6px;
            font-family: 'Roboto', sans-serif;
            font-size: 14px;
            font-weight: 500;
            text-decoration: none;
            cursor: pointer;
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            letter-spacing: 0.25px;
            min-height: 36px;
        }
        
        .btn:focus {
            outline: none;
            box-shadow: 0 0 0 2px rgba(26, 115, 232, 0.2);
        }
        
        .btn-primary {
            background: #1a73e8;
            color: white;
        }
        
        .btn-primary:hover {
            background: #1557b0;
            transform: translateY(-1px);
        }
        
        .btn-secondary {
            background: #f1f3f4;
            color: #202124;
        }
        
        .btn-secondary:hover {
            background: #e8eaed;
        }
        
        .btn-danger {
            background: #d93025;
            color: white;
        }
        
        .btn-danger:hover {
            background: #b31412;
        }

        .icon-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 28px;
            height: 28px;
            border-radius: 6px;
            border: 1px solid transparent;
            background: #f1f3f4;
            color: #5f6368;
            font-size: 14px;
            cursor: pointer;
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .icon-btn:hover:not([disabled]) {
            background: #e8eaed;
            color: #202124;
        }

        .icon-btn.locked {
            background: #fce8e6;
            color: #b31412;
            border-color: #f8bbb0;
        }

        .icon-btn.danger {
            background: #fde0dc;
            color: #b31412;
        }

        .icon-btn[disabled] {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .btn-success {
            background: #137333;
            color: white;
        }
        
        .btn-success:hover {
            background: #0f5a1f;
        }
        
        .btn-full {
            width: 100%;
        }
        
        /* Main App Content */
        .app-content {
            display: none;
            flex: 1;
        }
        
        .app-content.show {
            display: block;
        }
        
        .app-header {
            background: white;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 16px;
            text-align: center;
        }
        
        .app-header h1 {
            color: #202124;
            font-size: 28px;
            font-weight: 400;
            margin: 0 0 6px 0;
            letter-spacing: 0.25px;
        }
        
        .app-header p {
            color: #5f6368;
            font-size: 14px;
            margin: 0;
            font-weight: 400;
        }
        
        /* URL Form Card */
        .url-form-card {
            background: white;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 16px;
        }
        
        .url-form-card h2 {
            color: #202124;
            font-size: 18px;
            font-weight: 500;
            margin: 0 0 16px 0;
            letter-spacing: 0.15px;
        }
        
        /* Result Card */
        .result-card {
            background: white;
            border-radius: 8px;
            padding: 16px;
            margin-top: 16px;
            display: none;
            border-left: 4px solid #137333;
        }
        
        .result-card.show {
            display: block;
            animation: slideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        
        @keyframes slideIn {
            from {
                opacity: 0;
                transform: translateY(-10px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
        
        .short-url {
            font-size: 18px;
            color: #1a73e8;
            word-break: break-all;
            margin-bottom: 16px;
            font-weight: 500;
        }
        
        /* Error States */
        .error {
            color: #d93025;
            font-size: 14px;
            margin-top: 8px;
            display: none;
            font-weight: 400;
        }
        
        .error.show {
            display: block;
            animation: shake 0.5s cubic-bezier(0.36, 0.07, 0.19, 0.97);
        }
        
        @keyframes shake {
            0%, 100% { transform: translateX(0); }
            25% { transform: translateX(-5px); }
            75% { transform: translateX(5px); }
        }
        
        /* Recent URLs Section */
        .urls-section {
            background: white;
            border-radius: 8px;
            padding: 20px;
        }
        
        .urls-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 16px;
            flex-wrap: wrap;
            gap: 12px;
        }
        
        .urls-header h2 {
            color: #202124;
            font-size: 18px;
            font-weight: 500;
            margin: 0;
            letter-spacing: 0.15px;
        }
        
        .urls-actions {
            display: flex;
            gap: 12px;
        }
        
        .url-list {
            display: flex;
            flex-direction: column;
            gap: 12px;
            max-height: 800px;
            overflow-y: auto;
        }
        
        .url-item {
            background: #f8f9fa;
            border-radius: 8px;
            padding: 14px 16px;
            margin-bottom: 10px;
            border: 1px solid #e8eaed;
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }
        
        .url-item:hover {
            background: #f1f3f4;
            transform: translateY(-1px);
        }
        
        .url-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 12px;
            padding-bottom: 8px;
            border-bottom: 1px solid #e8eaed;
            gap: 12px;
        }

        .url-toolbar,
        .url-header-main {
            display: flex;
            align-items: center;
            gap: 10px;
            flex: 1;
            min-width: 0;
            flex-wrap: wrap;
        }

        .record-checkbox {
            margin-right: 2px;
        }

        .url-description {
            color: #202124;
            font-weight: 500;
            font-size: 14px;
            letter-spacing: 0.15px;
            flex: 1;
            min-width: 140px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        
        .url-date {
            color: #9aa0a6;
            font-size: 12px;
            font-weight: 400;
            text-align: right;
        }
        
        .url-original {
            display: none;
            color: #5f6368;
            font-size: 13px;
            margin-bottom: 6px;
            word-break: break-all;
            font-weight: 400;
        }
        
        .url-short {
            color: #1a73e8;
            font-size: 13px;
            margin-bottom: 8px;
            font-weight: 500;
        }
        
        .url-meta {
            color: #9aa0a6;
            font-size: 11px;
            margin-bottom: 6px;
            font-weight: 400;
        }
        
        .url-stats {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
            margin-top: 6px;
        }

        .stat-chip {
            background: #e8f0fe;
            color: #1a73e8;
            padding: 3px 10px;
            border-radius: 14px;
            font-size: 11px;
            font-weight: 500;
            letter-spacing: 0.15px;
        }
        
        .stat-chip.success {
            background: #e6f4ea;
            color: #137333;
        }

        .stat-chip.warning {
            background: #fef7e0;
            color: #b06000;
        }

        .stat-chip.danger {
            background: #fce8e6;
            color: #d93025;
        }

        /* Empty States */
        .empty-state {
            text-align: center;
            padding: 48px 24px;
            color: #9aa0a6;
        }
        
        .empty-state p {
            font-size: 16px;
            margin: 0;
            font-weight: 400;
        }
        
        /* Responsive Design */
        @media (max-width: 768px) {
            .form-row {
                flex-direction: column;
                gap: 0;
            }
            
            .form-row .form-group {
                margin-bottom: 16px;
            }
            .app-container {
                padding: 16px;
            }
            
            .password-card,
            .url-form-card,
            .urls-section {
                padding: 24px;
            }
            
            .urls-header {
                flex-direction: column;
                align-items: stretch;
            }
            
            .urls-actions {
                justify-content: center;
            }
            
            .btn {
                padding: 10px 20px;
                font-size: 13px;
            }
        }
        
        /* Focus Management */
        .form-input:focus,
        .btn:focus {
            outline: none;
            box-shadow: 0 0 0 2px rgba(26, 115, 232, 0.2);
        }
        
        /* High Contrast Support */
        @media (prefers-contrast: high) {
            .form-input {
                border-width: 2px;
            }
            
            .btn {
                border: 2px solid transparent;
            }
        }
        
        /* Reduced Motion */
        @media (prefers-reduced-motion: reduce) {
            * {
                animation-duration: 0.01ms !important;
                animation-iteration-count: 1 !important;
                transition-duration: 0.01ms !important;
            }
        }
    </style>
</head>
<body>
    <!-- Password Screen -->
    <div id="passwordScreen" class="password-screen">
        <div class="password-card elevation-2">
            <h1>URL Shortener</h1>
            <p>Please enter the password to continue.</p>
            <form id="passwordForm">
                <div class="form-group">
                    <label for="password" class="form-label">Password</label>
                    <input type="password" id="password" name="password" class="form-input" placeholder="Enter password" required>
                </div>
                <button type="submit" class="btn btn-primary btn-full">Access App</button>
            </form>
            <div class="error" id="passwordError"></div>
        </div>
    </div>
        
        <!-- App Content -->
        <div id="appContent" class="app-content">
            <div class="app-container">
                <div class="app-header elevation-1">
                    <h1>URL Shortener</h1>
                </div>
                
                <div class="url-form-card elevation-1">
                    <h2>Create Short URL</h2>
                    <form id="urlForm">
                        <div class="form-group">
                            <label for="originalUrl" class="form-label">Long URL</label>
                            <input type="url" id="originalUrl" name="originalUrl" class="form-input" placeholder="https://example.com/very-long-url" required>
                        </div>
                        
                        <div class="form-row">
                            <div class="form-group form-group-description">
                                <label for="description" class="form-label">Description</label>
                                <input type="text" id="description" name="description" class="form-input" placeholder="[Project]-[Date of Issue]_[Description]" maxlength="100" required>
                            </div>
                            
                            <div class="form-group form-group-expiration">
                                <label for="expirationType" class="form-label">Expiration</label>
                                <select id="expirationType" name="expirationType" class="form-select">
                                    <option value="permanent">Permanent</option>
                                    <option value="30days">30 days</option>
                                </select>
                            </div>
                        </div>
                        
                        <button type="submit" class="btn btn-primary btn-full">Create Short URL</button>
                    </form>
                    
                    <div class="error" id="error"></div>
                    
                    <div class="result-card" id="result">
                        <div class="short-url" id="shortUrl"></div>
                        <button class="btn btn-success" onclick="copyToClipboard()">Copy to Clipboard</button>
                    </div>
                </div>
                
                <!-- Recent URLs Section -->
                <div class="urls-section elevation-1">
                    <div class="urls-header">
                        <h2>Recent URLs</h2>
                        <div class="urls-actions">
                            <button class="btn btn-secondary" onclick="loadRecentUrls()">Refresh</button>
                            <a href="/history" target="_blank" class="btn btn-secondary">View All History</a>
                        </div>
                    </div>
                    <div class="url-list" id="urlList">
                        <div class="empty-state">
                            <p>Loading recent URLs...</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>

    <script>
        const CORRECT_PASSWORD = '0258';
        
        // Check if already authenticated
        if (localStorage.getItem('urlShortenerAuthenticated') === 'true') {
            showApp();
        }
        
        document.getElementById('passwordForm').addEventListener('submit', function(e) {
            e.preventDefault();
            const password = document.getElementById('password').value;
            const errorDiv = document.getElementById('passwordError');
            
            if (password === CORRECT_PASSWORD) {
                localStorage.setItem('urlShortenerAuthenticated', 'true');
                showApp();
            } else {
                errorDiv.textContent = 'Incorrect password. Please try again.';
                errorDiv.classList.add('show');
                document.getElementById('password').value = '';
            }
        });
        
        function showApp() {
            document.getElementById('passwordScreen').style.display = 'none';
            document.getElementById('appContent').classList.add('show');
            loadRecentUrls();
        }
        

        
        document.getElementById('urlForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const originalUrl = document.getElementById('originalUrl').value;
            const description = document.getElementById('description').value;
            const expirationType = document.getElementById('expirationType').value;
            const errorDiv = document.getElementById('error');
            const resultDiv = document.getElementById('result');
            
            // Hide previous results
            errorDiv.classList.remove('show');
            resultDiv.classList.remove('show');
            
            try {
                const response = await fetch('/api/urls', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        url: originalUrl,
                        description: description,
                        expirationType: expirationType
                    })
                });
                
                const data = await response.json();
                
                if (!response.ok) {
                    throw new Error(data.error || 'Failed to create short URL');
                }
                
                // Show result
                document.getElementById('shortUrl').textContent = data.shortUrl;
                resultDiv.classList.add('show');
                
                // Clear form
                document.getElementById('originalUrl').value = '';
                document.getElementById('description').value = '';
                
                // Refresh recent URLs
                loadRecentUrls();
                
            } catch (error) {
                errorDiv.textContent = error.message;
                errorDiv.classList.add('show');
            }
        });
        
        function copyToClipboard() {
            const shortUrl = document.getElementById('shortUrl').textContent;
            navigator.clipboard.writeText(shortUrl).then(() => {
                const btn = document.querySelector('.btn-success');
                const originalText = btn.textContent;
                btn.textContent = 'Copied!';
                setTimeout(() => {
                    btn.textContent = originalText;
                }, 2000);
            }).catch(err => {
                console.error('Failed to copy to clipboard:', err);
                // Fallback for older browsers
                const textArea = document.createElement('textarea');
                textArea.value = shortUrl;
                document.body.appendChild(textArea);
                textArea.select();
                try {
                    document.execCommand('copy');
                    const btn = document.querySelector('.btn-success');
                    const originalText = btn.textContent;
                    btn.textContent = 'Copied!';
                    setTimeout(() => {
                        btn.textContent = originalText;
                    }, 2000);
                } catch (fallbackErr) {
                    console.error('Fallback copy failed:', fallbackErr);
                    alert('Failed to copy to clipboard. Please copy manually: ' + shortUrl);
                }
                document.body.removeChild(textArea);
            });
        }
        
        async function loadRecentUrls() {
            const urlList = document.getElementById('urlList');
            urlList.innerHTML = '<div class="no-urls">Loading recent URLs...</div>';
            
            try {
                const response = await fetch('/api/urls?limit=10');
                const data = await response.json();
                
                if (data.urls && data.urls.length > 0) {
                    const urlsHtml = data.urls.map(url => {
                        const createdAt = new Date(url.createdAt).toLocaleString();
                        const lastAccessed = url.lastAccessed ? new Date(url.lastAccessed).toLocaleString() : 'Never';
                        const shortUrl = window.location.origin + '/' + url.shortCode;
                        
                        // 计算过期状态
                        let expirationInfo = '';
                        if (url.expiresAt) {
                            const expiresAt = new Date(url.expiresAt);
                            const now = new Date();
                            const isExpired = now > expiresAt;
                            const expiresText = expiresAt.toLocaleString();
                            
                            if (isExpired) {
                                expirationInfo = \`<span class="stat-chip" style="background: #fce8e6; color: #d93025;">Expired</span>\`;
                            } else {
                                expirationInfo = \`<span class="stat-chip warning">Expires: \${expiresText}</span>\`;
                            }
                        } else {
                            expirationInfo = \`<span class="stat-chip success">Permanent</span>\`;
                        }
                        
                        return \`
                            <div class="url-item elevation-1">
                                <div class="url-header">
                                    <span class="url-description">\${url.description}</span>
                                    <span class="url-date">\${createdAt}</span>
                                </div>
                                <div class="url-original">\${url.originalUrl}</div>
                                <div class="url-short">\${shortUrl}</div>
                                <div class="url-stats">
                                    <span class="stat-chip">\${url.redirectCount} redirects</span>
                                    <span class="stat-chip warning">Last: \${lastAccessed}</span>
                                    \${expirationInfo}
                                </div>
                            </div>
                        \`;
                    }).join('');
                    
                    urlList.innerHTML = urlsHtml;
                } else {
                    urlList.innerHTML = '<div class="empty-state"><p>No URLs created yet. Create your first short URL above!</p></div>';
                }
            } catch (error) {
                urlList.innerHTML = '<div class="empty-state"><p>Error loading recent URLs. Please try again.</p></div>';
            }
        }
    </script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    }
  });
}

async function serveHistoryPage(request: Request): Promise<Response> {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>URL History - URL Shortener</title>
    <style>
        /* Material Design Typography */
        @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap');
        
        * {
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Roboto', -apple-system, BlinkMacSystemFont, sans-serif;
            margin: 0;
            padding: 0;
            background: #fafafa;
            min-height: 100vh;
            color: #202124;
            line-height: 1.5;
        }
        
        /* Material Design Elevation */
        .elevation-1 {
            box-shadow: 0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24);
        }
        
        .elevation-2 {
            box-shadow: 0 3px 6px rgba(0,0,0,0.16), 0 3px 6px rgba(0,0,0,0.23);
        }
        
        .elevation-3 {
            box-shadow: 0 10px 20px rgba(0,0,0,0.19), 0 6px 6px rgba(0,0,0,0.23);
        }
        
        /* Layout */
        .app-container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 24px;
            min-height: 100vh;
        }
        
        /* Header */
        .header {
            background: white;
            border-radius: 12px;
            padding: 32px;
            margin-bottom: 24px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 20px;
        }

        .header-actions {
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
        }
        
        h1 {
            color: #202124;
            margin: 0;
            font-size: 32px;
            font-weight: 400;
            letter-spacing: 0.25px;
        }
        
        /* Buttons */
        .btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 12px 24px;
            border: none;
            border-radius: 8px;
            font-family: 'Roboto', sans-serif;
            font-size: 14px;
            font-weight: 500;
            text-decoration: none;
            cursor: pointer;
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            letter-spacing: 0.25px;
            min-height: 40px;
        }
        
        .btn:focus {
            outline: none;
            box-shadow: 0 0 0 2px rgba(26, 115, 232, 0.2);
        }
        
        .btn-secondary {
            background: #f1f3f4;
            color: #202124;
        }
        
        .btn-secondary:hover {
            background: #e8eaed;
        }
        
        .btn-primary {
            background: #1a73e8;
            color: white;
        }
        
        .btn-primary:hover {
            background: #1557b0;
        }
        
        .btn-danger {
            background: #d93025;
            color: white;
        }
        
        .btn-danger:hover {
            background: #b31412;
        }
        
        /* Search Section */
        .search-section {
            background: white;
            border-radius: 12px;
            padding: 32px;
            margin-bottom: 24px;
        }

        .search-title {
            margin: 0 0 16px 0;
            font-size: 20px;
            font-weight: 500;
            color: #202124;
        }
        
        .search-form {
            display: flex;
            gap: 16px;
            align-items: center;
            flex-wrap: wrap;
        }

        .bulk-actions {
            background: white;
            border-radius: 12px;
            padding: 24px 32px;
            margin-bottom: 24px;
            display: flex;
            flex-wrap: wrap;
            justify-content: space-between;
            gap: 16px;
            align-items: center;
        }

        .bulk-summary {
            display: flex;
            flex-direction: column;
            gap: 8px;
            color: #5f6368;
            font-size: 14px;
        }

        .selection-count {
            font-weight: 500;
            color: #202124;
        }

        .bulk-tip {
            font-size: 12px;
        }

        .bulk-buttons {
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
        }

        .btn[disabled] {
            opacity: 0.6;
            cursor: not-allowed;
        }

        .action-feedback {
            background: #e8f0fe;
            border-radius: 12px;
            padding: 16px 32px;
            margin-bottom: 16px;
            color: #1a73e8;
            font-size: 14px;
        }

        .action-feedback.success {
            background: #e6f4ea;
            color: #137333;
        }

        .action-feedback.error {
            background: #fce8e6;
            color: #d93025;
        }

        .action-feedback.info {
            background: #e8f0fe;
            color: #1a73e8;
        }

        .search-input {
            flex: 1;
            min-width: 300px;
            padding: 16px;
            border: 1px solid #dadce0;
            border-radius: 8px;
            font-size: 16px;
            font-family: 'Roboto', sans-serif;
            background: white;
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            color: #202124;
        }
        
        .search-input:focus {
            outline: none;
            border-color: #1a73e8;
            box-shadow: 0 0 0 2px rgba(26, 115, 232, 0.2);
        }
        
        .search-input::placeholder {
            color: #9aa0a6;
        }
        
        /* Results Info */
        .results-info {
            background: white;
            border-radius: 12px;
            padding: 16px 32px;
            margin-bottom: 24px;
            color: #5f6368;
            font-size: 14px;
            font-weight: 400;
        }
        
        /* URL List */
        .url-list {
            background: white;
            border-radius: 12px;
            padding: 32px;
            max-height: 850px;
            overflow-y: auto;
        }
        
        .url-item {
            background: #f8f9fa;
            border-radius: 8px;
            padding: 14px 16px;
            margin-bottom: 10px;
            border: 1px solid #e8eaed;
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .url-item:hover {
            background: #f1f3f4;
            transform: translateY(-1px);
        }

        .url-item.locked {
            border-color: #fce8e6;
            background: #fff7f7;
        }

        .url-item:last-child {
            margin-bottom: 0;
        }

        /* URL Header */
        .url-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 12px;
            padding-bottom: 8px;
            border-bottom: 1px solid #e8eaed;
            gap: 12px;
        }

        .url-toolbar,
        .url-header-main {
            display: flex;
            align-items: center;
            gap: 10px;
            flex: 1;
            min-width: 0;
            flex-wrap: wrap;
        }

        .record-checkbox {
            margin-right: 2px;
        }

        .url-description {
            color: #202124;
            font-weight: 500;
            font-size: 14px;
            letter-spacing: 0.15px;
            flex: 1;
            min-width: 140px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .url-date {
            color: #9aa0a6;
            font-size: 12px;
            font-weight: 400;
            text-align: right;
        }

        .url-original {
            color: #5f6368;
            font-size: 12px;
            margin-bottom: 6px;
            word-break: break-word;
            font-weight: 400;
        }

        .url-short {
            color: #1a73e8;
            font-size: 13px;
            margin-bottom: 6px;
            font-weight: 500;
        }

        .url-stats {
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
        }
        
        .stat-chip {
            background: #e8f0fe;
            color: #1a73e8;
            padding: 3px 10px;
            border-radius: 14px;
            font-size: 11px;
            font-weight: 500;
            letter-spacing: 0.15px;
        }
        
        .stat-chip.success {
            background: #e6f4ea;
            color: #137333;
        }
        
        .stat-chip.warning {
            background: #fef7e0;
            color: #b06000;
        }
        
        /* Empty States */
        .empty-state {
            text-align: center;
            padding: 48px 24px;
            color: #9aa0a6;
        }
        
        .empty-state p {
            font-size: 16px;
            margin: 0;
            font-weight: 400;
        }
        
        .loading {
            text-align: center;
            padding: 48px 24px;
            color: #9aa0a6;
        }
        
        .loading p {
            font-size: 16px;
            margin: 0;
            font-weight: 400;
        }
        
        /* Error States */
        .error {
            color: #d93025;
            text-align: center;
            padding: 16px 32px;
            background: #fce8e6;
            border-radius: 8px;
            margin-bottom: 24px;
            font-size: 14px;
            font-weight: 400;
        }
        
        /* Responsive Design */
        @media (max-width: 768px) {
            .app-container {
                padding: 16px;
            }
            
            .header,
            .search-section,
            .url-list {
                padding: 24px;
            }
            
            .header {
                flex-direction: column;
                align-items: stretch;
            }
            
            .search-form {
                flex-direction: column;
            }
            
            .search-input {
                min-width: auto;
            }
            
            .btn {
                padding: 10px 20px;
                font-size: 13px;
            }
        }
        
        /* Focus Management */
        .search-input:focus,
        .btn:focus {
            outline: none;
            box-shadow: 0 0 0 2px rgba(26, 115, 232, 0.2);
        }
        
        /* High Contrast Support */
        @media (prefers-contrast: high) {
            .search-input {
                border-width: 2px;
            }
            
            .btn {
                border: 2px solid transparent;
            }
        }
        
        /* Reduced Motion */
        @media (prefers-reduced-motion: reduce) {
            * {
                animation-duration: 0.01ms !important;
                animation-iteration-count: 1 !important;
                transition-duration: 0.01ms !important;
            }
        }
    </style>
</head>
<body>
    <div class="app-container">
        <div class="header elevation-1">
            <h1>URL History</h1>
            <div class="header-actions">
                <a href="/" class="btn btn-secondary">← Back to Shortener</a>
                <a href="/history" class="btn btn-secondary">View All History</a>
            </div>
        </div>
        
        <div class="search-section elevation-1">
            <h2 class="search-title">Search in notes</h2>
            <form id="searchForm" class="search-form">
                <input 
                    type="text" 
                    id="searchInput" 
                    class="search-input" 
                    placeholder="Search in descriptions... (e.g., 'github', 'project', 'work')"
                    autocomplete="off">
                <button type="submit" class="btn btn-primary">Search</button>
                <button type="button" class="btn btn-danger" onclick="clearSearch()">Clear</button>
            </form>
        </div>

        <div class="bulk-actions elevation-1">
            <div class="bulk-summary">
                <span class="selection-count" id="selectionCount">No records selected</span>
                <span class="bulk-tip">Locked records stay safe until you unlock them.</span>
            </div>
            <div class="bulk-buttons">
                <button type="button" class="btn btn-secondary" onclick="selectOlderThan120()">Select >120 days</button>
                <button type="button" class="btn btn-secondary" onclick="clearSelection()">Clear selection</button>
                <button type="button" class="btn btn-danger" id="deleteSelectedBtn" onclick="deleteSelected()" disabled>Delete selected</button>
            </div>
        </div>

        <div id="actionFeedback" class="action-feedback" style="display: none;"></div>
        <div id="resultsInfo" class="results-info elevation-1"></div>
        <div id="error" class="error" style="display: none;"></div>
        
        <div class="url-list elevation-1" id="urlList">
            <div class="loading">
                <p>Loading all URLs...</p>
            </div>
        </div>
    </div>

    <script>
        const DAY_MS = 24 * 60 * 60 * 1000;
        const BULK_THRESHOLD_DAYS = 120;

        let allUrls = [];
        let currentQuery = '';
        const selectedCodes = new Set();

        const urlList = document.getElementById('urlList');
        const resultsInfo = document.getElementById('resultsInfo');
        const errorDiv = document.getElementById('error');
        const selectionCountEl = document.getElementById('selectionCount');
        const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
        const actionFeedback = document.getElementById('actionFeedback');

        window.addEventListener('load', loadAllUrls);

        document.getElementById('searchForm').addEventListener('submit', (event) => {
            event.preventDefault();
            const query = document.getElementById('searchInput').value.trim();
            if (query) {
                searchUrls(query);
            } else {
                loadAllUrls();
            }
        });

        function showLoading(message) {
            urlList.innerHTML = '<div class="loading"><p>' + message + '</p></div>';
        }

        function clearError() {
            errorDiv.textContent = '';
            errorDiv.style.display = 'none';
        }

        function showError(message) {
            errorDiv.textContent = message;
            errorDiv.style.display = 'block';
            hideFeedback();
        }

        function hideFeedback() {
            if (!actionFeedback) {
                return;
            }
            actionFeedback.style.display = 'none';
            actionFeedback.className = 'action-feedback';
            actionFeedback.textContent = '';
        }

        function showFeedback(message, type) {
            if (!actionFeedback) {
                return;
            }
            const variant = type || 'info';
            actionFeedback.textContent = message;
            actionFeedback.className = 'action-feedback ' + variant;
            actionFeedback.style.display = 'block';
        }

        function updateSelectionUI() {
            const count = selectedCodes.size;
            if (selectionCountEl) {
                selectionCountEl.textContent = count === 0
                    ? 'No records selected'
                    : count + ' record' + (count === 1 ? '' : 's') + ' selected';
            }
            if (deleteSelectedBtn) {
                deleteSelectedBtn.disabled = count === 0;
            }
        }

        function handleCheckboxChange(shortCode, checked) {
            if (checked) {
                selectedCodes.add(shortCode);
            } else {
                selectedCodes.delete(shortCode);
            }
            updateSelectionUI();
        }

        function selectOlderThan120() {
            selectedCodes.clear();
            const cutoff = Date.now() - BULK_THRESHOLD_DAYS * DAY_MS;
            allUrls.forEach((url) => {
                if (!url.locked && typeof url.createdAt === 'number' && url.createdAt < cutoff) {
                    selectedCodes.add(url.shortCode);
                }
            });
            displayUrls(allUrls);
            if (selectedCodes.size > 0) {
                showFeedback('Selected ' + selectedCodes.size + ' record' + (selectedCodes.size === 1 ? '' : 's') + ' older than ' + BULK_THRESHOLD_DAYS + ' days.', 'success');
            } else {
                showFeedback('No unlocked records older than ' + BULK_THRESHOLD_DAYS + ' days were found.', 'info');
            }
        }

        function clearSelection() {
            selectedCodes.clear();
            displayUrls(allUrls);
            showFeedback('Selection cleared.', 'info');
        }

        async function deleteSingle(shortCode) {
            if (!confirm('Delete this short URL? This action cannot be undone.')) {
                return;
            }
            clearError();
            hideFeedback();
            try {
                const response = await fetch('/api/urls?code=' + encodeURIComponent(shortCode), {
                    method: 'DELETE'
                });

                if (response.status === 204) {
                    selectedCodes.delete(shortCode);
                    await refreshCurrentView();
                    showFeedback('URL deleted successfully.', 'success');
                    return;
                }

                let data = {};
                try {
                    data = await response.json();
                } catch {
                    data = {};
                }

                if (response.status === 423) {
                    showError('This record is locked. Unlock it before deleting.');
                } else {
                    showError(data.error || 'Failed to delete URL.');
                }
            } catch (error) {
                console.error(error);
                showError('Failed to delete URL. Please try again.');
            }
        }

        async function deleteSelected() {
            if (selectedCodes.size === 0) {
                return;
            }

            if (!confirm('Delete ' + selectedCodes.size + ' selected record' + (selectedCodes.size === 1 ? '' : 's') + '? This action cannot be undone.')) {
                return;
            }

            clearError();
            hideFeedback();

            try {
                const response = await fetch('/api/urls/bulk-delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ codes: Array.from(selectedCodes) })
                });
                const data = await response.json().catch(() => ({}));

                if (!response.ok) {
                    throw new Error(data.error || 'Bulk delete failed');
                }

                selectedCodes.clear();
                await refreshCurrentView();

                const summary = [];
                if (typeof data.deleted === 'number') {
                    summary.push(data.deleted + ' deleted');
                }
                if (typeof data.skippedLocked === 'number' && data.skippedLocked > 0) {
                    summary.push(data.skippedLocked + ' locked');
                }
                if (typeof data.notFound === 'number' && data.notFound > 0) {
                    summary.push(data.notFound + ' missing');
                }

                const message = summary.length > 0
                    ? 'Bulk delete complete: ' + summary.join(', ') + '.'
                    : 'Bulk delete complete.';
                showFeedback(message, 'success');
            } catch (error) {
                console.error(error);
                showError(error.message || 'Bulk delete failed. Please try again.');
            }
        }

        async function toggleLock(shortCode, shouldLock) {
            clearError();
            hideFeedback();

            try {
                const response = await fetch('/api/urls/lock', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ code: shortCode, locked: shouldLock })
                });
                const data = await response.json().catch(() => ({}));

                if (!response.ok) {
                    throw new Error(data.error || 'Failed to update lock state');
                }

                if (shouldLock) {
                    selectedCodes.delete(shortCode);
                }

                await refreshCurrentView();
                showFeedback(shouldLock ? 'Record locked.' : 'Record unlocked.', 'success');
            } catch (error) {
                console.error(error);
                showError(error.message || 'Failed to update lock state.');
            }
        }

        function clearSearch() {
            document.getElementById('searchInput').value = '';
            loadAllUrls();
        }

        async function refreshCurrentView() {
            if (currentQuery) {
                await searchUrls(currentQuery);
            } else {
                await loadAllUrls();
            }
        }

        async function loadAllUrls() {
            currentQuery = '';
            clearError();
            hideFeedback();
            showLoading('Loading all URLs...');

            try {
                const response = await fetch('/api/urls');
                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || 'Failed to load URLs');
                }

                const urls = Array.isArray(data.urls) ? data.urls : [];
                allUrls = urls;

                if (urls.length === 0) {
                    urlList.innerHTML = '<div class="empty-state"><p>No URLs found. Create your first short URL!</p></div>';
                    resultsInfo.textContent = '';
                    selectedCodes.clear();
                    updateSelectionUI();
                    return;
                }

                displayUrls(urls);
                resultsInfo.textContent = 'Showing all ' + urls.length + ' URLs (sorted by most recent)';
            } catch (error) {
                console.error(error);
                urlList.innerHTML = '';
                showError('Error loading URLs. Please try again.');
                resultsInfo.textContent = '';
            }
        }

        async function searchUrls(query) {
            currentQuery = query;
            clearError();
            hideFeedback();
            showLoading('Searching...');

            try {
                const response = await fetch('/api/urls/search?q=' + encodeURIComponent(query));
                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || 'Search failed');
                }

                const urls = Array.isArray(data.urls) ? data.urls : [];
                allUrls = urls;

                if (urls.length === 0) {
                    urlList.innerHTML = '<div class="empty-state"><p>No URLs found matching your search.</p></div>';
                    resultsInfo.textContent = 'No URLs found matching "' + query + '".';
                    selectedCodes.clear();
                    updateSelectionUI();
                    return;
                }

                displayUrls(urls);

                let message = 'Found ' + (typeof data.total === 'number' ? data.total : urls.length) + ' URLs matching "' + query + '" in descriptions';
                if (data.scanLimitHit) {
                    message += ' (partial results)';
                }
                resultsInfo.textContent = message;
            } catch (error) {
                console.error(error);
                urlList.innerHTML = '';
                showError(error.message || 'Search error. Please try again.');
                resultsInfo.textContent = '';
            }
        }

        function displayUrls(urls) {
            const availableCodes = new Set(urls.filter((url) => !url.locked).map((url) => url.shortCode));
            Array.from(selectedCodes).forEach((code) => {
                if (!availableCodes.has(code)) {
                    selectedCodes.delete(code);
                }
            });

            if (urls.length === 0) {
                urlList.innerHTML = '<div class="empty-state"><p>No URLs found matching your search.</p></div>';
                updateSelectionUI();
                return;
            }

            const urlsHtml = urls.map((url) => {
                const createdAt = new Date(url.createdAt).toLocaleString();
                const lastAccessed = url.lastAccessed ? new Date(url.lastAccessed).toLocaleString() : 'Never';
                const shortUrl = window.location.origin + '/' + url.shortCode;
                const locked = Boolean(url.locked);

                let expirationInfo = '<span class="stat-chip success">Permanent</span>';
                if (url.expiresAt) {
                    const expiresAtDate = new Date(url.expiresAt);
                    const now = new Date();
                    const expiresText = expiresAtDate.toLocaleString();
                    expirationInfo = now > expiresAtDate
                        ? '<span class="stat-chip danger">Expired</span>'
                        : '<span class="stat-chip warning">Expires: ' + expiresText + '</span>';
                }

                const descriptionText = url.description ? url.description : '(no description)';

                return \`
                    <div class="url-item elevation-1\${locked ? ' locked' : ''}">
                        <div class="url-header">
                            <div class="url-toolbar">
                                <input type="checkbox" class="record-checkbox" data-code="\${url.shortCode}" \${locked ? 'disabled' : ''} \${selectedCodes.has(url.shortCode) ? 'checked' : ''} onchange="handleCheckboxChange('\${url.shortCode}', this.checked)" aria-label="Select \${descriptionText}">
                                <button class="icon-btn \${locked ? 'locked' : ''}" type="button" title="\${locked ? 'Unlock record' : 'Lock record'}" aria-pressed="\${locked ? 'true' : 'false'}" onclick="toggleLock('\${url.shortCode}', \${locked ? 'false' : 'true'})">
                                    \${locked ? '&#128274;' : '&#128275;'}
                                </button>
                                <button class="icon-btn danger" type="button" title="Delete record" onclick="deleteSingle('\${url.shortCode}')" \${locked ? 'disabled' : ''}>
                                    &#128465;
                                </button>
                                <span class="url-description" title="\${descriptionText}">\${descriptionText}</span>
                                \${locked ? '<span class="stat-chip danger">Locked</span>' : ''}
                            </div>
                            <span class="url-date">\${createdAt}</span>
                        </div>
                        <div class="url-original">\${url.originalUrl}</div>
                        <div class="url-short">\${shortUrl}</div>
                        <div class="url-stats">
                            <span class="stat-chip">\${url.redirectCount} redirects</span>
                            <span class="stat-chip warning">Last: \${lastAccessed}</span>
                            \${expirationInfo}
                        </div>
                    </div>
                \`;
            }).join('');

            urlList.innerHTML = urlsHtml;
            updateSelectionUI();
        }
    </script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    }
  });
}

function generateShortCode(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}


export class RedirectCounter {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    switch (url.pathname) {
      case '/increment':
        if (request.method !== 'POST') {
          return new Response('Method Not Allowed', { status: 405 });
        }
        return this.handleIncrement();
      case '/stats':
        return this.handleStats();
      case '/reset':
        if (request.method !== 'POST') {
          return new Response('Method Not Allowed', { status: 405 });
        }
        return this.handleReset();
      default:
        return new Response('Not Found', { status: 404 });
    }
  }

  private async handleIncrement(): Promise<Response> {
    const current = (await this.state.storage.get<number>('count')) ?? 0;
    const next = current + 1;
    const lastAccessed = Date.now();

    await this.state.storage.put('count', next);
    await this.state.storage.put('lastAccessed', lastAccessed);

    return new Response(JSON.stringify({
      redirectCount: next,
      lastAccessed,
    }), {
      headers: {
        'Content-Type': 'application/json',
      }
    });
  }

  private async handleStats(): Promise<Response> {
    const count = (await this.state.storage.get<number>('count')) ?? 0;
    const lastAccessed = await this.state.storage.get<number>('lastAccessed');

    if (count === 0 && typeof lastAccessed !== 'number') {
      return new Response('Not Found', { status: 404 });
    }

    return new Response(JSON.stringify({
      redirectCount: count,
      lastAccessed: typeof lastAccessed === 'number' ? lastAccessed : undefined,
    }), {
      headers: {
        'Content-Type': 'application/json',
      }
    });
  }

  private async handleReset(): Promise<Response> {
    await this.state.storage.deleteAll();
    return new Response(null, { status: 204 });
  }
}
