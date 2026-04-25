import { BaseConnector } from './base.js';
import https from 'https';

export class SecurityTrailsConnector extends BaseConnector {
    constructor(config, state, telemetry) {
        super(config, state, telemetry);
        this.name = 'SecurityTrails';
        this.apiKey = process.env.SECURITYTRAILS_API_KEY;
    }

    async run(investigationId, phaseId, inputType, inputValue) {
        if (!this.apiKey) return { status: 'skipped', error: 'SECURITYTRAILS_API_KEY not set' };

        const runId = this.state.recordConnectorRun(investigationId, phaseId, this.name, inputType, inputValue);
        this.telemetry.connectorStart(investigationId, this.name, phaseId, { type: inputType, value: inputValue });

        try {
            const entities = [];

            if (inputType === 'domain') {
                const general = await this._apiGet(`/v1/domain/${inputValue}`);
                if (general?.current_dns) {
                    const dns = general.current_dns;
                    for (const type of ['a', 'aaaa', 'mx', 'ns', 'txt', 'soa']) {
                        const records = dns[type]?.values || [];
                        for (const rec of records) {
                            const value = rec.ip || rec.value || rec.ip_str || '';
                            if (!value) continue;

                            entities.push({
                                type: 'dns_record',
                                data: { type: type.toUpperCase(), name: inputValue, value, source: 'securitytrails' },
                                confidence: 0.9
                            });

                            if (type === 'a' || type === 'aaaa') {
                                entities.push({
                                    type: 'ip',
                                    data: { address: value, source: 'securitytrails_dns' },
                                    confidence: 0.9,
                                    asKnown: { type: 'ip', value }
                                });
                            }
                        }
                    }
                }

                const subs = await this._apiGet(`/v1/domain/${inputValue}/subdomains?children_only=false`);
                if (subs?.subdomains) {
                    for (const sub of subs.subdomains) {
                        const fqdn = `${sub}.${inputValue}`;
                        entities.push({
                            type: 'subdomain',
                            data: { name: fqdn, parent_domain: inputValue, source: 'securitytrails' },
                            confidence: 0.9,
                            asKnown: { type: 'domain', value: fqdn }
                        });
                    }
                }

                const whois = await this._apiGet(`/v1/domain/${inputValue}/whois`);
                if (whois?.result) {
                    const w = whois.result;
                    if (w.registrar_name) {
                        entities.push({
                            type: 'domain',
                            data: { name: inputValue, registrar: w.registrar_name, created_at: w.created_date, expires_at: w.expires_date, source: 'securitytrails_whois' },
                            confidence: 0.85
                        });
                    }
                    for (const contact of w.contacts || []) {
                        if (contact.email) {
                            entities.push({
                                type: 'email',
                                data: { address: contact.email, source: 'securitytrails_whois' },
                                confidence: 0.7,
                                asKnown: { type: 'email', value: contact.email }
                            });
                        }
                        if (contact.organization) {
                            entities.push({
                                type: 'organization',
                                data: { name: contact.organization, source: 'securitytrails_whois' },
                                confidence: 0.7
                            });
                        }
                    }
                }

                const history = await this._apiGet(`/v1/history/${inputValue}/dns/a`);
                if (history?.records) {
                    for (const record of history.records.slice(0, 20)) {
                        for (const val of record.values || []) {
                            if (val.ip) {
                                entities.push({
                                    type: 'ip',
                                    data: { address: val.ip, first_seen: record.first_seen, last_seen: record.last_seen, source: 'securitytrails_history' },
                                    confidence: 0.6
                                });
                            }
                        }
                    }
                }
            }

            if (inputType === 'ip') {
                const domains = await this._apiGet(`/v1/ips/nearby/${inputValue}`);
                if (domains?.blocks) {
                    for (const block of domains.blocks) {
                        for (const site of block.sites || []) {
                            entities.push({
                                type: 'domain',
                                data: { name: site, source: 'securitytrails_ip_neighbors' },
                                confidence: 0.5,
                                asKnown: { type: 'domain', value: site }
                            });
                        }
                    }
                }

                const searchResult = await this._apiGet(`/v1/domains/list?include_ips=false&page=1&scroll=false`, 'POST', {
                    filter: { ipv4: inputValue }
                });
                if (searchResult?.records) {
                    for (const rec of searchResult.records) {
                        if (rec.hostname) {
                            entities.push({
                                type: 'domain',
                                data: { name: rec.hostname, source: 'securitytrails_reverse_ip' },
                                confidence: 0.7,
                                asKnown: { type: 'domain', value: rec.hostname }
                            });
                        }
                    }
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

    _apiGet(path, method = 'GET', body = null) {
        return new Promise((resolve, reject) => {
            const opts = {
                hostname: 'api.securitytrails.com',
                path,
                method,
                headers: { 'APIKEY': this.apiKey, 'Accept': 'application/json' },
                timeout: 15000
            };
            if (body) opts.headers['Content-Type'] = 'application/json';

            const req = https.request(opts, res => {
                if (res.statusCode === 404) { res.resume(); return resolve(null); }
                if (res.statusCode === 429) { res.resume(); return reject(new Error('SecurityTrails rate limited')); }
                if (res.statusCode >= 400) { res.resume(); return reject(new Error(`SecurityTrails HTTP ${res.statusCode}`)); }
                let data = '';
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => {
                    try { resolve(JSON.parse(data)); } catch { resolve(null); }
                });
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('SecurityTrails timeout')); });
            if (body) req.write(JSON.stringify(body));
            req.end();
        });
    }

    async healthCheck() {
        return { ok: !!this.apiKey, version: 'v1', hasApiKey: !!this.apiKey };
    }
}
