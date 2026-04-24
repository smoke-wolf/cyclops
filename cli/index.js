#!/usr/bin/env node

import { Command } from 'commander';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Engine } from '../src/core/engine.js';
import { readFileSync, writeFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'cyclops.db');

// ─── ANSI ────────────────────────────────────────────────────────────────
const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', B = '\x1b[34m', P = '\x1b[35m', C = '\x1b[36m';
const DIM = '\x1b[2m', BOLD = '\x1b[1m', UL = '\x1b[4m', RST = '\x1b[0m';
const BG_R = '\x1b[41m', BG_G = '\x1b[42m', BG_Y = '\x1b[43m', BG_B = '\x1b[44m';
const UP = (n) => `\x1b[${n}A`;
const CLR = '\x1b[2K';
const HIDE_CUR = '\x1b[?25l';
const SHOW_CUR = '\x1b[?25h';
const COL = (n) => `\x1b[${n}G`;

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

process.on('exit', () => process.stdout.write(SHOW_CUR));
process.on('SIGINT', () => { process.stdout.write(SHOW_CUR); process.exit(130); });
process.on('SIGTERM', () => { process.stdout.write(SHOW_CUR); process.exit(143); });

function pad(s, n) { return String(s).padEnd(n).slice(0, n); }
function rpad(s, n) { return String(s).padStart(n).slice(0, n); }
function trunc(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function cols() { return process.stdout.columns || 100; }

function bar(ratio, width = 20) {
    const filled = Math.round(ratio * width);
    return `${G}${'█'.repeat(filled)}${DIM}${'░'.repeat(width - filled)}${RST}`;
}

function confBadge(c) {
    const pct = (c * 100).toFixed(0);
    if (c >= 0.8) return `${G}${pct}%${RST}`;
    if (c >= 0.5) return `${Y}${pct}%${RST}`;
    return `${R}${pct}%${RST}`;
}

function statusBadge(s) {
    const map = { completed: `${G}✔ done${RST}`, running: `${Y}● running${RST}`, failed: `${R}✗ failed${RST}`, pending: `${DIM}○ pending${RST}`, aborting: `${R}◌ aborting${RST}` };
    return map[s] || `${DIM}${s}${RST}`;
}

function divider(label) {
    const w = cols();
    const line = '─'.repeat(Math.max(0, w - label.length - 4));
    console.log(`\n${DIM}──${RST} ${BOLD}${label}${RST} ${DIM}${line}${RST}`);
}

function banner() {
    console.log(`
${R}   ██████╗${RST}${Y}██╗   ██╗${RST}${G} ██████╗${RST}${C}██╗     ${RST}${B} ██████╗ ${RST}${P}██████╗ ${RST}${R}███████╗${RST}
${R}  ██╔════╝${RST}${Y}╚██╗ ██╔╝${RST}${G}██╔════╝${RST}${C}██║     ${RST}${B}██╔═══██╗${RST}${P}██╔══██╗${RST}${R}██╔════╝${RST}
${R}  ██║     ${RST}${Y} ╚████╔╝ ${RST}${G}██║     ${RST}${C}██║     ${RST}${B}██║   ██║${RST}${P}██████╔╝${RST}${R}███████╗${RST}
${R}  ██║     ${RST}${Y}  ╚██╔╝  ${RST}${G}██║     ${RST}${C}██║     ${RST}${B}██║   ██║${RST}${P}██╔═══╝ ${RST}${R}╚════██║${RST}
${R}  ╚██████╗${RST}${Y}   ██║   ${RST}${G}╚██████╗${RST}${C}███████╗${RST}${B}╚██████╔╝${RST}${P}██║     ${RST}${R}███████║${RST}
${R}   ╚═════╝${RST}${Y}   ╚═╝   ${RST}${G} ╚═════╝${RST}${C}╚══════╝${RST}${B} ╚═════╝ ${RST}${P}╚═╝     ${RST}${R}╚══════╝${RST}
  ${DIM}Unified OSINT Targeting Pipeline${RST}
`);
}

// ─── LIVE INVESTIGATION UI ───────────────────────────────────────────────

class LiveTracker {
    constructor(engine, investigationId, name, workflow) {
        this.engine = engine;
        this.id = investigationId;
        this.name = name;
        this.workflow = workflow;
        this.entities = {};
        this.totalEntities = 0;
        this.links = 0;
        this.phases = {};
        this.activeConnectors = new Set();
        this.completedConnectors = 0;
        this.failedConnectors = 0;
        this.recentActivity = [];
        this.spinIdx = 0;
        this.startTime = Date.now();
        this.interval = null;
    }

    start() {
        process.stdout.write(HIDE_CUR);
        this.interval = setInterval(() => this._render(), 150);
    }

    stop() {
        if (this.interval) clearInterval(this.interval);
        process.stdout.write(SHOW_CUR);
    }

    onEvent(event) {
        switch (event.type) {
            case 'phase_start':
                this.phases[event.phaseId] = 'running';
                this._log(`${Y}◆${RST} phase ${BOLD}${event.phaseId}${RST}`);
                break;
            case 'phase_end':
                this.phases[event.phaseId] = event.status;
                break;
            case 'connector_start':
                this.activeConnectors.add(event.connector);
                break;
            case 'connector_end':
                this.activeConnectors.delete(event.connector);
                if (event.status === 'completed') this.completedConnectors++;
                else this.failedConnectors++;
                if (event.entitiesFound > 0) {
                    this._log(`${G}+${event.entitiesFound}${RST} via ${P}${event.connector}${RST} ${DIM}(${event.input?.value || ''})${RST}`);
                }
                break;
            case 'entity_new':
                this.entities[event.entityType] = (this.entities[event.entityType] || 0) + 1;
                this.totalEntities++;
                break;
            case 'error':
                this._log(`${R}✗${RST} ${event.connector || ''}: ${DIM}${trunc(event.message || '', 60)}${RST}`);
                break;
        }
    }

    _log(msg) {
        this.recentActivity.push(msg);
        if (this.recentActivity.length > 12) this.recentActivity.shift();
    }

    _render() {
        this.spinIdx = (this.spinIdx + 1) % SPINNER.length;
        const spin = `${R}${SPINNER[this.spinIdx]}${RST}`;
        const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(0);
        const w = cols();

        const phaseKeys = Object.keys(this.phases);
        const phaseDone = Object.values(this.phases).filter(s => s === 'completed').length;
        const phaseTotal = phaseKeys.length || '?';

        const phaseBar = phaseKeys.map(k => {
            const s = this.phases[k];
            if (s === 'completed') return `${G}█${RST}`;
            if (s === 'running') return `${Y}▓${RST}`;
            if (s === 'failed') return `${R}█${RST}`;
            return `${DIM}░${RST}`;
        }).join('');

        const active = [...this.activeConnectors].slice(0, 4);
        const activeStr = active.length ? active.map(c => `${C}${c}${RST}`).join(` ${DIM}│${RST} `) : `${DIM}idle${RST}`;

        // Build entity type summary
        const typePairs = Object.entries(this.entities).sort((a, b) => b[1] - a[1]);
        const typeStr = typePairs.slice(0, 6).map(([t, c]) => `${t}:${BOLD}${c}${RST}`).join(' ');

        // Count lines we'll output
        const lines = [];
        lines.push('');
        lines.push(`  ${spin} ${BOLD}${this.name}${RST}  ${DIM}${this.workflow}${RST}  ${DIM}${elapsed}s${RST}`);
        lines.push('');
        lines.push(`  ${BOLD}${this.totalEntities}${RST} entities  ${BOLD}${this.completedConnectors}${RST} connectors  ${BOLD}${phaseDone}${RST}/${phaseTotal} phases  ${this.failedConnectors > 0 ? `${R}${this.failedConnectors} failed${RST}` : ''}`);
        lines.push(`  ${phaseBar}  ${DIM}[${active.length ? active.join(', ') : 'idle'}]${RST}`);
        if (typeStr) lines.push(`  ${typeStr}`);
        lines.push('');
        for (const msg of this.recentActivity.slice(-6)) {
            lines.push(`  ${msg}`);
        }
        lines.push('');

        // Move cursor up to overwrite previous frame
        if (this._prevLines) {
            process.stdout.write(UP(this._prevLines));
        }
        for (const line of lines) {
            process.stdout.write(`${CLR}${line}\n`);
        }
        this._prevLines = lines.length;
    }

    printSummary(stats) {
        // Clear tracker area
        if (this._prevLines) {
            process.stdout.write(UP(this._prevLines));
            for (let i = 0; i < this._prevLines; i++) process.stdout.write(`${CLR}\n`);
            process.stdout.write(UP(this._prevLines));
        }

        const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);

        divider('COMPLETE');
        console.log();
        console.log(`  ${G}▲${RST} ${BOLD}${this.name}${RST}  ${DIM}${this.id}${RST}`);
        console.log(`  ${DIM}${this.workflow} — ${elapsed}s${RST}`);
        console.log();

        // Stats row
        const entityTotal = stats.entities.reduce((s, e) => s + e.count, 0);
        console.log(`  ${BOLD}${entityTotal}${RST} entities  ${BOLD}${stats.links}${RST} links  ${BOLD}${this.completedConnectors}${RST} connectors  ${BOLD}${stats.phases.length}${RST} phases`);
        console.log();

        // Entity breakdown
        if (stats.entities.length) {
            const sorted = [...stats.entities].sort((a, b) => b.count - a.count);
            const maxCount = sorted[0]?.count || 1;
            for (const row of sorted) {
                const barWidth = Math.round((row.count / maxCount) * 24);
                console.log(`  ${pad(row.type, 16)} ${rpad(row.count, 4)} ${G}${'█'.repeat(barWidth)}${RST}`);
            }
            console.log();
        }

        // Phase summary
        if (stats.phases.length) {
            for (const p of stats.phases) {
                const delta = (p.entities_after || 0) - (p.entities_before || 0);
                const icon = p.status === 'completed' ? `${G}✔${RST}` : p.status === 'failed' ? `${R}✗${RST}` : `${Y}●${RST}`;
                console.log(`  ${icon} ${pad(p.phase_id, 22)} ${delta > 0 ? `${G}+${delta}${RST}` : `${DIM}+0${RST}`}`);
            }
            console.log();
        }
    }
}

// ─── ENTITY TABLE RENDERER ──────────────────────────────────────────────

function printEntityTable(entities, opts = {}) {
    const { limit = 50, type = null, minConfidence = 0, search = null, verbose = false } = opts;

    let filtered = entities;
    if (type) filtered = filtered.filter(e => e.type === type);
    if (minConfidence > 0) filtered = filtered.filter(e => e.confidence >= minConfidence);
    if (search) {
        const q = search.toLowerCase();
        filtered = filtered.filter(e => {
            const dataStr = JSON.stringify(e.data || {}).toLowerCase();
            return e.type.includes(q) || dataStr.includes(q);
        });
    }
    filtered.sort((a, b) => b.confidence - a.confidence);

    if (!filtered.length) {
        console.log(`  ${DIM}No entities match filters${RST}`);
        return;
    }

    const total = filtered.length;
    const showing = Math.min(total, limit);
    console.log(`  ${DIM}${showing} of ${total} entities${RST}\n`);

    if (verbose) {
        for (const e of filtered.slice(0, limit)) {
            const conf = confBadge(e.confidence);
            const src = e.source_count > 1 ? ` ${Y}(${e.source_count} sources)${RST}` : '';
            console.log(`  ${conf}  ${C}${e.type}${RST}${src}`);
            for (const [k, v] of Object.entries(e.data || {})) {
                if (v !== null && v !== undefined && typeof v !== 'object') {
                    console.log(`       ${DIM}${k}:${RST} ${trunc(String(v), 70)}`);
                }
            }
            console.log();
        }
    } else {
        // Grouped compact view
        const grouped = {};
        for (const e of filtered.slice(0, limit)) {
            if (!grouped[e.type]) grouped[e.type] = [];
            grouped[e.type].push(e);
        }

        for (const [t, items] of Object.entries(grouped).sort((a, b) => b[1].length - a[1].length)) {
            console.log(`  ${C}${BOLD}${t}${RST} ${DIM}(${items.length})${RST}`);
            for (const e of items) {
                const conf = confBadge(e.confidence);
                const src = e.source_count > 1 ? ` ${Y}×${e.source_count}${RST}` : '';
                const primary = primaryValue(e);
                console.log(`    ${conf} ${primary}${src}`);
            }
            console.log();
        }
    }

    if (total > limit) {
        console.log(`  ${DIM}... ${total - limit} more (use --limit to see more)${RST}`);
    }
}

function primaryValue(entity) {
    const d = entity.data || {};
    const candidates = ['address', 'name', 'url', 'username', 'number', 'platform', 'value'];
    for (const k of candidates) {
        if (d[k]) return trunc(String(d[k]), 60);
    }
    const vals = Object.values(d).filter(v => typeof v === 'string');
    return vals.length ? trunc(vals[0], 60) : `${DIM}(no data)${RST}`;
}

// ─── INPUT DETECTION ────────────────────────────────────────────────────

function detectType(value) {
    if (/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(value)) return 'email';
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value)) return 'ip';
    if (/^[0-9a-f:]+$/.test(value) && value.includes(':')) return 'ip';
    if (/^https?:\/\//i.test(value)) return 'url';
    if (/^\+?\d[\d\s()-]{6,}$/.test(value)) return 'phone';
    if (/^[a-z0-9]([a-z0-9-]*\.)+[a-z]{2,}$/i.test(value)) return 'domain';
    return 'username';
}

function pickWorkflow(type) {
    const map = {
        username: 'username_trace',
        email: 'person_full',
        domain: 'domain_recon',
        ip: 'domain_recon',
        url: 'domain_recon',
        phone: 'person_full',
        name: 'person_full',
    };
    return map[type] || 'quick_recon';
}

// ─── COMMANDS ────────────────────────────────────────────────────────────

const program = new Command();
program.name('cyclops').description('Unified OSINT targeting pipeline').version('1.0.0');

async function runInvestigation(target, opts = {}) {
    const type = opts.type || detectType(target);
    const workflow = opts.workflow || pickWorkflow(type);
    const format = opts.format || 'json';
    const quiet = opts.quiet || false;

    if (!quiet) banner();
    const engine = new Engine(DB_PATH);

    const knowns = [{ type, value: target }];
    if (opts.known) {
        for (const k of opts.known) {
            const [t, ...rest] = k.split(':');
            knowns.push({ type: t, value: rest.join(':') });
        }
    }

    const wfConfig = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'workflows.json'), 'utf-8'));
    const wf = wfConfig.workflows[workflow];
    if (!wf) {
        console.log(`${R}✗${RST} Unknown workflow: ${workflow}`);
        console.log(`  Available: ${Object.keys(wfConfig.workflows).join(', ')}`);
        engine.close();
        process.exit(1);
    }

    console.log(`  ${BOLD}Target:${RST}   ${target}`);
    console.log(`  ${BOLD}Type:${RST}     ${C}${type}${RST} ${opts.type ? '' : `${DIM}(auto-detected)${RST}`}`);
    console.log(`  ${BOLD}Workflow:${RST} ${workflow} ${DIM}(${wf.phases.length} phases)${RST}`);
    if (knowns.length > 1) {
        console.log(`  ${BOLD}Extra knowns:${RST}`);
        for (const k of knowns.slice(1)) {
            console.log(`    ${C}${k.type}${RST} ${k.value}`);
        }
    }

    const tracker = new LiveTracker(engine, null, target, workflow);

    engine.telemetry.onEvent(event => {
        tracker.onEvent(event);
    });

    console.log(`\n  ${R}▲${RST} Starting...\n`);
    tracker.start();

    try {
        const id = await engine.investigate(target, knowns, workflow);
        tracker.id = id;
        const stats = engine.state.getStats(id);
        tracker.stop();
        tracker.printSummary(stats);

        const reportPath = await engine.reporter.generate(id, format);
        console.log(`  ${BOLD}Report:${RST} ${reportPath}`);

        const entities = engine.state.getEntities(id);
        const highConf = entities.filter(e => e.confidence >= 0.8);
        if (highConf.length) {
            divider('HIGH CONFIDENCE');
            console.log();
            for (const e of highConf.slice(0, 15)) {
                const src = e.source_count > 1 ? ` ${Y}(${e.source_count} sources)${RST}` : '';
                console.log(`  ${confBadge(e.confidence)} ${C}${e.type}${RST} ${primaryValue(e)}${src}`);
            }
            if (highConf.length > 15) console.log(`  ${DIM}... and ${highConf.length - 15} more${RST}`);
            console.log();
        }

        console.log(`  ${DIM}View all: cyclops entities ${id}${RST}`);
        console.log(`  ${DIM}Graph:    cyclops graph ${id}${RST}`);
        console.log();
    } catch (e) {
        tracker.stop();
        console.log(`\n${R}✗ Investigation failed:${RST} ${e.message}`);
    } finally {
        engine.close();
    }
}

