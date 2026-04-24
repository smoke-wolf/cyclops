import { BaseConnector } from './base.js';
import https from 'https';
import http from 'http';

export class WebScraperConnector extends BaseConnector {
    constructor(config, state, telemetry) {
        super(config, state, telemetry);
        this.name = 'WebScraper';
    }

    async run(investigationId, phaseId, inputType, inputValue) {
        const runId = this.state.recordConnectorRun(investigationId, phaseId, this.name, inputType, inputValue);
        this.telemetry.connectorStart(investigationId, this.name, phaseId, { type: inputType, value: inputValue });

        try {
            const entities = [];
            const url = inputValue.startsWith('http') ? inputValue : `https://${inputValue}`;
            const html = await this._fetch(url);

            const emails = html.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g);
            if (emails) {
                const seen = new Set();
                for (const email of emails) {
                    const clean = email.toLowerCase();
                    if (!seen.has(clean) && !clean.includes('example.com') && !clean.includes('wixpress')) {
                        seen.add(clean);
                        entities.push({
                            type: 'email',
                            data: { address: clean, source: `web_scrape:${inputValue}` },
                            confidence: 0.7,
                            asKnown: { type: 'email', value: clean }
                        });
                    }
                }
            }

            const socialPatterns = [
                { regex: /https?:\/\/(?:www\.)?twitter\.com\/(\w+)/gi, platform: 'Twitter' },
                { regex: /https?:\/\/(?:www\.)?x\.com\/(\w+)/gi, platform: 'Twitter' },
                { regex: /https?:\/\/(?:www\.)?github\.com\/([\w-]+)/gi, platform: 'GitHub' },
                { regex: /https?:\/\/(?:www\.)?linkedin\.com\/(?:in|company)\/([\w-]+)/gi, platform: 'LinkedIn' },
                { regex: /https?:\/\/(?:www\.)?facebook\.com\/([\w.]+)/gi, platform: 'Facebook' },
                { regex: /https?:\/\/(?:www\.)?instagram\.com\/(\w+)/gi, platform: 'Instagram' },
                { regex: /https?:\/\/(?:www\.)?youtube\.com\/(?:@|channel\/|user\/)([\w-]+)/gi, platform: 'YouTube' },
                { regex: /https?:\/\/(?:www\.)?reddit\.com\/(?:user|r)\/([\w-]+)/gi, platform: 'Reddit' },
                { regex: /https?:\/\/(?:www\.)?t\.me\/(\w+)/gi, platform: 'Telegram' },
                { regex: /https?:\/\/(?:www\.)?discord\.gg\/(\w+)/gi, platform: 'Discord' },
                { regex: /https?:\/\/(?:www\.)?medium\.com\/@?([\w-]+)/gi, platform: 'Medium' },
                { regex: /https?:\/\/(?:www\.)?keybase\.io\/(\w+)/gi, platform: 'Keybase' },
                { regex: /https?:\/\/(?:www\.)?mastodon\.\w+\/@(\w+)/gi, platform: 'Mastodon' }
            ];

            const seenAccounts = new Set();
            for (const { regex, platform } of socialPatterns) {
                for (const match of html.matchAll(regex)) {
                    const username = match[1];
                    const key = `${platform}:${username}`;
                    if (seenAccounts.has(key)) continue;
                    seenAccounts.add(key);
                    const ignore = ['share', 'intent', 'sharer', 'login', 'signup', 'home', 'search', 'explore', 'settings', 'about', 'help', 'privacy', 'terms'];
                    if (ignore.includes(username.toLowerCase())) continue;

                    entities.push({
                        type: 'account',
                        data: { platform, username, url: match[0], source: `web_scrape:${inputValue}`, verified: false },
                        confidence: 0.65,
                        asKnown: { type: 'username', value: username }
                    });
                }
            }

            const phoneRegex = /(?:\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
            const bodyText = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
            const seenPhones = new Set();
            for (const match of bodyText.matchAll(phoneRegex)) {
                const phone = match[0].replace(/[-.\s()]/g, '');
                if (phone.length < 10 || phone.length > 15) continue;
                if (/^0{3,}|^1234|^0123|^9999/.test(phone)) continue;
                if (seenPhones.has(phone)) continue;
                seenPhones.add(phone);
                const context = bodyText.slice(Math.max(0, match.index - 100), match.index + match[0].length + 100);
                const phoneContext = /phone|tel|call|contact|mobile|fax|whatsapp/i.test(context);
                entities.push({
                    type: 'phone',
                    data: { number: phone, source: `web_scrape:${inputValue}`, in_phone_context: phoneContext },
                    confidence: phoneContext ? 0.7 : 0.3
                });
            }

            const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
            const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)/i);

