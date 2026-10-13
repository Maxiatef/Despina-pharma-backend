import { renderTemplate, TEMPLATE_NAMES } from './email.templates.js';
import { signWebhook, verifyWebhookSignature } from './webhook-signature.js';
import { isUndeliverableTestAddress, parseRecipients } from './email-settings.js';

const SECRET = `whsec_${Buffer.from('a-test-secret-of-some-length!!').toString('base64')}`;
const sample = {
  referenceNo: 'DP-INQ-2026-000001', formType: 'contact', contactName: 'Sara <b>Ali</b>', contactEmail: 'sara@example.com', message: 'Hi & hello',
  projectId: 'p1', inquiryId: 'i1', projectCode: 'DP-PRJ-2026-0001', projectName: 'Serum', quoteNo: 'Q1', versionNo: 1, total: '10.50', currency: 'USD',
  decision: 'accepted', sampleTitle: 'S', revisionNo: 1, productName: 'P', title: 'Follow up DP-INQ-2026-000001', token: 'abc def', tasks: ['x'], completedStage: 'A', nextStage: 'B',
};

describe('email templates', () => {
  it('render every template with subject, html and text', () => {
    for (const t of TEMPLATE_NAMES) {
      const r = renderTemplate(t, sample, 'https://example.org/');
      expect(r.subject.length).toBeGreaterThan(3);
      expect(r.html).toContain('Despina');
      expect(r.html).toContain('The art of beauty. The science behind it.');
      expect(r.text).toContain('Despina Pharma');
      expect(r.html).not.toMatch(/undefined|\[object Object\]/);
      expect(r.text).not.toMatch(/undefined|\[object Object\]/);
    }
  });

  it('escapes user content in HTML', () => {
    const r = renderTemplate('owner_notice', sample, 'https://example.org');
    expect(r.html).toContain('Sara &lt;b&gt;Ali&lt;/b&gt;');
    expect(r.html).not.toContain('<b>Ali</b>');
    expect(r.html).toContain('Hi &amp; hello');
  });

  it('links point at the app and encode tokens', () => {
    expect(renderTemplate('invite', sample, 'https://example.org').text).toContain('https://example.org/accept-invite/?token=abc%20def');
    expect(renderTemplate('quote_ready', sample, 'https://example.org').html).toContain('https://example.org/portal/projects/p1/');
  });
});

describe('webhook signature', () => {
  const body = JSON.stringify({ type: 'email.delivered', data: { email_id: 'e1' } });

  it('accepts a correctly signed call', () => {
    const h = signWebhook(SECRET, body);
    expect(verifyWebhookSignature(SECRET, body, { id: h['svix-id'], timestamp: h['svix-timestamp'], signature: h['svix-signature'] })).toEqual({ ok: true });
  });

  it('refuses a changed body, a wrong secret, missing headers and old timestamps', () => {
    const h = signWebhook(SECRET, body);
    const headers = { id: h['svix-id'], timestamp: h['svix-timestamp'], signature: h['svix-signature'] };
    expect(verifyWebhookSignature(SECRET, body.replace('e1', 'e2'), headers).ok).toBe(false);
    expect(verifyWebhookSignature(`whsec_${Buffer.from('other').toString('base64')}`, body, headers).ok).toBe(false);
    expect(verifyWebhookSignature(SECRET, body, { id: headers.id }).ok).toBe(false);
    const old = signWebhook(SECRET, body, 'msg_1', Math.floor(Date.now() / 1000) - 3600);
    expect(verifyWebhookSignature(SECRET, body, { id: 'msg_1', timestamp: old['svix-timestamp'], signature: old['svix-signature'] }).ok).toBe(false);
  });

  it('accepts when one of several signatures matches (secret rotation)', () => {
    const h = signWebhook(SECRET, body);
    const sig = `v1,AAAA ${h['svix-signature']}`;
    expect(verifyWebhookSignature(SECRET, body, { id: h['svix-id'], timestamp: h['svix-timestamp'], signature: sig }).ok).toBe(true);
  });
});

describe('recipients', () => {
  it('parses and de-duplicates comma lists, dropping invalid entries', () => {
    expect(parseRecipients('A@x.com, b@y.org; a@x.com nope')).toEqual(['a@x.com', 'b@y.org']);
  });
  it('recognises test addresses', () => {
    expect(isUndeliverableTestAddress('buyer.1@smoke-test.invalid')).toBe(true);
    expect(isUndeliverableTestAddress('qa@qa.invalid')).toBe(true);
    expect(isUndeliverableTestAddress('x@example.com')).toBe(true);
    expect(isUndeliverableTestAddress('maxatef235@gmail.com')).toBe(false);
  });
});
