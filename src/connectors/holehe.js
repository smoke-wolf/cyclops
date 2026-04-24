import { BaseConnector } from './base.js';

export class HoleheConnector extends BaseConnector {
    parse(stdout, stderr, inputType, inputValue) {
        const entities = [];
        const lines = stdout.split('\n').filter(Boolean);

        for (const line of lines) {
            const match = line.match(/\[\+\]\s+(\S+)\s+/);
            if (match) {
                entities.push({
                    type: 'account',
                    data: {
                        platform: match[1],
                        username: null,
                        url: null,
                        verified: true,
                        email_registered: true
                    },
                    confidence: 0.9
                });
            }

            try {
                const data = JSON.parse(line);
                if (data.exists === true || data.used === true) {
                    entities.push({
                        type: 'account',
                        data: {
                            platform: data.name || data.domain,
                            username: data.emailrecovery || null,
                            url: data.url || null,
                            verified: true,
                            email_registered: true,
                            recovery_email: data.emailrecovery || null,
                            recovery_phone: data.phoneNumber || null
                        },
                        confidence: 0.9
                    });
                }
            } catch {}
        }
        return entities;
    }
}