            entities.push({
                type: 'url',
                data: {
                    url,
                    title: titleMatch?.[1]?.trim(),
                    description: descMatch?.[1]?.trim(),
                    source: 'web_scrape'
                },
                confidence: 0.9
            });

            const techSignatures = [
                { pattern: /wp-content|wordpress/i, tech: 'WordPress' },
                { pattern: /shopify/i, tech: 'Shopify' },
                { pattern: /next\.js|__next/i, tech: 'Next.js' },
                { pattern: /react/i, tech: 'React' },
                { pattern: /angular/i, tech: 'Angular' },
                { pattern: /vue\.js|vuejs/i, tech: 'Vue.js' },
                { pattern: /cloudflare/i, tech: 'Cloudflare' },
                { pattern: /google-analytics|gtag/i, tech: 'Google Analytics' },
                { pattern: /recaptcha/i, tech: 'reCAPTCHA' },
                { pattern: /stripe\.js/i, tech: 'Stripe' }
            ];

            const techs = [];
            for (const { pattern, tech } of techSignatures) {
                if (pattern.test(html)) techs.push(tech);
            }
            if (techs.length) {
                entities.push({
                    type: 'technology',
                    data: { url, technologies: techs, source: 'web_scrape' },
                    confidence: 0.7
                });
            }

            let newCount = 0;
            for (const entity of entities) {
                const added = this.state.addEntity(investigationId, entity.type, entity.data, entity.confidence || 0.5);
                if (added.new) newCount++;
                this.telemetry.entityDiscovered(investigationId, entity.type, added.new, this.name);
                if (entity.asKnown) {
                    this.state.addKnown(investigationId, entity.asKnown.type, entity.asKnown.value, this.name, entity.confidence || 0.5);
                }
            }

            this.state.completeConnectorRun(runId, 'completed', newCount, null, null, 0);
            this.telemetry.connectorEnd(investigationId, this.name, phaseId, {
                status: 'completed', entitiesFound: newCount, input: { type: inputType, value: inputValue }
            });
            return { status: 'completed', entities, newCount };
        } catch (e) {
            this.state.completeConnectorRun(runId, 'failed', 0, null, e.message, 1);
            this.telemetry.connectorEnd(investigationId, this.name, phaseId, {
                status: 'failed', entitiesFound: 0, input: { type: inputType, value: inputValue }
            });
            return { status: 'failed', error: e.message };
        }
    }

    _fetch(url, maxRedirects = 5) {
        return new Promise((resolve, reject) => {
            if (maxRedirects <= 0) return reject(new Error('too many redirects'));
            const mod = url.startsWith('https') ? https : http;
            const req = mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }, timeout: 15000 }, res => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    res.resume();
                    const next = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).href;
                    return this._fetch(next, maxRedirects - 1).then(resolve).catch(reject);
                }
                if (res.statusCode === 429) { reject(new Error('web_scraper rate limited')); res.resume(); return; }
                if (res.statusCode >= 400) { reject(new Error(`web_scraper HTTP ${res.statusCode}`)); res.resume(); return; }
                let data = '';
                res.on('data', chunk => { data += chunk; if (data.length > 2_000_000) { res.destroy(); resolve(data); } });
                res.on('end', () => resolve(data));
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('web_scraper timeout')); });
        });
    }

    async healthCheck() { return { ok: true, version: 'native' }; }
}
