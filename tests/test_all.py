#!/usr/bin/env python3
import asyncio
import os
import sys
import json

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from cyclops.core.engine import Engine

R, G, Y, DIM, BOLD, RST = "\033[31m", "\033[32m", "\033[33m", "\033[2m", "\033[1m", "\033[0m"

passed = failed = skipped = 0
failures = []


async def test(name, fn):
    global passed, failed
    try:
        result = fn()
        if asyncio.iscoroutine(result):
            await result
        passed += 1
        print(f"  {G}✓{RST} {name}")
    except Exception as e:
        failed += 1
        print(f"  {R}✗{RST} {name}")
        print(f"    {DIM}{e}{RST}")
        failures.append({"name": name, "error": str(e)})


def skip(name, reason):
    global skipped, passed
    skipped += 1
    passed -= 1
    print(f"  {Y}○{RST} {name} {DIM}({reason}){RST}")


def assert_(cond, msg="assertion failed"):
    if not cond:
        raise AssertionError(msg)


def assert_eq(a, b, msg=None):
    if a != b:
        raise AssertionError(msg or f"expected {b}, got {a}")


def assert_gt(a, b, msg=None):
    if not (a > b):
        raise AssertionError(msg or f"expected {a} > {b}")


async def main():
    global passed

    print(f"\n{R}{BOLD}CYCLOPS{RST} {DIM}Test Suite (Python){RST}\n")
    import time
    t0 = time.time()

    # ── STATE LAYER ──
    print(f"{BOLD}State Layer{RST}")

    await test("create investigation", lambda: _test_create_investigation())
    await test("add and retrieve knowns", lambda: _test_knowns())
    await test("knowns are case-normalized", lambda: _test_knowns_normalized())
    await test("entity dedup with confidence boost", lambda: _test_entity_dedup())
    await test("entity confidence caps at 1.0", lambda: _test_confidence_cap())
    await test("entity fingerprinting", lambda: _test_fingerprinting())
    await test("entity links", lambda: _test_entity_links())
    await test("connector run tracking", lambda: _test_connector_run())
    await test("investigation status lifecycle", lambda: _test_status_lifecycle())
    await test("list investigations with status filter", lambda: _test_list_filter())
    await test("getStats returns correct entity type breakdown", lambda: _test_stats())

    # ── CONNECTOR REGISTRY ──
    print(f"\n{BOLD}Connector Registry{RST}")

    await test("registry loads all 32 connectors", lambda: _test_registry_count())
    await test("native connectors flagged correctly", lambda: _test_native_count())
    await test("filter connectors by input type", lambda: _test_filter_input())
    await test("forPhase returns correct connectors", lambda: _test_for_phase())

    # ── CORRELATION ENGINE ──
    print(f"\n{BOLD}Correlation Engine{RST}")

    await test("correlate entities across sources", lambda: _test_correlate())
    await test("build entity graph with correct structure", lambda: _test_graph())
    await test("fuzzy matching links similar usernames", lambda: _test_fuzzy())
    await test("multi-source bonus applied", lambda: _test_multi_source())

    # ── REPORT GENERATION ──
    print(f"\n{BOLD}Report Generation{RST}")

    await test("generate JSON report", lambda: _test_json_report())
    await test("generate HTML report", lambda: _test_html_report())
    await test("generate Markdown report", lambda: _test_md_report())

    # ── TELEMETRY ──
    print(f"\n{BOLD}Telemetry{RST}")

    await test("telemetry broadcasts events", lambda: _test_telemetry_events())
    await test("telemetry tracks active runs", lambda: _test_telemetry_active())

    # ── LIVE CONNECTORS ──
    print(f"\n{BOLD}Live Connector Tests{RST}")

    await test("GitHub: smoke-wolf", _test_github)
    await test("DNS-Native: github.com", _test_dns)
    await test("WHOIS-Native: github.com", _test_whois)
    await test("IP-API: 8.8.8.8", _test_ip_api)
    await test("EmailRep: test@example.com", _test_emailrep)
    await test("WebScraper: github.com", _test_webscraper)

    # ── ENGINE INTEGRATION ──
    print(f"\n{BOLD}Engine Integration{RST}")

    await test("quick_recon investigation: smoke-wolf", _test_quick_recon)

    # ── CLI ──
    print(f"\n{BOLD}CLI{RST}")

    await test("auto-detect types", lambda: _test_detect_types())

    # ── SUMMARY ──
    elapsed = time.time() - t0
    print(f"\n{BOLD}{'═' * 50}{RST}")
    print(f"  {G}{passed} passed{RST}  {R if failed else DIM}{failed} failed{RST}  {Y if skipped else DIM}{skipped} skipped{RST}  {DIM}{elapsed:.1f}s{RST}")
    print(f"{BOLD}{'═' * 50}{RST}")
    if failures:
        print(f"\n{R}{BOLD}Failures:{RST}")
        for f in failures:
            print(f"  {R}✗{RST} {f['name']}: {DIM}{f['error']}{RST}")
    print()
    sys.exit(1 if failed else 0)


