import { BaseConnector } from './base.js';

export class MaigretConnector extends BaseConnector {
    parse(stdout, stderr, inputType, inputValue) {
        const entities = [];

        try {
            const data = JSON.parse(stdout);
            const sites = data.sites || data;

            for (const [site, info] of Object.entries(sites)) {
                if (info.status?.status === 'Claimed' || info.status === 'Claimed') {
                    const entity = {
                        type: 'account',
                        data: {
                            platform: site,
                            username: inputValue,
                            url: info.url_user || info.url,
                            verified: true,
                            tags: info.tags || []
                        },
                        confidence: 0.85
                    };

                    if (info.ids_usernames) {
                        for (const linked of Object.values(info.ids_usernames)) {
                            entities.push({
                                type: 'person',
                                data: { username: linked },
                                confidence: 0.5,
                                asKnown: { type: 'username', value: linked }
                            });
                        }
                    }

                    if (info.ids_emails) {
                        for (const email of Object.values(info.ids_emails)) {
                            entities.push({
                                type: 'email',
                                data: { address: email, source: site },
                                confidence: 0.7,
                                asKnown: { type: 'email', value: email }
                            });
                        }
                    }

                    if (info.url_user) {
                        entity.asKnown = { type: 'url', value: info.url_user };
                    }
                    entities.push(entity);
                }
            }
        } catch {
            const lines = stdout.split('\n');
            for (const line of lines) {
                const match = line.match(/\[\+\]\s+(\S+):\s+(https?:\/\/\S+)/);
                if (match) {
                    entities.push({
                        type: 'account',
                        data: { platform: match[1], username: inputValue, url: match[2], verified: true },
                        confidence: 0.8
                    });
                }
            }
        }
        return entities;
    }
}
