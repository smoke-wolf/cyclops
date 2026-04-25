import { BaseConnector } from './base.js';
import https from 'https';

export class AbuseIPDBConnector extends BaseConnector {
    constructor(config, state, telemetry) {
        super(config, state, telemetry);
        this.name = 'AbuseIPDB';
        this.apiKey = process.env.ABUSEIPDB_API_KEY;
    }

    async run(investigationId, phaseId, inputType, inputValue) {
        if (!this.apiKey) return { status: 'skipped', error: 'ABUSEIPDB_API_KEY not set' };

        const runId = this.state.recordConnectorRun(investigationId, phaseId, this.name, inputType, inputValue);
        this.telemetry.connectorStart(investigationId, this.name, phaseId, { type: inputType, value: inputValue });

        try {
            const entities = [];
            const data = await this._apiGet(`/api/v2/check?ipAddress=${encodeURIComponent(inputValue)}&maxAgeInDays=90&verbose`);

            if (data?.data) {
                const d = data.data;
                entities.push({
                    type: 'ip',
                    data: {
                        address: inputValue,
                        abuse_score: d.abuseConfidenceScore,
                        country: d.countryCode,
                        isp: d.isp,
                        domain: d.domain,
                        usage_type: d.usageType,
                        is_tor: d.isTor,
                        is_proxy: d.isProxy || false,
                        total_reports: d.totalReports,
                        num_distinct_users: d.numDistinctUsers,
                        last_reported: d.lastReportedAt,
                        source: 'abuseipdb'
                    },
                    confidence: 0.9
                });

                if (d.domain) {
                    entities.push({
                        type: 'domain',
                        data: { name: d.domain, source: 'abuseipdb_isp' },
                        confidence: 0.6,
                        asKnown: { type: 'domain', value: d.domain }
                    });
                }

                if (d.hostnames?.length) {
                    for (const hostname of d.hostnames) {
                        entities.push({
                            type: 'domain',
                            data: { name: hostname, source: 'abuseipdb_hostname' },
                            confidence: 0.8,
                            asKnown: { type: 'domain', value: hostname }
                        });
                    }
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
            const req = https.get({
                hostname: 'api.abuseipdb.com',
                path,
                headers: { 'Key': this.apiKey, 'Accept': 'application/json' },
                timeout: 10000
            }, res => {
                if (res.statusCode === 404) { res.resume(); return resolve(null); }
                if (res.statusCode === 429) { res.resume(); return reject(new Error('AbuseIPDB rate limited')); }
                if (res.statusCode >= 400) { res.resume(); return reject(new Error(`AbuseIPDB HTTP ${res.statusCode}`)); }
                let data = '';
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => {
                    try { resolve(JSON.parse(data)); } catch { resolve(null); }
                });
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('AbuseIPDB timeout')); });
        });
    }

    async healthCheck() {
        return { ok: !!this.apiKey, version: 'v2', hasApiKey: !!this.apiKey };
    }
}
