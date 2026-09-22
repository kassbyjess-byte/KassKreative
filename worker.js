// Kass Kreative Admin Portal - Cloudflare Worker
// Handles: Authentication, Stripe API (orders, payment links), order status tracking, Shippo shipping

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// ============ AUTH HELPERS ============

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)));
}

async function createJWT(payload, secret) {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify({ ...payload, exp: Date.now() + 24 * 60 * 60 * 1000 }));
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`${header}.${body}`));
  const sig = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return `${header}.${body}.${sig}`;
}

async function verifyJWT(token, secret) {
  try {
    const [header, body, sig] = token.split('.');
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const signature = Uint8Array.from(atob(sig), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify('HMAC', key, signature, encoder.encode(`${header}.${body}`));
    if (!valid) return null;
    const payload = JSON.parse(atob(body));
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}

// ============ STRIPE HELPERS ============

async function stripeRequest(env, method, path, body = null) {
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': '2024-06-20',
    },
  };
  if (body) options.body = encodeParams(body);
  const res = await fetch(`https://api.stripe.com/v1${path}`, options);
  return res.json();
}

function encodeParams(obj, prefix = '') {
  const parts = [];
  for (const [key, val] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(val)) {
      // Repeat the key for each array item (Stripe's expected format)
      for (const item of val) {
        parts.push(`${encodeURIComponent(fullKey)}=${encodeURIComponent(item)}`);
      }
    } else if (typeof val === 'object' && val !== null) {
      parts.push(encodeParams(val, fullKey));
    } else {
      parts.push(`${encodeURIComponent(fullKey)}=${encodeURIComponent(val)}`);
    }
  }
  return parts.join('&');
}

// ============ KV HELPERS (Order Status) ============

async function getOrderStatus(env, paymentIntentId) {
  try {
    if (!env.ORDER_STATUS) return { status: 'paid', notes: '', tracking: '', history: [] };
    const data = await env.ORDER_STATUS.get(paymentIntentId, 'json');
    return data || { status: 'paid', notes: '', tracking: '', history: [] };
  } catch (e) {
    return { status: 'paid', notes: '', tracking: '', history: [] };
  }
}

async function setOrderStatus(env, paymentIntentId, statusData) {
  if (!env.ORDER_STATUS) throw new Error('KV binding ORDER_STATUS not configured');
  await env.ORDER_STATUS.put(paymentIntentId, JSON.stringify(statusData));
}

// ============ SHIPPO HELPERS ============

