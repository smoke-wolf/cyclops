import { BaseConnector } from './base.js';
import https from 'https';

export class URLScanConnector extends BaseConnector {
    constructor(config, state, telemetry) {
        super(config, state, telemetry);
        this.name = 'URLScan';
        this.apiKey = process.env.URLSCAN_API_KEY;
    }

    async run(investigationId, phaseId, inputType, inputValue) {
        const runId = this.state.recordConnectorRun(investigationId, phaseId, this.name, inputType, inputValue);
        this.telemetry.connectorStart(investigationId, this.name, phaseId, { type: inputType, value: inputValue });

        try {
            const entities = [];
            const query = inputType === 'domain' ? `domain:${inputValue}` : `page.url:"${inputValue}"`;
            const results = await this._apiGet(`/api/v1/search/?q=${encodeURIComponent(query)}&size=20`);

            if (results?.results) {
                const seenIPs = new Set();
                const seenDomains = new Set();
                const technologies = new Set();

                for (const scan of results.results) {
                    const page = scan.page || {};

                    if (page.ip && !seenIPs.has(page.ip)) {
                        seenIPs.add(page.ip);
                        entities.push({
                            type: 'ip',
                            data: {
                                address: page.ip,
                                asn: page.asnname,
                                country: page.country,
                                server: page.server,
                                source: 'urlscan'
                            },
                            confidence: 0.8,
                            asKnown: { type: 'ip', value: page.ip }
                        });
                    }

                    if (page.domain && !seenDomains.has(page.domain) && page.domain !== inputValue) {
                        seenDomains.add(page.domain);
                        entities.push({
                            type: 'domain',
                            data: { name: page.domain, source: 'urlscan' },
                            confidence: 0.7,
                            asKnown: { type: 'domain', value: page.domain }
                        });
                    }

                    if (page.server) technologies.add(page.server);
                }

                if (technologies.size > 0) {
                    entities.push({
                        type: 'technology',
                        data: {
                            url: inputType === 'domain' ? `https://${inputValue}` : inputValue,
                            technologies: [...technologies],
                            source: 'urlscan'
                        },
                        confidence: 0.7
                    });
                }

                if (inputType === 'domain') {
                    const latest = results.results[0];
                    if (latest?.task?.uuid) {
                        const detail = await this._apiGet(`/api/v1/result/${latest.task.uuid}/`);
                        if (detail?.lists) {
                            for (const domain of (detail.lists.domains || []).slice(0, 20)) {
                                if (!seenDomains.has(domain) && domain !== inputValue) {
                                    seenDomains.add(domain);
                                    entities.push({
                                        type: 'domain',
                                        data: { name: domain, source: 'urlscan_resources' },
                                        confidence: 0.5
                                    });
                                }
                            }

                            for (const ip of (detail.lists.ips || []).slice(0, 20)) {
                                if (!seenIPs.has(ip)) {
                                    seenIPs.add(ip);
                                    entities.push({
                                        type: 'ip',
                                        data: { address: ip, source: 'urlscan_resources' },
                                        confidence: 0.5,
                                        asKnown: { type: 'ip', value: ip }
                                    });
                                }
                            }

                            if (detail.lists.certificates?.length) {
                                for (const cert of detail.lists.certificates.slice(0, 10)) {
                                    entities.push({
                                        type: 'certificate',
                                        data: {
                                            subject: cert.subjectName,
                                            issuer: cert.issuer,
                                            valid_from: cert.validFrom ? new Date(cert.validFrom * 1000).toISOString() : null,
                                            valid_to: cert.validTo ? new Date(cert.validTo * 1000).toISOString() : null,
                                            source: 'urlscan'
                                        },
                                        confidence: 0.8
                                    });
                                }
                            }
                        }
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
            const headers = { 'Accept': 'application/json' };
            if (this.apiKey) headers['API-Key'] = this.apiKey;

            const req = https.get({
                hostname: 'urlscan.io',
                path,
                headers,
                timeout: 15000
            }, res => {
                if (res.statusCode === 404) { res.resume(); return resolve(null); }
                if (res.statusCode === 429) { res.resume(); return reject(new Error('URLScan rate limited')); }
                if (res.statusCode >= 400) { res.resume(); return reject(new Error(`URLScan HTTP ${res.statusCode}`)); }
                let data = '';
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => {
                    try { resolve(JSON.parse(data)); } catch { resolve(null); }
                });
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('URLScan timeout')); });
        });
    }

    async healthCheck() {
        return { ok: true, version: 'v1', hasApiKey: !!this.apiKey };
    }
}
