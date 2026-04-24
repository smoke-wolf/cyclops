import { BaseConnector } from './base.js';

export class TheHarvesterConnector extends BaseConnector {
    parse(stdout, stderr, inputType, inputValue) {
        const entities = [];

        try {
            const data = JSON.parse(stdout);
            for (const email of (data.emails || [])) {
                entities.push({
                    type: 'email',
                    data: { address: email, source: 'theharvester', domain: inputValue },
                    confidence: 0.8,
                    asKnown: { type: 'email', value: email }
                });
            }
            for (const host of (data.hosts || [])) {
                const parts = host.split(':');
                entities.push({
                    type: 'subdomain',
                    data: { name: parts[0], parent_domain: inputValue, ip: parts[1] || null },
                    confidence: 0.85,
                    asKnown: { type: 'domain', value: parts[0] }
                });
                if (parts[1]) {
                    entities.push({
                        type: 'ip',
                        data: { address: parts[1] },
                        confidence: 0.85,
                        asKnown: { type: 'ip', value: parts[1] }
                    });
                }
            }
            for (const ip of (data.ips || [])) {
                entities.push({
                    type: 'ip',
                    data: { address: ip },
                    confidence: 0.8,
                    asKnown: { type: 'ip', value: ip }
                });
            }
        } catch {
            const emailRegex = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
            const ipRegex = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
            const subdomainRegex = new RegExp(`[\\w.-]+\\.${inputValue.replace('.', '\\.')}`, 'gi');

            for (const match of stdout.matchAll(emailRegex)) {
                entities.push({
                    type: 'email',
                    data: { address: match[0], source: 'theharvester' },
                    confidence: 0.7,
                    asKnown: { type: 'email', value: match[0] }
                });
            }
            for (const match of stdout.matchAll(subdomainRegex)) {
                entities.push({
                    type: 'subdomain',
                    data: { name: match[0], parent_domain: inputValue },
                    confidence: 0.7,
                    asKnown: { type: 'domain', value: match[0] }
                });
            }
            for (const match of stdout.matchAll(ipRegex)) {
                entities.push({
                    type: 'ip',
                    data: { address: match[0] },
                    confidence: 0.6,
                    asKnown: { type: 'ip', value: match[0] }
                });
            }
        }
        return entities;
    }
}
