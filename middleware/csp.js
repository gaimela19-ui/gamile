/**
 * Content Security Policy Middleware
 * Provides secure CSP headers to prevent XSS and code injection attacks
 */

export const cspMiddleware = (req, res, next) => {
  // Define CSP directives
  const cspDirectives = {
    'default-src': ["'self'"],
    'script-src': [
      "'self'",
      // Allow specific external scripts
      "https://connect.facebook.net",
      "https://www.googletagmanager.com",
      "https://www.google-analytics.com",
      "https://js.stripe.com",
      "https://checkout.stripe.com",
      // For development - allow unsafe-inline and unsafe-eval
      ...(process.env.NODE_ENV === 'development' ? ["'unsafe-inline'", "'unsafe-eval'"] : []),
      // For production - allow unsafe-eval for bundler optimizations (minimal risk for built code)
      ...(process.env.NODE_ENV === 'production' ? ["'unsafe-eval'"] : [])
    ],
    'style-src': [
      "'self'",
      "'unsafe-inline'", // Required for styled-components and inline styles
      "https://fonts.googleapis.com"
    ],
    'font-src': [
      "'self'",
      "https://fonts.gstatic.com",
      "data:"
    ],
    'img-src': [
      "'self'",
      "data:",
      "blob:",
      "https:",
      // Allow external image services
      "https://res.cloudinary.com",
      "https://images.unsplash.com",
      "https://www.facebook.com", // For Facebook Pixel tracking image
      "https://barcode.tec-it.com" // For barcode generation
    ],
    'connect-src': [
      "'self'",
      "https://api.stripe.com",
      "https://connect.facebook.net",
      "https://www.facebook.com",
      "https://www.googletagmanager.com",
      "https://www.google-analytics.com",
      "https://stats.g.doubleclick.net",
      "https://www.googleadservices.com",
      "https://api.cloudinary.com",
      // Allow localhost for development
      ...(process.env.NODE_ENV === 'development' ? 
        ["http://localhost:*", "ws://localhost:*", "wss://localhost:*"] : [])
    ],
    'frame-src': [
      "'self'",
      "https://www.googletagmanager.com",
      "https://js.stripe.com",
      "https://checkout.stripe.com"
    ],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
    'upgrade-insecure-requests': process.env.NODE_ENV === 'production' ? [] : null
  };

  // Build CSP header value
  const cspValue = Object.entries(cspDirectives)
    .filter(([_, value]) => value !== null)
    .map(([directive, sources]) => 
      Array.isArray(sources) && sources.length > 0 
        ? `${directive} ${sources.join(' ')}`
        : directive
    )
    .join('; ');

  // Set CSP header
  res.setHeader('Content-Security-Policy', cspValue);
  
  // Additional security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  next();
};

export default cspMiddleware;