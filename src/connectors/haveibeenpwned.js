import { BaseConnector } from './base.js';
import https from 'https';

export class HaveIBeenPwnedConnector extends BaseConnector {
    constructor(config, state, telemetry) {
        super(config, state, telemetry);
        this.name = 'HaveIBeenPwned';
    }

    async run(investigationId, phaseId, inputType, inputValue) {
        const runId = this.state.recordConnectorRun(investigationId, phaseId, this.name, inputType, inputValue);
        this.telemetry.connectorStart(investigationId, this.name, phaseId, { type: inputType, value: inputValue });

        try {
            const entities = [];

            const breaches = await this._apiGet(`/api/v3/breachedaccount/${encodeURIComponent(inputValue)}?truncateResponse=false`);

            if (Array.isArray(breaches)) {
                for (const breach of breaches) {
                    entities.push({
                        type: 'breach',
                        data: {
                            name: breach.Name,
                            title: breach.Title,
                            domain: breach.Domain,
                            date: breach.BreachDate,
                            added_date: breach.AddedDate,
                            modified_date: breach.ModifiedDate,
                            pwn_count: breach.PwnCount,
                            description: breach.Description?.replace(/<[^>]+>/g, '').slice(0, 500),
                            data_classes: breach.DataClasses,
                            is_verified: breach.IsVerified,
                            is_sensitive: breach.IsSensitive,
                            email: inputValue,
                            source: 'haveibeenpwned'
                        },
                        confidence: breach.IsVerified ? 0.95 : 0.7
                    });

                    if (breach.Domain) {
                        entities.push({
                            type: 'domain',
                            data: { name: breach.Domain, source: `breach:${breach.Name}` },
                            confidence: 0.6
                        });
                    }
                }
            }

            const pastes = await this._apiGet(`/api/v3/pasteaccount/${encodeURIComponent(inputValue)}`);
            if (Array.isArray(pastes)) {
                for (const paste of pastes) {
                    entities.push({
                        type: 'breach',
                        data: {
                            name: `Paste: ${paste.Title || paste.Id}`,
                            source_type: 'paste',
                            paste_source: paste.Source,
                            date: paste.Date,
                            email_count: paste.EmailCount,
                            email: inputValue,
                            source: 'haveibeenpwned_paste'
                        },
                        confidence: 0.6
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

    _apiGet(path) {
        return new Promise((resolve, reject) => {
            const opts = {
                hostname: 'haveibeenpwned.com',
                path,
                headers: {
                    'User-Agent': 'cyclops-osint',
                    'Accept': 'application/json'
                }
            };
            const apiKey = process.env.HIBP_API_KEY;
            if (apiKey) opts.headers['hibp-api-key'] = apiKey;

            https.get(opts, res => {
                if (res.statusCode === 404) return resolve([]);
                if (res.statusCode === 401) return reject(new Error('HIBP API key required (set HIBP_API_KEY)'));
                if (res.statusCode === 429) return reject(new Error('HIBP rate limited'));
                let data = '';
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => {
                    try { resolve(JSON.parse(data)); } catch { resolve([]); }
                });
            }).on('error', reject);
        });
    }

    async healthCheck() {
        const key = process.env.HIBP_API_KEY;
        return { ok: !!key, version: 'v3', hasApiKey: !!key };
    }
}