// Default command — `cyclops <target>` just works
program
    .argument('[target]', 'Target to investigate (auto-detects type)')
    .option('-t, --type <type>', 'Override input type (username, email, domain, ip, url, phone)')
    .option('-w, --workflow <workflow>', 'Override workflow')
    .option('-k, --known <knowns...>', 'Extra knowns (type:value)')
    .option('--format <format>', 'Report format', 'json')
    .option('-q, --quiet', 'Minimal output')
    .action(async (target, opts, cmd) => {
        if (!target) return;
        if (cmd.args.length === 1 && !program.commands.some(c => c.name() === target)) {
            await runInvestigation(target, opts);
        }
    });

program
    .command('investigate <target>')
    .description('Launch a new investigation')
    .option('-t, --type <type>', 'Override input type')
    .option('-w, --workflow <workflow>', 'Override workflow')
    .option('-k, --known <knowns...>', 'Extra knowns (type:value)')
    .option('--format <format>', 'Report format', 'json')
    .option('-q, --quiet', 'Minimal output')
    .action(async (target, opts) => {
        await runInvestigation(target, opts);
    });

program
    .command('list')
    .description('List investigations')
    .option('-s, --status <status>', 'Filter by status')
    .option('-l, --limit <n>', 'Max results', '20')
    .action((opts) => {
        const engine = new Engine(DB_PATH);
        let investigations = engine.state.listInvestigations(opts.status);

        if (!investigations.length) {
            console.log(`\n  ${DIM}No investigations found${RST}\n`);
            engine.close();
            return;
        }

        investigations = investigations.slice(0, parseInt(opts.limit));
        const w = cols();

        console.log();
        console.log(`  ${BOLD}${pad('ID', 10)} ${pad('Name', 26)} ${pad('Workflow', 16)} ${pad('Status', 14)} Created${RST}`);
        console.log(`  ${DIM}${'─'.repeat(Math.min(90, w - 4))}${RST}`);

        for (const inv of investigations) {
            const stats = engine.state.getStats(inv.id);
            const entityTotal = stats.entities.reduce((s, e) => s + e.count, 0);
            const statusStr = statusBadge(inv.status);
            const time = inv.created_at?.split('T')[0] || inv.created_at || '';
            console.log(`  ${DIM}${pad(inv.id, 10)}${RST} ${pad(inv.name, 26)} ${DIM}${pad(inv.workflow, 16)}${RST} ${statusStr}${' '.repeat(Math.max(0, 6 - inv.status.length))} ${DIM}${time}${RST} ${entityTotal ? `${G}${entityTotal}e${RST}` : ''}`);
        }
        console.log(`\n  ${DIM}${investigations.length} investigation(s)${RST}\n`);
        engine.close();
    });

