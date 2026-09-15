.PHONY: all test test-cac test-cct test-conformance-cac demo demo-cac bench-cac bench-cct clean

all: test

test: test-cac test-cct

test-cac:
	$(MAKE) -C cac test

test-conformance-cac:
	$(MAKE) -C cac test-conformance

test-cct:
	$(MAKE) -C cct test

demo: demo-cac

demo-cac:
	$(MAKE) -C cac demo

bench-cac:
	$(MAKE) -C cac bench

bench-cct:
	$(MAKE) -C cct benchmark

clean:
	$(MAKE) -C cac clean
	$(MAKE) -C cct clean
