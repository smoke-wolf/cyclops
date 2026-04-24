import { BaseConnector } from './base.js';
import dns from 'dns/promises';

export class DnsNativeConnector extends BaseConnector {
    constructor(config, state, telemetry) {
        super(config, state, telemetry);
        this.name = 'DNS-Native';
    }

    async run(investigationId, phaseId, inputType, inputValue) {
        const runId = this.state.recordConnectorRun(investigationId, phaseId, this.name, inputType, inputValue);
        this.telemetry.connectorStart(investigationId, this.name, phaseId, { type: inputType, value: inputValue });

        const entities = [];
        try {
            const recordTypes = ['A', 'AAAA', 'MX', 'NS', 'TXT', 'CNAME', 'SOA', 'SRV'];

            for (const type of recordTypes) {
                try {
                    const records = await dns.resolve(inputValue, type);
                    for (const rec of (Array.isArray(records) ? records : [records])) {
                        if (type === 'A' || type === 'AAAA') {
                            entities.push({
                                type: 'ip',
                                data: { address: rec, version: type === 'AAAA' ? 6 : 4, source: 'dns_resolve' },
                                confidence: 0.95,
                                asKnown: { type: 'ip', value: rec }
                            });
                            entities.push({
                                type: 'dns_record',
                                data: { type, name: inputValue, value: rec },
                                confidence: 0.95
                            });
                        } else if (type === 'MX') {
                            entities.push({
                                type: 'dns_record',
                                data: { type: 'MX', name: inputValue, value: rec.exchange, priority: rec.priority },
                                confidence: 0.95
                            });
                            entities.push({
                                type: 'subdomain',
                                data: { name: rec.exchange, parent_domain: inputValue, source: 'mx_record' },
                                confidence: 0.85
                            });
                        } else if (type === 'NS') {
                            entities.push({
                                type: 'dns_record',
                                data: { type: 'NS', name: inputValue, value: rec },
                                confidence: 0.95
                            });
                        } else if (type === 'TXT') {
                            const txt = Array.isArray(rec) ? rec.join('') : rec;
                            entities.push({
                                type: 'dns_record',
                                data: { type: 'TXT', name: inputValue, value: txt },
                                confidence: 0.95
                            });

                            const spfIncludes = txt.match(/include:(\S+)/g);
                            if (spfIncludes) {
                                for (const inc of spfIncludes) {
                                    const domain = inc.replace('include:', '');
                                    entities.push({
                                        type: 'domain',
                                        data: { name: domain, source: 'spf_include' },
                                        confidence: 0.7,
                                        asKnown: { type: 'domain', value: domain }
                                    });
                                }
                            }

                            const dmarcMatch = txt.match(/rua=mailto:([^;,\s]+)/);
                            if (dmarcMatch) {
                                entities.push({
                                    type: 'email',
                                    data: { address: dmarcMatch[1], source: 'dmarc_rua' },
                                    confidence: 0.8,
                                    asKnown: { type: 'email', value: dmarcMatch[1] }
                                });
                            }

                            if (txt.includes('v=spf1')) {
                                const ip4s = txt.match(/ip4:(\S+)/g);
                                if (ip4s) {
                                    for (const ip4 of ip4s) {
                                        const ip = ip4.replace('ip4:', '').split('/')[0];
                                        entities.push({
                                            type: 'ip',
                                            data: { address: ip, source: 'spf_record' },
                                            confidence: 0.8,
                                            asKnown: { type: 'ip', value: ip }
                                        });
                                    }
                                }
                            }
                        } else if (type === 'CNAME') {
                            entities.push({
                                type: 'dns_record',
                                data: { type: 'CNAME', name: inputValue, value: rec },
                                confidence: 0.95
                            });
                            entities.push({
                                type: 'domain',
                                data: { name: rec, source: 'cname' },
                                confidence: 0.8,
                                asKnown: { type: 'domain', value: rec }
                            });
                        } else if (type === 'SOA') {
                            entities.push({
                                type: 'dns_record',
                                data: {
                                    type: 'SOA', name: inputValue,
                                    value: `${rec.nsname} ${rec.hostmaster}`,
                                    serial: rec.serial
                                },
                                confidence: 0.95
                            });
                            if (rec.hostmaster) {
                                const parts = rec.hostmaster.split('.');
                                const email = parts.length >= 2
                                    ? parts[0] + '@' + parts.slice(1).join('.')
                                    : rec.hostmaster;
                                entities.push({
                                    type: 'email',
                                    data: { address: email, source: 'soa_hostmaster' },
                                    confidence: 0.5
                                });
                            }
                        }
                    }
                } catch {}
            }

            const commonSubs = ['www', 'mail', 'ftp', 'api', 'dev', 'staging', 'admin', 'blog', 'shop', 'store',
                'app', 'cdn', 'static', 'media', 'img', 'images', 'vpn', 'remote', 'portal', 'login',
                'dashboard', 'status', 'docs', 'help', 'support', 'git', 'gitlab', 'jira', 'wiki',
                'test', 'beta', 'demo', 'sandbox', 'internal', 'intranet', 'mx', 'smtp', 'pop', 'imap',
                'ns1', 'ns2', 'dns', 'proxy', 'gateway', 'firewall', 'monitor', 'grafana', 'prometheus'];

            const subResults = await Promise.allSettled(
                commonSubs.map(async sub => {
                    const fqdn = `${sub}.${inputValue}`;
                    const addrs = await dns.resolve4(fqdn);
                    return { sub, fqdn, ips: addrs };
                })
            );

            for (const result of subResults) {
                if (result.status === 'fulfilled' && result.value.ips?.length) {
                    const { fqdn, ips } = result.value;
                    entities.push({
                        type: 'subdomain',
                        data: { name: fqdn, parent_domain: inputValue, ip: ips[0], source: 'dns_bruteforce' },
                        confidence: 0.9,
                        asKnown: { type: 'domain', value: fqdn }
                    });
                    for (const ip of ips) {
                        entities.push({
                            type: 'ip',
                            data: { address: ip, source: 'subdomain_resolve' },
                            confidence: 0.9,
                            asKnown: { type: 'ip', value: ip }
                        });
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

    async healthCheck() { return { ok: true, version: 'native' }; }
}