program
    .command('status <id>')
    .description('Show investigation status')
    .action((id) => {
        const engine = new Engine(DB_PATH);
        const status = engine.getStatus(id);

        if (!status.investigation) {
            console.log(`${R}✗${RST} Investigation ${id} not found`);
            engine.close();
            return;
        }

        const inv = status.investigation;
        const stats = status.stats;
        const entityTotal = stats.entities.reduce((s, e) => s + e.count, 0);

        divider(inv.name);
        console.log();
        console.log(`  ${BOLD}ID:${RST}       ${inv.id}`);
        console.log(`  ${BOLD}Status:${RST}   ${statusBadge(inv.status)}`);
        console.log(`  ${BOLD}Workflow:${RST} ${inv.workflow}`);
        console.log(`  ${BOLD}Created:${RST}  ${inv.created_at}`);
        if (inv.completed_at) console.log(`  ${BOLD}Finished:${RST} ${inv.completed_at}`);
        console.log();

        // Stats
        console.log(`  ${BOLD}${entityTotal}${RST} entities  ${BOLD}${stats.links}${RST} links  ${BOLD}${stats.phases.length}${RST} phases`);
        console.log();

        // Entity breakdown bars
        if (stats.entities.length) {
            const sorted = [...stats.entities].sort((a, b) => b.count - a.count);
            const maxCount = sorted[0]?.count || 1;
            for (const row of sorted) {
                const barWidth = Math.round((row.count / maxCount) * 20);
                console.log(`  ${pad(row.type, 16)} ${rpad(row.count, 4)} ${G}${'█'.repeat(barWidth)}${RST}`);
            }
            console.log();
        }

        // Phases
        if (stats.phases.length) {
            console.log(`  ${BOLD}Phases${RST}`);
            for (const p of stats.phases) {
                const delta = (p.entities_after || 0) - (p.entities_before || 0);
                const icon = p.status === 'completed' ? `${G}✔${RST}` : p.status === 'failed' ? `${R}✗${RST}` : p.status === 'running' ? `${Y}●${RST}` : `${DIM}○${RST}`;
                console.log(`  ${icon} ${pad(p.phase_id, 22)} ${delta > 0 ? `${G}+${delta}${RST}` : `${DIM}+0${RST}`}`);
            }
            console.log();
        }

        // Connector stats
        if (stats.connectors.length) {
            const grouped = {};
            for (const c of stats.connectors) {
                if (!grouped[c.connector]) grouped[c.connector] = {};
                grouped[c.connector][c.status] = c.count;
            }
            console.log(`  ${BOLD}Connectors${RST}`);
            for (const [name, s] of Object.entries(grouped)) {
                const parts = [];
                if (s.completed) parts.push(`${G}${s.completed} ok${RST}`);
                if (s.failed) parts.push(`${R}${s.failed} fail${RST}`);
                if (s.timeout) parts.push(`${Y}${s.timeout} timeout${RST}`);
                console.log(`  ${pad(name, 18)} ${parts.join('  ')}`);
            }
            console.log();
        }

        engine.close();
    });

