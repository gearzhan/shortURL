# 🔗 URL Shortener

A fast, scalable URL shortening service built with Cloudflare Workers and KV storage. This service allows you to create short, memorable URLs that redirect to longer original URLs.

## ✨ Features

- **🔗 URL Shortening**: Convert long URLs into short, shareable links
- **📝 Descriptions**: Add descriptions to remember what each link is for (required)
- **📊 Analytics**: Track redirect counts and access times
- **🔍 Search**: Search through all URLs by their descriptions
- **📚 History**: View complete URL history with search functionality
- **🌐 CORS Support**: Full CORS support for API integration
- **⚡ Edge Performance**: Runs on Cloudflare's global edge network
- **💾 Persistent Storage**: Uses Cloudflare KV for reliable data storage
- **🎨 Beautiful UI**: Modern, responsive web interface
- **🔒 Secure**: Input validation and error handling

## 🚀 Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher)
- [Cloudflare account](https://dash.cloudflare.com/sign-up)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)

### Installation

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd short
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up Cloudflare KV**
   
   First, create a KV namespace:
   ```bash
   npx wrangler kv:namespace create "URLS"
   ```
   
   Then create a preview namespace for development:
   ```bash
   npx wrangler kv:namespace create "URLS" --preview
   ```

4. **Update configuration**
   
   Update `wrangler.jsonc` with your KV namespace IDs:
   ```json
   {
     "kv_namespaces": [
       {
         "binding": "URLS",
         "id": "your-production-kv-id",
         "preview_id": "your-preview-kv-id"
       }
     ]
   }
   ```

5. **Deploy to Cloudflare**
   ```bash
   npm run deploy
   ```

## 🛠️ Development

### Local Development

Start the development server:
```bash
npm run dev
```

This will start a local development server at `http://localhost:8787`.

### Testing

Run the test suite:
```bash
npm test
```

Run tests in watch mode:
```bash
npm test -- --watch
```

## 📖 API Reference

### Base URL
```
https://your-worker.your-subdomain.workers.dev
```

### Endpoints

#### Create Short URL
**POST** `/api/urls`

Creates a new short URL.

**Request Body:**
```json
{
  "url": "https://example.com/very-long-url",
  "description": "Description of what this URL is for" // required
}
```

**Response:**
```json
{
  "shortUrl": "https://your-worker.workers.dev/abc123",
  "originalUrl": "https://example.com/very-long-url",
  "shortCode": "abc123",
  "description": "Description of what this URL is for",
  "createdAt": 1640995200000
}
```

#### List URLs
**GET** `/api/urls`

Lists all created URLs with pagination.

**Query Parameters:**
- `limit` (optional): Number of URLs to return (default: 50)
- `cursor` (optional): Pagination cursor

**Response:**
```json
{
  "urls": [
    {
      "originalUrl": "https://example.com/very-long-url",
      "shortCode": "abc123",
      "description": "Description of what this URL is for",
      "createdAt": 1640995200000,
      "redirectCount": 42,
      "lastAccessed": 1640995300000
    }
  ],
  "cursor": "next-page-cursor",
  "listComplete": false
}
```

#### Get URL Statistics
**GET** `/api/urls/stats`

Get statistics for a specific short URL.

**Query Parameters:**
- `code` (required): The short code to get stats for

**Response:**
```json
{
  "shortCode": "abc123",
  "originalUrl": "https://example.com/very-long-url",
  "redirectCount": 42,
  "createdAt": 1640995200000,
  "lastAccessed": 1640995300000
}
```

#### Search URLs by Descriptions
**GET** `/api/urls/search`

Search for URLs by their descriptions (case-insensitive).

**Query Parameters:**
- `q` (required): Search query to match against notes

**Response:**
```json
{
  "urls": [
    {
      "originalUrl": "https://example.com/very-long-url",
      "shortCode": "abc123",
      "description": "This is a test URL with a description",
      "createdAt": 1640995200000,
      "redirectCount": 42,
      "lastAccessed": 1640995300000
    }
  ],
  "query": "test",
  "total": 1
}
```

#### Redirect
**GET** `/{shortCode}`

Redirects to the original URL.

**Response:**
- **302 Redirect** to the original URL
- **404 Not Found** if the short code doesn't exist

## 🎨 Web Interface

The service includes a beautiful, responsive web interface accessible at the root URL. Features include:

### Main Page (`/`)
- **URL Shortening**: Create short URLs with optional notes
- **Recent URLs**: View the last 10 URLs with notes and statistics
- **Password Protection**: Secure access with password authentication

### History Page (`/history`)
- **Complete History**: View all created URLs
- **Search Functionality**: Search through URLs by their descriptions
- **Responsive Design**: Works on desktop and mobile devices
- **Sorting**: URLs are sorted by creation date (most recent first)

- **Simple URL Input**: Just paste your long URL and get a short one
- **Descriptions**: Add descriptions to remember what each link is for (required)
- **Copy to Clipboard**: One-click copying of generated URLs
- **Recent URLs**: View the last 10 URLs with notes and statistics
- **Full History**: Access complete URL history with search functionality
- **Error Handling**: Clear error messages for invalid inputs
- **Mobile Responsive**: Works perfectly on all devices

## 🔧 Configuration

### Environment Variables

The service uses Cloudflare KV for storage. No additional environment variables are required.

### Customization

You can customize the service by modifying:

- **Short Code Generation**: Edit the `generateShortCode()` function in `src/index.ts`
- **UI Styling**: Modify the CSS in the `serveMainPage()` function
- **Validation Rules**: Update URL validation and note length rules
- **CORS Settings**: Modify CORS headers in the API functions

## 📊 Data Structure

URLs are stored in Cloudflare KV with the following structure:

```typescript
interface UrlRecord {
  originalUrl: string;      // The original long URL
  shortCode: string;        // The short code (KV key)
  createdAt: number;        // Creation timestamp
  redirectCount: number;    // Number of redirects
  lastAccessed?: number;    // Last access timestamp
}
```

## 🚀 Deployment

### Production Deployment

1. **Build and deploy:**
   ```bash
   npm run deploy
   ```

2. **Set up custom domain (optional):**
   ```bash
   npx wrangler domain add your-domain.com
   ```

### Environment Management

- **Production**: Uses production KV namespace
- **Preview**: Uses preview KV namespace for testing
- **Local Development**: Uses local KV simulation

## 🔒 Security Considerations

- **Input Validation**: All URLs are validated before processing
- **Custom Code Sanitization**: Custom codes are sanitized to prevent injection
- **Rate Limiting**: Consider implementing rate limiting for production use
- **HTTPS Only**: All requests should use HTTPS in production

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request

## 📝 License

This project is licensed under the MIT License.

## 🆘 Support

If you encounter any issues:

1. Check the [Cloudflare Workers documentation](https://developers.cloudflare.com/workers/)
2. Review the test suite for usage examples
3. Open an issue on GitHub

## 🎯 Roadmap

- [ ] Rate limiting
- [ ] URL expiration dates
- [ ] Password protection for URLs
- [ ] QR code generation
- [ ] Advanced analytics dashboard
- [ ] Bulk URL import/export
- [ ] API authentication
- [ ] URL categories/tags 

## 🎨 **Summary of Embedding Options:**

### **1. Iframe Embedding** (`embed-example.html`)
- ✅ **Pros**: Full app with password protection and recent URLs
- ✅ **Pros**: No need to modify your existing site design
- ❌ **Cons**: Limited customization, separate scroll context

### **2. API Integration** (`api-integration-example.html`)
- ✅ **Pros**: Full control over design and user experience
- ✅ **Pros**: Seamless integration with your site
- ✅ **Pros**: Can customize features and styling
- ❌ **Cons**: Need to implement password protection yourself if needed

### **3. Simple Widget** (`simple-widget.html`)
- ✅ **Pros**: Minimal, lightweight integration
- ✅ **Pros**: Easy to add to any website
- ✅ **Pros**: Customizable styling
- ❌ **Cons**: Basic functionality only

## 🎨 **Quick Embed Code:**

For the simplest embed, just add this to your HTML:

```html
<iframe 
    src="https://short.g-zhanyu.workers.dev" 
    width="100%" 
    height="600px" 
    style="border: none; border-radius: 8px;">
</iframe>
```

## 🔧 **API Endpoints for Custom Integration:**

- **Create URL**: `POST https://short.g-zhanyu.workers.dev/api/urls`
- **List URLs**: `GET https://short.g-zhanyu.workers.dev/api/urls`
- **Get Stats**: `GET https://short.g-zhanyu.workers.dev/api/urls/stats/{shortCode}`

**Which embedding approach would you prefer?** I can help you customize any of these options for your specific needs! 