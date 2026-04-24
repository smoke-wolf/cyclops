#!/usr/bin/env node

import { Command } from 'commander';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Engine } from '../src/core/engine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'cyclops.db');

const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', B = '\x1b[34m', P = '\x1b[35m';
const DIM = '\x1b[2m', BOLD = '\x1b[1m', RST = '\x1b[0m';

function banner() {
    console.log(`${R}${BOLD}
   ██████╗██╗   ��█╗ ██████╗██╗      ██████╗ ██████╗ ███████╗
  ██╔════╝╚██╗ █���╔╝██╔════╝██║     ██╔���══██╗██╔══██╗██╔════╝
  ██║      ╚████╔╝ ██║     ██║     ██║   ██║██████╔╝███████╗
  ██║       ╚██╔╝  ██║     ██║     ██║   ██║██╔═══╝ ╚════██║
  ╚███��██╗   ██║   ╚██████╗███████╗╚██████╔╝██║     ███████║
   ╚═════╝   ���═╝    ╚═════╝╚══════╝ ╚═════╝ ╚═╝     ╚══════╝${RST}
  ${DIM}Unified OSINT Targeting Pipeline${RST}
`);
}

const program = new Command();
program.name('cyclops').description('Unified OSINT targeting pipeline').version('0.1.0');

program
    .command('investigate')
    .description('Launch a new investigation')
    .requiredOption('-n, --name <name>', 'Investigation name')
    .option('-w, --workflow <workflow>', 'Workflow to use', 'person_full')
    .option('-k, --known <knowns...>', 'Known inputs (type:value format)')
    .option('--format <format>', 'Report format (json, html, markdown)', 'json')
    .action(async (opts) => {
        banner();
        const engine = new Engine(DB_PATH);

        const knowns = (opts.known || []).map(k => {
            const [type, ...rest] = k.split(':');
            return { type, value: rest.join(':') };
        });

        if (!knowns.length) {
            console.log(`${R}✗${RST} At least one --known required (e.g. --known username:johndoe)`);
            process.exit(1);
        }

        console.log(`${B}▸${RST} Investigation: ${BOLD}${opts.name}${RST}`);
        console.log(`${B}▸${RST} Workflow: ${opts.workflow}`);
        console.log(`${B}▸${RST} Knowns:`);
        for (const k of knowns) {
            console.log(`  ${DIM}${k.type}:${RST} ${k.value}`);
        }
        console.log();

        engine.telemetry.onEvent(event => {
            const ts = new Date().toLocaleTimeString();
            switch (event.type) {
                case 'phase_start':
                    console.log(`${Y}◆${RST} ${DIM}${ts}${RST} Phase: ${BOLD}${event.phaseId}${RST}`);
                    break;
                case 'phase_end':
                    const color = event.status === 'completed' ? G : R;
                    console.log(`${color}◆${RST} ${DIM}${ts}${RST} Phase ${event.phaseId} → ${event.status}`);
                    break;
                case 'connector_start':
                    console.log(`  ${P}→${RST} ${DIM}${ts}${RST} ${event.connector} (${event.input?.type}: ${event.input?.value})`);
                    break;
                case 'connector_end':
                    const sc = event.status === 'completed' ? G : R;
                    console.log(`  ${sc}←${RST} ${DIM}${ts}${RST} ${event.connector} ${event.status} [${event.entitiesFound} entities, ${event.duration}ms]`);
                    break;
                case 'entity_new':
                    console.log(`    ${G}+${RST} ${event.entityType} ${DIM}via ${event.connector}${RST}`);
                    break;
                case 'error':
                    console.log(`  ${R}✗${RST} ${DIM}${ts}${RST} ${event.connector}: ${event.message}`);
                    break;
            }
        });

        try {
            console.log(`${R}▲${RST} Starting investigation...\n`);
            const id = await engine.investigate(opts.name, knowns, opts.workflow);
            const stats = engine.state.getStats(id);

            console.log(`\n${G}═══════════════════════════════════════${RST}`);
            console.log(`${G}▲${RST} Investigation ${BOLD}complete${RST}`);
            console.log(`${DIM}ID: ${id}${RST}\n`);

            const typeGroups = {};
            for (const row of stats.entities) {
                typeGroups[row.type] = row.count;
            }
            console.log(`${BOLD}Entities:${RST}`);
            for (const [type, count] of Object.entries(typeGroups)) {
                console.log(`  ${type}: ${count}`);
            }
            console.log(`\n${BOLD}Links:${RST} ${stats.links}`);

            const reportPath = await engine.reporter.generate(id, opts.format);
            console.log(`\n${BOLD}Report:${RST} ${reportPath}`);
        } catch (e) {
            console.log(`\n${R}✗ Investigation failed:${RST} ${e.message}`);
        } finally {
            engine.close();
        }
    });

program
    .command('list')
    .description('List investigations')
    .option('-s, --status <status>', 'Filter by status')
    .action((opts) => {
        const engine = new Engine(DB_PATH);
        const investigations = engine.state.listInvestigations(opts.status);

        if (!investigations.length) {
            console.log(`${DIM}No investigations found${RST}`);
            engine.close();
            return;
        }

        console.log(`\n${BOLD}  ID        Name                    Workflow          Status      Created${RST}`);
        console.log(`${DIM}${'─'.repeat(90)}${RST}`);
        for (const inv of investigations) {
            const statusColor = inv.status === 'completed' ? G : inv.status === 'running' ? Y : inv.status === 'failed' ? R : DIM;
            console.log(`  ${inv.id.padEnd(10)} ${inv.name.padEnd(24)} ${inv.workflow.padEnd(18)} ${statusColor}${inv.status.padEnd(12)}${RST} ${DIM}${inv.created_at}${RST}`);
        }
        console.log();
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
        console.log(`\n${BOLD}${inv.name}${RST} ${DIM}(${inv.id})${RST}`);
        console.log(`  Workflow: ${inv.workflow}`);
        console.log(`  Status: ${inv.status}`);
        console.log(`  Created: ${inv.created_at}`);

        if (status.stats.entities.length) {
            console.log(`\n${BOLD}Entities:${RST}`);
            for (const row of status.stats.entities) {
                console.log(`  ${row.type}: ${row.count}`);
            }
        }
        console.log(`  Links: ${status.stats.links}`);

        if (status.stats.phases.length) {
            console.log(`\n${BOLD}Phases:${RST}`);
            for (const p of status.stats.phases) {
                const color = p.status === 'completed' ? G : p.status === 'running' ? Y : R;
                console.log(`  ${color}●${RST} ${p.phase_id} [${p.status}] +${(p.entities_after || 0) - (p.entities_before || 0)} entities`);
            }
        }
        console.log();
        engine.close();
    });

program
    .command('report <id>')
    .description('Generate report for investigation')
    .option('--format <format>', 'Report format (json, html, markdown)', 'html')
    .action(async (id, opts) => {
        const engine = new Engine(DB_PATH);
        try {
            const path = await engine.reporter.generate(id, opts.format);
            console.log(`${G}▲${RST} Report generated: ${path}`);
        } catch (e) {
            console.log(`${R}✗${RST} ${e.message}`);
        }
        engine.close();
    });

program
    .command('connectors')
    .description('List and check connectors')
    .option('--health', 'Run health checks')
    .action(async (opts) => {
        const engine = new Engine(DB_PATH);
        const connectors = engine.registry.list();

        if (opts.health) {
            console.log(`${DIM}Running health checks...${RST}\n`);
            await engine.registry.checkHealth();
        }

        console.log(`${BOLD}  Connector         Type                Accepts              Status${RST}`);
        console.log(`${DIM}${'─'.repeat(80)}${RST}`);
        for (const c of connectors) {
            const statusStr = c.healthy === true ? `${G}OK${RST}` : c.healthy === false ? `${R}DOWN${RST}` : `${DIM}--${RST}`;
            console.log(`  ${c.name.padEnd(18)} ${c.type.padEnd(20)} ${c.accepts.join(', ').padEnd(21)} ${statusStr}`);
        }

        if (opts.health) {
            const summary = engine.registry.getHealthSummary();
            console.log(`\n  ${G}${summary.healthy} healthy${RST}  ${R}${summary.unhealthy} down${RST}  ${DIM}${summary.unchecked} unchecked${RST}`);
        }
        console.log();
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
