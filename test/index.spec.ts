import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src/index';

// Type for incoming requests
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe('URL Shortener Worker', () => {
  it('serves the main page with password protection', async () => {
    const request = new IncomingRequest('http://example.com/');
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env as any, ctx);
    await waitOnExecutionContext(ctx);
    
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    
    const html = await response.text();
    expect(html).toContain('URL Shortener');
    expect(html).toContain('Please enter the password');
    expect(html).toContain('0258'); // Password in the JavaScript
  });

  it('creates a short URL via API', async () => {
    const request = new IncomingRequest('http://example.com/api/urls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/very-long-url' })
    });
    
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env as any, ctx);
    await waitOnExecutionContext(ctx);
    
    expect(response.status).toBe(201);
    
    const data = await response.json() as any;
    expect(data.shortUrl).toMatch(/^http:\/\/example\.com\/[a-z0-9]{6}$/);
    expect(data.originalUrl).toBe('https://example.com/very-long-url');
    expect(data.shortCode).toMatch(/^[a-z0-9]{6}$/);
    expect(data.createdAt).toBeTypeOf('number');
  });

  it('creates a short URL with description via API', async () => {
    const request = new IncomingRequest('http://example.com/api/urls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        url: 'https://example.com/very-long-url-with-description',
        description: 'This is a test description'
      })
    });
    
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env as any, ctx);
    await waitOnExecutionContext(ctx);
    
    expect(response.status).toBe(201);
    
    const data = await response.json() as any;
    expect(data.shortUrl).toMatch(/^http:\/\/example\.com\/[a-z0-9]{6}$/);
    expect(data.originalUrl).toBe('https://example.com/very-long-url-with-description');
    expect(data.shortCode).toMatch(/^[a-z0-9]{6}$/);
    expect(data.description).toBe('This is a test description');
    expect(data.createdAt).toBeTypeOf('number');
  });

  it('allows URLs without description', async () => {
    const request = new IncomingRequest('http://example.com/api/urls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        url: 'https://example.com/valid-url',
        description: ''
      })
    });
    
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env as any, ctx);
    await waitOnExecutionContext(ctx);
    
    expect(response.status).toBe(201);
    
    const data = await response.json() as any;
    expect(data.description).toBe('');
  });

  it('rejects invalid URLs', async () => {
    const request = new IncomingRequest('http://example.com/api/urls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'not-a-valid-url' })
    });
    
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env as any, ctx);
    await waitOnExecutionContext(ctx);
    
    expect(response.status).toBe(400);
    
    const data = await response.json() as any;
    expect(data.error).toBe('Invalid URL');
  });

  it('tracks redirect metrics using Durable Objects', async () => {
    const createRequest = new IncomingRequest('http://example.com/api/urls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://example.com/redirect-target',
        description: 'Redirect metrics test'
      })
    });

    const createCtx = createExecutionContext();
    const createResponse = await worker.fetch(createRequest, env as any, createCtx);
    await waitOnExecutionContext(createCtx);

    expect(createResponse.status).toBe(201);
    const created = await createResponse.json() as any;
    const shortCode = created.shortCode as string;

    const redirectRequest = new IncomingRequest(`http://example.com/${shortCode}`);
    const redirectCtx = createExecutionContext();
    const redirectResponse = await worker.fetch(redirectRequest, env as any, redirectCtx);
    await waitOnExecutionContext(redirectCtx);

    expect(redirectResponse.status).toBe(302);

    const statsRequest = new IncomingRequest(`http://example.com/api/urls/stats?code=${shortCode}`);
    const statsCtx = createExecutionContext();
    const statsResponse = await worker.fetch(statsRequest, env as any, statsCtx);
    await waitOnExecutionContext(statsCtx);

    expect(statsResponse.status).toBe(200);
    const stats = await statsResponse.json() as any;
    expect(stats.redirectCount).toBeGreaterThanOrEqual(1);
    expect(stats.lastAccessed).toBeTypeOf('number');
  });

  it('handles CORS preflight requests', async () => {
    const request = new IncomingRequest('http://example.com/api/urls', {
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://example.com',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type'
      }
    });
    
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env as any, ctx);
    await waitOnExecutionContext(ctx);
    
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-methods')).toContain('POST');
  });

  it('prevents deletion of locked URLs until unlocked', async () => {
    const createRequest = new IncomingRequest('http://example.com/api/urls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://example.com/lock-target',
        description: 'Lock test'
      })
    });

    const createCtx = createExecutionContext();
    const createResponse = await worker.fetch(createRequest, env as any, createCtx);
    await waitOnExecutionContext(createCtx);

    expect(createResponse.status).toBe(201);
    const created = await createResponse.json() as any;
    const shortCode = created.shortCode as string;

    const lockRequest = new IncomingRequest('http://example.com/api/urls/lock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: shortCode, locked: true })
    });
    const lockCtx = createExecutionContext();
    const lockResponse = await worker.fetch(lockRequest, env as any, lockCtx);
    await waitOnExecutionContext(lockCtx);

    expect(lockResponse.status).toBe(200);
    const lockData = await lockResponse.json() as any;
    expect(lockData.locked).toBe(true);

    const deleteWhileLocked = new IncomingRequest(`http://example.com/api/urls?code=${shortCode}`, {
      method: 'DELETE'
    });
    const deleteLockedCtx = createExecutionContext();
    const deleteLockedResponse = await worker.fetch(deleteWhileLocked, env as any, deleteLockedCtx);
    await waitOnExecutionContext(deleteLockedCtx);

    expect(deleteLockedResponse.status).toBe(423);

    const unlockRequest = new IncomingRequest('http://example.com/api/urls/lock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: shortCode, locked: false })
    });
    const unlockCtx = createExecutionContext();
    const unlockResponse = await worker.fetch(unlockRequest, env as any, unlockCtx);
    await waitOnExecutionContext(unlockCtx);

    expect(unlockResponse.status).toBe(200);
    const unlockData = await unlockResponse.json() as any;
    expect(unlockData.locked).toBe(false);

    const deleteRequest = new IncomingRequest(`http://example.com/api/urls?code=${shortCode}`, {
      method: 'DELETE'
    });
    const deleteCtx = createExecutionContext();
    const deleteResponse = await worker.fetch(deleteRequest, env as any, deleteCtx);
    await waitOnExecutionContext(deleteCtx);

    expect(deleteResponse.status).toBe(204);

    const stored = await env.URLS.get(shortCode);
    expect(stored).toBeNull();
  });

  it('bulk deletes URLs older than the configured threshold while respecting locks', async () => {
    const create = async (description: string) => {
      const request = new IncomingRequest('http://example.com/api/urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: 'https://example.com/' + description.toLowerCase().replace(/\s+/g, '-'),
          description
        })
      });
      const ctx = createExecutionContext();
      const response = await worker.fetch(request, env as any, ctx);
      await waitOnExecutionContext(ctx);
      expect(response.status).toBe(201);
      return response.json() as Promise<any>;
    };

    const first = await create('Old unlocked record');
    const second = await create('Old locked record');
    const recent = await create('Recent record');

    const dayMs = 24 * 60 * 60 * 1000;
    const now = Date.now();

    const firstRecord = JSON.parse((await env.URLS.get(first.shortCode))!);
    firstRecord.createdAt = now - 130 * dayMs;
    firstRecord.locked = false;
    await env.URLS.put(first.shortCode, JSON.stringify(firstRecord));

    const secondRecord = JSON.parse((await env.URLS.get(second.shortCode))!);
    secondRecord.createdAt = now - 140 * dayMs;
    secondRecord.locked = true;
    await env.URLS.put(second.shortCode, JSON.stringify(secondRecord));

    const recentRecord = JSON.parse((await env.URLS.get(recent.shortCode))!);
    recentRecord.createdAt = now - 5 * dayMs;
    recentRecord.locked = false;
    await env.URLS.put(recent.shortCode, JSON.stringify(recentRecord));

    const bulkRequest = new IncomingRequest('http://example.com/api/urls/bulk-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ olderThanDays: 120 })
    });
    const bulkCtx = createExecutionContext();
    const bulkResponse = await worker.fetch(bulkRequest, env as any, bulkCtx);
    await waitOnExecutionContext(bulkCtx);

    expect(bulkResponse.status).toBe(200);
    const result = await bulkResponse.json() as any;
    expect(result.deleted).toBeGreaterThanOrEqual(1);
    expect(result.skippedLocked).toBeGreaterThanOrEqual(1);

    const firstAfter = await env.URLS.get(first.shortCode);
    const secondAfter = await env.URLS.get(second.shortCode);
    const recentAfter = await env.URLS.get(recent.shortCode);

    expect(firstAfter).toBeNull();
    expect(secondAfter).not.toBeNull();
    expect(recentAfter).not.toBeNull();
  });

  it('serves the history page', async () => {
    const request = new IncomingRequest('http://example.com/history');
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env as any, ctx);
    await waitOnExecutionContext(ctx);
    
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    
    const html = await response.text();
    expect(html).toContain('URL History');
    expect(html).toContain('Search in notes');
    expect(html).toContain('View All History');
  });

  it('searches URLs by descriptions', async () => {
    const request = new IncomingRequest('http://example.com/api/urls/search?q=test');
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env as any, ctx);
    await waitOnExecutionContext(ctx);
    
    expect(response.status).toBe(200);
    
    const data = await response.json() as any;
    expect(data).toHaveProperty('urls');
    expect(data).toHaveProperty('query', 'test');
    expect(data).toHaveProperty('total');
    expect(Array.isArray(data.urls)).toBe(true);
  });

  it('requires search query parameter', async () => {
    const request = new IncomingRequest('http://example.com/api/urls/search');
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env as any, ctx);
    await waitOnExecutionContext(ctx);
    
    expect(response.status).toBe(400);
    
    const data = await response.json() as any;
    expect(data.error).toBe('Search query is required');
  });
});
