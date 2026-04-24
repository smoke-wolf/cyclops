import { BaseConnector } from './base.js';

export class DnsreconConnector extends BaseConnector {
    parse(stdout, stderr, inputType, inputValue) {
        const entities = [];

        try {
            const records = JSON.parse(stdout);
            for (const rec of (Array.isArray(records) ? records : [])) {
                entities.push({
                    type: 'dns_record',
                    data: {
                        type: rec.type,
                        name: rec.name,
                        value: rec.address || rec.target || rec.strings,
                        ttl: rec.ttl
                    },
                    confidence: 0.9
                });

                if (rec.type === 'A' || rec.type === 'AAAA') {
                    entities.push({
                        type: 'ip',
                        data: { address: rec.address, version: rec.type === 'AAAA' ? 6 : 4 },
                        confidence: 0.9,
                        asKnown: { type: 'ip', value: rec.address }
                    });
                }

                if (rec.type === 'MX') {
                    entities.push({
                        type: 'subdomain',
                        data: { name: rec.exchange || rec.target, parent_domain: inputValue },
                        confidence: 0.85
                    });
                }

                if (rec.type === 'CNAME') {
                    entities.push({
                        type: 'subdomain',
                        data: { name: rec.name, parent_domain: inputValue, cname: rec.target },
                        confidence: 0.85,
                        asKnown: { type: 'domain', value: rec.target }
                    });
                }

                if (rec.type === 'NS') {
                    entities.push({
                        type: 'subdomain',
                        data: { name: rec.target, parent_domain: inputValue },
                        confidence: 0.9
                    });
                }

                if (rec.type === 'TXT' && rec.strings) {
                    const spf = rec.strings.match(/include:(\S+)/g);
                    if (spf) {
                        for (const inc of spf) {
                            const domain = inc.replace('include:', '');
                            entities.push({
                                type: 'domain',
                                data: { name: domain, source: 'spf_include' },
                                confidence: 0.7
                            });
                        }
                    }
                }
            }
        } catch {
            const lines = stdout.split('\n');
            for (const line of lines) {
                const recMatch = line.match(/\[\*\]\s+(\w+)\s+(\S+)\s+(\S+)/);
                if (recMatch) {
                    entities.push({
                        type: 'dns_record',
                        data: { type: recMatch[1], name: recMatch[2], value: recMatch[3] },
                        confidence: 0.7
                    });
                }
            }
        }
        return entities;
    }
}
