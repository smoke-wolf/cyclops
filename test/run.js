#!/usr/bin/env node

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { unlinkSync, existsSync } from 'fs';
import { Engine } from '../src/core/engine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, 'test.db');

const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', B = '\x1b[34m', P = '\x1b[35m';
const DIM = '\x1b[2m', BOLD = '\x1b[1m', RST = '\x1b[0m';

let passed = 0, failed = 0, skipped = 0;

function cleanup() {
    if (existsSync(DB_PATH)) unlinkSync(DB_PATH);
    const wal = DB_PATH + '-wal';
    const shm = DB_PATH + '-shm';
    if (existsSync(wal)) unlinkSync(wal);
    if (existsSync(shm)) unlinkSync(shm);
}

async function test(name, fn) {
    try {
        await fn();
        passed++;
        console.log(`  ${G}✓${RST} ${name}`);
    } catch (e) {
        failed++;
        console.log(`  ${R}✗${RST} ${name}`);
        console.log(`    ${DIM}${e.message}${RST}`);
    }
}

function skip(name, reason) {
    skipped++;
    console.log(`  ${Y}○${RST} ${name} ${DIM}(${reason})${RST}`);
}

function assert(condition, msg) {
    if (!condition) throw new Error(msg || 'assertion failed');
}

// ═══════════════════════════════════════════════════
console.log(`\n${R}${BOLD}CYCLOPS${RST} ${DIM}Test Suite${RST}\n`);

// ── STATE LAYER ──
console.log(`${BOLD}State Layer${RST}`);
cleanup();

await test('create investigation', () => {
    const engine = new Engine(DB_PATH);
    const id = engine.state.createInvestigation('test-inv', 'person_full');
    assert(id, 'should return id');
    const inv = engine.state.getInvestigation(id);
    assert(inv.name === 'test-inv', 'name mismatch');
    assert(inv.status === 'pending', 'status should be pending');
    engine.close();
});

cleanup();
await test('add and retrieve knowns', () => {
    const engine = new Engine(DB_PATH);
    const id = engine.state.createInvestigation('test', 'person_full');
    engine.state.addKnown(id, 'email', 'test@example.com');
    engine.state.addKnown(id, 'username', 'testuser');
    const knowns = engine.state.getKnowns(id);
    assert(knowns.length === 2, `expected 2 knowns, got ${knowns.length}`);
    const emails = engine.state.getKnowns(id, 'email');
    assert(emails.length === 1, 'should filter by type');
    engine.close();
});

cleanup();
await test('entity dedup with confidence boost', () => {
    const engine = new Engine(DB_PATH);
    const id = engine.state.createInvestigation('test', 'person_full');
    const r1 = engine.state.addEntity(id, 'email', { address: 'test@example.com' }, 0.5);
    assert(r1.new === true, 'first insert should be new');
    const r2 = engine.state.addEntity(id, 'email', { address: 'test@example.com' }, 0.5);
    assert(r2.new === false, 'duplicate should not be new');
    const entities = engine.state.getEntities(id, 'email');
    assert(entities.length === 1, 'should dedup');
    assert(entities[0].source_count === 2, 'source count should be 2');
    assert(entities[0].confidence > 0.5, 'confidence should boost');
    engine.close();
});

cleanup();
await test('entity fingerprinting', () => {
    const engine = new Engine(DB_PATH);
    const fp1 = engine.state.entityFingerprint('email', { address: 'a@b.com' });
    const fp2 = engine.state.entityFingerprint('email', { address: 'a@b.com' });
    const fp3 = engine.state.entityFingerprint('email', { address: 'c@d.com' });
    assert(fp1 === fp2, 'same data should produce same fingerprint');
    assert(fp1 !== fp3, 'different data should produce different fingerprint');
    engine.close();
});

cleanup();
await test('entity links', () => {
    const engine = new Engine(DB_PATH);
    const id = engine.state.createInvestigation('test', 'person_full');
    const e1 = engine.state.addEntity(id, 'email', { address: 'a@b.com' }, 0.9);
    const e2 = engine.state.addEntity(id, 'account', { platform: 'GitHub', username: 'user1' }, 0.8);
    engine.state.addLink(id, e1.id, e2.id, 'email_to_account', 0.9, [{ rule: 'test' }]);
    const links = engine.state.getLinks(id);
    assert(links.length === 1, 'should have 1 link');
    assert(links[0].confidence === 0.9, 'link confidence');
    engine.close();
});

cleanup();
await test('connector run tracking', () => {
    const engine = new Engine(DB_PATH);
    const id = engine.state.createInvestigation('test', 'person_full');
    const runId = engine.state.recordConnectorRun(id, 'seed_expansion', 'GitHub', 'username', 'testuser');
    engine.state.completeConnectorRun(runId, 'completed', 5, 'raw output', null, 0);
    const stats = engine.state.getStats(id);
    assert(stats.connectors.length > 0, 'should have connector stats');
    engine.close();
});

cleanup();
await test('investigation status lifecycle', () => {
    const engine = new Engine(DB_PATH);
    const id = engine.state.createInvestigation('test', 'person_full');
    assert(engine.state.getInvestigation(id).status === 'pending');
    engine.state.updateInvestigationStatus(id, 'running');
    assert(engine.state.getInvestigation(id).status === 'running');
    engine.state.updateInvestigationStatus(id, 'completed');
    const inv = engine.state.getInvestigation(id);
    assert(inv.status === 'completed');
    assert(inv.completed_at, 'should set completed_at');
    engine.close();
});

// ── CONNECTOR REGISTRY ──
console.log(`\n${BOLD}Connector Registry${RST}`);
cleanup();

await test('registry loads all connectors', () => {
    const engine = new Engine(DB_PATH);
    const list = engine.registry.list();
    assert(list.length >= 18, `expected >=18 connectors, got ${list.length}`);
    engine.close();
});

cleanup();
await test('filter connectors by input type', () => {
    const engine = new Engine(DB_PATH);
    const email = engine.registry.forInputType('email');
    assert(email.length >= 2, `should have >=2 email connectors, got ${email.length}`);
    const username = engine.registry.forInputType('username');
    assert(username.length >= 2, `should have >=2 username connectors, got ${username.length}`);
    const domain = engine.registry.forInputType('domain');
    assert(domain.length >= 3, `should have >=3 domain connectors, got ${domain.length}`);
    engine.close();
});

// ── CORRELATION ENGINE ──
console.log(`\n${BOLD}Correlation Engine${RST}`);
cleanup();

await test('correlate entities across sources', () => {
    const engine = new Engine(DB_PATH);
    const id = engine.state.createInvestigation('test', 'person_full');
    engine.state.addEntity(id, 'email', { address: 'user@example.com' }, 0.9);
    engine.state.addEntity(id, 'account', { platform: 'GitHub', username: 'user1', address: 'user@example.com' }, 0.8);
    engine.state.addEntity(id, 'breach', { name: 'Test Breach', address: 'user@example.com' }, 0.7);
    const links = engine.correlator.correlate(id);
    assert(links.length > 0, 'should create at least 1 link');
    engine.close();
});

cleanup();
await test('build entity graph', () => {
    const engine = new Engine(DB_PATH);
    const id = engine.state.createInvestigation('test', 'person_full');
    engine.state.addEntity(id, 'person', { name: 'Test User', username: 'testuser' }, 0.9);
    engine.state.addEntity(id, 'email', { address: 'test@example.com' }, 0.8);
    engine.state.addEntity(id, 'account', { platform: 'GitHub', username: 'testuser', address: 'test@example.com' }, 0.7);
    engine.correlator.correlate(id);
    const graph = engine.correlator.buildGraph(id);
    assert(graph.nodes.length === 3, `expected 3 nodes, got ${graph.nodes.length}`);
    assert(graph.edges.length > 0, `should have edges, got ${graph.edges.length}`);
    engine.close();
});

// ── REPORT GENERATION ──
console.log(`\n${BOLD}Report Generation${RST}`);
cleanup();

await test('generate JSON report', async () => {
    const engine = new Engine(DB_PATH);
    const id = engine.state.createInvestigation('test-report', 'person_full');
    engine.state.addKnown(id, 'username', 'testuser');
    engine.state.addEntity(id, 'account', { platform: 'GitHub', username: 'testuser' }, 0.9);
    engine.state.addEntity(id, 'email', { address: 'test@example.com' }, 0.8);
    engine.state.updateInvestigationStatus(id, 'completed');
    const path = await engine.reporter.generate(id, 'json');
    assert(path.endsWith('report.json'), `unexpected path: ${path}`);
    assert(existsSync(path), 'report file should exist');
    engine.close();
});

cleanup();
await test('generate HTML report', async () => {
    const engine = new Engine(DB_PATH);
    const id = engine.state.createInvestigation('html-test', 'person_full');
    engine.state.addKnown(id, 'email', 'test@example.com');
    engine.state.addEntity(id, 'breach', { name: 'TestBreach', email: 'test@example.com' }, 0.8);
    engine.state.updateInvestigationStatus(id, 'completed');
    const path = await engine.reporter.generate(id, 'html');
    assert(path.endsWith('report.html'), 'should be html');
    assert(existsSync(path), 'report file should exist');
    engine.close();
});

// ── LIVE CONNECTORS (NATIVE, NO API KEY NEEDED) ──
console.log(`\n${BOLD}Live Connector Tests — Native${RST}`);
cleanup();

await test('GitHub connector: smoke-wolf', async () => {
    const engine = new Engine(DB_PATH);
    const id = engine.state.createInvestigation('gh-test', 'person_full');
    engine.state.addKnown(id, 'username', 'smoke-wolf');
    const connector = engine.registry.get('github');
    const result = await connector.run(id, 'test', 'username', 'smoke-wolf');
    assert(result.status === 'completed', `status: ${result.status}, error: ${result.error}`);
    assert(result.newCount > 0, `expected entities, got ${result.newCount}`);
    const entities = engine.state.getEntities(id);
    const accounts = entities.filter(e => e.type === 'account');
    assert(accounts.some(a => a.data.platform === 'GitHub'), 'should find GitHub account');
    const repos = entities.filter(e => e.type === 'repository');
    assert(repos.length > 0, 'should find repositories');
    console.log(`    ${DIM}Found ${entities.length} entities (${accounts.length} accounts, ${repos.length} repos)${RST}`);
    engine.close();
});

cleanup();
await test('DNS-Native connector: github.com', async () => {
    const engine = new Engine(DB_PATH);
    const id = engine.state.createInvestigation('dns-test', 'domain_recon');
    engine.state.addKnown(id, 'domain', 'github.com');
    const connector = engine.registry.get('dns_native');
    const result = await connector.run(id, 'test', 'domain', 'github.com');
    assert(result.status === 'completed', `status: ${result.status}`);
    assert(result.newCount > 0, `expected entities, got ${result.newCount}`);
    const entities = engine.state.getEntities(id);
    const ips = entities.filter(e => e.type === 'ip');
    const subs = entities.filter(e => e.type === 'subdomain');
    assert(ips.length > 0, 'should resolve IPs');
    console.log(`    ${DIM}Found ${entities.length} entities (${ips.length} IPs, ${subs.length} subdomains)${RST}`);
    engine.close();
});

cleanup();
await test('WHOIS-Native connector: github.com', async () => {
    const engine = new Engine(DB_PATH);
    const id = engine.state.createInvestigation('whois-test', 'domain_recon');
    const connector = engine.registry.get('whois_native');
    const result = await connector.run(id, 'test', 'domain', 'github.com');
    assert(result.status === 'completed', `status: ${result.status}, error: ${result.error}`);
    assert(result.newCount > 0, `expected entities, got ${result.newCount}`);
    const entities = engine.state.getEntities(id);
    const domains = entities.filter(e => e.type === 'domain');
    assert(domains.length > 0, 'should find domain record');
    console.log(`    ${DIM}Found ${entities.length} entities${RST}`);
    engine.close();
});

cleanup();
await test('crt.sh connector: github.com', async () => {
    const engine = new Engine(DB_PATH);
    const id = engine.state.createInvestigation('crt-test', 'domain_recon');
    const connector = engine.registry.get('crt_sh');
    const result = await connector.run(id, 'test', 'domain', 'github.com');
    assert(result.status === 'completed', `status: ${result.status}, error: ${result.error}`);
    const entities = engine.state.getEntities(id);
    const subs = entities.filter(e => e.type === 'subdomain');
    const certs = entities.filter(e => e.type === 'certificate');
    console.log(`    ${DIM}Found ${subs.length} subdomains, ${certs.length} certificates${RST}`);
    engine.close();
});

cleanup();
await test('WebScraper connector: farpsec.xyz', async () => {
    const engine = new Engine(DB_PATH);
    const id = engine.state.createInvestigation('scrape-test', 'domain_recon');
    const connector = engine.registry.get('web_scraper');
    const result = await connector.run(id, 'test', 'domain', 'farpsec.xyz');
    assert(result.status === 'completed', `status: ${result.status}, error: ${result.error}`);
    const entities = engine.state.getEntities(id);
    console.log(`    ${DIM}Found ${entities.length} entities from farpsec.xyz${RST}`);
    const types = {};
    for (const e of entities) { types[e.type] = (types[e.type] || 0) + 1; }
    console.log(`    ${DIM}Types: ${JSON.stringify(types)}${RST}`);
    engine.close();
});

// ── LIVE: FULL INVESTIGATION ──
console.log(`\n${BOLD}Full Investigation — smoke-wolf${RST}`);
cleanup();

await test('full investigation: smoke-wolf (native connectors only)', async () => {
    const engine = new Engine(DB_PATH);

    engine.telemetry.onEvent(event => {
        if (event.type === 'phase_start') {
            process.stdout.write(`    ${Y}◆${RST} ${event.phaseId} `);
        } else if (event.type === 'phase_end') {
            process.stdout.write(`${event.status === 'completed' ? G + '✓' : R + '✗'}${RST}\n`);
        } else if (event.type === 'entity_new') {
            process.stdout.write(`${G}.${RST}`);
        }
    });

    const knowns = [
        { type: 'username', value: 'smoke-wolf' },
        { type: 'email', value: 'udah.farp@gmail.com' },
        { type: 'email', value: 'mowglisinderblok@gmail.com' }
    ];

    const id = await engine.investigate('smoke-wolf investigation', knowns, 'username_trace');
    const stats = engine.state.getStats(id);
    const entities = engine.state.getEntities(id);

    console.log(`\n    ${DIM}Total entities: ${entities.length}${RST}`);
    console.log(`    ${DIM}Total links: ${stats.links}${RST}`);

    const byType = {};
    for (const e of entities) { byType[e.type] = (byType[e.type] || 0) + 1; }
    for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
        console.log(`    ${DIM}  ${type}: ${count}${RST}`);
    }

    const reportPath = await engine.reporter.generate(id, 'html');
    console.log(`    ${DIM}Report: ${reportPath}${RST}`);

    assert(entities.length > 5, `expected >5 entities, got ${entities.length}`);
    engine.close();
});

// ── SUMMARY ──
cleanup();
console.log(`\n${BOLD}${'═'.repeat(50)}${RST}`);
console.log(`  ${G}${passed} passed${RST}  ${failed > 0 ? R : DIM}${failed} failed${RST}  ${Y}${skipped} skipped${RST}`);
console.log(`${BOLD}${'═'.repeat(50)}${RST}\n`);

process.exit(failed > 0 ? 1 : 0);
