"""Top-level commands for reproducible generation, verification and execution."""

from pathlib import Path

import typer

from cctbench.canonicalize import strict_json_loads
from cctbench.eval.harness import json_write, jsonl_write, run_benchmark
from cctbench.generator.dataset import generate_dataset
from cctbench.schema.fixture import LineageBenchFixture
from cctbench.verifier.cct import verify_cognitive_continuity

app = typer.Typer(add_completion=False, no_args_is_help=True)


@app.command()
def benchmark(
    output_dir: Path = Path("results"),
    fixtures_dir: Path = Path("fixtures"),
    report_path: Path = Path("docs/evaluation-results.md"),
    seed: int = 20260904,
    development_identities: int = 4,
    evaluation_identities: int = 8,
    epochs: int = 3,
    bootstrap_samples: int = 1000,
    embedding_backend: str = "hashing",
    embedding_dimensions: int = 256,
    sit_config: Path | None = None,
    overhead_repeats: int = 5,
    overhead_warmups: int = 2,
):
    """Regenerate and execute all local benchmark stages, excluding unconfigured external models."""
    run_benchmark(
        output_dir,
        fixtures_dir,
        report_path,
        seed,
        development_identities,
        evaluation_identities,
        epochs,
        bootstrap_samples,
        embedding_backend,
        embedding_dimensions,
        strict_json_loads(sit_config.read_text()) if sit_config else None,
        overhead_repeats,
        overhead_warmups,
    )


@app.command()
def verify(fixture_path: Path, fixture_id: str | None = None):
    """Verify one frozen JSON fixture, or select an ID from generated.jsonl."""
    if fixture_path.suffix == ".jsonl":
        if fixture_id is None:
            raise typer.BadParameter("--fixture-id is required for JSONL")
        with fixture_path.open() as stream:
            data = next(
                (
                    item
                    for line in stream
                    if (item := strict_json_loads(line))["fixture_id"] == fixture_id
                ),
                None,
            )
        if data is None:
            raise typer.BadParameter("Fixture ID not found")
    else:
        data = strict_json_loads(fixture_path.read_text())
    f = LineageBenchFixture.model_validate(data)
    report = verify_cognitive_continuity(
        f.predecessor_state,
        f.transition_witness,
        f.candidate_successor,
        f.policy,
        f.verification_context,
    )
    print(report.model_dump_json(indent=2))


@app.command()
def generate_fixtures(
    output_dir: Path = Path("fixtures"),
    seed: int = 20260904,
    development_identities: int = 4,
    evaluation_identities: int = 8,
    epochs: int = 3,
):
    """Generate deterministic identity-disjoint fixtures without evaluating or calibrating."""
    output_dir.mkdir(parents=True, exist_ok=True)
    fixtures, histories, seeds = generate_dataset(
        seed, development_identities, evaluation_identities, epochs
    )
    jsonl_write(
        output_dir / "generated.jsonl", (f.model_dump(mode="json") for f in fixtures)
    )
    jsonl_write(output_dir / "identity_histories.jsonl", histories)
    json_write(output_dir / "seeds.json", seeds)
    print(f"Generated {len(fixtures)} fixtures")


@app.command()
def performance(
    output_dir: Path = Path("results/performance"),
    report_path: Path = Path("docs/verifier-performance.md"),
    seed: int = 20260904,
    repeats: int = typer.Option(
        300, min=100, help="Measured repetitions per case and component."
    ),
    warmups: int = typer.Option(
        10, min=5, help="Discarded warmups per case and component."
    ),
    blocks: int = typer.Option(5, min=1),
):
    """Characterize verifier overhead with valid signed scaling workloads; no throughput claims."""
    from cctbench.eval.performance import run_performance

    if blocks > min(repeats, warmups):
        raise typer.BadParameter("blocks must not exceed warmups or repeats")
    run_performance(output_dir, report_path, seed, repeats, warmups, blocks)


if __name__ == "__main__":
    app()
