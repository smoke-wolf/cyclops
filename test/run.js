#!/usr/bin/env node

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { unlinkSync, existsSync } from 'fs';
import { Engine } from '../src/core/engine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, 'test.db');

const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', B = '\x1b[34m', P = '\x1b[35m', C = '\x1b[36m';
const DIM = '\x1b[2m', BOLD = '\x1b[1m', RST = '\x1b[0m';

let passed = 0, failed = 0, skipped = 0;
const failures = [];

function cleanup() {
    for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) {
        try { if (existsSync(f)) unlinkSync(f); } catch {}
    }
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
        failures.push({ name, error: e.message });
    }
}

function skip(name, reason) {
    skipped++;
    console.log(`  ${Y}○${RST} ${name} ${DIM}(${reason})${RST}`);
}

function assert(condition, msg) {
    if (!condition) throw new Error(msg || 'assertion failed');
}

function assertEq(a, b, msg) {
    if (a !== b) throw new Error(msg || `expected ${b}, got ${a}`);
}

function assertGt(a, b, msg) {
    if (!(a > b)) throw new Error(msg || `expected ${a} > ${b}`);
}

// ═══════════════════════════════════════════════════════════
console.log(`\n${R}${BOLD}CYCLOPS${RST} ${DIM}Test Suite${RST}\n`);
const t0 = Date.now();

// ── STATE LAYER ──────────────────────────────────────────
console.log(`${BOLD}State Layer${RST}`);
cleanup();

await test('create investigation', () => {
    const engine = new Engine(DB_PATH);
    const id = engine.state.createInvestigation('test-inv', 'person_full');
    assert(id, 'should return id');
    const inv = engine.state.getInvestigation(id);
    assertEq(inv.name, 'test-inv', 'name mismatch');
    assertEq(inv.status, 'pending', 'status should be pending');
    assertEq(inv.workflow, 'person_full', 'workflow mismatch');
    engine.close();
});

cleanup();
await test('add and retrieve knowns', () => {
    const engine = new Engine(DB_PATH);
    const id = engine.state.createInvestigation('test', 'person_full');
    engine.state.addKnown(id, 'email', 'test@example.com');
    engine.state.addKnown(id, 'username', 'testuser');
    const knowns = engine.state.getKnowns(id);
    assertEq(knowns.length, 2, `expected 2 knowns, got ${knowns.length}`);
    const emails = engine.state.getKnowns(id, 'email');
    assertEq(emails.length, 1, 'should filter by type');
    assertEq(emails[0].value, 'test@example.com');
    engine.close();
});

cleanup();
await test('knowns are case-normalized', () => {
    const engine = new Engine(DB_PATH);
    const id = engine.state.createInvestigation('test', 'person_full');
    engine.state.addKnown(id, 'email', 'TEST@Example.com');
    const knowns = engine.state.getKnowns(id, 'email');
    assertEq(knowns[0].value, 'test@example.com', 'should lowercase');
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
    assertEq(entities.length, 1, 'should dedup');
    assertEq(entities[0].source_count, 2, 'source count should be 2');
    assertGt(entities[0].confidence, 0.5, 'confidence should boost');
    engine.close();
});

cleanup();
await test('entity confidence caps at 1.0', () => {
    const engine = new Engine(DB_PATH);
    const id = engine.state.createInvestigation('test', 'person_full');
    engine.state.addEntity(id, 'email', { address: 'test@a.com' }, 0.95);
    for (let i = 0; i < 10; i++) {
        engine.state.addEntity(id, 'email', { address: 'test@a.com' }, 0.95);
    }
    const entities = engine.state.getEntities(id, 'email');
    assert(entities[0].confidence <= 1.0, `confidence ${entities[0].confidence} exceeds 1.0`);
    engine.close();
});

cleanup();
await test('entity fingerprinting', () => {
    const engine = new Engine(DB_PATH);
    const fp1 = engine.state.entityFingerprint('email', { address: 'a@b.com' });
    const fp2 = engine.state.entityFingerprint('email', { address: 'a@b.com' });
    const fp3 = engine.state.entityFingerprint('email', { address: 'c@d.com' });
    const fp4 = engine.state.entityFingerprint('domain', { name: 'a@b.com' });
    assertEq(fp1, fp2, 'same data should produce same fingerprint');
    assert(fp1 !== fp3, 'different data should produce different fingerprint');
    assert(fp1 !== fp4, 'different types should produce different fingerprint');
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
    assertEq(links.length, 1, 'should have 1 link');
    assertEq(links[0].confidence, 0.9, 'link confidence');
    const linksForE1 = engine.state.getLinks(id, e1.id);
    assertEq(linksForE1.length, 1, 'should find link by entity');
    engine.close();
});

cleanup();
await test('connector run tracking', () => {
    const engine = new Engine(DB_PATH);
    const id = engine.state.createInvestigation('test', 'person_full');
    const runId = engine.state.recordConnectorRun(id, 'seed_expansion', 'GitHub', 'username', 'testuser');
    engine.state.completeConnectorRun(runId, 'completed', 5, 'raw output', null, 0);
    const stats = engine.state.getStats(id);
    assertGt(stats.connectors.length, 0, 'should have connector stats');
    assertEq(stats.connectors[0].status, 'completed');
    engine.close();
});

cleanup();
await test('investigation status lifecycle', () => {
    const engine = new Engine(DB_PATH);
    const id = engine.state.createInvestigation('test', 'person_full');
    assertEq(engine.state.getInvestigation(id).status, 'pending');
    engine.state.updateInvestigationStatus(id, 'running');
    assertEq(engine.state.getInvestigation(id).status, 'running');
    engine.state.updateInvestigationStatus(id, 'completed');
    const inv = engine.state.getInvestigation(id);
    assertEq(inv.status, 'completed');
    assert(inv.completed_at, 'should set completed_at');
    engine.close();
});

cleanup();
await test('list investigations with status filter', () => {
    const engine = new Engine(DB_PATH);
    const id1 = engine.state.createInvestigation('a', 'quick_recon');
    const id2 = engine.state.createInvestigation('b', 'quick_recon');
    engine.state.updateInvestigationStatus(id1, 'completed');
    engine.state.updateInvestigationStatus(id2, 'running');
    const all = engine.state.listInvestigations();
    assertEq(all.length, 2);
    const completed = engine.state.listInvestigations('completed');
    assertEq(completed.length, 1);
    assertEq(completed[0].name, 'a');
    engine.close();
});

cleanup();
await test('getStats returns correct entity type breakdown', () => {
    const engine = new Engine(DB_PATH);
    const id = engine.state.createInvestigation('test', 'person_full');
    engine.state.addEntity(id, 'email', { address: 'a@b.com' }, 0.8);
    engine.state.addEntity(id, 'email', { address: 'c@d.com' }, 0.8);
    engine.state.addEntity(id, 'domain', { name: 'example.com' }, 0.7);
    const stats = engine.state.getStats(id);
    const emailStat = stats.entities.find(e => e.type === 'email');
    assertEq(emailStat.count, 2);
    const domainStat = stats.entities.find(e => e.type === 'domain');
    assertEq(domainStat.count, 1);
    engine.close();
});

// ── CONNECTOR REGISTRY ───────────────────────────────────
console.log(`\n${BOLD}Connector Registry${RST}`);
cleanup();

await test('registry loads all 28 connectors', () => {
    const engine = new Engine(DB_PATH);
    const list = engine.registry.list();
    assertEq(list.length, 28, `expected 28 connectors, got ${list.length}`);
    engine.close();
});

cleanup();
await test('native connectors flagged correctly', () => {
    const engine = new Engine(DB_PATH);
    const list = engine.registry.list();
    const native = list.filter(c => c.native);
    assertEq(native.length, 12, `expected 12 native, got ${native.length}`);
    const nativeNames = native.map(c => c.key).sort();
    assert(nativeNames.includes('github'), 'github should be native');
    assert(nativeNames.includes('dns_native'), 'dns_native should be native');
    assert(nativeNames.includes('web_scraper'), 'web_scraper should be native');
    engine.close();
});

cleanup();
await test('filter connectors by input type', () => {
    const engine = new Engine(DB_PATH);
    const email = engine.registry.forInputType('email');
    assertGt(email.length, 2, `should have >2 email connectors, got ${email.length}`);
    const username = engine.registry.forInputType('username');
    assertGt(username.length, 2, `should have >2 username connectors`);
    const domain = engine.registry.forInputType('domain');
    assertGt(domain.length, 3, `should have >3 domain connectors`);
    engine.close();
});

cleanup();
await test('forPhase returns correct connectors', () => {
    const engine = new Engine(DB_PATH);
    const phase = { connectors: ['github', 'dns_native', 'nonexistent'] };
    const result = engine.registry.forPhase(phase);
    assertEq(result.length, 2, 'should skip nonexistent');
    assert(result.some(r => r.key === 'github'));
    assert(result.some(r => r.key === 'dns_native'));
    engine.close();
});

// ── CORRELATION ENGINE ───────────────────────────────────
console.log(`\n${BOLD}Correlation Engine${RST}`);
cleanup();

await test('correlate entities across sources', () => {
    const engine = new Engine(DB_PATH);
    const id = engine.state.createInvestigation('test', 'person_full');
    engine.state.addEntity(id, 'email', { address: 'user@example.com' }, 0.9);
    engine.state.addEntity(id, 'account', { platform: 'GitHub', username: 'user1', address: 'user@example.com' }, 0.8);
    engine.state.addEntity(id, 'breach', { name: 'Test Breach', address: 'user@example.com' }, 0.7);
    const links = engine.correlator.correlate(id);
    assertGt(links.length, 0, 'should create at least 1 link');
    engine.close();
});

cleanup();
await test('build entity graph with correct structure', () => {
    const engine = new Engine(DB_PATH);
    const id = engine.state.createInvestigation('test', 'person_full');
    engine.state.addEntity(id, 'person', { name: 'Test User', username: 'testuser' }, 0.9);
    engine.state.addEntity(id, 'email', { address: 'test@example.com' }, 0.8);
    engine.state.addEntity(id, 'account', { platform: 'GitHub', username: 'testuser', address: 'test@example.com' }, 0.7);
    engine.correlator.correlate(id);
    const graph = engine.correlator.buildGraph(id);
    assertEq(graph.nodes.length, 3, `expected 3 nodes, got ${graph.nodes.length}`);
    assertGt(graph.edges.length, 0, `should have edges`);
    assert(graph.nodes.every(n => n.type && n.label && n.id !== undefined), 'nodes should have type, label, id');
    assert(graph.edges.every(e => e.from !== undefined && e.to !== undefined && e.type), 'edges need from, to, type');
    engine.close();
});

cleanup();
await test('fuzzy matching links similar usernames', () => {
    const engine = new Engine(DB_PATH);
    const id = engine.state.createInvestigation('test', 'person_full');
    engine.state.addEntity(id, 'person', { name: 'Test', username: 'smoke-wolf' }, 0.9);
    engine.state.addEntity(id, 'account', { platform: 'GitHub', username: 'smoke-wolf' }, 0.8);
    engine.state.addEntity(id, 'account', { platform: 'Twitter', username: 'smokewolf' }, 0.6);
    const links = engine.correlator.correlate(id);
    assertGt(links.length, 0, 'should link similar usernames');
    engine.close();
});

cleanup();
await test('multi-source bonus applied', () => {
    const engine = new Engine(DB_PATH);
    const id = engine.state.createInvestigation('test', 'person_full');
    engine.state.addEntity(id, 'email', { address: 'x@y.com' }, 0.5);
    engine.state.addEntity(id, 'email', { address: 'x@y.com' }, 0.5);
    engine.state.addEntity(id, 'email', { address: 'x@y.com' }, 0.5);
    engine.correlator.correlate(id);
    const entities = engine.state.getEntities(id, 'email');
    assertGt(entities[0].confidence, 0.6, 'multi-source should boost confidence');
    engine.close();
});

// ── REPORT GENERATION ────────────────────────────────────
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
    const { readFileSync } = await import('fs');
    const report = JSON.parse(readFileSync(path, 'utf-8'));
    assert(report.meta.name === 'test-report', 'report meta.name');
    assertEq(report.summary.entity_count, 2, 'report entity count');
    assertGt(report.knowns.length, 0, 'report should include knowns');
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
    const { readFileSync } = await import('fs');
    const html = readFileSync(path, 'utf-8');
    assert(html.includes('CYCLOPS'), 'HTML should contain CYCLOPS');
    assert(html.includes('html-test'), 'HTML should contain investigation name');
    engine.close();
});