program
    .command('entities <id>')
    .description('Browse entities from an investigation')
    .option('-t, --type <type>', 'Filter by entity type')
    .option('-s, --search <query>', 'Search entity data')
    .option('-c, --confidence <min>', 'Minimum confidence (0-1)', '0')
    .option('-l, --limit <n>', 'Max results', '50')
    .option('-v, --verbose', 'Show all entity fields')
    .option('--high', 'Show only high-confidence (>80%)')
    .option('--multi', 'Show only multi-source corroborated')
    .option('--json', 'Output raw JSON')
    .action((id, opts) => {
        const engine = new Engine(DB_PATH);
        const inv = engine.state.getInvestigation(id);

        if (!inv) {
            console.log(`${R}✗${RST} Investigation ${id} not found`);
            engine.close();
            return;
        }

        let entities = engine.state.getEntities(id);
        if (opts.high) opts.confidence = '0.8';
        if (opts.multi) entities = entities.filter(e => e.source_count > 1);

        if (opts.json) {
            let filtered = entities;
            if (opts.type) filtered = filtered.filter(e => e.type === opts.type);
            if (opts.search) {
                const q = opts.search.toLowerCase();
                filtered = filtered.filter(e => JSON.stringify(e.data).toLowerCase().includes(q));
            }
            if (parseFloat(opts.confidence) > 0) filtered = filtered.filter(e => e.confidence >= parseFloat(opts.confidence));
            console.log(JSON.stringify(filtered, null, 2));
            engine.close();
            return;
        }

        divider(`${inv.name} — Entities`);
        console.log();

        // Type summary bar
        const types = {};
        for (const e of entities) types[e.type] = (types[e.type] || 0) + 1;
        const typePairs = Object.entries(types).sort((a, b) => b[1] - a[1]);
        console.log(`  ${DIM}Types:${RST} ${typePairs.map(([t, c]) => `${C}${t}${RST}:${c}`).join('  ')}`);
        console.log();

        printEntityTable(entities, {
            limit: parseInt(opts.limit),
            type: opts.type,
            minConfidence: parseFloat(opts.confidence),
            search: opts.search,
            verbose: opts.verbose
        });

        engine.close();
    });

