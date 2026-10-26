// Security headers for every response, and the Content Security Policy for the pages.
//
// The policy only lets the browser run scripts from this site, plus the few inline scripts in
// our own HTML, each allowed by the hash of its exact text (worked out here at startup, so
// editing an inline script can't silently break or weaken the policy).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Hashes ('sha256-…') of every inline <script> (including import maps) in the given HTML files.
function inlineScriptHashes(files) {
  const hashes = new Set();
  const inline = /<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;
  for (const file of files) {
    const html = fs.readFileSync(file, 'utf8');
    for (const match of html.matchAll(inline)) {
      hashes.add(`'sha256-${crypto.createHash('sha256').update(match[1], 'utf8').digest('base64')}'`);
    }
  }
  return [...hashes];
}

function htmlFiles(root, folders) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.html')) out.push(full);
    }
  };
  for (const folder of folders) walk(path.join(root, folder));
  const top = path.join(root, 'index.html');
  if (fs.existsSync(top)) out.push(top);
  return out;
}

function contentSecurityPolicy({ root, folders, isProd }) {
  const scriptHashes = inlineScriptHashes(htmlFiles(root, folders));
  const policy = [
    "default-src 'self'",
    `script-src 'self' ${scriptHashes.join(' ')}`,
    // Inline style attributes are used for layout values (colors, positions) set from scripts.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ];
  if (isProd) policy.push('upgrade-insecure-requests');
  return policy.join('; ');
}

function securityHeaders({ root, folders, isProd }) {
  const csp = contentSecurityPolicy({ root, folders, isProd });
  return (req, res, next) => {
    res.set({
      'Content-Security-Policy': csp,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
      'Cross-Origin-Opener-Policy': 'same-origin'
    });
    if (isProd) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    next();
  };
}

// JSON.parse reviver: drops keys that could change an object's prototype if the data is later
// merged into another object (prototype pollution).
function safeJsonReviver(key, value) {
  return key === '__proto__' || key === 'constructor' || key === 'prototype' ? undefined : value;
}

module.exports = { securityHeaders, contentSecurityPolicy, inlineScriptHashes, safeJsonReviver };
