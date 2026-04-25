import { BaseConnector } from './base.js';
import https from 'https';

export class OTXConnector extends BaseConnector {
    constructor(config, state, telemetry) {
        super(config, state, telemetry);
        this.name = 'AlienVault OTX';
        this.apiKey = process.env.OTX_API_KEY;
    }

    async run(investigationId, phaseId, inputType, inputValue) {
        const runId = this.state.recordConnectorRun(investigationId, phaseId, this.name, inputType, inputValue);
        this.telemetry.connectorStart(investigationId, this.name, phaseId, { type: inputType, value: inputValue });

        try {
            const entities = [];

            if (inputType === 'domain') {
                const general = await this._apiGet(`/api/v1/indicators/domain/${inputValue}/general`);
                if (general) {
                    if (general.pulse_info?.count > 0) {
                        entities.push({
                            type: 'domain',
                            data: {
                                name: inputValue,
                                pulse_count: general.pulse_info.count,
                                pulses: general.pulse_info.pulses?.slice(0, 5).map(p => ({ name: p.name, created: p.created })),
                                source: 'otx'
                            },
                            confidence: 0.85
                        });
                    }
                }

                const passive = await this._apiGet(`/api/v1/indicators/domain/${inputValue}/passive_dns`);
                if (passive?.passive_dns) {
                    const seenIPs = new Set();
                    for (const rec of passive.passive_dns.slice(0, 30)) {
                        if (rec.address && !seenIPs.has(rec.address)) {
                            seenIPs.add(rec.address);
                            entities.push({
                                type: 'ip',
                                data: {
                                    address: rec.address,
                                    first_seen: rec.first,
                                    last_seen: rec.last,
                                    record_type: rec.record_type,
                                    source: 'otx_passive_dns'
                                },
                                confidence: 0.7,
                                asKnown: { type: 'ip', value: rec.address }
                            });
                        }
                    }
                }

                const malware = await this._apiGet(`/api/v1/indicators/domain/${inputValue}/malware`);
                if (malware?.data?.length) {
                    entities.push({
                        type: 'domain',
                        data: {
                            name: inputValue,
                            malware_samples: malware.data.length,
                            recent_hashes: malware.data.slice(0, 5).map(m => m.hash),
                            source: 'otx_malware'
                        },
                        confidence: 0.9
                    });
                }
            }

            if (inputType === 'ip') {
                const general = await this._apiGet(`/api/v1/indicators/IPv4/${inputValue}/general`);
                if (general) {
                    entities.push({
                        type: 'ip',
                        data: {
                            address: inputValue,
                            asn: general.asn,
                            country: general.country_name,
                            pulse_count: general.pulse_info?.count || 0,
                            reputation: general.reputation,
                            source: 'otx'
                        },
                        confidence: 0.85
                    });
                }

                const passive = await this._apiGet(`/api/v1/indicators/IPv4/${inputValue}/passive_dns`);
                if (passive?.passive_dns) {
                    const seenDomains = new Set();
                    for (const rec of passive.passive_dns.slice(0, 30)) {
                        if (rec.hostname && !seenDomains.has(rec.hostname)) {
                            seenDomains.add(rec.hostname);
                            entities.push({
                                type: 'domain',
                                data: {
                                    name: rec.hostname,
                                    first_seen: rec.first,
                                    last_seen: rec.last,
                                    source: 'otx_passive_dns'
                                },
                                confidence: 0.7,
                                asKnown: { type: 'domain', value: rec.hostname }
                            });
                        }
                    }
                }
            }

            if (inputType === 'url') {
                const general = await this._apiGet(`/api/v1/indicators/url/${encodeURIComponent(inputValue)}/general`);
                if (general) {
                    entities.push({
                        type: 'url',
                        data: {
                            url: inputValue,
                            pulse_count: general.pulse_info?.count || 0,
                            source: 'otx'
                        },
                        confidence: 0.8
                    });
                }
            }

            let newCount = 0;
            for (const entity of entities) {
                const added = this.state.addEntity(investigationId, entity.type, entity.data, entity.confidence);
                if (added.new) newCount++;
                this.telemetry.entityDiscovered(investigationId, entity.type, added.new, this.name);
                if (entity.asKnown) {
                    this.state.addKnown(investigationId, entity.asKnown.type, entity.asKnown.value, this.name, entity.confidence);
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
            const headers = { 'Accept': 'application/json' };
            if (this.apiKey) headers['X-OTX-API-KEY'] = this.apiKey;

            const req = https.get({
                hostname: 'otx.alienvault.com',
                path,
                headers,
                timeout: 15000
            }, res => {
                if (res.statusCode === 404) { res.resume(); return resolve(null); }
                if (res.statusCode === 429) { res.resume(); return reject(new Error('OTX rate limited')); }
                if (res.statusCode >= 400) { res.resume(); return reject(new Error(`OTX HTTP ${res.statusCode}`)); }
                let data = '';
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => {
                    try { resolve(JSON.parse(data)); } catch { resolve(null); }
                });
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('OTX timeout')); });
        });
    }

    async healthCheck() {
        return { ok: true, version: 'v1', hasApiKey: !!this.apiKey };
    }
}