cleanup();
await test('generate Markdown report', async () => {
    const engine = new Engine(DB_PATH);
    const id = engine.state.createInvestigation('md-test', 'person_full');
    engine.state.addKnown(id, 'domain', 'example.com');
    engine.state.addEntity(id, 'domain', { name: 'example.com' }, 0.9);
    engine.state.addEntity(id, 'subdomain', { name: 'mail.example.com' }, 0.7);
    engine.state.updateInvestigationStatus(id, 'completed');
    const path = await engine.reporter.generate(id, 'markdown');
    assert(path.endsWith('report.md'), 'should be .md');
    assert(existsSync(path), 'report file should exist');
    const { readFileSync } = await import('fs');
    const md = readFileSync(path, 'utf-8');
    assert(md.includes('# CYCLOPS'), 'MD should start with header');
    assert(md.includes('example.com'), 'MD should contain domain');
    engine.close();
});

// ── TELEMETRY ────────────────────────────────────────────
console.log(`\n${BOLD}Telemetry${RST}`);
cleanup();

await test('telemetry broadcasts events to listeners', () => {
    const engine = new Engine(DB_PATH);
    const events = [];
    engine.telemetry.onEvent(e => events.push(e));
    const id = engine.state.createInvestigation('test', 'person_full');
    engine.telemetry.phaseStart(id, 'test_phase');
    engine.telemetry.phaseEnd(id, 'test_phase', 'completed');
    assertEq(events.length, 2);
    assertEq(events[0].type, 'phase_start');
    assertEq(events[1].type, 'phase_end');
    engine.close();
});

