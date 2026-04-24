import { BaseConnector } from './base.js';
import net from 'net';

export class WhoisNativeConnector extends BaseConnector {
    constructor(config, state, telemetry) {
        super(config, state, telemetry);
        this.name = 'WHOIS-Native';
    }

    async run(investigationId, phaseId, inputType, inputValue) {
        const runId = this.state.recordConnectorRun(investigationId, phaseId, this.name, inputType, inputValue);
        this.telemetry.connectorStart(investigationId, this.name, phaseId, { type: inputType, value: inputValue });

        try {
            const raw = await this._whoisQuery(inputValue);
            const entities = this._parseWhois(raw, inputValue);

            let newCount = 0;
            for (const entity of entities) {
                const added = this.state.addEntity(investigationId, entity.type, entity.data, entity.confidence || 0.5);
                if (added.new) newCount++;
                this.telemetry.entityDiscovered(investigationId, entity.type, added.new, this.name);
                if (entity.asKnown) {
                    this.state.addKnown(investigationId, entity.asKnown.type, entity.asKnown.value, this.name, entity.confidence || 0.5);
                }
            }

            this.state.completeConnectorRun(runId, 'completed', newCount, raw?.slice(0, 5000), null, 0);
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

    _parseWhois(raw, domain) {
        const entities = [];
        const fields = {};

        for (const line of raw.split('\n')) {
            const match = line.match(/^\s*([\w\s/]+):\s*(.+)$/);
            if (match) {
                const key = match[1].trim().toLowerCase();
                const val = match[2].trim();
                if (!fields[key]) fields[key] = val;
            }
        }

        entities.push({
            type: 'domain',
            data: {
                name: domain,
                registrar: fields['registrar'] || fields['registrar name'],
                created_at: fields['creation date'] || fields['created'] || fields['registered'],
                expires_at: fields['registry expiry date'] || fields['expiration date'] || fields['expires'],
                updated_at: fields['updated date'] || fields['last updated'],
                nameservers: this._extractNameservers(raw),
                status: fields['domain status'],
                dnssec: fields['dnssec']
            },
            confidence: 0.95
        });

        const emails = raw.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g);
        if (emails) {
            const seen = new Set();
            for (const email of emails) {
                if (!seen.has(email.toLowerCase()) && !email.includes('abuse')) {
                    seen.add(email.toLowerCase());
                    entities.push({
                        type: 'email',
                        data: { address: email, source: 'whois' },
                        confidence: 0.7,
                        asKnown: { type: 'email', value: email }
                    });
                }
            }
        }

        const ns = this._extractNameservers(raw);
        for (const nameserver of ns) {
            entities.push({
                type: 'subdomain',
                data: { name: nameserver, source: 'whois_ns' },
                confidence: 0.9
            });
        }

        const org = fields['registrant organization'] || fields['org-name'] || fields['organization'];
        if (org && org !== 'REDACTED FOR PRIVACY' && !org.includes('Privacy') && !org.includes('Proxy')) {
            entities.push({
                type: 'organization',
                data: { name: org, source: 'whois_registrant' },
                confidence: 0.7
            });
        }

        const registrantName = fields['registrant name'];
        if (registrantName && registrantName !== 'REDACTED FOR PRIVACY' && !registrantName.includes('Privacy')) {
            entities.push({
                type: 'person',
                data: { name: registrantName, source: 'whois_registrant' },
                confidence: 0.6
            });
        }

        return entities;
    }

    _extractNameservers(raw) {
        const ns = [];
        const regex = /name\s*server:\s*(\S+)/gi;
        for (const match of raw.matchAll(regex)) {
            ns.push(match[1].toLowerCase().replace(/\.$/, ''));
        }
        return [...new Set(ns)];
    }

    _whoisQuery(domain, server = 'whois.verisign-grs.com') {
        return new Promise((resolve, reject) => {
            const socket = net.createConnection(43, server, () => {
                socket.write(domain + '\r\n');
            });
            let data = '';
            socket.on('data', chunk => { data += chunk.toString(); });
            socket.on('end', () => {
                const referral = data.match(/Registrar WHOIS Server:\s*(\S+)/i);
                if (referral && referral[1] !== server) {
                    this._whoisQuery(domain, referral[1]).then(resolve).catch(() => resolve(data));
                } else {
                    resolve(data);
                }
            });
            socket.on('error', reject);
            socket.setTimeout(15000, () => { socket.destroy(); reject(new Error('whois timeout')); });
        });
    }

    async healthCheck() { return { ok: true, version: 'native' }; }
}