program
    .command('graph <id>')
    .description('Print entity link graph to terminal')
    .option('-d, --depth <n>', 'Max link depth', '2')
    .action((id, opts) => {
        const engine = new Engine(DB_PATH);
        const inv = engine.state.getInvestigation(id);

        if (!inv) {
            console.log(`${R}✗${RST} Investigation ${id} not found`);
            engine.close();
            return;
        }

        const entities = engine.state.getEntities(id);
        const links = engine.state.getLinks(id);

        divider(`${inv.name} — Graph`);
        console.log();
        console.log(`  ${entities.length} nodes, ${links.length} edges`);
        console.log();

        if (!links.length) {
            console.log(`  ${DIM}No links found${RST}\n`);
            engine.close();
            return;
        }

        // Build adjacency
        const entityMap = {};
        for (const e of entities) entityMap[e.id] = e;

        const adj = {};
        for (const link of links) {
            if (!adj[link.from_entity_id]) adj[link.from_entity_id] = [];
            if (!adj[link.to_entity_id]) adj[link.to_entity_id] = [];
            adj[link.from_entity_id].push({ to: link.to_entity_id, type: link.link_type, conf: link.confidence });
            adj[link.to_entity_id].push({ to: link.from_entity_id, type: link.link_type, conf: link.confidence });
        }

        // Find most-connected nodes
        const sorted = Object.entries(adj).sort((a, b) => b[1].length - a[1].length);

        console.log(`  ${BOLD}Most Connected${RST}`);
        for (const [nodeId, neighbors] of sorted.slice(0, 15)) {
            const e = entityMap[nodeId];
            if (!e) continue;
            const pv = primaryValue(e);
            console.log(`  ${C}${pad(e.type, 14)}${RST} ${pad(pv, 35)} ${BOLD}${neighbors.length}${RST} links`);
        }
        console.log();

        // Print tree from top nodes
        const depth = parseInt(opts.depth);
        const printed = new Set();
        for (const [rootId] of sorted.slice(0, 5)) {
            const root = entityMap[rootId];
            if (!root || printed.has(rootId)) continue;
            printTree(root, entityMap, adj, printed, '', depth, 0);
        }
        console.log();

        engine.close();
    });