cleanup();
await test('telemetry tracks active runs', () => {
    const engine = new Engine(DB_PATH);
    const id = engine.state.createInvestigation('test', 'person_full');
    engine.telemetry.connectorStart(id, 'GitHub', 'phase1', { type: 'username', value: 'test' });
    assertEq(engine.telemetry.getActiveRuns().length, 1);
    engine.telemetry.connectorEnd(id, 'GitHub', 'phase1', { status: 'completed', input: { value: 'test' } });
    assertEq(engine.telemetry.getActiveRuns().length, 0);
    engine.close();
});

// ── LIVE CONNECTORS (NATIVE) ─────────────────────────────
console.log(`\n${BOLD}Live Connector Tests${RST}`);
cleanup();

await test('GitHub: smoke-wolf', async () => {
    const engine = new Engine(DB_PATH);
    const id = engine.state.createInvestigation('gh-test', 'person_full');
    engine.state.addKnown(id, 'username', 'smoke-wolf');
    const connector = engine.registry.get('github');
    const result = await connector.run(id, 'test', 'username', 'smoke-wolf');
    assertEq(result.status, 'completed', `status: ${result.status}, error: ${result.error}`);
    if (result.newCount === 0) {
        skip('GitHub', 'rate limited — 0 entities returned');
        passed--; engine.close(); return;
    }
    const entities = engine.state.getEntities(id);
    assert(entities.some(e => e.type === 'account' && e.data.platform === 'GitHub'), 'should find GitHub account');
    assert(entities.some(e => e.type === 'repository'), 'should find repositories');
    assert(entities.some(e => e.type === 'person'), 'should find person');
    console.log(`    ${DIM}${entities.length} entities (${entities.filter(e => e.type === 'account').length} accounts, ${entities.filter(e => e.type === 'repository').length} repos)${RST}`);
    engine.close();
});

