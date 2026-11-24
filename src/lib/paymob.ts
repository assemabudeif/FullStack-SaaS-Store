import { createHmac, timingSafeEqual } from 'node:crypto';

export interface PaymobConfig {
  apiKey?: string;
  integrationId?: number;
  iframeId?: number;
  hmacSecret?: string;
}

export interface CustomerBillingData {
  name: string;
  email: string;
  phone: string;
  line1?: string;
  city?: string;
  country?: string;
}

export interface PaymobOrderParams {
  amountCents: number;
  currency: string;
  merchantOrderId: string;
  customer: CustomerBillingData;
  slug: string;
}

export interface PaymobInitResult {
  paymobOrderId: string;
  paymentKey: string;
  paymentUrl: string;
  iframeId: number;
  isSimulated: boolean;
}

export async function createPaymobPaymentSession(
  config: PaymobConfig,
  params: PaymobOrderParams,
  options: { allowSimulation?: boolean } = {},
): Promise<PaymobInitResult> {
  const apiKey = config.apiKey?.trim();
  const integrationId = config.integrationId;
  const iframeId = config.iframeId ?? 798934;

  // If live credentials are provided, call live Paymob Accept APIs
  if (apiKey && integrationId) {
    try {
      // 1. Authentication request
      const authRes = await fetch('https://accept.paymob.com/api/auth/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey }),
      });
      if (!authRes.ok) {
        throw new Error(`Paymob auth failed: ${authRes.statusText}`);
      }
      const authData = (await authRes.json()) as { token: string };

      // 2. Order Registration
      const orderRes = await fetch('https://accept.paymob.com/api/ecommerce/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auth_token: authData.token,
          delivery_needed: 'false',
          amount_cents: String(params.amountCents),
          currency: params.currency,
          merchant_order_id: params.merchantOrderId,
        }),
      });
      if (!orderRes.ok) {
        throw new Error(`Paymob order creation failed: ${orderRes.statusText}`);
      }
      const orderData = (await orderRes.json()) as { id: number };

      // Split customer name
      const nameParts = params.customer.name.trim().split(' ');
      const firstName = nameParts[0] || 'Customer';
      const lastName = nameParts.slice(1).join(' ') || 'User';

      // 3. Payment Key Generation
      const keyRes = await fetch('https://accept.paymob.com/api/acceptance/payment_keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auth_token: authData.token,
          amount_cents: String(params.amountCents),
          expiration: 3600,
          order_id: String(orderData.id),
          billing_data: {
            apartment: 'NA',
            email: params.customer.email,
            floor: 'NA',
            first_name: firstName,
            street: params.customer.line1 || 'Main Street',
            building: 'NA',
            phone_number: params.customer.phone || '+201000000000',
            shipping_method: 'PKG',
            postal_code: 'NA',
            city: params.customer.city || 'Cairo',
            country: params.customer.country || 'EG',
            last_name: lastName,
            state: 'NA',
          },
          currency: params.currency,
          integration_id: integrationId,
        }),
      });
      if (!keyRes.ok) {
        throw new Error(`Paymob payment key failed: ${keyRes.statusText}`);
      }
      const keyData = (await keyRes.json()) as { token: string };

      return {
        paymobOrderId: String(orderData.id),
        paymentKey: keyData.token,
        paymentUrl: `https://accept.paymob.com/api/acceptance/iframes/${iframeId}?payment_token=${keyData.token}`,
        iframeId,
        isSimulated: false,
      };
    } catch (error) {
      if (options.allowSimulation === false) {
        throw new Error('Paymob is unavailable; payment simulation is disabled.');
      }
      console.warn('Paymob API call encountered an error, falling back to simulator:', error);
    }
  }

  if (options.allowSimulation === false) {
    throw new Error('Paymob is not configured; payment simulation is disabled.');
  }

  // Interactive simulated gateway mode for local development, instant testing, and showcase
  const simulatedKey = `pm_sim_${Math.random().toString(36).substring(2, 12)}_${Date.now()}`;
  const simulatedOrderId = `pm_ord_${Math.random().toString(36).substring(2, 8)}`;
  const paymentUrl = `/shop/${params.slug}/paymob-simulator?orderId=${params.merchantOrderId}&amount=${params.amountCents}&currency=${params.currency}&key=${simulatedKey}`;

  return {
    paymobOrderId: simulatedOrderId,
    paymentKey: simulatedKey,
    paymentUrl,
    iframeId,
    isSimulated: true,
  };
}

export function verifyPaymobHmac(data: Record<string, any>, hmacSecret: string): boolean {
  if (!hmacSecret) return false;
  // Standard Paymob HMAC fields concatenation
  const fields = [
    'amount_cents',
    'created_at',
    'currency',
    'error_occured',
    'has_parent_transaction',
    'id',
    'integration_id',
    'is_3d_secure',
    'is_auth',
    'is_capture',
    'is_refunded',
    'is_standalone_payment',
    'is_voided',
    'order.id',
    'owner',
    'pending',
    'source_data.pan',
    'source_data.sub_type',
    'source_data.type',
    'success',
  ];

  let concatenated = '';
  for (const field of fields) {
    const parts = field.split('.');
    let val: any = data;
    for (const p of parts) {
      val = val?.[p];
    }
    concatenated += val !== undefined && val !== null ? String(val) : '';
  }

  const expected = createHmac('sha512', hmacSecret).update(concatenated).digest('hex');
  const received = data.hmac || data.HMAC;
  if (typeof received !== 'string' || !/^[a-f0-9]{128}$/i.test(received)) return false;
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex'));
}
