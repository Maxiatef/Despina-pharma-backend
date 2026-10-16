/**
 * Simple spam check for website forms. A submission that scores 2 or more is held for review:
 * it is saved, but no e-mail goes out (so a bot cannot use the form to mail the address it typed)
 * and no follow-up task is made until staff release it. Floods from one address are stopped by the rate limit instead.
 */
export interface SpamInput {
  name: string;
  email: string;
  company?: string;
  message?: string;
  /** Other answers, without fields meant for links (website, benchmark links). */
  fieldTexts: string[];
  /** Milliseconds between opening the form and sending it (sent by the website). */
  elapsedMs?: number;
}

const LINKS = /(https?:\/\/|www\.)\S+/gi;
const HAS_LINK = /(https?:\/\/|www\.)\S+/i;
const MARKUP = /\[url[=\]]|<a\s+href|\[link[=\]]/i;
const WORDS = /\b(viagra|cialis|casino|betting|crypto ?currency|bitcoin|forex|binary options|backlinks?|seo (services|agency|ranking)|guest posts?|rank (your|on) google|payday loans?|adult dating|escort)\b/i;
const DISPOSABLE = new Set([
  'mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com', 'temp-mail.org', 'yopmail.com', 'trashmail.com',
  'sharklasers.com', 'getnada.com', 'dispostable.com', 'maildrop.cc', 'fakeinbox.com', 'throwawaymail.com',
]);

export function spamReasons(input: SpamInput): string[] {
  const reasons: { text: string; weight: number }[] = [];
  const add = (text: string, weight: number) => reasons.push({ text, weight });
  const allText = [input.message ?? '', ...input.fieldTexts].join('\n');
  const links = allText.match(LINKS)?.length ?? 0;

  if (HAS_LINK.test(input.name)) add('Link in the name field', 2);
  if (HAS_LINK.test(input.company ?? '')) add('Link in the company field', 1);
  if (MARKUP.test(allText)) add('Link markup in the text', 2);
  if (links >= 4) add(`${links} links in the text`, 2);
  else if (links >= 1) add(`${links} link${links > 1 ? 's' : ''} in the text`, 1);
  const word = allText.match(WORDS)?.[0];
  if (word) add(`Spam word "${word}"`, 2);
  if (input.elapsedMs !== undefined && input.elapsedMs < 3000) add(`Sent ${(input.elapsedMs / 1000).toFixed(1)} s after opening the form`, 2);
  const domain = input.email.split('@')[1]?.toLowerCase();
  if (domain && DISPOSABLE.has(domain)) add('Throw-away e-mail address', 1);

  const score = reasons.reduce((n, r) => n + r.weight, 0);
  return score >= 2 ? reasons.map((r) => r.text) : [];
}