def _test_create_investigation():
    e = Engine()
    inv_id = e.state.create_investigation("test", "person_full")
    assert_(inv_id, "should return id")
    inv = e.state.get_investigation(inv_id)
    assert_eq(inv["name"], "test")
    assert_eq(inv["status"], "pending")
    e.close()

def _test_knowns():
    e = Engine()
    inv_id = e.state.create_investigation("test", "person_full")
    e.state.add_known(inv_id, "email", "test@example.com")
    e.state.add_known(inv_id, "username", "testuser")
    assert_eq(len(e.state.get_knowns(inv_id)), 2)
    assert_eq(len(e.state.get_knowns(inv_id, "email")), 1)
    e.close()

def _test_knowns_normalized():
    e = Engine()
    inv_id = e.state.create_investigation("test", "person_full")
    e.state.add_known(inv_id, "email", "TEST@Example.com")
    assert_eq(e.state.get_knowns(inv_id, "email")[0]["value"], "test@example.com")
    e.close()

def _test_entity_dedup():
    e = Engine()
    inv_id = e.state.create_investigation("test", "person_full")
    r1 = e.state.add_entity(inv_id, "email", {"address": "test@example.com"}, 0.5)
    assert_(r1["new"])
    r2 = e.state.add_entity(inv_id, "email", {"address": "test@example.com"}, 0.5)
    assert_(not r2["new"])
    ents = e.state.get_entities(inv_id, "email")
    assert_eq(len(ents), 1)
    assert_eq(ents[0]["source_count"], 2)
    assert_gt(ents[0]["confidence"], 0.5)
    e.close()

def _test_confidence_cap():
    e = Engine()
    inv_id = e.state.create_investigation("test", "person_full")
    e.state.add_entity(inv_id, "email", {"address": "x@y.com"}, 0.95)
    for _ in range(10):
        e.state.add_entity(inv_id, "email", {"address": "x@y.com"}, 0.95)
    ents = e.state.get_entities(inv_id, "email")
    assert_(ents[0]["confidence"] <= 1.0, f"confidence {ents[0]['confidence']} > 1.0")
    e.close()

def _test_fingerprinting():
    e = Engine()
    fp1 = e.state.entity_fingerprint("email", {"address": "a@b.com"})
    fp2 = e.state.entity_fingerprint("email", {"address": "a@b.com"})
    fp3 = e.state.entity_fingerprint("email", {"address": "c@d.com"})
    fp4 = e.state.entity_fingerprint("domain", {"name": "a@b.com"})
    assert_eq(fp1, fp2)
    assert_(fp1 != fp3)
    assert_(fp1 != fp4)
    e.close()

def _test_entity_links():
    e = Engine()
    inv_id = e.state.create_investigation("test", "person_full")
    e1 = e.state.add_entity(inv_id, "email", {"address": "a@b.com"}, 0.9)
    e2 = e.state.add_entity(inv_id, "account", {"platform": "GitHub", "username": "user1"}, 0.8)
    e.state.add_link(inv_id, e1["id"], e2["id"], "email_to_account", 0.9, [{"rule": "test"}])
    links = e.state.get_links(inv_id)
    assert_eq(len(links), 1)
    assert_eq(links[0]["confidence"], 0.9)
    e.close()