function printTree(entity, entityMap, adj, printed, prefix, maxDepth, depth) {
    if (printed.has(entity.id) || depth > maxDepth) return;
    printed.add(entity.id);

    const pv = primaryValue(entity);
    const conf = confBadge(entity.confidence);
    console.log(`${prefix}${depth ? '├─ ' : ''}${C}${entity.type}${RST} ${pv} ${conf}`);

    const neighbors = (adj[entity.id] || []).filter(n => !printed.has(n.to));
    for (let i = 0; i < Math.min(neighbors.length, 8); i++) {
        const n = neighbors[i];
        const child = entityMap[n.to];
        if (!child) continue;
        const nextPrefix = prefix + (depth ? '│  ' : '   ');
        printTree(child, entityMap, adj, printed, nextPrefix, maxDepth, depth + 1);
    }
    if (neighbors.length > 8) {
        console.log(`${prefix}│  ${DIM}... +${neighbors.length - 8} more${RST}`);
    }
}

program
    .command('report <id>')
    .description('Generate report for investigation')
    .option('--format <format>', 'Report format (json, html, markdown)', 'json')
    .action(async (id, opts) => {
        const engine = new Engine(DB_PATH);
        try {
            const path = await engine.reporter.generate(id, opts.format);
            console.log(`\n  ${G}▲${RST} Report generated: ${BOLD}${path}${RST}\n`);
        } catch (e) {
            console.log(`${R}✗${RST} ${e.message}`);
        }
        engine.close();
    });

