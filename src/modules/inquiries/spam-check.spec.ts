import { describe, expect, it } from 'vitest';
import { spamReasons } from './spam-check.js';

const base = { name: 'Anna Smith', email: 'anna@brand.com', company: 'Brand Co', message: 'We need a quote for 5,000 face creams.', fieldTexts: [], elapsedMs: 40_000 };

describe('spamReasons', () => {
  it('lets a normal form through', () => {
    expect(spamReasons(base)).toEqual([]);
  });
  it('allows one or two links in the text', () => {
    expect(spamReasons({ ...base, message: 'Like https://a.example and www.b.example' })).toEqual([]);
  });
  it('holds a link in the name', () => {
    expect(spamReasons({ ...base, name: 'Buy now https://x.example' })).toContain('Link in the name field');
  });
  it('holds many links, link markup and spam words', () => {
    expect(spamReasons({ ...base, message: 'a http://1.x b http://2.x c http://3.x d http://4.x' }).length).toBeGreaterThan(0);
    expect(spamReasons({ ...base, message: '[url=http://x.example]cheap[/url]' }).length).toBeGreaterThan(0);
    expect(spamReasons({ ...base, fieldTexts: ['We offer SEO services'] }).length).toBeGreaterThan(0);
  });
  it('holds a form sent within 3 seconds, but not when the time is unknown', () => {
    expect(spamReasons({ ...base, elapsedMs: 800 }).length).toBeGreaterThan(0);
    expect(spamReasons({ ...base, elapsedMs: undefined })).toEqual([]);
  });
  it('needs two weak signs: a throw-away address alone is not enough', () => {
    expect(spamReasons({ ...base, email: 'x@mailinator.com' })).toEqual([]);
    expect(spamReasons({ ...base, email: 'x@mailinator.com', message: 'see http://x.example' }).length).toBe(2);
  });
});