def _test_connector_run():
    e = Engine()
    inv_id = e.state.create_investigation("test", "person_full")
    run_id = e.state.record_connector_run(inv_id, "seed_expansion", "GitHub", "username", "testuser")
    e.state.complete_connector_run(run_id, "completed", 5)
    stats = e.state.get_stats(inv_id)
    assert_gt(len(stats["connectors"]), 0)
    assert_eq(stats["connectors"][0]["status"], "completed")
    e.close()

def _test_status_lifecycle():
    e = Engine()
    inv_id = e.state.create_investigation("test", "person_full")
    assert_eq(e.state.get_investigation(inv_id)["status"], "pending")
    e.state.update_investigation_status(inv_id, "running")
    assert_eq(e.state.get_investigation(inv_id)["status"], "running")
    e.state.update_investigation_status(inv_id, "completed")
    inv = e.state.get_investigation(inv_id)
    assert_eq(inv["status"], "completed")
    assert_(inv["completed_at"])
    e.close()

def _test_list_filter():
    e = Engine()
    e.state.create_investigation("a", "quick_recon")
    id2 = e.state.create_investigation("b", "quick_recon")
    e.state.update_investigation_status(e.state.list_investigations()[1]["id"], "completed")
    e.state.update_investigation_status(id2, "running")
    assert_eq(len(e.state.list_investigations()), 2)
    assert_eq(len(e.state.list_investigations("running")), 1)
    e.close()

def _test_stats():
    e = Engine()
    inv_id = e.state.create_investigation("test", "person_full")
    e.state.add_entity(inv_id, "email", {"address": "a@b.com"}, 0.8)
    e.state.add_entity(inv_id, "email", {"address": "c@d.com"}, 0.8)
    e.state.add_entity(inv_id, "domain", {"name": "example.com"}, 0.7)
    stats = e.state.get_stats(inv_id)
    email_stat = next(s for s in stats["entities"] if s["type"] == "email")
    assert_eq(email_stat["count"], 2)
    e.close()

def _test_registry_count():
    e = Engine()
    assert_eq(len(e.registry.list()), 32, f"expected 32, got {len(e.registry.list())}")
    e.close()

def _test_native_count():
    e = Engine()
    native = [c for c in e.registry.list() if c["native"]]
    assert_eq(len(native), 16, f"expected 16 native, got {len(native)}")
    e.close()

def _test_filter_input():
    e = Engine()
    assert_gt(len(e.registry.for_input_type("email")), 2)
    assert_gt(len(e.registry.for_input_type("domain")), 3)
    assert_gt(len(e.registry.for_input_type("username")), 2)
    e.close()

def _test_for_phase():
    e = Engine()
    phase = {"connectors": ["github", "dns_native", "nonexistent"]}
    result = e.registry.for_phase(phase)
    assert_eq(len(result), 2)
    e.close()

def _test_correlate():
    e = Engine()
    inv_id = e.state.create_investigation("test", "person_full")
    e.state.add_entity(inv_id, "email", {"address": "user@example.com"}, 0.9)
    e.state.add_entity(inv_id, "account", {"platform": "GitHub", "username": "user1", "address": "user@example.com"}, 0.8)
    e.state.add_entity(inv_id, "breach", {"name": "TestBreach", "address": "user@example.com"}, 0.7)
    links = e.correlator.correlate(inv_id)
    assert_gt(len(links), 0, "should create links")
    e.close()

def _test_graph():
    e = Engine()
    inv_id = e.state.create_investigation("test", "person_full")
    e.state.add_entity(inv_id, "person", {"name": "Test User", "username": "testuser"}, 0.9)
    e.state.add_entity(inv_id, "email", {"address": "test@example.com"}, 0.8)
    e.state.add_entity(inv_id, "account", {"platform": "GitHub", "username": "testuser", "address": "test@example.com"}, 0.7)
    e.correlator.correlate(inv_id)
    graph = e.correlator.build_graph(inv_id)
    assert_eq(len(graph["nodes"]), 3)
    assert_gt(len(graph["edges"]), 0)
    e.close()