program
    .command('connectors')
    .description('List and check connectors')
    .option('--health', 'Run health checks')
    .option('--native', 'Show only native connectors')
    .option('--binary', 'Show only binary connectors')
    .option('-t, --type <type>', 'Filter by connector type')
    .action(async (opts) => {
        const engine = new Engine(DB_PATH);
        let connectors = engine.registry.list();

        if (opts.native) connectors = connectors.filter(c => c.native);
        if (opts.binary) connectors = connectors.filter(c => !c.native);
        if (opts.type) connectors = connectors.filter(c => c.type.includes(opts.type));

        if (opts.health) {
            console.log(`\n  ${DIM}Running health checks...${RST}\n`);
            await engine.registry.checkHealth();
            connectors = engine.registry.list();
            if (opts.native) connectors = connectors.filter(c => c.native);
            if (opts.binary) connectors = connectors.filter(c => !c.native);
            if (opts.type) connectors = connectors.filter(c => c.type.includes(opts.type));
        }

        console.log();
        console.log(`  ${BOLD}${pad('Connector', 18)} ${pad('Type', 22)} ${pad('Accepts', 24)} Status${RST}`);
        console.log(`  ${DIM}${'─'.repeat(Math.min(85, cols() - 4))}${RST}`);

        let healthy = 0, unhealthy = 0, unchecked = 0;
        for (const c of connectors) {
            let statusStr;
            if (c.healthy === true) { statusStr = `${G}● ok${RST}`; healthy++; }
            else if (c.healthy === false) { statusStr = `${R}● down${RST}`; unhealthy++; }
            else { statusStr = `${DIM}○ --${RST}`; unchecked++; }

            const native = c.native ? `${C}native${RST}` : `${DIM}binary${RST}`;
            const accepts = c.accepts.map(a => `${B}${a}${RST}`).join(' ');
            console.log(`  ${pad(c.name, 18)} ${DIM}${pad(c.type, 22)}${RST} ${pad(c.accepts.join(' '), 24)} ${statusStr}  ${native}`);
        }

        console.log();
        if (opts.health) {
            console.log(`  ${G}${healthy} healthy${RST}  ${unhealthy ? `${R}${unhealthy} down${RST}` : `${DIM}0 down${RST}`}  ${DIM}${unchecked} unchecked${RST}`);
        }
        console.log(`  ${DIM}${connectors.length} connector(s)${RST}\n`);
        engine.close();
    });

