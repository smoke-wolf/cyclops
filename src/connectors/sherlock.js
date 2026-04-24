import { BaseConnector } from './base.js';

export class SherlockConnector extends BaseConnector {
    parse(stdout, stderr, inputType, inputValue) {
        const entities = [];
        const lines = stdout.split('\n').filter(Boolean);

        for (const line of lines) {
            try {
                const data = JSON.parse(line);
                if (data && typeof data === 'object') {
                    for (const [site, info] of Object.entries(data)) {
                        if (info.status === 'Claimed') {
                            entities.push({
                                type: 'account',
                                data: {
                                    platform: site,
                                    username: inputValue,
                                    url: info.url_user,
                                    verified: true
                                },
                                confidence: 0.85,
                                asKnown: { type: 'url', value: info.url_user }
                            });
                        }
                    }
                }
            } catch {
                const match = line.match(/\[\+\]\s+(\S+):\s+(https?:\/\/\S+)/);
                if (match) {
                    entities.push({
                        type: 'account',
                        data: {
                            platform: match[1],
                            username: inputValue,
                            url: match[2],
                            verified: true
                        },
                        confidence: 0.8,
                        asKnown: { type: 'url', value: match[2] }
                    });
                }
            }
        }
        return entities;
    }
}
