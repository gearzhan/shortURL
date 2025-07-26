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

  it('rejects URLs without description', async () => {
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
    
    expect(response.status).toBe(400);
    
    const data = await response.json() as any;
    expect(data.error).toBe('Description is required');
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