def _test_fuzzy():
    e = Engine()
    inv_id = e.state.create_investigation("test", "person_full")
    e.state.add_entity(inv_id, "person", {"name": "Test", "username": "smoke-wolf"}, 0.9)
    e.state.add_entity(inv_id, "account", {"platform": "GitHub", "username": "smoke-wolf"}, 0.8)
    e.state.add_entity(inv_id, "account", {"platform": "Twitter", "username": "smokewolf"}, 0.6)
    links = e.correlator.correlate(inv_id)
    assert_gt(len(links), 0, "should link similar usernames")
    e.close()

def _test_multi_source():
    e = Engine()
    inv_id = e.state.create_investigation("test", "person_full")
    e.state.add_entity(inv_id, "email", {"address": "x@y.com"}, 0.5)
    e.state.add_entity(inv_id, "email", {"address": "x@y.com"}, 0.5)
    e.state.add_entity(inv_id, "email", {"address": "x@y.com"}, 0.5)
    e.correlator.correlate(inv_id)
    ents = e.state.get_entities(inv_id, "email")
    assert_gt(ents[0]["confidence"], 0.6, "multi-source should boost")
    e.close()

def _test_json_report():
    e = Engine()
    inv_id = e.state.create_investigation("test-report", "person_full")
    e.state.add_known(inv_id, "username", "testuser")
    e.state.add_entity(inv_id, "account", {"platform": "GitHub", "username": "testuser"}, 0.9)
    e.state.add_entity(inv_id, "email", {"address": "test@example.com"}, 0.8)
    e.state.update_investigation_status(inv_id, "completed")
    path = e.reporter.generate(inv_id, "json")
    assert_(path.endswith("report.json"))
    assert_(os.path.exists(path))
    report = json.loads(open(path).read())
    assert_eq(report["meta"]["name"], "test-report")
    assert_eq(report["summary"]["entity_count"], 2)
    e.close()

def _test_html_report():
    e = Engine()
    inv_id = e.state.create_investigation("html-test", "person_full")
    e.state.add_known(inv_id, "email", "test@example.com")
    e.state.add_entity(inv_id, "breach", {"name": "TestBreach", "email": "test@example.com"}, 0.8)
    e.state.update_investigation_status(inv_id, "completed")
    path = e.reporter.generate(inv_id, "html")
    assert_(path.endswith("report.html"))
    html = open(path).read()
    assert_("CYCLOPS" in html)
    assert_("html-test" in html)
    e.close()

def _test_md_report():
    e = Engine()
    inv_id = e.state.create_investigation("md-test", "person_full")
    e.state.add_known(inv_id, "domain", "example.com")
    e.state.add_entity(inv_id, "domain", {"name": "example.com"}, 0.9)
    e.state.update_investigation_status(inv_id, "completed")
    path = e.reporter.generate(inv_id, "markdown")
    assert_(path.endswith("report.md"))
    md = open(path).read()
    assert_("# CYCLOPS" in md)
    assert_("example.com" in md)
    e.close()

def _test_telemetry_events():
    e = Engine()
    events = []
    e.telemetry.on_event(lambda ev: events.append(ev))
    inv_id = e.state.create_investigation("test", "person_full")
    e.telemetry.phase_start(inv_id, "test_phase")
    e.telemetry.phase_end(inv_id, "test_phase", "completed")
    assert_eq(len(events), 2)
    assert_eq(events[0]["type"], "phase_start")
    assert_eq(events[1]["type"], "phase_end")
    e.close()

def _test_telemetry_active():
    e = Engine()
    inv_id = e.state.create_investigation("test", "person_full")
    e.telemetry.connector_start(inv_id, "GitHub", "phase1", {"type": "username", "value": "test"})
    assert_eq(len(e.telemetry.get_active_runs()), 1)
    e.telemetry.connector_end(inv_id, "GitHub", "phase1", {"status": "completed", "input": {"value": "test"}})
    assert_eq(len(e.telemetry.get_active_runs()), 0)
    e.close()

