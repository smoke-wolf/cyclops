import { BaseConnector } from './base.js';
import https from 'https';

export class ShodanInternetDBConnector extends BaseConnector {
    constructor(config, state, telemetry) {
        super(config, state, telemetry);
        this.name = 'Shodan InternetDB';
    }

    async run(investigationId, phaseId, inputType, inputValue) {
        const runId = this.state.recordConnectorRun(investigationId, phaseId, this.name, inputType, inputValue);
        this.telemetry.connectorStart(investigationId, this.name, phaseId, { type: inputType, value: inputValue });

        try {
            const data = await this._fetch(`https://internetdb.shodan.io/${encodeURIComponent(inputValue)}`);
            const entities = [];

            if (data) {
                if (data.ports?.length) {
                    for (const port of data.ports) {
                        entities.push({
                            type: 'port',
                            data: { number: port, ip: inputValue, source: 'shodan_internetdb' },
                            confidence: 0.9
                        });
                    }
                }

                if (data.hostnames?.length) {
                    for (const hostname of data.hostnames) {
                        entities.push({
                            type: 'domain',
                            data: { name: hostname, source: 'shodan_internetdb' },
                            confidence: 0.8,
                            asKnown: { type: 'domain', value: hostname }
                        });
                    }
                }

                if (data.vulns?.length) {
                    entities.push({
                        type: 'ip',
                        data: {
                            address: inputValue,
                            vulns: data.vulns,
                            ports: data.ports,
                            cpes: data.cpes,
                            source: 'shodan_internetdb'
                        },
                        confidence: 0.9
                    });
                }

                if (data.tags?.length) {
                    entities.push({
                        type: 'ip',
                        data: { address: inputValue, tags: data.tags, source: 'shodan_internetdb_tags' },
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

    _fetch(url) {
        return new Promise((resolve, reject) => {
            const req = https.get(url, { timeout: 10000 }, res => {
                if (res.statusCode === 404) { res.resume(); return resolve(null); }
                if (res.statusCode >= 400) { res.resume(); return reject(new Error(`InternetDB HTTP ${res.statusCode}`)); }
                let data = '';
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => {
                    try { resolve(JSON.parse(data)); } catch { resolve(null); }
                });
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('InternetDB timeout')); });
        });
    }

    async healthCheck() {
        return { ok: true, version: 'free', hasApiKey: true };
    }
}
