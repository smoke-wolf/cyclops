import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORR_CONFIG_PATH = join(__dirname, '..', '..', 'config', 'correlation.json');

export class Correlator {
    constructor(state) {
        this.state = state;
        this.config = JSON.parse(readFileSync(CORR_CONFIG_PATH, 'utf-8'));
    }

    correlate(investigationId) {
        const entities = this.state.getEntities(investigationId);
        const existingLinks = new Set(
            this.state.getLinks(investigationId).map(l => `${l.from_entity_id}:${l.to_entity_id}:${l.link_type}`)
        );

        for (const rule of this.config.linking_rules) {
            const fromEntities = entities.filter(e => e.type === rule.from);
            const toEntities = entities.filter(e => e.type === rule.to);

            for (const from of fromEntities) {
                for (const to of toEntities) {
                    if (from.id === to.id) continue;

                    const confidence = this._matchScore(from, to, rule);
                    if (confidence < (this.config.scoring?.fuzzy_match_threshold || 0.5)) continue;

                    const linkKey = `${from.id}:${to.id}:${rule.name}`;
                    const reverseLinkKey = `${to.id}:${from.id}:${rule.name}`;
                    if (existingLinks.has(linkKey) || existingLinks.has(reverseLinkKey)) continue;

                    this.state.addLink(investigationId, from.id, to.id, rule.name, confidence, [
                        { rule: rule.name, from_type: from.type, to_type: to.type }
                    ]);
                    existingLinks.add(linkKey);

                    if (rule.bidirectional) {
                        this.state.addLink(investigationId, to.id, from.id, rule.name, confidence, [
                            { rule: rule.name, from_type: to.type, to_type: from.type, reverse: true }
                        ]);
                        existingLinks.add(reverseLinkKey);
                    }
                }
            }
        }

        this._applyMultiSourceBonus(investigationId, entities);
        return this.state.getLinks(investigationId);
    }

    _matchScore(from, to, rule) {
        let matched = 0;
        let total = rule.match_fields.length;

        for (const field of rule.match_fields) {
            const fromVal = this._resolveField(from, field);
            const toVal = this._resolveField(to, field);

            if (!fromVal || !toVal) continue;

            if (typeof fromVal === 'string' && typeof toVal === 'string') {
                if (fromVal.toLowerCase() === toVal.toLowerCase()) {
                    matched++;
                } else if (this._fuzzyMatch(fromVal, toVal) > 0.8) {
                    matched += 0.7;
                }
            } else if (fromVal === toVal) {
                matched++;
            }
        }

        if (total === 0) return 0;
        const matchRatio = matched / total;
        return matchRatio * rule.confidence;
    }

    _resolveField(entity, field) {
        if (entity.data[field] !== undefined) return entity.data[field];

        const aliases = {
            address: ['email', 'ip_address', 'ip'],
            ip: ['address', 'ip_address'],
            name: ['domain', 'hostname', 'subdomain', 'login', 'title'],
            username: ['handle', 'screen_name', 'user', 'login'],
            number: ['phone', 'phone_number'],
            email: ['address'],
            homepage: ['url', 'blog']
        };

        for (const [canonical, alts] of Object.entries(aliases)) {
            if (field === canonical) {
                for (const alt of alts) {
                    if (entity.data[alt] !== undefined) return entity.data[alt];
                }
            }
        }

        if (field === 'username' && entity.type === 'repository' && entity.data.name) {
            const parts = entity.data.name.split('/');
            if (parts.length === 2) return parts[0];
        }

        if (field === 'name' && entity.type === 'url' && entity.data.url) {
            try {
                return new URL(entity.data.url.startsWith('http') ? entity.data.url : `https://${entity.data.url}`).hostname;
            } catch {}
        }

        if (field === 'name' && entity.type === 'technology' && entity.data.url) {
            try {
                return new URL(entity.data.url.startsWith('http') ? entity.data.url : `https://${entity.data.url}`).hostname;
            } catch {}
        }

        return null;
    }

    _fuzzyMatch(a, b) {
        const la = a.toLowerCase();
        const lb = b.toLowerCase();
        if (la === lb) return 1.0;
        if (la.includes(lb) || lb.includes(la)) return 0.9;

        const maxLen = Math.max(la.length, lb.length);
        if (maxLen === 0) return 1.0;
        const dist = this._levenshtein(la, lb);
        return 1.0 - (dist / maxLen);
    }

    _levenshtein(a, b) {
        const m = a.length, n = b.length;
        const dp = Array.from({ length: m + 1 }, (_, i) => {
            const row = new Array(n + 1);
            row[0] = i;
            return row;
        });
        for (let j = 0; j <= n; j++) dp[0][j] = j;

        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                dp[i][j] = a[i - 1] === b[j - 1]
                    ? dp[i - 1][j - 1]
                    : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
            }
        }
        return dp[m][n];
    }

    _applyMultiSourceBonus(investigationId, entities) {
        const bonus = this.config.scoring?.multi_source_bonus || 0.1;
        for (const entity of entities) {
            if (entity.source_count > 1) {
                const boosted = Math.min(1.0, entity.confidence + (bonus * (entity.source_count - 1)));
                if (boosted !== entity.confidence) {
                    this.state.db.prepare(
                        'UPDATE entities SET confidence = ? WHERE id = ?'
                    ).run(boosted, entity.id);
                }
            }
        }
    }

    buildGraph(investigationId) {
        const entities = this.state.getEntities(investigationId);
        const links = this.state.getLinks(investigationId);

        return {
            nodes: entities.map(e => ({
                id: e.id,
                type: e.type,
                label: this._entityLabel(e),
                confidence: e.confidence,
                sources: e.source_count,
                data: e.data
            })),
            edges: links.map(l => ({
                from: l.from_entity_id,
                to: l.to_entity_id,
                type: l.link_type,
                confidence: l.confidence
            }))
        };
    }

    _entityLabel(entity) {
        const d = entity.data;
        switch (entity.type) {
            case 'person': return d.name || d.username || d.email || 'Unknown Person';
            case 'account': return `${d.platform}/${d.username}`;
            case 'email': return d.address;
            case 'domain': return d.name;
            case 'subdomain': return d.name;
            case 'ip': return d.address;
            case 'port': return `${d.address}:${d.number}`;
            case 'breach': return d.name;
            case 'credential': return `${d.email}@${d.source_breach}`;
            case 'phone': return d.number;
            case 'url': return d.url;
            case 'certificate': return d.subject || d.fingerprint;
            case 'dns_record': return `${d.type} ${d.name}`;
            default: return JSON.stringify(d).slice(0, 50);
        }
    }
}