program
    .command('workflows')
    .description('List available workflows')
    .action(() => {
        const wfConfig = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'workflows.json'), 'utf-8'));
        const workflows = wfConfig.workflows;

        console.log();
        for (const [key, wf] of Object.entries(workflows)) {
            console.log(`  ${R}▸${RST} ${BOLD}${key}${RST}`);
            console.log(`    ${wf.description}`);
            console.log(`    ${DIM}${wf.phases.length} phases:${RST} ${wf.phases.map(p => p.name || p.id).join(' → ')}`);
            const inputs = new Set();
            for (const p of wf.phases) {
                for (const t of (p.input_types || [])) inputs.add(t);
            }
            if (inputs.size) console.log(`    ${DIM}Accepts:${RST} ${[...inputs].map(i => `${C}${i}${RST}`).join(' ')}`);
            console.log();
        }
    });

program
    .command('purge [id]')
    .description('Delete an investigation (or all with --all)')
    .option('--all', 'Purge all investigations')
    .action((id, opts) => {
        const engine = new Engine(DB_PATH);

        if (!id && !opts.all) {
            console.log(`${R}✗${RST} Specify an investigation ID or use --all`);
            engine.close();
            return;
        }

        if (opts.all) {
            const count = engine.state.listInvestigations().length;
            engine.state.db.exec('DELETE FROM telemetry');
            engine.state.db.exec('DELETE FROM reports');
            engine.state.db.exec('DELETE FROM entity_links');
            engine.state.db.exec('DELETE FROM connector_runs');
            engine.state.db.exec('DELETE FROM phase_runs');
            engine.state.db.exec('DELETE FROM entities');
            engine.state.db.exec('DELETE FROM knowns');
            engine.state.db.exec('DELETE FROM investigations');
            console.log(`\n  ${G}▲${RST} Purged ${count} investigation(s)\n`);
        } else {
            const inv = engine.state.getInvestigation(id);
            if (!inv) {
                console.log(`${R}✗${RST} Investigation ${id} not found`);
                engine.close();
                return;
            }
            engine.state.db.prepare('DELETE FROM telemetry WHERE investigation_id = ?').run(id);
            engine.state.db.prepare('DELETE FROM reports WHERE investigation_id = ?').run(id);
            engine.state.db.prepare('DELETE FROM entity_links WHERE investigation_id = ?').run(id);
            engine.state.db.prepare('DELETE FROM connector_runs WHERE investigation_id = ?').run(id);
            engine.state.db.prepare('DELETE FROM phase_runs WHERE investigation_id = ?').run(id);
            engine.state.db.prepare('DELETE FROM entities WHERE investigation_id = ?').run(id);
            engine.state.db.prepare('DELETE FROM knowns WHERE investigation_id = ?').run(id);
            engine.state.db.prepare('DELETE FROM investigations WHERE id = ?').run(id);
            console.log(`\n  ${G}▲${RST} Purged: ${inv.name}\n`);
        }

        engine.close();
    });

program
    .command('export <id>')
    .description('Export investigation data')
    .option('--format <format>', 'Format: json, csv, ndjson', 'json')
    .option('-o, --output <path>', 'Output file path')
    .action((id, opts) => {
        const engine = new Engine(DB_PATH);
        const inv = engine.state.getInvestigation(id);

        if (!inv) {
            console.log(`${R}✗${RST} Investigation ${id} not found`);
            engine.close();
            return;
        }

        const entities = engine.state.getEntities(id);
        const links = engine.state.getLinks(id);
        const knowns = engine.state.getKnowns(id);

        let output;
        if (opts.format === 'ndjson') {
            output = entities.map(e => JSON.stringify({ type: e.type, data: e.data, confidence: e.confidence, sources: e.source_count })).join('\n');
        } else if (opts.format === 'csv') {
            const rows = ['type,primary_value,confidence,sources'];
            for (const e of entities) {
                rows.push(`${e.type},"${primaryValue(e).replace(/"/g, '""')}",${e.confidence},${e.source_count}`);
            }
            output = rows.join('\n');
        } else {
            output = JSON.stringify({ investigation: inv, knowns, entities: entities.map(e => ({ type: e.type, data: e.data, confidence: e.confidence, sources: e.source_count })), links: links.length }, null, 2);
        }

        if (opts.output) {
            writeFileSync(opts.output, output);
            console.log(`\n  ${G}▲${RST} Exported to ${opts.output}\n`);
        } else {
            process.stdout.write(output + '\n');
        }

        engine.close();
    });

program
    .command('serve')
    .description('Start the dashboard server')
    .option('-p, --port <port>', 'Port', '3100')
    .action((opts) => {
        process.env.CYCLOPS_PORT = opts.port;
        import('../src/api/server.js');
    });

program.parse();
