.PHONY: all test test-cac demo demo-cac bench-cac clean

all: test

test: test-cac

test-cac:
	$(MAKE) -C cac test

test-conformance-cac:
	$(MAKE) -C cac test-conformance

demo: demo-cac

demo-cac:
	$(MAKE) -C cac demo

bench-cac:
	$(MAKE) -C cac bench

clean:
	$(MAKE) -C cac clean