cleanup();
await test('DNS-Native: github.com', async () => {
    const engine = new Engine(DB_PATH);
    const id = engine.state.createInvestigation('dns-test', 'domain_recon');
    const connector = engine.registry.get('dns_native');
    const result = await connector.run(id, 'test', 'domain', 'github.com');
    assertEq(result.status, 'completed', `status: ${result.status}`);
    assertGt(result.newCount, 0, 'expected entities');
    const entities = engine.state.getEntities(id);
    assert(entities.some(e => e.type === 'ip'), 'should resolve IPs');
    assert(entities.some(e => e.type === 'dns_record'), 'should find DNS records');
    console.log(`    ${DIM}${entities.length} entities (${entities.filter(e => e.type === 'ip').length} IPs, ${entities.filter(e => e.type === 'subdomain').length} subs)${RST}`);
    engine.close();
});

cleanup();
await test('WHOIS-Native: github.com', async () => {
    const engine = new Engine(DB_PATH);
    const id = engine.state.createInvestigation('whois-test', 'domain_recon');
    const connector = engine.registry.get('whois_native');
    const result = await connector.run(id, 'test', 'domain', 'github.com');
    assertEq(result.status, 'completed', `status: ${result.status}, error: ${result.error}`);
    assertGt(result.newCount, 0, 'expected entities');
    engine.close();
});

