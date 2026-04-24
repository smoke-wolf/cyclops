import { BaseConnector } from './base.js';
import https from 'https';

export class WaybackConnector extends BaseConnector {
    constructor(config, state, telemetry) {
        super(config, state, telemetry);
        this.name = 'Wayback';
    }

    async run(investigationId, phaseId, inputType, inputValue) {
        const runId = this.state.recordConnectorRun(investigationId, phaseId, this.name, inputType, inputValue);
        this.telemetry.connectorStart(investigationId, this.name, phaseId, { type: inputType, value: inputValue });

        try {
            const entities = [];
            const domain = inputValue.replace(/^https?:\/\//, '');

            const urls = await this._fetch(`https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(domain)}/*&output=json&fl=original,timestamp,mimetype,statuscode&collapse=urlkey&limit=200`);
            const records = JSON.parse(urls);

            if (Array.isArray(records) && records.length > 1) {
                const seen = new Set();
                for (const row of records.slice(1)) {
                    const [original, timestamp, mime, status] = row;
                    if (seen.has(original)) continue;
                    seen.add(original);

                    entities.push({
                        type: 'url',
                        data: {
                            url: original,
                            timestamp,
                            mime_type: mime,
                            status_code: parseInt(status) || null,
                            source: 'wayback_machine',
                            archive_url: `https://web.archive.org/web/${timestamp}/${original}`
                        },
                        confidence: 0.8
                    });

                    try {
                        const u = new URL(original);
                        const sub = u.hostname;
                        if (sub !== domain && sub.endsWith(domain)) {
                            entities.push({
                                type: 'subdomain',
                                data: { name: sub, parent_domain: domain, source: 'wayback_machine' },
                                confidence: 0.7,
                                asKnown: { type: 'domain', value: sub }
                            });
                        }

                        if (u.pathname.match(/\.(js|json|xml|env|config|bak|sql|log|txt|csv|zip|tar|gz)$/i)) {
                            entities.push({
                                type: 'url',
                                data: {
                                    url: original,
                                    interesting_file: true,
                                    extension: u.pathname.split('.').pop(),
                                    source: 'wayback_machine'
                                },
                                confidence: 0.6
                            });
                        }

                        if (u.pathname.match(/\/api\/|\/v[12]\/|\/graphql|\/rest\//i)) {
                            entities.push({
                                type: 'url',
                                data: { url: original, api_endpoint: true, source: 'wayback_machine' },
                                confidence: 0.7
                            });
                        }
                    } catch {}
                }

                const emailRegex = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
                const urlText = records.slice(1).map(r => r[0]).join('\n');
                for (const match of urlText.matchAll(emailRegex)) {
                    entities.push({
                        type: 'email',
                        data: { address: match[0], source: 'wayback_url_params' },
                        confidence: 0.4,
                        asKnown: { type: 'email', value: match[0] }
                    });
                }
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

    _fetch(url) {
        return new Promise((resolve, reject) => {
            https.get(url, { headers: { 'User-Agent': 'cyclops-osint' }, timeout: 30000 }, res => {
                let data = '';
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => resolve(data));
            }).on('error', reject);
        });
    }

    async healthCheck() { return { ok: true, version: 'native' }; }
}
