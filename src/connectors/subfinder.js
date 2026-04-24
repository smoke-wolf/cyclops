import { BaseConnector } from './base.js';

export class SubfinderConnector extends BaseConnector {
    parse(stdout, stderr, inputType, inputValue) {
        const entities = [];
        const lines = stdout.split('\n').filter(Boolean);

        for (const line of lines) {
            try {
                const data = JSON.parse(line);
                entities.push({
                    type: 'subdomain',
                    data: {
                        name: data.host || data.input,
                        parent_domain: inputValue,
                        source: data.source || 'subfinder'
                    },
                    confidence: 0.85,
                    asKnown: { type: 'domain', value: data.host || data.input }
                });
            } catch {
                const trimmed = line.trim();
                if (trimmed.includes('.') && !trimmed.includes(' ')) {
                    entities.push({
                        type: 'subdomain',
                        data: { name: trimmed, parent_domain: inputValue },
                        confidence: 0.75,
                        asKnown: { type: 'domain', value: trimmed }
                    });
                }
            }
        }
        return entities;
    }
}
