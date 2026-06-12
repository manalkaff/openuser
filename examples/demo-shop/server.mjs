#!/usr/bin/env node
// examples/demo-shop/server.mjs
// OpenUser demo shop — intentionally-buggy mini e-commerce site for e2e testing.
// Bugs planted:
//   (a) Checkout "Place Order" button has no event handler — functional, critical
//   (b) console.error on cart page load — console bug
//   (c) GET /api/stock returns 500 on product detail page fetch — network/console bug
//   (d) "Continue" button on cart CLEARS the cart — ux_confusion, medium

import http from 'node:http';
import { parse as parseUrl } from 'node:url';
import { randomBytes } from 'node:crypto';

const PORT = process.env.DEMO_PORT ? Number(process.env.DEMO_PORT) : 4949;

// ── In-memory state ──────────────────────────────────────────────────────────

const PRODUCTS = [
  { id: 'p1', name: 'Widget Pro', price: 29.90, stock: 50, description: 'The original widget. Reliable, sturdy, and loved by professionals.' },
  { id: 'p2', name: 'Gadget Lite', price: 14.50, stock: 3,  description: 'Compact gadget for everyday use. Perfect for beginners.' },
  { id: 'p3', name: 'Doohickey Max', price: 59.00, stock: 0, description: 'Premium doohickey with extended warranty.' },
];

const sessions = new Map(); // sessionId → { username, cart: [{productId, qty}] }

function getSession(req) {
  const cookie = req.headers['cookie'] || '';
  const match = cookie.match(/sid=([^;]+)/);
  if (match && sessions.has(match[1])) return { id: match[1], data: sessions.get(match[1]) };
  return null;
}

function setCookie(res, sid) {
  res.setHeader('Set-Cookie', `sid=${sid}; Path=/; HttpOnly; SameSite=Lax`);
}

// ── HTML helpers ─────────────────────────────────────────────────────────────

