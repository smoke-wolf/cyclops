import { BaseConnector } from './base.js';

export class AmassConnector extends BaseConnector {
    parse(stdout, stderr, inputType, inputValue) {
        const entities = [];
        const lines = stdout.split('\n').filter(Boolean);

        for (const line of lines) {
            try {
                const data = JSON.parse(line);
                if (data.name) {
                    entities.push({
                        type: 'subdomain',
                        data: {
                            name: data.name,
                            parent_domain: data.domain || inputValue,
                            ip: data.addresses?.[0]?.ip || null,
                            asn: data.addresses?.[0]?.asn || null,
                            source: data.sources?.join(', ') || 'amass'
                        },
                        confidence: 0.9,
                        asKnown: { type: 'domain', value: data.name }
                    });

                    for (const addr of (data.addresses || [])) {
                        if (addr.ip) {
                            entities.push({
                                type: 'ip',
                                data: { address: addr.ip, asn: addr.asn, org: addr.desc },
                                confidence: 0.9,
                                asKnown: { type: 'ip', value: addr.ip }
                            });
                        }
                    }
                }
            } catch {
                const match = line.match(/^([\w.-]+)\s*$/);
                if (match && match[1].includes('.')) {
                    entities.push({
                        type: 'subdomain',
                        data: { name: match[1], parent_domain: inputValue },
                        confidence: 0.7,
                        asKnown: { type: 'domain', value: match[1] }
                    });
                }
            }
        }
        return entities;
    }
}