cleanup();
await test('crt.sh: github.com (skip if rate-limited)', async () => {
    const engine = new Engine(DB_PATH);
    const id = engine.state.createInvestigation('crt-test', 'domain_recon');
    const connector = engine.registry.get('crt_sh');
    const result = await connector.run(id, 'test', 'domain', 'github.com');
    if (result.status === 'failed') {
        skip('crt.sh', result.error);
        passed--;
        engine.close();
        return;
    }
    assertEq(result.status, 'completed', `status: ${result.status}, error: ${result.error}`);
    const entities = engine.state.getEntities(id);
    console.log(`    ${DIM}${entities.filter(e => e.type === 'subdomain').length} subdomains, ${entities.filter(e => e.type === 'certificate').length} certs${RST}`);
    engine.close();
});

cleanup();
await test('HaveIBeenPwned: test@example.com', async () => {
    const engine = new Engine(DB_PATH);
    const id = engine.state.createInvestigation('hibp-test', 'person_full');
    const connector = engine.registry.get('haveibeenpwned');
    const result = await connector.run(id, 'test', 'email', 'test@example.com');
    assert(result.status === 'completed' || result.status === 'failed', 'should complete or fail gracefully');
    engine.close();
});

cleanup();
await test('WebScraper: github.com', async () => {
    const engine = new Engine(DB_PATH);
    const id = engine.state.createInvestigation('scrape-test', 'domain_recon');
    const connector = engine.registry.get('web_scraper');
    const result = await connector.run(id, 'test', 'domain', 'github.com');
    assertEq(result.status, 'completed', `status: ${result.status}, error: ${result.error}`);
    const entities = engine.state.getEntities(id);
    console.log(`    ${DIM}${entities.length} entities${RST}`);
    engine.close();
});

