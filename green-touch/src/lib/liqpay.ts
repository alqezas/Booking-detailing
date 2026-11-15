/**
 * LiqPay checkout is a signed form POST (data + signature) to LiqPay's page.
 * The payload is prepared and signed on the server; the browser only submits it.
 */
export type Checkout = {url: string; data: string; signature: string};

export function goToLiqPay(c: Checkout): void {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = c.url;
  form.acceptCharset = 'utf-8';
  for (const [name, value] of Object.entries({data: c.data, signature: c.signature})) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}
