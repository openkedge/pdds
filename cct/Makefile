PYTHON ?= python3
VENV := .venv
RUN := $(VENV)/bin/python

.PHONY: setup benchmark performance-benchmark test security-test ci

setup: $(VENV)/.installed

$(VENV)/.installed: pyproject.toml requirements.lock
	$(PYTHON) -m venv $(VENV)
	$(RUN) -m pip install -r requirements.lock
	$(RUN) -m pip install --no-deps -e .
	touch $@

benchmark: setup
	$(RUN) -m cctbench.cli benchmark

performance-benchmark: setup
	OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 VECLIB_MAXIMUM_THREADS=1 $(RUN) -m cctbench.cli performance

test: setup
	$(RUN) -m pytest -q

security-test: setup
	$(RUN) -m pytest -q tests/security --soundness-report docs/soundness-regression.md

ci: setup
	$(RUN) -m pytest -q tests --soundness-report docs/soundness-regression.md --junitxml=test-results/junit.xml

clean:
	rm -rf .venv build dist *.egg-info src/*.egg-info .pytest_cache .hypothesis .ruff_cache
	find . -type d -name "__pycache__" -prune -exec rm -rf {} +
