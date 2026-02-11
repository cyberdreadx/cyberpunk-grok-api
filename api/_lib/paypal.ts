/**
 * PayPal REST API helpers — OAuth2 token, create order, capture.
 */

const PAYPAL_API = process.env.PAYPAL_SANDBOX === "true"
  ? "https://api-m.sandbox.paypal.com"
  : "https://api-m.paypal.com";

async function getAccessToken(): Promise<string> {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("PayPal credentials not configured");
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${auth}`,
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`PayPal auth failed: ${err}`);
  }

  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

export interface CreateOrderParams {
  amountDollars: string;
  packageId: string;
  credits: number;
  userId: string;
}

export async function createPayPalOrder(params: CreateOrderParams): Promise<string> {
  const token = await getAccessToken();

  const res = await fetch(`${PAYPAL_API}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: {
            currency_code: "USD",
            value: params.amountDollars,
          },
          custom_id: JSON.stringify({
            user_id: params.userId,
            package: params.packageId,
            credits: params.credits,
          }),
        },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`PayPal create order failed: ${err}`);
  }

  const data = (await res.json()) as { id: string };
  return data.id;
}

export async function capturePayPalOrder(orderId: string): Promise<{
  captureId: string;
  customId: string;
}> {
  const token = await getAccessToken();

  const res = await fetch(`${PAYPAL_API}/v2/checkout/orders/${orderId}/capture`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`PayPal capture failed: ${err}`);
  }

  const data = (await res.json()) as {
    purchase_units?: Array<{
      payments?: {
        captures?: Array<{ id: string }>;
      };
      custom_id?: string;
    }>;
  };

  const capture = data.purchase_units?.[0]?.payments?.captures?.[0];
  const customId = data.purchase_units?.[0]?.custom_id;

  if (!capture?.id) {
    throw new Error("PayPal capture response missing capture ID");
  }

  return { captureId: capture.id, customId: customId || "" };
}