function layout(title, body, extraHead = '') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — Demo Shop</title>
  ${extraHead}
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #f8f9fa; color: #212529; }
    header { background: #343a40; color: #fff; padding: 12px 24px; display: flex; align-items: center; gap: 16px; }
    header a { color: #adb5bd; text-decoration: none; font-size: 14px; }
    header a:hover { color: #fff; }
    header .brand { font-size: 20px; font-weight: 700; color: #fff; text-decoration: none; margin-right: auto; }
    main { max-width: 960px; margin: 32px auto; padding: 0 16px; }
    h1 { font-size: 28px; margin-bottom: 16px; }
    h2 { font-size: 20px; margin-bottom: 12px; }
    .card { background: #fff; border: 1px solid #dee2e6; border-radius: 8px; padding: 20px; margin-bottom: 16px; }
    .btn { display: inline-block; padding: 10px 20px; border-radius: 6px; border: none; cursor: pointer; font-size: 15px; font-weight: 600; }
    .btn-primary { background: #0d6efd; color: #fff; }
    .btn-primary:hover { background: #0b5ed7; }
    .btn-secondary { background: #6c757d; color: #fff; }
    .btn-secondary:hover { background: #5c636a; }
    .btn-danger { background: #dc3545; color: #fff; }
    .btn-success { background: #198754; color: #fff; }
    .alert { padding: 12px 16px; border-radius: 6px; margin-bottom: 16px; }
    .alert-danger { background: #f8d7da; color: #842029; border: 1px solid #f5c2c7; }
    .alert-success { background: #d1e7dd; color: #0a3622; border: 1px solid #badbcc; }
    .product-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
    .product-card { background: #fff; border: 1px solid #dee2e6; border-radius: 8px; padding: 16px; }
    .product-card h3 { margin-bottom: 8px; }
    .product-card .price { font-size: 20px; font-weight: 700; color: #0d6efd; margin-bottom: 8px; }
    .product-card .stock { font-size: 13px; color: #6c757d; margin-bottom: 12px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #dee2e6; }
    th { font-weight: 600; background: #f8f9fa; }
    .form-group { margin-bottom: 16px; }
    label { display: block; font-weight: 600; margin-bottom: 4px; }
    input[type=text], input[type=email], input[type=password] {
      width: 100%; padding: 8px 12px; border: 1px solid #ced4da; border-radius: 6px; font-size: 15px;
    }
  </style>
</head>
<body>
<header>
  <a class="brand" href="/">Demo Shop</a>
  <a href="/products">Products</a>
  <a href="/cart">My Cart</a>
  <a href="/login">Login</a>
</header>
<main>
  ${body}
</main>
</body>
</html>`;
}

// ── Route handlers ───────────────────────────────────────────────────────────

function handleHome(req, res) {
  const sess = getSession(req);
  const greeting = sess ? `<p class="alert alert-success">Welcome back, <strong>${sess.data.username}</strong>!</p>` : '';
  const html = layout('Home', `
    <h1>Welcome to Demo Shop</h1>
    ${greeting}
    <p style="margin-bottom:24px; color:#6c757d;">Your favourite place for widgets, gadgets, and doohickeys.</p>
    <div class="product-grid">
      ${PRODUCTS.map(p => `
        <div class="product-card">
          <h3>${p.name}</h3>
          <div class="price">RM ${p.price.toFixed(2)}</div>
          <div class="stock">${p.stock > 0 ? `${p.stock} in stock` : 'Out of stock'}</div>
          <p style="font-size:13px; color:#495057; margin-bottom:12px;">${p.description}</p>
          <a href="/products/${p.id}" class="btn btn-primary" style="text-decoration:none;">View Details</a>
        </div>
      `).join('')}
    </div>
  `);
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
}

function handleProducts(req, res) {
  handleHome(req, res);
}

function handleProductDetail(req, res, productId) {
  const product = PRODUCTS.find(p => p.id === productId);
  if (!product) {
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end(layout('Not Found', '<h1>Product not found</h1><p><a href="/">Back to home</a></p>'));
    return;
  }

  // Bug (c): fetches /api/stock which returns 500 — causes console error and broken stock display
  const html = layout('Product: ' + product.name, `
    <a href="/" style="font-size:14px; color:#6c757d;">&larr; Back to products</a>
    <div class="card" style="margin-top:16px;">
      <h1>${product.name}</h1>
      <div style="font-size:24px; font-weight:700; color:#0d6efd; margin: 12px 0;">RM ${product.price.toFixed(2)}</div>
      <p style="color:#495057; margin-bottom:16px;">${product.description}</p>
      <div id="stock-info" style="margin-bottom:16px; color:#6c757d; font-size:14px;">Loading stock…</div>
      <form action="/cart/add" method="POST" style="display:flex; gap:12px; align-items:center;">
        <input type="hidden" name="productId" value="${product.id}">
        <label for="qty" style="font-weight:600;">Qty:</label>
        <input type="number" id="qty" name="qty" value="1" min="1" max="10"
               style="width:70px; padding:8px; border:1px solid #ced4da; border-radius:6px;">
        <button type="submit" class="btn btn-primary">Add to Cart</button>
      </form>
    </div>
  `, `<script>
    // Bug (c): /api/stock intentionally returns 500
    fetch('/api/stock?productId=${product.id}')
      .then(r => {
        if (!r.ok) throw new Error('Stock API error: ' + r.status);
        return r.json();
      })
      .then(data => {
        document.getElementById('stock-info').textContent =
          data.stock > 0 ? data.stock + ' units in stock' : 'Out of stock';
      })
      .catch(err => {
        // This console.error is intentional — Bug (c) also produces a console error on this page
        console.error('Failed to load stock information', err);
        document.getElementById('stock-info').textContent = 'Stock information unavailable';
      });
  </script>`);
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
}

function handleCartGet(req, res) {
  const sess = getSession(req);
  const cart = sess ? sess.data.cart : [];
  const items = cart.map(item => {
    const p = PRODUCTS.find(pr => pr.id === item.productId);
    return p ? { ...p, qty: item.qty, subtotal: (p.price * item.qty).toFixed(2) } : null;
  }).filter(Boolean);
  const total = items.reduce((s, i) => s + parseFloat(i.subtotal), 0).toFixed(2);

  // Bug (b): console.error fires on every cart page load
  const html = layout('My Cart', `
    <h1>My Cart</h1>
    ${items.length === 0 ? '<div class="alert alert-danger">Your cart is empty. <a href="/">Browse products</a></div>' : `
      <table>
        <thead><tr><th>Product</th><th>Price</th><th>Qty</th><th>Subtotal</th></tr></thead>
        <tbody>
          ${items.map(i => `
            <tr>
              <td>${i.name}</td>
              <td>RM ${i.price.toFixed(2)}</td>
              <td>${i.qty}</td>
              <td>RM ${i.subtotal}</td>
            </tr>
          `).join('')}
        </tbody>
        <tfoot><tr><td colspan="3"><strong>Total</strong></td><td><strong>RM ${total}</strong></td></tr></tfoot>
      </table>
      <div style="margin-top:20px; display:flex; gap:12px;">
        <!-- Bug (d): "Continue" button clears the cart (POST /cart/clear) — label implies "continue to checkout" -->
        <form action="/cart/clear" method="POST">
          <button type="submit" class="btn btn-primary">Continue</button>
        </form>
        <a href="/checkout" class="btn btn-secondary" style="text-decoration:none;">Skip to Checkout</a>
      </div>
    `}
  `, `<script>
    // Bug (b): intentional console.error on cart page load
    console.error('CartService: session sync failed — cart state may be stale');
  </script>`);
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
}

function handleCartAdd(req, res, body) {
  const sess = getSession(req);
  if (!sess) {
    res.writeHead(302, { Location: '/login?next=/cart' });
    res.end();
    return;
  }
  const params = new URLSearchParams(body);
  const productId = params.get('productId');
  const qty = parseInt(params.get('qty') || '1', 10);
  const existing = sess.data.cart.find(i => i.productId === productId);
  if (existing) {
    existing.qty += qty;
  } else {
    sess.data.cart.push({ productId, qty });
  }
  res.writeHead(302, { Location: '/cart' });
  res.end();
}

function handleCartClear(req, res) {
  // Bug (d): This route backs the misleadingly-labelled "Continue" button
  const sess = getSession(req);
  if (sess) sess.data.cart = [];
  res.writeHead(302, { Location: '/cart' });
  res.end();
}

function handleCheckout(req, res) {
  // Bug (a): "Place Order" button has no handler — nothing happens when clicked
  const html = layout('Checkout', `
    <h1>Checkout</h1>
    <div class="card">
      <h2>Shipping Information</h2>
      <form id="checkout-form" style="max-width:480px;">
        <div class="form-group">
          <label for="full-name">Full Name</label>
          <input type="text" id="full-name" name="fullName" placeholder="Your full name" required>
        </div>
        <div class="form-group">
          <label for="email">Email Address</label>
          <input type="email" id="email" name="email" placeholder="you@example.com" required>
        </div>
        <div class="form-group">
          <label for="address">Shipping Address</label>
          <input type="text" id="address" name="address" placeholder="Street, city, postcode" required>
        </div>
        <div class="form-group">
          <label for="payment">Payment Method</label>
          <select id="payment" name="payment" style="width:100%; padding:8px 12px; border:1px solid #ced4da; border-radius:6px; font-size:15px;">
            <option value="online_banking">Online Banking</option>
            <option value="credit_card">Credit Card</option>
            <option value="ewallet">E-Wallet</option>
          </select>
        </div>
        <!-- Bug (a): button has type="button" with no onclick — intentionally does nothing -->
        <button type="button" class="btn btn-success" style="width:100%; padding:14px;">Place Order</button>
      </form>
    </div>
  `);
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
}

function handleLogin(req, res, searchParams) {
  const next = searchParams.get('next') || '/';
  const html = layout('Login', `
    <h1>Login</h1>
    <div class="card" style="max-width:400px; margin:0 auto;">
      <form action="/login" method="POST" style="display:flex; flex-direction:column; gap:16px;">
        <input type="hidden" name="next" value="${next}">
        <div class="form-group">
          <label for="username">Username</label>
          <input type="text" id="username" name="username" placeholder="demo" required>
        </div>
        <div class="form-group">
          <label for="password">Password</label>
          <input type="password" id="password" name="password" placeholder="••••••••" required>
        </div>
        <button type="submit" class="btn btn-primary">Sign In</button>
        <p style="font-size:13px; color:#6c757d; text-align:center;">
          Demo credentials: <strong>demo / demo123</strong>
        </p>
      </form>
    </div>
  `);
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
}

function handleLoginPost(req, res, body) {
  const params = new URLSearchParams(body);
  const username = params.get('username');
  const password = params.get('password');
  const next = params.get('next') || '/';
  if (username === 'demo' && password === 'demo123') {
    const sid = randomBytes(16).toString('hex');
    sessions.set(sid, { username, cart: [] });
    setCookie(res, sid);
    res.writeHead(302, { Location: next });
  } else {
    const html = layout('Login', `
      <h1>Login</h1>
      <div class="card" style="max-width:400px; margin:0 auto;">
        <div class="alert alert-danger">Invalid username or password.</div>
        <form action="/login" method="POST" style="display:flex; flex-direction:column; gap:16px;">
          <input type="hidden" name="next" value="${next}">
          <div class="form-group">
            <label for="username">Username</label>
            <input type="text" id="username" name="username" value="${username || ''}" required>
          </div>
          <div class="form-group">
            <label for="password">Password</label>
            <input type="password" id="password" name="password" required>
          </div>
          <button type="submit" class="btn btn-primary">Sign In</button>
        </form>
      </div>
    `);
    res.writeHead(401, { 'Content-Type': 'text/html' });
    res.end(html);
  }
  res.end?.();
}

function handleApiStock(req, res) {
  // Bug (c): always returns 500 to simulate a broken stock API
  res.writeHead(500, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Internal server error: stock service unavailable' }));
}

// ── Request dispatcher ───────────────────────────────────────────────────────

function collectBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => resolve(body));
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = parseUrl(req.url || '/', true);
  const pathname = parsed.pathname || '/';
  const method = req.method || 'GET';

  try {
    if (method === 'GET') {
      if (pathname === '/') return handleHome(req, res);
      if (pathname === '/products') return handleProducts(req, res);
      const productMatch = pathname.match(/^\/products\/(p\d+)$/);
      if (productMatch) return handleProductDetail(req, res, productMatch[1]);
      if (pathname === '/cart') return handleCartGet(req, res);
      if (pathname === '/checkout') return handleCheckout(req, res);
      if (pathname === '/login') return handleLogin(req, res, parsed.query);
      if (pathname === '/api/stock') return handleApiStock(req, res);
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end(layout('Not Found', '<h1>404 — Page not found</h1><p><a href="/">Home</a></p>'));
      return;
    }

    if (method === 'POST') {
      const body = await collectBody(req);
      if (pathname === '/cart/add') return handleCartAdd(req, res, body);
      if (pathname === '/cart/clear') return handleCartClear(req, res);
      if (pathname === '/login') return handleLoginPost(req, res, body);
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
  } catch (err) {
    console.error('Demo shop unhandled error:', err);
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end(layout('Error', '<h1>500 — Internal error</h1>'));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Demo shop running at http://127.0.0.1:${PORT}`);
  console.log('Bugs planted: (a) checkout button no-op, (b) cart console.error, (c) /api/stock 500, (d) Continue clears cart');
});

export { server };
