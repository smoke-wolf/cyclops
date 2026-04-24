#!/usr/bin/env node

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { unlinkSync, existsSync } from 'fs';
import { Engine } from '../src/core/engine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, 'deep_recon.db');

const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', B = '\x1b[34m', P = '\x1b[35m';
const DIM = '\x1b[2m', BOLD = '\x1b[1m', RST = '\x1b[0m';

if (existsSync(DB_PATH)) unlinkSync(DB_PATH);
[DB_PATH + '-wal', DB_PATH + '-shm'].forEach(f => { if (existsSync(f)) unlinkSync(f); });

const engine = new Engine(DB_PATH);

engine.telemetry.onEvent(event => {
    const ts = new Date().toLocaleTimeString();
    switch (event.type) {
        case 'phase_start':
            console.log(`\n${Y}◆ PHASE: ${event.phaseId}${RST}`);
            break;
        case 'phase_end':
            const c = event.status === 'completed' ? G : R;
            console.log(`${c}  → ${event.status}${RST}`);
            break;
        case 'connector_start':
            process.stdout.write(`  ${P}▸${RST} ${event.connector} `);
            break;
        case 'connector_end':
            const sc = event.status === 'completed' ? G : R;
            console.log(`${sc}${event.status}${RST} [${event.entitiesFound} new, ${event.duration}ms]`);
            break;
        case 'entity_new':
            process.stdout.write(`${G}.${RST}`);
            break;
        case 'error':
            console.log(`  ${R}✗ ${event.connector}: ${event.message}${RST}`);
            break;
    }
});

console.log(`${R}${BOLD}CYCLOPS${RST} ${DIM}Deep Recon — smoke-wolf + farpsec.xyz${RST}\n`);

const knowns = [
    { type: 'username', value: 'smoke-wolf' },
    { type: 'email', value: 'udah.farp@gmail.com' },
    { type: 'email', value: 'mowglisinderblok@gmail.com' },
    { type: 'domain', value: 'farpsec.xyz' }
];

console.log(`${BOLD}Knowns:${RST}`);
for (const k of knowns) console.log(`  ${DIM}${k.type}:${RST} ${k.value}`);

try {
    const id = await engine.investigate('smoke-wolf deep recon', knowns, 'person_full');
    const stats = engine.state.getStats(id);
    const entities = engine.state.getEntities(id);
    const links = engine.state.getLinks(id);

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`${G}${BOLD}INVESTIGATION COMPLETE${RST}\n`);
    console.log(`  Entities: ${BOLD}${entities.length}${RST}`);
    console.log(`  Links:    ${BOLD}${links.length}${RST}`);
    console.log(`  Knowns:   ${BOLD}${engine.state.getKnowns(id).length}${RST} (expanded from ${knowns.length})`);

    const byType = {};
    for (const e of entities) { byType[e.type] = (byType[e.type] || 0) + 1; }
    console.log(`\n${BOLD}Entity Breakdown:${RST}`);
    for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${type.padEnd(15)} ${count}`);
    }

    const linkTypes = {};
    for (const l of links) { linkTypes[l.link_type] = (linkTypes[l.link_type] || 0) + 1; }
    if (Object.keys(linkTypes).length) {
        console.log(`\n${BOLD}Link Types:${RST}`);
        for (const [type, count] of Object.entries(linkTypes).sort((a, b) => b[1] - a[1])) {
            console.log(`  ${type.padEnd(25)} ${count}`);
        }
    }

    const highConf = entities.filter(e => e.confidence >= 0.8);
    console.log(`\n${BOLD}High Confidence Entities (≥80%):${RST}`);
    for (const e of highConf.slice(0, 30)) {
        const label = e.type === 'account' ? `${e.data.platform}/${e.data.username}` :
                     e.type === 'email' ? e.data.address :
                     e.type === 'domain' ? e.data.name :
                     e.type === 'subdomain' ? e.data.name :
                     e.type === 'ip' ? e.data.address :
                     e.type === 'person' ? `${e.data.name} (${e.data.username || ''})` :
                     e.type === 'repository' ? e.data.name :
                     e.type === 'dns_record' ? `${e.data.type} ${e.data.name}` :
                     e.type === 'certificate' ? e.data.subject :
                     JSON.stringify(e.data).slice(0, 60);
        console.log(`  ${G}●${RST} ${e.type.padEnd(14)} ${label} ${DIM}(${(e.confidence*100).toFixed(0)}%, ${e.source_count} src)${RST}`);
    }

    const multiSrc = entities.filter(e => e.source_count > 1);
    if (multiSrc.length) {
        console.log(`\n${BOLD}Multi-Source Corroborated:${RST}`);
        for (const e of multiSrc) {
            const label = e.data.address || e.data.name || e.data.username || e.data.url || JSON.stringify(e.data).slice(0, 50);
            console.log(`  ${Y}★${RST} ${e.type} — ${label} ${DIM}(${e.source_count} sources, ${(e.confidence*100).toFixed(0)}%)${RST}`);
        }
    }

    const jsonPath = await engine.reporter.generate(id, 'json');
    const htmlPath = await engine.reporter.generate(id, 'html');
    const mdPath = await engine.reporter.generate(id, 'markdown');
    console.log(`\n${BOLD}Reports:${RST}`);
    console.log(`  JSON:     ${jsonPath}`);
    console.log(`  HTML:     ${htmlPath}`);
    console.log(`  Markdown: ${mdPath}`);

    console.log(`\n${'═'.repeat(60)}\n`);
} catch (e) {
    console.log(`\n${R}✗ FAILED: ${e.message}${RST}`);
    console.log(e.stack);
}

engine.close();
