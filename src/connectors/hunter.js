import { BaseConnector } from './base.js';
import https from 'https';

export class HunterConnector extends BaseConnector {
    constructor(config, state, telemetry) {
        super(config, state, telemetry);
        this.name = 'Hunter';
        this.apiKey = process.env.HUNTER_API_KEY;
    }

    async run(investigationId, phaseId, inputType, inputValue) {
        if (!this.apiKey) return { status: 'skipped', error: 'HUNTER_API_KEY not set' };

        const runId = this.state.recordConnectorRun(investigationId, phaseId, this.name, inputType, inputValue);
        this.telemetry.connectorStart(investigationId, this.name, phaseId, { type: inputType, value: inputValue });

        try {
            const entities = [];

            if (inputType === 'domain') {
                const data = await this._apiGet(`/v2/domain-search?domain=${encodeURIComponent(inputValue)}&api_key=${this.apiKey}&limit=50`);
                if (data?.data) {
                    const d = data.data;

                    if (d.organization) {
                        entities.push({
                            type: 'organization',
                            data: { name: d.organization, source: 'hunter' },
                            confidence: 0.8
                        });
                    }

                    for (const email of (d.emails || [])) {
                        entities.push({
                            type: 'email',
                            data: {
                                address: email.value,
                                type: email.type,
                                confidence_score: email.confidence,
                                first_name: email.first_name,
                                last_name: email.last_name,
                                position: email.position,
                                department: email.department,
                                source: 'hunter'
                            },
                            confidence: (email.confidence || 50) / 100,
                            asKnown: { type: 'email', value: email.value }
                        });

                        if (email.first_name && email.last_name) {
                            entities.push({
                                type: 'person',
                                data: {
                                    name: `${email.first_name} ${email.last_name}`,
                                    email: email.value,
                                    position: email.position,
                                    department: email.department,
                                    source: 'hunter'
                                },
                                confidence: 0.7
                            });
                        }
                    }
                }
            }

            if (inputType === 'email') {
                const data = await this._apiGet(`/v2/email-verifier?email=${encodeURIComponent(inputValue)}&api_key=${this.apiKey}`);
                if (data?.data) {
                    const d = data.data;
                    entities.push({
                        type: 'email',
                        data: {
                            address: inputValue,
                            status: d.status,
                            deliverable: d.result === 'deliverable',
                            disposable: d.disposable,
                            webmail: d.webmail,
                            mx_records: d.mx_records,
                            smtp_server: d.smtp_server,
                            source: 'hunter_verify'
                        },
                        confidence: d.score ? d.score / 100 : 0.7
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

    _apiGet(path) {
        return new Promise((resolve, reject) => {
            const req = https.get({
                hostname: 'api.hunter.io',
                path,
                headers: { 'Accept': 'application/json' },
                timeout: 15000
            }, res => {
                if (res.statusCode === 401) { res.resume(); return reject(new Error('Hunter API key invalid')); }
                if (res.statusCode === 429) { res.resume(); return reject(new Error('Hunter rate limited')); }
                if (res.statusCode >= 400) { res.resume(); return reject(new Error(`Hunter HTTP ${res.statusCode}`)); }
                let data = '';
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => {
                    try { resolve(JSON.parse(data)); } catch { resolve(null); }
                });
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('Hunter timeout')); });
        });
    }

    async healthCheck() {
        return { ok: !!this.apiKey, version: 'v2', hasApiKey: !!this.apiKey };
    }
}