async function shippoRequest(env, method, path, body = null) {
  const options = {
    method,
    headers: {
      'Authorization': `ShippoToken ${env.SHIPPO_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
  };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(`https://api.goshippo.com${path}`, options);
  return res.json();
}

async function handleTestCanadaPost(request, env) {
  const cpUser = 'd38c684541d293a3';
  const cpPass = '6350400ca21112592ad6b5';
  const custNum = '0001241429';
  const auth = btoa(`${cpUser}:${cpPass}`);

  // Simple rate request to Canada Post API directly
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<mailing-scenario xmlns="http://www.canadapost.ca/ws/ship/rate-v4">
  <customer-number>${custNum}</customer-number>
  <parcel-characteristics>
    <weight>1.8</weight>
    <dimensions><length>28</length><width>20</width><height>5</height></dimensions>
  </parcel-characteristics>
  <origin-postal-code>J9A0B9</origin-postal-code>
  <destination>
    <united-states><zip-code>60068</zip-code></united-states>
  </destination>
</mailing-scenario>`;

  const res = await fetch('https://soa-gw.canadapost.ca/rs/ship/price', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/vnd.cpc.ship.rate-v4+xml',
      'Accept': 'application/vnd.cpc.ship.rate-v4+xml',
    },
    body: xml,
  });

  const responseText = await res.text();
  return new Response(JSON.stringify({
    status: res.status,
    statusText: res.statusText,
    response: responseText,
  }), {
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}

async function handleConnectCarrier(request, env) {
  const { carrier, account_id, parameters } = await request.json();
  const result = await shippoRequest(env, 'POST', '/carrier_accounts/', {
    carrier,
    account_id,
    parameters,
    active: true,
  });
  return new Response(JSON.stringify(result), {
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}

async function handleListCarriers(env) {
  const carriers = await shippoRequest(env, 'GET', '/carrier_accounts?results=50');
  const summary = (carriers.results || []).map(c => ({
    id: c.object_id,
    carrier: c.carrier,
    account_id: c.account_id,
    active: c.active,
    is_shippo_account: c.is_shippo_account,
  }));
  return new Response(JSON.stringify({
    count: summary.length,
    carriers: summary,
  }), {
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}

// Determine box dimensions based on journal sizes in the order.
// Small box (9x6x2 in = 23x15 cm) if all journals are Passport/A6/Custom Passport/Custom A6.
// Large box (28x20 cm) if any A5 or Custom A5 is present.
// Height scales by 5cm per stacked journal.
function calcBoxDimensions(lineItems) {
  const journalItems = (lineItems || []).filter(li =>
    li.description &&
    !li.description.match(/shipping|duties|tax|postage|delivery fee/i) &&
    !li.description.match(/\(.*(?:journal|holder)\)\s*$/i)
  );
  const journalCount = journalItems.length || 1;

  // Detect if any journal is A5 / Custom A5 (large box required)
  const hasLargeJournal = journalItems.some(li => {
    const desc = li.description || '';
    return /(^|\s)(Custom\s+)?A5(\s|$)/i.test(desc);
  });

  const length = hasLargeJournal ? 28 : 23;
  const width = hasLargeJournal ? 20 : 15;
  const height = 5 * journalCount;
  return { length, width, height, journalCount };
}

async function handleGetRates(request, env) {
  const { order_id } = await request.json();

  // Get order details from Stripe
  const pi = await stripeRequest(env, 'GET', `/payment_intents/${order_id}`);
  const sessions = await stripeRequest(env, 'GET', `/checkout/sessions?payment_intent=${order_id}&expand[]=data.line_items`);
  const session = sessions.data?.[0] || {};
  const shipping = session.shipping_details
    || session.shipping
    || pi.shipping
    || (session.customer_details?.address ? { name: session.customer_details.name, address: session.customer_details.address } : null);

  if (!shipping || !shipping.address) {
    return new Response(JSON.stringify({
      error: 'No shipping address on this order',
    }), {
      status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }

  // Determine journal count and box dimensions based on sizes
  const lineItems = session.line_items?.data || [];
  const box = calcBoxDimensions(lineItems);
  const journalCount = box.journalCount;

  // Scale weight: 1.8kg per journal
  const WEIGHT_PER_JOURNAL = 1.8;
  const totalWeight = (WEIGHT_PER_JOURNAL * journalCount).toFixed(1);
  const totalHeight = box.height;
  const boxLength = box.length;
  const boxWidth = box.width;

  // Call Canada Post Rating API directly
  const cpUser = 'd38c684541d293a3';
  const cpPass = '6350400ca21112592ad6b5';
  const custNum = '0001241429';
  const auth = btoa(`${cpUser}:${cpPass}`);

  const addr = shipping.address;
  const destCountry = (addr.country || '').toUpperCase();
  const postalOrZip = (addr.postal_code || addr.zip || '').toUpperCase().replace(/\s/g, '');

  // Build destination XML based on country
  let destinationXml = '';
  if (destCountry === 'CA') {
    destinationXml = `<destination><domestic><postal-code>${postalOrZip}</postal-code></domestic></destination>`;
  } else if (destCountry === 'US') {
    destinationXml = `<destination><united-states><zip-code>${postalOrZip}</zip-code></united-states></destination>`;
  } else {
    destinationXml = `<destination><international><country-code>${destCountry}</country-code></international></destination>`;
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<mailing-scenario xmlns="http://www.canadapost.ca/ws/ship/rate-v4">
  <customer-number>${custNum}</customer-number>
  <parcel-characteristics>
    <weight>${totalWeight}</weight>
    <dimensions><length>${boxLength}</length><width>${boxWidth}</width><height>${totalHeight}</height></dimensions>
  </parcel-characteristics>
  <origin-postal-code>J9A0B9</origin-postal-code>
  ${destinationXml}
</mailing-scenario>`;

  const cpRes = await fetch('https://soa-gw.canadapost.ca/rs/ship/price', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/vnd.cpc.ship.rate-v4+xml',
      'Accept': 'application/vnd.cpc.ship.rate-v4+xml',
    },
    body: xml,
  });

  const responseText = await cpRes.text();

  if (cpRes.status !== 200) {
    return new Response(JSON.stringify({
      error: 'Canada Post API error',
      status: cpRes.status,
      details: responseText,
    }), {
      status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }

  // Parse XML response to extract rates
  const rates = [];
  const quoteRegex = /<price-quote>([\s\S]*?)<\/price-quote>/g;
  let match;
  while ((match = quoteRegex.exec(responseText)) !== null) {
    const quote = match[1];
    const serviceCode = (quote.match(/<service-code>(.*?)<\/service-code>/) || [])[1] || '';
    const serviceName = (quote.match(/<service-name>(.*?)<\/service-name>/) || [])[1] || '';
    const due = (quote.match(/<due>(.*?)<\/due>/) || [])[1] || '0';
    const deliveryDate = (quote.match(/<expected-delivery-date>(.*?)<\/expected-delivery-date>/) || [])[1] || '';

    rates.push({
      rate_id: serviceCode,
      service: `Canada Post — ${serviceName}`,
      amount: due,
      currency: 'CAD',
      estimated_days: deliveryDate || null,
      provider: 'Canada Post',
    });
  }

  if (rates.length === 0) {
    return new Response(JSON.stringify({
      error: 'No rates returned from Canada Post',
      raw: responseText.substring(0, 500),
    }), {
      status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }

  // Sort by price
  rates.sort((a, b) => parseFloat(a.amount) - parseFloat(b.amount));

  return new Response(JSON.stringify({
    shipment_id: order_id,
    rates,
  }), {
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}

async function handleCreateLabel(request, env) {
  const { rate_id, order_id, test_mode } = await request.json();
  // rate_id is the Canada Post service code (e.g. USA.TP, USA.EP, DOM.EP)
  // test_mode: if true, uses Canada Post development sandbox (no real charges)

  // Canada Post API base URL - use sandbox for testing, production for real labels
  const CP_BASE = test_mode ? 'https://ct.soa-gw.canadapost.ca' : 'https://soa-gw.canadapost.ca';

  // Get order details from Stripe for shipping address and journal count
  const pi = await stripeRequest(env, 'GET', `/payment_intents/${order_id}`);
  const sessions = await stripeRequest(env, 'GET', `/checkout/sessions?payment_intent=${order_id}&expand[]=data.line_items`);
  const session = sessions.data?.[0] || {};
  const shipping = session.shipping_details
    || session.shipping
    || pi.shipping
    || (session.customer_details?.address ? { name: session.customer_details.name, address: session.customer_details.address } : null);

  if (!shipping || !shipping.address) {
    return new Response(JSON.stringify({ error: 'No shipping address on this order' }), {
      status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }

  // Determine journal count and box dimensions based on sizes
  const labelLineItems = session.line_items?.data || [];
  const box = calcBoxDimensions(labelLineItems);
  const journalCount = box.journalCount;

  // Scale weight for multi-journal shipments
  const WEIGHT_PER_JOURNAL = 1.8;
  // Customs values by size — must match actual retail pricing
  const CUSTOMS_VALUE_BY_SIZE = {
    'A5': 208, 'Custom A5': 208,
    'A6': 178, 'Custom A6': 178,
    'Passport': 88, 'Custom Passport': 88,
  };
  const totalWeight = (WEIGHT_PER_JOURNAL * journalCount).toFixed(1);
  const totalHeight = box.height;
  const boxLength = box.length;
  const boxWidth = box.width;

  const cpUser = 'd38c684541d293a3';
  const cpPass = '6350400ca21112592ad6b5';
  const custNum = '0001241429';
  const auth = btoa(`${cpUser}:${cpPass}`);

  // Zonos Account Key for prepaying US duties via Canada Post
  const ZONOS_ACCOUNT_KEY = 'credential_live_a4b3c1ad-ecbf-416b-88a3-6d47443ed3a2';

  const addr = shipping.address;
  const destCountry = (addr.country || '').toUpperCase();
  const destName = shipping.name || 'Customer';

  // Build destination XML based on country
  let destAddressXml = '';
  // Combine line1 + line2 if line1 is just a street number
  let addrLine1 = addr.line1 || '';
  let addrLine2 = addr.line2 || '';
  if (addrLine1 && addrLine2 && /^\d+$/.test(addrLine1.trim())) {
    addrLine1 = `${addrLine1.trim()} ${addrLine2.trim()}`;
    addrLine2 = '';
  }

  // Destination always requires country-code (DestinationAddressDetailsType)
  destAddressXml = `
      <address-details>
        <address-line-1>${escapeXml(addrLine1)}</address-line-1>
        ${addrLine2 ? `<address-line-2>${escapeXml(addrLine2)}</address-line-2>` : ''}
        <city>${escapeXml(addr.city || '')}</city>
        <prov-state>${escapeXml(addr.state || '')}</prov-state>
        <country-code>${destCountry}</country-code>
        <postal-zip-code>${(addr.postal_code || '').toUpperCase().replace(/\s/g, '')}</postal-zip-code>
      </address-details>`;

  // Get customer email for notification
  const customerEmail = session.customer_details?.email || pi.receipt_email || '';

  const shipmentXml = `<?xml version="1.0" encoding="UTF-8"?>
<non-contract-shipment xmlns="http://www.canadapost.ca/ws/ncshipment-v4">
  <requested-shipping-point>J9A0B9</requested-shipping-point>
  <delivery-spec>
    <service-code>${escapeXml(rate_id)}</service-code>
    <sender>
      <name>Kass Kreative</name>
      <company>Kass Kreative</company>
      <contact-phone>8195881640</contact-phone>
      <address-details>
        <address-line-1>604 Boul des Grives</address-line-1>
        <city>Gatineau</city>
        <prov-state>QC</prov-state>
        <postal-zip-code>J9A0B9</postal-zip-code>
      </address-details>
    </sender>
    <destination>
      <name>${escapeXml(destName)}</name>
      ${destAddressXml}
    </destination>
    ${destCountry !== 'CA' ? `<options>
      <option>
        <option-code>ABAN</option-code>
      </option>
    </options>` : ''}
    <parcel-characteristics>
      <weight>${totalWeight}</weight>
      <dimensions>
        <length>${boxLength}</length>
        <width>${boxWidth}</width>
        <height>${totalHeight}</height>
      </dimensions>
    </parcel-characteristics>
    <notification>
      <email>${escapeXml(customerEmail)}</email>
      <on-shipment>true</on-shipment>
      <on-exception>true</on-exception>
      <on-delivery>true</on-delivery>
    </notification>
    <preferences>
      <show-packing-instructions>false</show-packing-instructions>
    </preferences>
    ${destCountry !== 'CA' ? `<customs>
      <currency>CAD</currency>
      <reason-for-export>SOG</reason-for-export>
      <sku-list>
        ${(() => {
          // Build per-journal customs items with correct retail values
          const journalItems = labelLineItems.filter(li =>
            li.description &&
            !li.description.match(/shipping|duties|tax|postage|delivery fee/i) &&
            !li.description.match(/\(.*(?:journal|holder)\)\s*$/i)
          );
          if (journalItems.length === 0) {
            return `<item>
          <customs-number-of-units>1</customs-number-of-units>
          <customs-description>Handcrafted Leather Journal</customs-description>
          <sku>JOURNAL-001</sku>
          <hs-tariff-code>4820.10</hs-tariff-code>
          <unit-weight>${WEIGHT_PER_JOURNAL}</unit-weight>
          <customs-value-per-unit>208.00</customs-value-per-unit>
          <country-of-origin>CA</country-of-origin>
          <province-of-origin>QC</province-of-origin>
        </item>`;
          }
          return journalItems.map((li, idx) => {
            const desc = li.description || '';
            const sizeMatch = desc.match(/^(Custom Passport|Custom A5|Custom A6|A5|A6|Passport)/i);
            const size = sizeMatch ? sizeMatch[1] : 'A5';
            const customsVal = (CUSTOMS_VALUE_BY_SIZE[size] || 208).toFixed(2);
            const isHolder = /Passport/i.test(size);
            return `<item>
          <customs-number-of-units>1</customs-number-of-units>
          <customs-description>Handcrafted Leather ${isHolder ? 'Passport Holder' : 'Journal'}</customs-description>
          <sku>JOURNAL-${String(idx + 1).padStart(3, '0')}</sku>
          <hs-tariff-code>4820.10</hs-tariff-code>
          <unit-weight>${WEIGHT_PER_JOURNAL}</unit-weight>
          <customs-value-per-unit>${customsVal}</customs-value-per-unit>
          <country-of-origin>CA</country-of-origin>
          <province-of-origin>QC</province-of-origin>
        </item>`;
          }).join('\n        ');
        })()}
      </sku-list>
    </customs>` : ''}
  </delivery-spec>
</non-contract-shipment>`;

  // Build request headers — include Zonos key for US-bound shipments
  const cpHeaders = {
    'Authorization': `Basic ${auth}`,
    'Content-Type': 'application/vnd.cpc.ncshipment-v4+xml',
    'Accept': 'application/vnd.cpc.ncshipment-v4+xml',
  };
  if (destCountry === 'US') {
    cpHeaders['X-CPC-Zonos-Key'] = ZONOS_ACCOUNT_KEY;
  }

  const cpRes = await fetch(`${CP_BASE}/rs/${custNum}/ncshipment`, {
    method: 'POST',
    headers: cpHeaders,
    body: shipmentXml,
  });

  const responseText = await cpRes.text();

  if (cpRes.status !== 200 && cpRes.status !== 201) {
    return new Response(JSON.stringify({
      error: 'Canada Post label creation failed',
      status: cpRes.status,
      details: responseText,
      xml_sent: shipmentXml,
    }), {
      status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }

  // Extract tracking pin and label URL from response
  const trackingPin = (responseText.match(/<tracking-pin>(.*?)<\/tracking-pin>/) || [])[1] || '';
  const labelUrl = (responseText.match(/<link rel="label"[^>]*href="([^"]*)"/) || [])[1] || '';
  const receiptUrl = (responseText.match(/<link rel="receipt"[^>]*href="([^"]*)"/) || [])[1] || '';

  // If we have a label URL, fetch the actual PDF
  let labelPdfBase64 = '';
  if (labelUrl) {
    try {
      const labelRes = await fetch(labelUrl, {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Accept': 'application/pdf',
        },
      });
      if (labelRes.ok) {
        const labelBuffer = await labelRes.arrayBuffer();
        // Convert ArrayBuffer to base64 in chunks (spread operator crashes on large buffers)
        const bytes = new Uint8Array(labelBuffer);
        let binary = '';
        const chunkSize = 8192;
        for (let i = 0; i < bytes.length; i += chunkSize) {
          const chunk = bytes.subarray(i, i + chunkSize);
          binary += String.fromCharCode.apply(null, chunk);
        }
        labelPdfBase64 = btoa(binary);
      }
    } catch (pdfErr) {
      // PDF download failed, but label was still created — continue without PDF
      labelPdfBase64 = '';
    }
  }

  // Update order status in KV
  const kvStatus = await getOrderStatus(env, order_id);
  kvStatus.status = 'shipped';
  kvStatus.tracking = trackingPin;
  kvStatus.tracking_url = trackingPin ? `https://www.canadapost-postescanada.ca/track-colis/en#/details/${trackingPin}` : '';
  kvStatus.label_url = labelUrl;
  kvStatus.history = kvStatus.history || [];
  kvStatus.history.push({
    status: 'shipped',
    timestamp: new Date().toISOString(),
    note: `Label created — ${trackingPin || 'No tracking'}`,
  });
  await setOrderStatus(env, order_id, kvStatus);

  return new Response(JSON.stringify({
    success: true,
    tracking_number: trackingPin,
    tracking_url: trackingPin ? `https://www.canadapost-postescanada.ca/track-colis/en#/details/${trackingPin}` : '',
    label_url: labelUrl,
    label_pdf: labelPdfBase64 || null,
    receipt_url: receiptUrl,
  }), {
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}

async function handleGetLabelPdf(request, env) {
  const { label_url } = await request.json();
  if (!label_url) {
    return new Response(JSON.stringify({ error: 'No label URL provided' }), {
      status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }

  const cpUser = 'd38c684541d293a3';
  const cpPass = '6350400ca21112592ad6b5';
  const auth = btoa(`${cpUser}:${cpPass}`);

  const labelRes = await fetch(label_url, {
    headers: {
      'Authorization': `Basic ${auth}`,
      'Accept': 'application/pdf',
    },
  });

  if (!labelRes.ok) {
    return new Response(JSON.stringify({ error: 'Failed to fetch label PDF', status: labelRes.status }), {
      status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }

  // Return the PDF directly with proper headers
  const pdfBuffer = await labelRes.arrayBuffer();
  return new Response(pdfBuffer, {
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="shipping-label.pdf"',
    },
  });
}

function escapeXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// ============ ROUTE HANDLERS ============

async function handleLogin(request, env) {
  const { username, password } = await request.json();
  const hashedInput = await hashPassword(password);
  if (username === env.ADMIN_USERNAME && hashedInput === env.ADMIN_PASSWORD_HASH) {
    const token = await createJWT({ user: username, role: 'admin' }, env.JWT_SECRET);
    return new Response(JSON.stringify({ token }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }
  return new Response(JSON.stringify({ error: 'Invalid credentials' }), {
    status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}

async function handleListOrders(env, url) {
  const limit = url.searchParams.get('limit') || 50;
  const startingAfter = url.searchParams.get('starting_after') || '';

  // Fetch payment intents
  let path = `/payment_intents?limit=${limit}`;
  if (startingAfter) path += `&starting_after=${startingAfter}`;

  const paymentIntents = await stripeRequest(env, 'GET', path);

  // If Stripe returned an error, surface it
  if (paymentIntents.error) {
    return new Response(JSON.stringify({
      error: 'Stripe API error',
      detail: paymentIntents.error.message || paymentIntents.error,
      kv_bound: !!env.ORDER_STATUS,
    }), {
      status: 502, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }

  // Fetch checkout sessions with line items expanded
  const sessions = await stripeRequest(env, 'GET', `/checkout/sessions?limit=100&expand[]=data.line_items`);

  // Build a map of payment_intent -> session
  const sessionMap = {};
  if (sessions.data) {
    for (const session of sessions.data) {
      if (session.payment_intent) {
        sessionMap[session.payment_intent] = session;
      }
    }
  }

  // Enrich orders with status from KV and session data (March 25, 2026 onwards)
  const createdGte = 1774396800; // 2026-03-25 00:00:00 UTC
  const orders = [];
  const piCount = paymentIntents.data ? paymentIntents.data.length : 0;
  let skippedNotSucceeded = 0;
  let skippedBeforeDate = 0;

  if (paymentIntents.data) {
    for (const pi of paymentIntents.data) {
      if (pi.status !== 'succeeded') { skippedNotSucceeded++; continue; }
      if (pi.created < createdGte) { skippedBeforeDate++; continue; }

      const session = sessionMap[pi.id] || {};
      const kvStatus = await getOrderStatus(env, pi.id);

      // Get product names and metadata from ALL journal line items
      const lineItems = session.line_items?.data || [];

      // Separate journal line items from shipping/duties/taxes/accessories
      const journalLineItems = lineItems.filter(li =>
        li.description &&
        !li.description.match(/shipping|duties|tax|postage|delivery fee/i) &&
        !li.description.match(/\(.*(?:journal|holder)\)\s*$/i)
      );
      const journalCount = journalLineItems.length || 1;

      // Build product name: show first journal + count if multiple
      let productName = journalLineItems.length > 0 ? journalLineItems[0].description : '';
      if (journalCount > 1) {
        productName = `${journalCount}x Journals`;
      }

      // Get metadata from first journal product — but only trust it fully
      // if it has journal_index (created by our admin portal for this specific order)
      let productMeta = {};
      if (journalLineItems.length > 0 && journalLineItems[0].price?.product) {
        const productId = typeof journalLineItems[0].price.product === 'string' ? journalLineItems[0].price.product : journalLineItems[0].price.product.id;
        try {
          const product = await stripeRequest(env, 'GET', `/products/${productId}`);
          const rawMeta = product.metadata || {};
          if (rawMeta.journal_index !== undefined) {
            // Order-specific product — trust all metadata
            productMeta = rawMeta;
          } else {
            // Shared/reused product — only trust size and leather
            productMeta = { size: rawMeta.size || '', leather: rawMeta.leather || '' };
          }
        } catch (e) { /* ignore */ }
      }

      // Merge metadata: product metadata > session metadata > pi metadata
      const metadata = { ...pi.metadata, ...session.metadata, ...productMeta };
      metadata.journal_count = String(journalCount);

      orders.push({
        id: pi.id,
        amount: pi.amount,
        currency: pi.currency,
        created: pi.created,
        customer_name: session.customer_details?.name || pi.customer?.name || '',
        customer_email: session.customer_details?.email || pi.customer?.email || '',
        product_name: productName,
        metadata,
        fulfillment: kvStatus,
        journal_count: journalCount,
      });
    }
  }

  // Merge in manual / e-transfer orders
  try {
    const manualOrders = await listManualOrders(env);
    for (const m of manualOrders) {
      const kvStatus = await getOrderStatus(env, m.id);
      const journals = m.journals || [];
      const journalCount = journals.length || 1;
      let productName = journals.length > 0
        ? (journals[0].size === 'Custom Passport'
            ? `Custom Passport Holder — ${journals[0].leather || ''}`
            : `${journals[0].size} Journal — ${journals[0].leather || ''}`)
        : 'Journal';
      if (journalCount > 1) productName = `${journalCount}x Journals`;
      orders.push({
        id: m.id,
        is_manual: true,
        payment_method: m.payment_method || 'e-transfer',
        amount: m.amount || 0,
        currency: m.currency || 'cad',
        created: m.created,
        customer_name: m.customer?.name || '',
        customer_email: m.customer?.email || '',
        product_name: productName,
        metadata: { journal_count: String(journalCount) },
        fulfillment: kvStatus,
        journal_count: journalCount,
      });
    }
  } catch (e) { /* swallow manual listing errors to not break Stripe list */ }

  // Sort merged list by created date desc
  orders.sort((a, b) => (b.created || 0) - (a.created || 0));

  return new Response(JSON.stringify({
    orders,
    has_more: paymentIntents.has_more || false,
    debug: { total_fetched: piCount, skipped_not_succeeded: skippedNotSucceeded, skipped_before_date: skippedBeforeDate, kv_bound: !!env.ORDER_STATUS },
  }), {
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}

async function handleCreatePaymentLink(request, env) {
  const body = await request.json();

  // Support both legacy single-journal format and new multi-journal format
  let journals, shipping, duties;
  if (body.journals && Array.isArray(body.journals)) {
    journals = body.journals;
    shipping = body.shipping || 0;
    duties = body.duties || 0;
  } else {
    // Legacy single-journal format
    journals = [{
      size: body.size,
      price: body.price,
      leather: body.leather,
      string_colour: body.string_colour,
      eyelet: body.eyelet,
      embossing: body.embossing || '',
      custom_description: body.custom_description || '',
      order_type: body.order_type || 'standard',
    }];
    shipping = body.shipping || 0;
    duties = body.duties || 0;
  }

  const lineItems = {};
  let lineIndex = 0;

  // Helper: "Custom Passport" is a leather cover (holder), not a journal
  const productLabelForSize = (size, leather) => {
    if (size === 'Custom Passport') return `Custom Passport Holder — ${leather}`;
    return `${size} Journal — ${leather}`;
  };

  // Create a Stripe product and price for each journal
  for (const journal of journals) {
    const product = await stripeRequest(env, 'POST', '/products', {
      name: productLabelForSize(journal.size, journal.leather),
      metadata: {
        size: journal.size,
        leather: journal.leather,
        string_colour: journal.string_colour,
        eyelet: journal.eyelet,
        embossing: journal.embossing || '',
        custom_description: journal.custom_description || '',
        order_type: journal.order_type || 'standard',
        journal_index: String(lineIndex),
      },
    });

    const priceObj = await stripeRequest(env, 'POST', '/prices', {
      product: product.id,
      unit_amount: Math.round(journal.price * 100),
      currency: 'cad',
    });

    lineItems[`line_items[${lineIndex}][price]`] = priceObj.id;
    lineItems[`line_items[${lineIndex}][quantity]`] = 1;
    lineItems[`line_items[${lineIndex}][adjustable_quantity][enabled]`] = 'false';
    lineIndex++;

    // Add accessories for this journal as separate line items
    if (journal.accessories && Array.isArray(journal.accessories)) {
      for (const acc of journal.accessories) {
        if (acc.name && acc.price > 0) {
          const accProduct = await stripeRequest(env, 'POST', '/products', {
            name: `${acc.name} (${journal.size === 'Custom Passport' ? 'Custom Passport Holder' : journal.size + ' Journal'})`,
            metadata: {
              type: 'accessory',
              accessory_name: acc.name,
              journal_size: journal.size,
              journal_leather: journal.leather,
            },
          });
          const accPrice = await stripeRequest(env, 'POST', '/prices', {
            product: accProduct.id,
            unit_amount: Math.round(acc.price * 100),
            currency: 'cad',
          });
          lineItems[`line_items[${lineIndex}][price]`] = accPrice.id;
          lineItems[`line_items[${lineIndex}][quantity]`] = 1;
          lineItems[`line_items[${lineIndex}][adjustable_quantity][enabled]`] = 'false';
          lineIndex++;
        }
      }
    }
  }

  // Helper: get-or-create a reusable Stripe product ID (cached in KV) so we don't
  // bloat the product library with a new "Shipping" / "Duties & Taxes" product every order.
  const getOrCreateSharedProduct = async (cacheKey, productName) => {
    if (env.ORDER_STATUS) {
      const cached = await env.ORDER_STATUS.get(`stripe_shared_product:${cacheKey}`);
      if (cached) return cached;
    }
    const product = await stripeRequest(env, 'POST', '/products', { name: productName });
    if (env.ORDER_STATUS && product.id) {
      await env.ORDER_STATUS.put(`stripe_shared_product:${cacheKey}`, product.id);
    }
    return product.id;
  };

  // Add shipping as separate line item if provided (reuses a single Stripe product)
  if (shipping && shipping > 0) {
    const shippingProductId = await getOrCreateSharedProduct('shipping', 'Shipping');
    const shippingPrice = await stripeRequest(env, 'POST', '/prices', {
      product: shippingProductId,
      unit_amount: Math.round(shipping * 100),
      currency: 'cad',
    });
    lineItems[`line_items[${lineIndex}][price]`] = shippingPrice.id;
    lineItems[`line_items[${lineIndex}][quantity]`] = 1;
    lineItems[`line_items[${lineIndex}][adjustable_quantity][enabled]`] = 'false';
    lineIndex++;
  }

  // Add duties & taxes as separate line item if provided (reuses a single Stripe product)
  if (duties && duties > 0) {
    const dutiesProductId = await getOrCreateSharedProduct('duties', 'Duties & Taxes');
    const dutiesPrice = await stripeRequest(env, 'POST', '/prices', {
      product: dutiesProductId,
      unit_amount: Math.round(duties * 100),
      currency: 'cad',
    });
    lineItems[`line_items[${lineIndex}][price]`] = dutiesPrice.id;
    lineItems[`line_items[${lineIndex}][quantity]`] = 1;
    lineItems[`line_items[${lineIndex}][adjustable_quantity][enabled]`] = 'false';
    lineIndex++;
  }

  // Store journal details as JSON in payment link metadata
  // Stripe metadata values are strings with 500 char limit, so we store compact JSON
  const journalSummary = journals.map(j => ({
    s: j.size, l: j.leather, sc: j.string_colour, e: j.eyelet,
    em: j.embossing || '', cd: j.custom_description || '', ot: j.order_type || 'standard'
  }));

  // Create payment link (single-use: deactivates after one payment)
  const paymentLink = await stripeRequest(env, 'POST', '/payment_links', {
    ...lineItems,
    'restrictions[completed_sessions][limit]': '1',
    'shipping_address_collection[allowed_countries][]': ['CA', 'US', 'GB', 'AU', 'NZ', 'DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'AT', 'CH', 'SE', 'NO', 'DK', 'IE'],
    'after_completion[type]': 'redirect',
    'after_completion[redirect][url]': `https://kasskreative.com/?thank-you`,
    // Store first journal specs for backward compatibility
    'metadata[size]': journals[0].size,
    'metadata[leather]': journals[0].leather,
    'metadata[string_colour]': journals[0].string_colour,
    'metadata[eyelet]': journals[0].eyelet,
    'metadata[embossing]': journals[0].embossing || '',
    'metadata[custom_description]': journals[0].custom_description || '',
    'metadata[order_type]': journals[0].order_type || 'standard',
    'metadata[shipping]': shipping ? String(shipping) : '0',
    'metadata[duties]': duties ? String(duties) : '0',
    'metadata[journal_count]': String(journals.length),
    'metadata[journals_json]': JSON.stringify(journalSummary),
  });

  return new Response(JSON.stringify({ url: paymentLink.url, id: paymentLink.id }), {
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}

async function handleUpdateOrder(request, env, orderId) {
  const { status, tracking, status_note } = await request.json();
  const current = await getOrderStatus(env, orderId);

  current.status = status || current.status;
  if (tracking) current.tracking = tracking;
  current.history = current.history || [];
  current.history.push({
    status: current.status,
    timestamp: new Date().toISOString(),
    note: status_note || '',
  });

  await setOrderStatus(env, orderId, current);

  return new Response(JSON.stringify({ success: true, fulfillment: current }), {
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}

async function handleUpdateJournals(request, env, orderId) {
  const { journals } = await request.json();
  if (!journals || !Array.isArray(journals)) {
    return new Response(JSON.stringify({ error: 'journals array is required' }), {
      status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }

  const current = await getOrderStatus(env, orderId);
  current.journals_metadata = journals;
  current.history = current.history || [];
  current.history.push({
    status: current.status || 'paid',
    timestamp: new Date().toISOString(),
    note: `Journal details updated (${journals.length} journal${journals.length !== 1 ? 's' : ''})`,
  });

  await setOrderStatus(env, orderId, current);

  return new Response(JSON.stringify({ success: true, fulfillment: current }), {
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}

// ============ MANUAL / E-TRANSFER ORDERS ============

async function handleCreateManualOrder(request, env) {
  const body = await request.json();
  const { journals, shipping = 0, duties = 0, customer = {}, payment_method = 'e-transfer', shipping_address = {}, notes = '' } = body;

  if (!journals || !Array.isArray(journals) || journals.length === 0) {
    return new Response(JSON.stringify({ error: 'journals array is required' }), {
      status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }
  if (!customer.name) {
    return new Response(JSON.stringify({ error: 'customer name is required' }), {
      status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }

  // Compute total in cents
  let amountCents = 0;
  for (const j of journals) {
    amountCents += Math.round((Number(j.price) || 0) * 100);
    if (Array.isArray(j.accessories)) {
      for (const a of j.accessories) {
        amountCents += Math.round((Number(a.price) || 0) * 100);
      }
    }
  }
  amountCents += Math.round((Number(shipping) || 0) * 100);
  amountCents += Math.round((Number(duties) || 0) * 100);

  const nowSec = Math.floor(Date.now() / 1000);
  const randomSuffix = Math.random().toString(36).slice(2, 10);
  const id = `manual_${nowSec}_${randomSuffix}`;

  const orderData = {
    id,
    is_manual: true,
    created: nowSec,
    amount: amountCents,
    currency: 'cad',
    customer,
    payment_method,
    shipping_address,
    shipping_amount: Number(shipping) || 0,
    duties_amount: Number(duties) || 0,
    notes,
    journals,
  };

  // Persist order data
  if (env.ORDER_STATUS) {
    await env.ORDER_STATUS.put(`order_data:${id}`, JSON.stringify(orderData));
  }

  // Seed fulfillment status (paid by default for manual orders)
  const initialStatus = (payment_method === 'local_pickup') ? 'local_pickup' : 'paid';
  await setOrderStatus(env, id, {
    status: initialStatus,
    notes: notes || `Manual order (${payment_method})`,
    tracking: '',
    history: [{
      status: initialStatus,
      timestamp: new Date().toISOString(),
      note: `Manual order created (${payment_method})`,
    }],
    journals_metadata: journals,
  });

  return new Response(JSON.stringify({ id, success: true, order: orderData }), {
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}

async function listManualOrders(env) {
  const orders = [];
  if (!env.ORDER_STATUS) return orders;
  let cursor = undefined;
  do {
    const res = await env.ORDER_STATUS.list({ prefix: 'order_data:', cursor });
    for (const k of res.keys) {
      const data = await env.ORDER_STATUS.get(k.name, 'json');
      if (data) orders.push(data);
    }
    cursor = res.list_complete ? undefined : res.cursor;
  } while (cursor);
  return orders;
}

async function buildManualOrderResponse(env, orderId) {
  const data = await env.ORDER_STATUS.get(`order_data:${orderId}`, 'json');
  if (!data) return null;
  const kvStatus = await getOrderStatus(env, orderId);

  const labelFor = (size, leather) => size === 'Custom Passport'
    ? `Custom Passport Holder — ${leather || ''}`
    : `${size} Journal — ${leather || ''}`;
  const journals = (data.journals || []).map((j, idx) => ({
    journal_index: idx,
    name: labelFor(j.size, j.leather),
    amount: Math.round((Number(j.price) || 0) * 100),
    size: j.size || '',
    leather: j.leather || '',
    string_colour: j.string_colour || '',
    eyelet: j.eyelet || '',
    embossing: j.embossing || '',
    custom_description: j.custom_description || '',
    order_type: j.order_type || '',
  }));

  const accessories = [];
  for (const j of (data.journals || [])) {
    if (Array.isArray(j.accessories)) {
      for (const a of j.accessories) {
        accessories.push({
          name: `${a.name} (${j.size === 'Custom Passport' ? 'Custom Passport Holder' : j.size + ' Journal'})`,
          amount: Math.round((Number(a.price) || 0) * 100),
          accessory_name: a.name,
          journal_size: j.size,
          journal_leather: j.leather,
        });
      }
    }
  }

  let productName = journals.length > 0 ? journals[0].name : '';
  if (journals.length > 1) productName = `${journals.length}x Journals`;

  const addr = data.shipping_address || {};
  const shippingAddress = {
    name: data.customer?.name || '',
    address: {
      line1: addr.line1 || '',
      line2: addr.line2 || '',
      city: addr.city || '',
      state: addr.state || '',
      postal_code: addr.postal_code || '',
      country: addr.country || '',
    },
  };

  return {
    id: orderId,
    is_manual: true,
    payment_method: data.payment_method || 'e-transfer',
    amount: data.amount || 0,
    amount_shipping: Math.round((data.shipping_amount || 0) * 100),
    amount_duties: Math.round((data.duties_amount || 0) * 100),
    currency: data.currency || 'cad',
    created: data.created,
    customer_name: data.customer?.name || '',
    customer_email: data.customer?.email || '',
    customer_phone: data.customer?.phone || '',
    shipping_address: shippingAddress,
    product_name: productName,
    metadata: { journal_count: String(journals.length) },
    journals,
    accessories,
    journal_count: journals.length,
    fulfillment: kvStatus,
    notes: data.notes || '',
  };
}

async function handleGetOrder(env, orderId) {
  // Route manual orders to dedicated handler
  if (orderId && orderId.startsWith('manual_')) {
    const order = await buildManualOrderResponse(env, orderId);
    if (!order) {
      return new Response(JSON.stringify({ error: 'Manual order not found' }), {
        status: 404, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }
    return new Response(JSON.stringify(order), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }

  const pi = await stripeRequest(env, 'GET', `/payment_intents/${orderId}`);
  const sessions = await stripeRequest(env, 'GET', `/checkout/sessions?payment_intent=${orderId}&expand[]=data.line_items`);
  const session = sessions.data?.[0] || {};
  const kvStatus = await getOrderStatus(env, orderId);

  // Get ALL line items and separate journals from shipping/duties
  const lineItems = session.line_items?.data || [];
  const journalLineItems = lineItems.filter(li =>
    li.description && !li.description.match(/shipping|duties|tax|postage|delivery fee/i) && !li.description.match(/\(.*(?:journal|holder)\)\s*$/i)
  );

  // Fetch metadata for ALL journal products
  // IMPORTANT: Only trust full product metadata if the product has a journal_index field,
  // which means it was created specifically for this order via the admin portal.
  // Products created directly in Stripe (or reused across orders) may carry stale metadata
  // from a different customer — so we only extract size/leather from the product name.
  const journals = [];
  for (const li of journalLineItems) {
    let meta = {};
    let isOrderSpecific = false;
    if (li.price?.product) {
      const productId = typeof li.price.product === 'string' ? li.price.product : li.price.product.id;
      try {
        const product = await stripeRequest(env, 'GET', `/products/${productId}`);
        meta = product.metadata || {};
        // journal_index is only set by our admin portal's payment link creator
        isOrderSpecific = meta.journal_index !== undefined;
      } catch (e) { /* ignore */ }
    }

    // Parse size and leather from product name as fallback (e.g. "A5 Journal — Ocean")
    const desc = li.description || '';
    let parsedSize = '', parsedLeather = '';
    const nameMatch = desc.match(/^(Custom Passport|Custom A5|Custom A6|A5|A6|Passport)\s+(?:Journal|Holder|leather journal)\s*[-—]\s*(.+)$/i);
    if (nameMatch) {
      parsedSize = nameMatch[1];
      parsedLeather = nameMatch[2].trim();
    }

    if (isOrderSpecific) {
      // Trust all metadata — this product was made for this exact order
      journals.push({
        name: desc,
        amount: li.amount_total || 0,
        size: meta.size || parsedSize,
        leather: meta.leather || parsedLeather,
        string_colour: meta.string_colour || '',
        eyelet: meta.eyelet || '',
        embossing: meta.embossing || '',
        custom_description: meta.custom_description || '',
        order_type: meta.order_type || 'standard',
      });
    } else {
      // Product may be shared/reused — only trust size and leather (from name)
      journals.push({
        name: desc,
        amount: li.amount_total || 0,
        size: meta.size || parsedSize,
        leather: meta.leather || parsedLeather,
        string_colour: '',
        eyelet: '',
        embossing: '',
        custom_description: '',
        order_type: meta.order_type || 'standard',
      });
    }
  }

  // Extract accessory line items
  const accessoryLineItems = lineItems.filter(li =>
    li.description && li.description.match(/\(.*(?:journal|holder)\)\s*$/i)
  );
  const accessories = [];
  for (const li of accessoryLineItems) {
    let accMeta = {};
    if (li.price?.product) {
      const productId = typeof li.price.product === 'string' ? li.price.product : li.price.product.id;
      try {
        const product = await stripeRequest(env, 'GET', `/products/${productId}`);
        accMeta = product.metadata || {};
      } catch (e) { /* ignore */ }
    }
    accessories.push({
      name: li.description || accMeta.accessory_name || 'Accessory',
      amount: li.amount_total || 0,
      accessory_name: accMeta.accessory_name || li.description || '',
      journal_size: accMeta.journal_size || '',
      journal_leather: accMeta.journal_leather || '',
    });
  }

  // Build product name
  let productName = journals.length > 0 ? journals[0].name : '';
  if (journals.length > 1) {
    productName = `${journals.length}x Journals`;
  }

  // First journal's metadata for backward compatibility
  const firstJournal = journals[0] || {};
  const metadata = {
    ...pi.metadata,
    ...session.metadata,
    size: firstJournal.size,
    leather: firstJournal.leather,
    string_colour: firstJournal.string_colour,
    eyelet: firstJournal.eyelet,
    embossing: firstJournal.embossing,
    custom_description: firstJournal.custom_description,
    order_type: firstJournal.order_type,
    journal_count: String(journals.length),
  };

  // Get shipping address from multiple possible sources
  const shippingAddress = session.shipping_details
    || session.shipping
    || pi.shipping
    || (session.customer_details?.address ? { name: session.customer_details.name, address: session.customer_details.address } : null)
    || null;

  const order = {
    id: pi.id,
    amount: pi.amount,
    currency: pi.currency,
    created: pi.created,
    customer_name: session.customer_details?.name || '',
    customer_email: session.customer_details?.email || '',
    customer_phone: session.customer_details?.phone || '',
    shipping_address: shippingAddress,
    product_name: productName,
    metadata,
    journals,
    accessories,
    journal_count: journals.length,
    fulfillment: kvStatus,
  };

  return new Response(JSON.stringify(order), {
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}

// ============ MAIN HANDLER ============

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;

      // Handle CORS preflight
      if (request.method === 'OPTIONS') {
        return new Response(null, { headers: CORS_HEADERS });
      }

      // Login endpoint (no auth required)
      if (path === '/api/auth/login' && request.method === 'POST') {
        return handleLogin(request, env);
      }

      // All other endpoints require auth
      const authHeader = request.headers.get('Authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      }
      const token = authHeader.split(' ')[1];
      const user = await verifyJWT(token, env.JWT_SECRET);
      if (!user) {
        return new Response(JSON.stringify({ error: 'Invalid or expired token' }), {
          status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      }

      // Authenticated routes
      if (path === '/api/orders' && request.method === 'GET') {
        return handleListOrders(env, url);
      }
      if (path === '/api/orders' && request.method === 'POST') {
        return handleCreatePaymentLink(request, env);
      }
      if (path === '/api/manual-orders' && request.method === 'POST') {
        return handleCreateManualOrder(request, env);
      }
      if (path.match(/^\/api\/orders\/(.+)$/) && request.method === 'GET') {
        const orderId = path.split('/api/orders/')[1];
        return handleGetOrder(env, orderId);
      }
      if (path.match(/^\/api\/orders\/[^/]+\/journals$/) && request.method === 'PUT') {
        const orderId = path.split('/api/orders/')[1].split('/journals')[0];
        return handleUpdateJournals(request, env, orderId);
      }
      if (path.match(/^\/api\/orders\/(.+)$/) && request.method === 'PATCH') {
        const orderId = path.split('/api/orders/')[1];
        return handleUpdateOrder(request, env, orderId);
      }

      // Shippo routes
      if (path === '/api/shipping/test-cp' && request.method === 'POST') {
        return handleTestCanadaPost(request, env);
      }
      if (path === '/api/shipping/carriers' && request.method === 'GET') {
        return handleListCarriers(env);
      }
      if (path === '/api/shipping/connect-carrier' && request.method === 'POST') {
        return handleConnectCarrier(request, env);
      }
      if (path === '/api/shipping/rates' && request.method === 'POST') {
        return handleGetRates(request, env);
      }
      if (path === '/api/shipping/label' && request.method === 'POST') {
        return handleCreateLabel(request, env);
      }
      if (path === '/api/shipping/label-pdf' && request.method === 'POST') {
        return handleGetLabelPdf(request, env);
      }

      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: 'Internal server error', message: err.message }), {
        status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }
  },
};
