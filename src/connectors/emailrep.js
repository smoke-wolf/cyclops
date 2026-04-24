import { BaseConnector } from './base.js';
import https from 'https';

export class EmailRepConnector extends BaseConnector {
    constructor(config, state, telemetry) {
        super(config, state, telemetry);
        this.name = 'EmailRep';
    }

    async run(investigationId, phaseId, inputType, inputValue) {
        const runId = this.state.recordConnectorRun(investigationId, phaseId, this.name, inputType, inputValue);
        this.telemetry.connectorStart(investigationId, this.name, phaseId, { type: inputType, value: inputValue });

        try {
            const entities = [];
            const data = JSON.parse(await this._fetch(`https://emailrep.io/${encodeURIComponent(inputValue)}`));

            if (data.email) {
                entities.push({
                    type: 'email',
                    data: {
                        address: data.email,
                        reputation: data.reputation,
                        suspicious: data.suspicious,
                        references: data.references,
                        details: {
                            blacklisted: data.details?.blacklisted,
                            malicious_activity: data.details?.malicious_activity,
                            credential_leaked: data.details?.credentials_leaked,
                            data_breach: data.details?.data_breach,
                            first_seen: data.details?.first_seen,
                            last_seen: data.details?.last_seen,
                            domain_exists: data.details?.domain_exists,
                            domain_reputation: data.details?.domain_reputation,
                            new_domain: data.details?.new_domain,
                            days_since_domain_creation: data.details?.days_since_domain_creation,
                            spam: data.details?.spam,
                            free_provider: data.details?.free_provider,
                            deliverable: data.details?.deliverable,
                            accepted_all: data.details?.accepted_all,
                            valid_mx: data.details?.valid_mx,
                            spoofable: data.details?.spoofable,
                            spf_strict: data.details?.spf_strict,
                            dmarc_enforced: data.details?.dmarc_enforced
                        },
                        profiles: data.details?.profiles || [],
                        source: 'emailrep'
                    },
                    confidence: 0.85
                });

                if (data.details?.profiles?.length) {
                    for (const profile of data.details.profiles) {
                        entities.push({
                            type: 'account',
                            data: {
                                platform: profile,
                                username: null,
                                email_registered: true,
                                source: 'emailrep'
                            },
                            confidence: 0.7
                        });
                    }
                }

                if (data.details?.credentials_leaked || data.details?.data_breach) {
                    entities.push({
                        type: 'breach',
                        data: {
                            name: 'emailrep_detected',
                            email: inputValue,
                            credential_leaked: data.details?.credentials_leaked,
                            data_breach: data.details?.data_breach,
                            source: 'emailrep'
                        },
                        confidence: 0.7
                    });
                }
            }

            let newCount = 0;
            for (const entity of entities) {
                const added = this.state.addEntity(investigationId, entity.type, entity.data, entity.confidence || 0.5);
                if (added.new) newCount++;
                this.telemetry.entityDiscovered(investigationId, entity.type, added.new, this.name);
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
            const opts = { headers: { 'User-Agent': 'cyclops-osint', 'Accept': 'application/json' }, timeout: 15000 };
            const key = process.env.EMAILREP_API_KEY;
            if (key) opts.headers['Key'] = key;
            https.get(url, opts, res => {
                let data = '';
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => resolve(data));
            }).on('error', reject);
        });
    }

    async healthCheck() { return { ok: true, version: 'native' }; }
}