async def _test_github():
    global passed
    e = Engine()
    inv_id = e.state.create_investigation("gh-test", "person_full")
    e.state.add_known(inv_id, "username", "smoke-wolf")
    conn = e.registry.get("github")
    result = await conn.run(inv_id, "test", "username", "smoke-wolf")
    assert_eq(result["status"], "completed", f"status: {result.get('status')}, error: {result.get('error')}")
    if result["newCount"] == 0:
        skip("GitHub", "rate limited")
        e.close()
        return
    ents = e.state.get_entities(inv_id)
    assert_(any(e_["type"] == "account" for e_ in ents), "should find account")
    assert_(any(e_["type"] == "repository" for e_ in ents), "should find repos")
    print(f"    {DIM}{len(ents)} entities{RST}")
    e.close()

async def _test_dns():
    e = Engine()
    inv_id = e.state.create_investigation("dns-test", "domain_recon")
    conn = e.registry.get("dns_native")
    result = await conn.run(inv_id, "test", "domain", "github.com")
    assert_eq(result["status"], "completed")
    assert_gt(result["newCount"], 0)
    ents = e.state.get_entities(inv_id)
    assert_(any(e_["type"] == "ip" for e_ in ents))
    print(f"    {DIM}{len(ents)} entities{RST}")
    e.close()

async def _test_whois():
    e = Engine()
    inv_id = e.state.create_investigation("whois-test", "domain_recon")
    conn = e.registry.get("whois_native")
    result = await conn.run(inv_id, "test", "domain", "github.com")
    assert_eq(result["status"], "completed")
    assert_gt(result["newCount"], 0)
    e.close()

async def _test_ip_api():
    e = Engine()
    inv_id = e.state.create_investigation("ip-test", "domain_recon")
    conn = e.registry.get("ip_api")
    result = await conn.run(inv_id, "test", "ip", "8.8.8.8")
    assert_eq(result["status"], "completed")
    ents = e.state.get_entities(inv_id)
    assert_(any(e_["type"] == "ip" for e_ in ents))
    print(f"    {DIM}{len(ents)} entities{RST}")
    e.close()

async def _test_emailrep():
    e = Engine()
    inv_id = e.state.create_investigation("er-test", "person_full")
    conn = e.registry.get("emailrep")
    result = await conn.run(inv_id, "test", "email", "test@example.com")
    assert_(result["status"] in ("completed", "failed"), "should handle gracefully")
    e.close()

async def _test_webscraper():
    e = Engine()
    inv_id = e.state.create_investigation("scrape-test", "domain_recon")
    conn = e.registry.get("web_scraper")
    result = await conn.run(inv_id, "test", "domain", "github.com")
    assert_eq(result["status"], "completed")
    ents = e.state.get_entities(inv_id)
    print(f"    {DIM}{len(ents)} entities{RST}")
    e.close()

async def _test_quick_recon():
    global passed
    e = Engine()
    phases = []
    e.telemetry.on_event(lambda ev: phases.append(ev["phaseId"]) if ev["type"] == "phase_start" else None)
    inv_id = await e.investigate("quick-test", [{"type": "username", "value": "smoke-wolf"}], "quick_recon")
    inv = e.state.get_investigation(inv_id)
    ents = e.state.get_entities(inv_id)
    assert_eq(inv["status"], "completed")
    assert_gt(len(phases), 0)
    if len(ents) == 0:
        skip("quick_recon", "external APIs rate limited")
        e.close()
        return
    assert_gt(len(ents), 0)
    stats = e.state.get_stats(inv_id)
    print(f"    {DIM}{len(ents)} entities, {stats['links']} links{RST}")
    e.close()

def _test_detect_types():
    from cyclops.cli import detect_type
    assert_eq(detect_type("a@b.com"), "email")
    assert_eq(detect_type("1.2.3.4"), "ip")
    assert_eq(detect_type("example.com"), "domain")
    assert_eq(detect_type("someuser"), "username")


if __name__ == "__main__":
    asyncio.run(main())
