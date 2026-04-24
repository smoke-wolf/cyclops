# CYCLOPS

Unified OSINT targeting pipeline. Config-driven orchestration across 25 connectors in parallel — entity graph correlation, fuzzy matching, multi-source confidence scoring, and autonomous report generation.

Enter knowns. Get intelligence.

![investigation](assets/investigate.svg)

## Quick Start

```bash
npm install
cyclops investigate john_doe -t username -w username_trace --known email:john@example.com
```

That's it. CYCLOPS fans out across every available connector, builds an entity graph, correlates across sources, and generates a report.

## CLI

![help](assets/help.svg)

| Command | Description |
|---------|-------------|
| `investigate <name> -t <type> -w <workflow>` | Run investigation with live progress |
| `list` | All investigations with status |
| `status <id>` | Full investigation breakdown |
| `entities <id>` | Browse, search, filter entities |
| `graph <id>` | Entity link tree |
| `report <id>` | Generate report (json, html, md) |
| `export <id>` | Export data (json, csv, ndjson) |
| `connectors` | List connectors (`--health`, `--native`) |
| `workflows` | Available workflows |
| `purge <id>` | Delete investigation (`--all`) |
| `serve` | Start dashboard server |

## Architecture

```
CLI / API ──▶ Engine (DAG) ──▶ Connectors (25) ──▶ External OSINT Sources
                  │                    │
            Correlator            Telemetry
            (linking,             (SSE, WS,
             scoring)              SQLite)
                  │
             Reporter
           (JSON, HTML, MD)
```

The engine resolves workflow phases as a DAG — connectors within each phase run in parallel, and each phase's output feeds the next as input. Entity dedup uses SHA-256 fingerprinting. Correlation uses Levenshtein fuzzy matching with configurable thresholds. Multi-source corroboration boosts confidence scores.

## Connectors

![connectors](assets/connectors.svg)

### Native (9) — zero dependencies, always available

| Connector | Accepts | Outputs |
|-----------|---------|---------|
| GitHub | username | accounts, repos, emails, orgs, collaborators, gists |
| DNS-Native | domain | IPs, subdomains, records, SPF/DMARC emails |
| WHOIS-Native | domain | registrar, nameservers, contacts, dates |
| crt.sh | domain | subdomains, certificates (CT logs) |
| HaveIBeenPwned | email | breaches, pastes |
| WebScraper | url, domain | emails, social accounts, phones, tech stack |
| Wayback Machine | domain | archived URLs, interesting files, API endpoints |
| IP-API | ip | geolocation, ASN, reverse DNS, proxy detection |
| EmailRep | email | reputation, profiles, breach flags |

### Binary (16) — auto-skipped if not installed

| Connector | Install |
|-----------|---------|
| Sherlock | `pip3 install sherlock-project` |
| Holehe | `pip3 install holehe` |
| Maigret | `pip3 install maigret` |
| theHarvester | `pip3 install theHarvester` |
| Amass | `go install github.com/owasp-amass/amass/v4/...@master` |
| Subfinder | `go install github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest` |
| Shodan | `pip3 install shodan` |
| Censys | `pip3 install censys` |
| PhoneInfoga | `go install github.com/sundowndev/phoneinfoga/v2@latest` |
| h8mail | `pip3 install h8mail` |
| WhatsMyName | `pip3 install whatsmyname` |
| socialscan | `pip3 install socialscan` |
| Photon | `pip3 install photon` |
| GHunt | `pip3 install ghunt` |
| Nmap | `brew install nmap` |
| DNSrecon | `pip3 install dnsrecon` |

Health checks run on startup. Failed binaries are silently skipped. Native connectors always run.

## Workflows

![workflows](assets/workflows.svg)

| Workflow | Phases | Description |
|----------|--------|-------------|
| `person_full` | 6 | Full person investigation — expansion, breach check, infrastructure, deep profiling, correlation, reporting |
| `domain_recon` | 6 | Infrastructure + personnel from a domain — subdomains, services, personnel, email enum, correlation, reporting |
| `username_trace` | 5 | Cross-platform username trace — platform search, profile scrape, identity pivot, correlation, reporting |
| `quick_recon` | 2 | 60-second surface sweep |

## Entity Graph

![graph](assets/graph.svg)

The correlation engine links entities across connectors using configurable rules and Levenshtein fuzzy matching. Multi-source corroboration automatically boosts confidence.

**16 entity types:** person, account, email, domain, subdomain, ip, port, certificate, breach, credential, phone, url, dns_record, repository, organization, technology

## Entity Browser

![entities](assets/entities.svg)

Filter by type, search by value, sort by confidence. Grouped view shows entities by category with inline detail.

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/investigate` | Launch (blocking) |
| POST | `/api/investigate/async` | Launch (non-blocking) |
| GET | `/api/investigations` | List all |
| GET | `/api/investigation/:id` | Status + stats |
| GET | `/api/investigation/:id/entities` | Entity list |
| GET | `/api/investigation/:id/graph` | Entity graph |
| GET | `/api/investigation/:id/report?format=html` | Report |
| POST | `/api/investigation/:id/abort` | Abort |
| GET | `/api/connectors` | Connector list + health |
| GET | `/api/workflows` | Workflow list |
| GET | `/api/events` | SSE event stream |

## Configuration

All behavior is config-driven. No code changes needed.

- `config/connectors.json` — connector definitions, timeouts, input caps
- `config/workflows.json` — workflow phases, dependencies, connector assignments
- `config/correlation.json` — entity types, linking rules, scoring thresholds

## API Keys (Optional)

```bash
export GITHUB_TOKEN=...        # 60 → 5000 req/hr
export SHODAN_API_KEY=...
export CENSYS_API_ID=...
export CENSYS_API_SECRET=...
export HIBP_API_KEY=...
export EMAILREP_API_KEY=...
```

## Testing

![tests](assets/tests.svg)

```bash
node test/run.js           # 40 tests: state, registry, correlation, reports, telemetry, live connectors, engine, CLI
node test/deep_recon.js    # full investigation with telemetry output
```

40 tests covering every layer — state management, connector registry, correlation engine, report generation, telemetry broadcasting, live connector integration (GitHub, DNS, WHOIS, crt.sh, HIBP, WebScraper, Wayback, IP-API, EmailRep), engine workflow execution, and CLI commands.

## License

MIT