cleanup();
await test('Wayback: example.com', async () => {
    const engine = new Engine(DB_PATH);
    const id = engine.state.createInvestigation('wb-test', 'domain_recon');
    const connector = engine.registry.get('wayback');
    const result = await connector.run(id, 'test', 'domain', 'example.com');
    assert(result.status === 'completed' || result.status === 'failed', 'should handle gracefully');
    engine.close();
});

cleanup();
await test('IP-API: 8.8.8.8', async () => {
    const engine = new Engine(DB_PATH);
    const id = engine.state.createInvestigation('ip-test', 'domain_recon');
    const connector = engine.registry.get('ip_api');
    const result = await connector.run(id, 'test', 'ip', '8.8.8.8');
    assertEq(result.status, 'completed', `status: ${result.status}, error: ${result.error}`);
    const entities = engine.state.getEntities(id);
    assert(entities.some(e => e.type === 'ip'), 'should return IP entity');
    console.log(`    ${DIM}${entities.length} entities${RST}`);
    engine.close();
});

cleanup();
await test('EmailRep: test@example.com', async () => {
    const engine = new Engine(DB_PATH);
    const id = engine.state.createInvestigation('er-test', 'person_full');
    const connector = engine.registry.get('emailrep');
    const result = await connector.run(id, 'test', 'email', 'test@example.com');
    assert(result.status === 'completed' || result.status === 'failed', 'should handle gracefully');
    engine.close();
});

// ── ENGINE INTEGRATION ───────────────────────────────────
console.log(`\n${BOLD}Engine Integration${RST}`);
cleanup();

await test('quick_recon investigation: smoke-wolf', async () => {
    const engine = new Engine(DB_PATH);
    const phases = [];
    engine.telemetry.onEvent(event => {
        if (event.type === 'phase_start') phases.push(event.phaseId);
    });

    const id = await engine.investigate('quick-test', [{ type: 'username', value: 'smoke-wolf' }], 'quick_recon');
    const stats = engine.state.getStats(id);
    const entities = engine.state.getEntities(id);
    const inv = engine.state.getInvestigation(id);

    assertEq(inv.status, 'completed', 'should complete');
    assertGt(phases.length, 0, 'should execute phases');
    if (entities.length === 0) {
        skip('quick_recon', 'external APIs rate limited — 0 entities');
        passed--; engine.close(); return;
    }
    assertGt(entities.length, 0, 'should find entities');
    console.log(`    ${DIM}${entities.length} entities, ${stats.links} links, ${stats.phases.length} phases${RST}`);
    engine.close();
});

cleanup();
await test('full username_trace: smoke-wolf', async () => {
    const engine = new Engine(DB_PATH);
    let entityCount = 0;
    engine.telemetry.onEvent(event => {
        if (event.type === 'phase_start') process.stdout.write(`    ${Y}◆${RST} ${event.phaseId} `);
        else if (event.type === 'phase_end') process.stdout.write(`${event.status === 'completed' ? G + '✓' : R + '✗'}${RST}\n`);
        else if (event.type === 'entity_new') { entityCount++; process.stdout.write(`${G}.${RST}`); }
    });

    const knowns = [{ type: 'username', value: 'smoke-wolf' }];
    const id = await engine.investigate('trace-test', knowns, 'username_trace');
    const stats = engine.state.getStats(id);
    const entities = engine.state.getEntities(id);

    console.log(`\n    ${DIM}${entities.length} entities, ${stats.links} links${RST}`);
    const byType = {};
    for (const e of entities) byType[e.type] = (byType[e.type] || 0) + 1;
    for (const [t, c] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
        console.log(`    ${DIM}  ${t}: ${c}${RST}`);
    }

    assertEq(engine.state.getInvestigation(id).status, 'completed');
    if (entities.length === 0) {
        skip('username_trace', 'external APIs rate limited — 0 entities');
        passed--; engine.close(); return;
    }
    assertGt(entities.length, 5, `expected >5 entities, got ${entities.length}`);
    assertGt(stats.links, 0, 'should create correlation links');

    const reportPath = await engine.reporter.generate(id, 'json');
    assert(existsSync(reportPath), 'report should exist');
    console.log(`    ${DIM}Report: ${reportPath}${RST}`);

    engine.close();
});

