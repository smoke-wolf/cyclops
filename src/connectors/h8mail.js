import { BaseConnector } from './base.js';

export class H8mailConnector extends BaseConnector {
    parse(stdout, stderr, inputType, inputValue) {
        const entities = [];

        try {
            const data = JSON.parse(stdout);
            for (const target of (data.targets || [data])) {
                for (const breach of (target.data || [])) {
                    entities.push({
                        type: 'breach',
                        data: {
                            name: breach.name || breach.source || 'unknown',
                            date: breach.date || null,
                            source: breach.source || 'h8mail',
                            data_types: breach.data_types || [],
                            email: inputValue
                        },
                        confidence: 0.85
                    });

                    if (breach.password || breach.hash) {
                        entities.push({
                            type: 'credential',
                            data: {
                                email: inputValue,
                                password_hash: breach.hash || null,
                                plaintext: breach.password || null,
                                source_breach: breach.name || breach.source
                            },
                            confidence: 0.9
                        });
                    }
                }
            }
        } catch {
            const lines = stdout.split('\n');
            let currentBreach = null;
            for (const line of lines) {
                const breachMatch = line.match(/\[\+\]\s+(.+?)(?:\s+\||\s*$)/);
                if (breachMatch) {
                    currentBreach = breachMatch[1];
                    entities.push({
                        type: 'breach',
                        data: { name: currentBreach, email: inputValue, source: 'h8mail' },
                        confidence: 0.75
                    });
                }
                const credMatch = line.match(/Password:\s*(.+)/i);
                if (credMatch && currentBreach) {
                    entities.push({
                        type: 'credential',
                        data: {
                            email: inputValue,
                            plaintext: credMatch[1].trim(),
                            source_breach: currentBreach
                        },
                        confidence: 0.85
                    });
                }
            }
        }
        return entities;
    }
}
