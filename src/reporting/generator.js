import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { Correlator } from '../correlate/linker.js';

export class ReportGenerator {
    constructor(state) {
        this.state = state;
        this.correlator = new Correlator(state);
    }

    _esc(str) {
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    async generate(investigationId, format = 'json', outputDir = null) {
        const investigation = this.state.getInvestigation(investigationId);
        const entities = this.state.getEntities(investigationId);
        const links = this.state.getLinks(investigationId);
        const knowns = this.state.getKnowns(investigationId);
        const stats = this.state.getStats(investigationId);
        const graph = this.correlator.buildGraph(investigationId);

        const report = {
            meta: {
                id: investigationId,
                name: investigation.name,
                workflow: investigation.workflow,
                created: investigation.created_at,
                completed: investigation.completed_at || new Date().toISOString(),
                generator: 'cyclops'
            },
            summary: this._buildSummary(entities, links, knowns, stats),
            knowns: knowns.map(k => ({ type: k.type, value: k.value, source: k.source })),
            entities: this._groupEntities(entities),
            links: links.map(l => ({
                from: l.from_entity_id,
                to: l.to_entity_id,
                type: l.link_type,
                confidence: l.confidence
            })),
            graph,
            timeline: stats.phases,
            connectors: stats.connectors
        };

        const dir = outputDir || join('/tmp/cyclops_runs', investigationId);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

        const generators = {
            json: () => this._writeJson(report, dir),
            html: () => this._writeHtml(report, dir),
            markdown: () => this._writeMarkdown(report, dir)
        };

        const gen = generators[format] || generators.json;
        const path = gen();

        this.state.db.prepare(`
            INSERT INTO reports (investigation_id, format, path, entity_count, link_count, summary)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(investigationId, format, path, entities.length, links.length, report.summary.text);

        return path;
    }

    _buildSummary(entities, links, knowns, stats) {
        const typeCounts = {};
        for (const e of entities) {
            typeCounts[e.type] = (typeCounts[e.type] || 0) + 1;
        }

        const highConfidence = entities.filter(e => e.confidence >= 0.8);
        const multiSource = entities.filter(e => e.source_count > 1);

        const lines = [
            `${entities.length} entities discovered across ${Object.keys(typeCounts).length} types`,
            `${links.length} relationships mapped`,
            `${highConfidence.length} high-confidence findings`,
            `${multiSource.length} multi-source corroborated entities`,
            `Started with ${knowns.length} known inputs`
        ];

        return {
            text: lines.join('. ') + '.',
            entity_count: entities.length,
            link_count: links.length,
            type_breakdown: typeCounts,
            high_confidence_count: highConfidence.length,
            multi_source_count: multiSource.length,
            input_count: knowns.length
        };
    }

    _groupEntities(entities) {
        const groups = {};
        for (const e of entities) {
            if (!groups[e.type]) groups[e.type] = [];
            groups[e.type].push({
                id: e.id,
                data: e.data,
                confidence: e.confidence,
                sources: e.source_count,
                first_seen: e.first_seen,
                last_seen: e.last_seen
            });
        }
        for (const type of Object.keys(groups)) {
            groups[type].sort((a, b) => b.confidence - a.confidence);
        }
        return groups;
    }

    _writeJson(report, dir) {
        const path = join(dir, 'report.json');
        writeFileSync(path, JSON.stringify(report, null, 2));
        return path;
    }

    _writeHtml(report, dir) {
        const path = join(dir, 'report.html');
        const html = this._renderHtml(report);
        writeFileSync(path, html);
        return path;
    }

    _writeMarkdown(report, dir) {
        const path = join(dir, 'report.md');
        const md = this._renderMarkdown(report);
        writeFileSync(path, md);
        return path;
    }

    _renderHtml(report) {
        const entityRows = Object.entries(report.entities).map(([type, items]) => {
            const rows = items.map(e => `
                <tr>
                    <td>${this._esc(type)}</td>
                    <td><code>${this._esc(JSON.stringify(e.data))}</code></td>
                    <td>${(e.confidence * 100).toFixed(0)}%</td>
                    <td>${e.sources}</td>
                </tr>
            `).join('');
            return rows;
        }).join('');

        return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CYCLOPS — ${this._esc(report.meta.name)}</title>
<style>
:root {
    --bg-0: #08090d; --bg-1: #0f1117; --bg-2: #181a22;
    --text-0: #f0f3f8; --text-1: #a0a8b8; --text-2: #6b7280;
    --accent: #e74c3c; --accent-dim: rgba(231,76,60,0.15);
    --green: #22c55e; --amber: #f59e0b; --red: #ef4444;
    --border: #1e2130; --radius: 6px;
    --mono: 'SF Mono', 'Menlo', 'Monaco', 'Consolas', monospace;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: var(--bg-0); color: var(--text-0); font-family: var(--mono); font-size: 13px; line-height: 1.6; padding: 32px; }
h1 { font-size: 18px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: var(--accent); margin-bottom: 4px; }
h2 { font-size: 14px; font-weight: 500; color: var(--text-1); margin: 24px 0 12px; text-transform: uppercase; letter-spacing: 0.08em; border-bottom: 1px solid var(--border); padding-bottom: 6px; }
.meta { color: var(--text-2); font-size: 11px; margin-bottom: 24px; }
.summary { background: var(--bg-1); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; margin-bottom: 24px; }
.stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin: 16px 0; }
.stat { background: var(--bg-2); border: 1px solid var(--border); border-radius: var(--radius); padding: 12px; text-align: center; }
.stat-value { font-size: 24px; font-weight: 700; color: var(--accent); }
.stat-label { font-size: 10px; text-transform: uppercase; color: var(--text-2); letter-spacing: 0.1em; }
table { width: 100%; border-collapse: collapse; font-size: 12px; }
th { text-align: left; padding: 8px 12px; background: var(--bg-2); color: var(--text-2); text-transform: uppercase; font-size: 10px; letter-spacing: 0.08em; border-bottom: 1px solid var(--border); }
td { padding: 8px 12px; border-bottom: 1px solid var(--border); color: var(--text-1); max-width: 500px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
tr:hover td { background: var(--bg-1); }
code { font-family: var(--mono); font-size: 11px; background: var(--bg-2); padding: 1px 4px; border-radius: 3px; }
.badge { display: inline-block; padding: 2px 8px; border-radius: 3px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; }
.badge-green { background: rgba(34,197,94,0.15); color: var(--green); }
.badge-amber { background: rgba(245,158,11,0.15); color: var(--amber); }
.badge-red { background: rgba(239,68,68,0.15); color: var(--red); }
footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid var(--border); color: var(--text-2); font-size: 11px; }
</style>
</head>
<body>
<h1>CYCLOPS</h1>
<div class="meta">${this._esc(report.meta.name)} &mdash; ${this._esc(report.meta.workflow)} &mdash; ${this._esc(report.meta.completed)}</div>

<div class="summary">${report.summary.text}</div>

<div class="stat-grid">
    <div class="stat"><div class="stat-value">${report.summary.entity_count}</div><div class="stat-label">Entities</div></div>
    <div class="stat"><div class="stat-value">${report.summary.link_count}</div><div class="stat-label">Links</div></div>
    <div class="stat"><div class="stat-value">${report.summary.high_confidence_count}</div><div class="stat-label">High Confidence</div></div>
    <div class="stat"><div class="stat-value">${report.summary.multi_source_count}</div><div class="stat-label">Multi-Source</div></div>
    <div class="stat"><div class="stat-value">${report.summary.input_count}</div><div class="stat-label">Inputs</div></div>
</div>

<h2>Knowns</h2>
<table>
<thead><tr><th>Type</th><th>Value</th><th>Source</th></tr></thead>
<tbody>
${report.knowns.map(k => `<tr><td><span class="badge badge-green">${this._esc(k.type)}</span></td><td>${this._esc(k.value)}</td><td>${this._esc(k.source)}</td></tr>`).join('\n')}
</tbody>
</table>

<h2>Entities</h2>
<table>
<thead><tr><th>Type</th><th>Data</th><th>Confidence</th><th>Sources</th></tr></thead>
<tbody>${entityRows}</tbody>
</table>

<footer>Generated by CYCLOPS &mdash; ${new Date().toISOString()}</footer>
</body>
</html>`;
    }

    _renderMarkdown(report) {
        let md = `# CYCLOPS — ${report.meta.name}\n\n`;
        md += `**Workflow:** ${report.meta.workflow}  \n`;
        md += `**Completed:** ${report.meta.completed}  \n\n`;
        md += `## Summary\n\n${report.summary.text}\n\n`;
        md += `| Metric | Value |\n|--------|-------|\n`;
        md += `| Entities | ${report.summary.entity_count} |\n`;
        md += `| Links | ${report.summary.link_count} |\n`;
        md += `| High Confidence | ${report.summary.high_confidence_count} |\n`;
        md += `| Multi-Source | ${report.summary.multi_source_count} |\n\n`;

        md += `## Knowns\n\n`;
        for (const k of report.knowns) {
            md += `- **${k.type}**: \`${k.value}\` (${k.source})\n`;
        }

        md += `\n## Entities\n\n`;
        for (const [type, items] of Object.entries(report.entities)) {
            md += `### ${type} (${items.length})\n\n`;
            for (const e of items.slice(0, 50)) {
                md += `- ${JSON.stringify(e.data)} — ${(e.confidence * 100).toFixed(0)}% (${e.sources} sources)\n`;
            }
            if (items.length > 50) md += `- ... and ${items.length - 50} more\n`;
            md += '\n';
        }

        return md;
    }
}
