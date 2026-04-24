import { BaseConnector } from './base.js';
import https from 'https';

export class VirusTotalConnector extends BaseConnector {
    constructor(config, state, telemetry) {
        super(config, state, telemetry);
        this.name = 'VirusTotal';
        this.apiKey = process.env.VIRUSTOTAL_API_KEY;
    }

    async run(investigationId, phaseId, inputType, inputValue) {
        if (!this.apiKey) return { status: 'skipped', error: 'VIRUSTOTAL_API_KEY not set' };

        const runId = this.state.recordConnectorRun(investigationId, phaseId, this.name, inputType, inputValue);
        this.telemetry.connectorStart(investigationId, this.name, phaseId, { type: inputType, value: inputValue });

        try {
            const entities = [];

            if (inputType === 'domain') {
                const data = await this._apiGet(`/api/v3/domains/${inputValue}`);
                if (data?.data?.attributes) {
                    const attrs = data.data.attributes;
                    entities.push({
                        type: 'domain',
                        data: {
                            name: inputValue,
                            registrar: attrs.registrar,
                            created_at: attrs.creation_date ? new Date(attrs.creation_date * 1000).toISOString() : null,
                            reputation: attrs.reputation,
                            malicious: attrs.last_analysis_stats?.malicious || 0,
                            suspicious: attrs.last_analysis_stats?.suspicious || 0,
                            harmless: attrs.last_analysis_stats?.harmless || 0,
                            categories: attrs.categories,
                            source: 'virustotal'
                        },
                        confidence: 0.95
                    });

                    if (attrs.last_dns_records) {
                        for (const rec of attrs.last_dns_records) {
                            if (rec.type === 'A' || rec.type === 'AAAA') {
                                entities.push({
                                    type: 'ip',
                                    data: { address: rec.value, source: 'virustotal_dns' },
                                    confidence: 0.9,
                                    asKnown: { type: 'ip', value: rec.value }
                                });
                            }
                            entities.push({
                                type: 'dns_record',
                                data: { type: rec.type, name: inputValue, value: rec.value, ttl: rec.ttl },
                                confidence: 0.9
                            });
                        }
                    }
                }

                const subs = await this._apiGet(`/api/v3/domains/${inputValue}/subdomains?limit=40`);
                if (subs?.data) {
                    for (const sub of subs.data) {
                        entities.push({
                            type: 'subdomain',
                            data: { name: sub.id, parent_domain: inputValue, source: 'virustotal' },
                            confidence: 0.9,
                            asKnown: { type: 'domain', value: sub.id }
                        });
                    }
                }
            }

            if (inputType === 'ip') {
                const data = await this._apiGet(`/api/v3/ip_addresses/${inputValue}`);
                if (data?.data?.attributes) {
                    const attrs = data.data.attributes;
                    entities.push({
                        type: 'ip',
                        data: {
                            address: inputValue,
                            asn: attrs.asn,
                            as_owner: attrs.as_owner,
                            country: attrs.country,
                            network: attrs.network,
                            reputation: attrs.reputation,
                            malicious: attrs.last_analysis_stats?.malicious || 0,
                            suspicious: attrs.last_analysis_stats?.suspicious || 0,
                            harmless: attrs.last_analysis_stats?.harmless || 0,
                            source: 'virustotal'
                        },
                        confidence: 0.95
                    });
                }

                const resolutions = await this._apiGet(`/api/v3/ip_addresses/${inputValue}/resolutions?limit=20`);
                if (resolutions?.data) {
                    for (const res of resolutions.data) {
                        const hostname = res.attributes?.host_name;
                        if (hostname) {
                            entities.push({
                                type: 'domain',
                                data: { name: hostname, source: 'virustotal_resolution', resolved_at: res.attributes?.date ? new Date(res.attributes.date * 1000).toISOString() : null },
                                confidence: 0.7,
                                asKnown: { type: 'domain', value: hostname }
                            });
                        }
                    }
                }
            }

            if (inputType === 'url') {
                const urlId = Buffer.from(inputValue).toString('base64url');
                const data = await this._apiGet(`/api/v3/urls/${urlId}`);
                if (data?.data?.attributes) {
                    const attrs = data.data.attributes;
                    entities.push({
                        type: 'url',
                        data: {
                            url: inputValue,
                            title: attrs.title,
                            final_url: attrs.last_final_url,
                            reputation: attrs.reputation,
                            malicious: attrs.last_analysis_stats?.malicious || 0,
                            suspicious: attrs.last_analysis_stats?.suspicious || 0,
                            source: 'virustotal'
                        },
                        confidence: 0.9
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
                hostname: 'www.virustotal.com',
                path,
                headers: { 'x-apikey': this.apiKey, 'Accept': 'application/json' },
                timeout: 15000
            }, res => {
                if (res.statusCode === 404) { res.resume(); return resolve(null); }
                if (res.statusCode === 429) { res.resume(); return reject(new Error('VirusTotal rate limited')); }
                if (res.statusCode >= 400) { res.resume(); return reject(new Error(`VirusTotal HTTP ${res.statusCode}`)); }
                let data = '';
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => {
                    try { resolve(JSON.parse(data)); } catch { resolve(null); }
                });
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('VirusTotal timeout')); });
        });
    }

    async healthCheck() {
        return { ok: !!this.apiKey, version: 'v3', hasApiKey: !!this.apiKey };
    }
}
