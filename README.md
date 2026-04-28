<p align="center">
  <img src="assets/demo.svg" alt="CYCLOPS demo" width="700"/>
</p>

<h1 align="center">CYCLOPS</h1>

<p align="center">
  <b>Unified OSINT targeting pipeline</b><br/>
  <sub>32 connectors &bull; entity graph correlation &bull; auto-reporting</sub>
</p>

<p align="center">
  <a href="https://github.com/smoke-wolf/cyclops/actions"><img src="https://github.com/smoke-wolf/cyclops/actions/workflows/test.yml/badge.svg" alt="Tests"/></a>
  <a href="https://www.python.org/"><img src="https://img.shields.io/badge/python-3.9+-blue.svg" alt="Python 3.9+"/></a>
  <a href="https://github.com/smoke-wolf/cyclops/blob/main/LICENSE"><img src="https://img.shields.io/github/license/smoke-wolf/cyclops" alt="License"/></a>
  <a href="https://github.com/smoke-wolf/cyclops/stargazers"><img src="https://img.shields.io/github/stars/smoke-wolf/cyclops?style=social" alt="Stars"/></a>
</p>

---

One target in, full intelligence out. CYCLOPS auto-detects your input (email, domain, IP, URL, phone, username), picks the right workflow, runs connectors in parallel, correlates entities across sources, and drops a report.

## Quick Start

```bash
pip install -e git+https://github.com/smoke-wolf/cyclops.git#egg=cyclops-osint

# or clone and install
git clone https://github.com/smoke-wolf/cyclops.git
cd cyclops
pip install -e .
```

```bash
# Investigate a domain
cyclops example.com

# Investigate a username
cyclops johndoe

# Investigate an email
cyclops target@company.com

# Investigate an IP
cyclops 8.8.8.8
```

### Docker

```bash
docker build -t cyclops .
docker run --rm cyclops example.com
```

## How It Works

```
target ──► auto-detect type ──► select workflow ──► run phases (parallel)
                                                         │
              report ◄── correlate ◄── deduplicate ◄── entities
```

1. **Input** — pass any target, CYCLOPS detects the type
2. **Workflow** — DAG-based engine picks the right phases and resolves dependencies
3. **Connectors** — each phase runs its connectors in parallel via `asyncio`
4. **Entities** — results are deduplicated with SHA-256 fingerprints, confidence-scored
5. **Correlation** — cross-source linking with fuzzy matching (Levenshtein)
6. **Report** — JSON, HTML, or Markdown

## Connectors

32 connectors — 16 native (built-in async HTTP, zero install) + 16 binary (auto-detected, skipped if not installed).

<details>
<summary><b>Native connectors (16)</b> — work out of the box</summary>

| Connector | Type | Accepts | API Key |
|-----------|------|---------|---------|
| GitHub | code_platform | username | Optional |
| DNS-Native | dns_enum | domain | — |
| WHOIS-Native | domain_registration | domain | — |
| crt.sh | certificate_transparency | domain | — |
| HaveIBeenPwned | breach_lookup | email | Optional |
| WebScraper | web_intelligence | domain, url | — |
| Wayback Machine | historical_archive | domain | — |
| IP-API | ip_geolocation | ip | Optional |
| EmailRep | email_reputation | email | Optional |
| Hunter | email_finder | domain, email | Required |
| VirusTotal | threat_intelligence | domain, ip, url | Required |
| SecurityTrails | dns_intelligence | domain, ip | Required |
| Shodan InternetDB | ip_recon | ip | — |
| AlienVault OTX | threat_intelligence | domain, ip, url | Optional |
| AbuseIPDB | ip_reputation | ip | Required |
| URLScan | url_intelligence | domain, url | Optional |

</details>

<details>
<summary><b>Binary connectors (16)</b> — auto-detected from PATH</summary>

| Connector | Type | Accepts |
|-----------|------|---------|
| Sherlock | username_enum | username |
| Holehe | email_enum | email |
| Maigret | username_deep | username |
| theHarvester | domain_recon | domain |
| Amass | subdomain_enum | domain |
| Subfinder | subdomain_enum | domain |
| Shodan CLI | ip_recon | ip, domain |
| Censys | cert_recon | domain, ip |
| PhoneInfoga | phone_recon | phone |
| h8mail | breach_lookup | email |
| WhatsMyName | username_enum | username |
| socialscan | availability_check | username, email |
| Photon | web_crawler | url, domain |
| GHunt | google_osint | email |
| Nmap | port_scan | ip, domain |
| DNSrecon | dns_enum | domain |

</details>

## Workflows

| Workflow | Description | Phases |
|----------|-------------|--------|
| `person_full` | Complete profile from any person identifier | 6 |
| `domain_recon` | Full infrastructure + personnel enumeration | 6 |
| `username_trace` | Trace username across platforms, extract linked identities | 5 |
| `quick_recon` | Fast surface sweep — 60 seconds max | 2 |

Override with `-w`:

```bash
cyclops example.com -w quick_recon
```

## API Keys

Set as environment variables. Only connectors with required keys need them — everything else works without configuration.

```bash
export GITHUB_TOKEN=ghp_...
export VIRUSTOTAL_API_KEY=...
export HUNTER_API_KEY=...
export SECURITYTRAILS_API_KEY=...
export ABUSEIPDB_API_KEY=...
export SHODAN_API_KEY=...
export HIBP_API_KEY=...
```

## Commands

```bash
cyclops <target>              # investigate (auto-detect type)
cyclops <target> -t domain    # override detected type
cyclops <target> -w quick_recon  # override workflow
cyclops connectors            # list all 32 connectors
cyclops workflows             # list available workflows
cyclops list                  # list past investigations
cyclops entities <id>         # browse entities from an investigation
cyclops entities <id> --type domain  # browse specific entities
cyclops entities <id> --json  # export entities as JSON
cyclops report <id> --format html  # generate HTML report
```

## Architecture

```
cyclops/
├── cli.py                 # click CLI + auto-detect
├── core/
│   ├── engine.py          # DAG workflow engine (asyncio)
│   ├── state.py           # SQLite + WAL, entity fingerprinting
│   └── telemetry.py       # event broadcasting
├── connectors/
│   ├── base.py            # BaseConnector + BinaryConnector
│   ├── registry.py        # config-driven loader
│   ├── github.py          # ... 16 native connectors
│   └── ...
├── correlate/
│   └── linker.py          # Levenshtein fuzzy matching, graph builder
└── reporting/
    └── generator.py       # JSON / HTML / Markdown
```

## Contributing

PRs welcome. To add a connector:

1. Create `cyclops/connectors/your_connector.py` extending `BaseConnector` or `BinaryConnector`
2. Add entry to `config/connectors.json`
3. Add to `CONNECTOR_MAP` in `cyclops/connectors/registry.py`
4. Add to relevant workflow phases in `config/workflows.json`

## License

MIT