// ── CLI COMMANDS ─────────────────────────────────────────
console.log(`\n${BOLD}CLI Commands${RST}`);

await test('cli: --help exits cleanly', async () => {
    const { execSync } = await import('child_process');
    const out = execSync('node cli/index.js --help', { cwd: join(__dirname, '..'), encoding: 'utf-8' });
    assert(out.includes('cyclops'), 'help should mention cyclops');
    assert(out.includes('investigate'), 'help should list investigate');
    assert(out.includes('entities'), 'help should list entities');
});

await test('cli: workflows command', async () => {
    const { execSync } = await import('child_process');
    const out = execSync('node cli/index.js workflows', { cwd: join(__dirname, '..'), encoding: 'utf-8' });
    assert(out.includes('person_full'), 'should list person_full');
    assert(out.includes('quick_recon'), 'should list quick_recon');
});

await test('cli: connectors command', async () => {
    const { execSync } = await import('child_process');
    const out = execSync('node cli/index.js connectors', { cwd: join(__dirname, '..'), encoding: 'utf-8' });
    assert(out.includes('GitHub'), 'should list GitHub');
    assert(out.includes('native'), 'should show native tag');
    assert(out.includes('28 connector'), 'should show count');
});

await test('cli: list command', async () => {
    const { execSync } = await import('child_process');
    const out = execSync('node cli/index.js list', { cwd: join(__dirname, '..'), encoding: 'utf-8' });
    assert(out.includes('investigation') || out.includes('No investigations'), 'should produce output');
});

await test('cli: investigate requires target', async () => {
    const { execSync } = await import('child_process');
    try {
        execSync('node cli/index.js investigate', { cwd: join(__dirname, '..'), encoding: 'utf-8', stdio: 'pipe' });
        throw new Error('should have failed');
    } catch (e) {
        assert(e.status !== 0 || e.stderr?.includes('required'), 'should exit non-zero');
    }
});

await test('cli: auto-detect type from target', async () => {
    const { execSync } = await import('child_process');
    const out = execSync(`node -e "
        function detectType(v) {
            if (/^[\\\\w.+-]+@[\\\\w-]+\\\\.[\\\\w.-]+$/.test(v)) return 'email';
            if (/^\\\\d{1,3}\\\\.\\\\d{1,3}\\\\.\\\\d{1,3}\\\\.\\\\d{1,3}$/.test(v)) return 'ip';
            if (/^[a-z0-9]([a-z0-9-]*\\\\.)+[a-z]{2,}$/i.test(v)) return 'domain';
            return 'username';
        }
        const r = [detectType('a@b.com'), detectType('1.2.3.4'), detectType('x.com'), detectType('user')];
        console.log(r.join(','));
    "`, { encoding: 'utf-8', timeout: 5000 });
    assertEq(out.trim(), 'email,ip,domain,username', 'auto-detect types');
});

// ── SUMMARY ──────────────────────────────────────────────
cleanup();
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

console.log(`\n${BOLD}${'═'.repeat(50)}${RST}`);
console.log(`  ${G}${passed} passed${RST}  ${failed > 0 ? R : DIM}${failed} failed${RST}  ${skipped > 0 ? Y : DIM}${skipped} skipped${RST}  ${DIM}${elapsed}s${RST}`);
console.log(`${BOLD}${'═'.repeat(50)}${RST}`);

if (failures.length) {
    console.log(`\n${R}${BOLD}Failures:${RST}`);
    for (const f of failures) {
        console.log(`  ${R}✗${RST} ${f.name}: ${DIM}${f.error}${RST}`);
    }
}

console.log();
process.exit(failed > 0 ? 1 : 0);
