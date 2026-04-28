import asyncio
import re
import sys

import click
from rich.console import Console
from rich.table import Table
from rich.live import Live
from rich.text import Text

from cyclops.core.engine import Engine

console = Console()


def detect_type(value: str) -> str:
    """
    Auto-detect the target type based on regex heuristics.
    
    Args:
        value: The target identifier to classify.
        
    Returns:
        The detected type (e.g. 'email', 'ip', 'domain', 'url', 'phone', or 'username').
    """
    if re.match(r'^[\w.+-]+@[\w-]+\.[\w.-]+$', value):
        return "email"
    if re.match(r'^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$', value):
        return "ip"
    if re.match(r'^[a-z0-9]([a-z0-9-]*\.)+[a-z]{2,}$', value, re.I):
        return "domain"
    if re.match(r'^https?://', value):
        return "url"
    if re.match(r'^\+?[\d\s()-]{7,}$', value):
        return "phone"
    return "username"


class DefaultGroup(click.Group):
    """Routes unknown first arguments to the hidden 'investigate' command."""
    def resolve_command(self, ctx, args):
        try:
            return super().resolve_command(ctx, args)
        except click.UsageError:
            return "investigate", self.get_command(ctx, "investigate"), list(args)


@click.group(cls=DefaultGroup, invoke_without_command=True)
@click.pass_context
def main(ctx):
    """CYCLOPS — Unified OSINT targeting pipeline."""
    if ctx.invoked_subcommand is None:
        click.echo(ctx.get_help())


@main.command(hidden=True)
@click.argument("target")
@click.option("-t", "--type", "input_type", help="Override auto-detected input type")
@click.option("-w", "--workflow", help="Override auto-selected workflow")
@click.option("-k", "--known", multiple=True, help="Extra knowns (type:value)")
def investigate(target, input_type, workflow, known):
    """Run an investigation on a target."""
    asyncio.run(_investigate(target, input_type, workflow, known))


async def _investigate(target, input_type, workflow, extra_knowns):
    if not input_type:
        input_type = detect_type(target)

    console.print(f"\n[bold red]CYCLOPS[/bold red] [dim]v2.0.0[/dim]")
    console.print(f"[bold]Target:[/bold] {target} [dim]({input_type})[/dim]")

    engine = Engine()
    knowns = [{"type": input_type, "value": target}]
    for k in extra_knowns:
        t, _, v = k.partition(":")
        if t and v:
            knowns.append({"type": t, "value": v})

    selected_wf = workflow or engine._pick_workflow(knowns)
    console.print(f"[bold]Workflow:[/bold] {selected_wf}\n")

    events = []
    entity_count = [0]

    def on_event(event):
        if event["type"] == "phase_start":
            console.print(f"  [yellow]◆[/yellow] {event['phaseId']}", end=" ")
        elif event["type"] == "phase_end":
            mark = "[green]✓[/green]" if event.get("status") == "completed" else "[red]✗[/red]"
            console.print(mark)
        elif event["type"] == "entity_new":
            entity_count[0] += 1
            sys.stdout.write(f"\033[32m.\033[0m")
            sys.stdout.flush()

    engine.telemetry.on_event(on_event)

    inv_id = await engine.investigate(target, knowns, workflow)
    stats = engine.state.get_stats(inv_id)
    entities = engine.state.get_entities(inv_id)

    console.print(f"\n  [bold green]{len(entities)}[/bold green] entities, [bold blue]{stats['links']}[/bold blue] links\n")

    by_type = {}
    for e in entities:
        by_type.setdefault(e["type"], []).append(e)
    for t, ents in sorted(by_type.items(), key=lambda x: -len(x[1])):
        console.print(f"  [dim]{t}: {len(ents)}[/dim]")

    report_path = engine.reporter.generate(inv_id, "json")
    console.print(f"\n  [dim]Report: {report_path}[/dim]")

    engine.close()


@main.command()
def connectors():
    """List all connectors."""
    engine = Engine()
    items = engine.registry.list()
    table = Table(title=f"CYCLOPS — {len(items)} connectors")
    table.add_column("Connector", style="bold")
    table.add_column("Type")
    table.add_column("Accepts")
    table.add_column("Native", justify="center")
    for item in items:
        native = "[green]✓[/green]" if item["native"] else "[dim]-[/dim]"
        table.add_row(item["name"], item["type"] or "", ", ".join(item["accepts"]), native)
    console.print(table)
    engine.close()


@main.command()
def workflows():
    """List available workflows."""
    engine = Engine()
    table = Table(title="Workflows")
    table.add_column("Name", style="bold")
    table.add_column("Description")
    table.add_column("Phases", justify="right")
    for key, wf in engine.workflows.items():
        table.add_row(key, wf.get("description", ""), str(len(wf.get("phases", []))))
    console.print(table)
    engine.close()


@main.command("list")
def list_investigations():
    """List all investigations."""
    engine = Engine()
    invs = engine.state.list_investigations()
    if not invs:
        console.print("[dim]No investigations found.[/dim]")
        engine.close()
        return
    table = Table(title="Investigations")
    table.add_column("ID", style="bold")
    table.add_column("Name")
    table.add_column("Workflow")
    table.add_column("Status")
    table.add_column("Created")
    for inv in invs:
        status_style = {"completed": "green", "running": "yellow", "failed": "red"}.get(inv["status"], "dim")
        table.add_row(inv["id"], inv["name"], inv["workflow"], f"[{status_style}]{inv['status']}[/{status_style}]", inv["created_at"][:19])
    console.print(table)
    engine.close()


@main.command()
@click.argument("inv_id")
@click.option("--type", "entity_type", help="Filter by entity type")
@click.option("--json", "as_json", is_flag=True, help="Output as JSON")
def entities(inv_id, entity_type, as_json):
    """Browse entities for an investigation."""
    import json as json_mod
    engine = Engine()
    ents = engine.state.get_entities(inv_id, entity_type)
    if as_json:
        click.echo(json_mod.dumps([{"type": e["type"], "data": e["data"], "confidence": e["confidence"]} for e in ents], indent=2))
    else:
        table = Table(title=f"Entities ({len(ents)})")
        table.add_column("Type", style="bold")
        table.add_column("Data")
        table.add_column("Confidence", justify="right")
        for e in ents:
            summary = ", ".join(f"{k}: {v}" for k, v in e["data"].items() if v and k != "source")[:80]
            table.add_row(e["type"], summary, f"{e['confidence']:.0%}")
        console.print(table)
    engine.close()


@main.command()
@click.argument("inv_id")
@click.option("--format", "fmt", default="json", type=click.Choice(["json", "html", "markdown"]))
def report(inv_id, fmt):
    """Generate a report."""
    engine = Engine()
    path = engine.reporter.generate(inv_id, fmt)
    console.print(f"[green]Report generated:[/green] {path}")
    engine.close()


if __name__ == "__main__":
    main()
