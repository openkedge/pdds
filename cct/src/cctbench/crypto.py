"""Real Ed25519 signatures over SHA-256 tagged preimages; no marker-based validity."""

import hashlib
from contextvars import ContextVar
from time import perf_counter_ns

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)

from cctbench.canonicalize import VERSION, canonicalize_obj, tagged_bytes
from cctbench.schema.enums import CheckStatus

SIGNATURE_TIMES = ContextVar("cct_signature_times", default=None)


def synthetic_key(seed: int, principal: str) -> Ed25519PrivateKey:
    # Reproducible PUBLIC benchmark keys. Never suitable for deployment secrets.
    return Ed25519PrivateKey.from_private_bytes(
        hashlib.sha256(f"cct-fixture-key:{seed}:{principal}".encode()).digest()
    )


def public_hex(key: Ed25519PrivateKey) -> str:
    return (
        key.public_key()
        .public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
        .hex()
    )


def sign(kind, payload, key, version=VERSION):
    digest = hashlib.sha256(tagged_bytes(kind, payload, version)).digest()
    return "ed25519:" + key.sign(digest).hex()


def verify_signature(kind, payload, signature, credential, epoch, version=VERSION):
    if credential is None or not credential.public_key:
        return CheckStatus.UNKNOWN, "Public key evidence unavailable"
    if not signature:
        return CheckStatus.UNKNOWN, "Signature evidence unavailable"
    start = None
    try:
        if not signature.startswith("ed25519:"):
            raise ValueError("Unsupported signature encoding")
        key = Ed25519PublicKey.from_public_bytes(bytes.fromhex(credential.public_key))
        digest = hashlib.sha256(tagged_bytes(kind, payload, version)).digest()
        signature_bytes = bytes.fromhex(signature.split(":", 1)[1])
        start = perf_counter_ns()
        key.verify(signature_bytes, digest)
    except (InvalidSignature, ValueError, TypeError):
        return CheckStatus.FAIL, "Ed25519 signature invalid"
    finally:
        times = SIGNATURE_TIMES.get()
        if times is not None and start is not None:
            times.append(perf_counter_ns() - start)
    if not credential.historical_status_known:
        return CheckStatus.UNKNOWN, "Historical key status unavailable"
    if epoch < credential.valid_from_epoch or (
        credential.valid_until_epoch is not None
        and epoch > credential.valid_until_epoch
    ):
        return CheckStatus.FAIL, "Key unauthorized for signing epoch"
    if (
        credential.compromised_from_epoch is not None
        and epoch >= credential.compromised_from_epoch
    ):
        return CheckStatus.FAIL, "Key compromised for signing epoch"
    if credential.revoked_at_epoch is not None and epoch >= credential.revoked_at_epoch:
        return CheckStatus.FAIL, "Key revoked by signing epoch"
    return CheckStatus.PASS, "Signature and historical key validity established"


def authority_payload(proposal, signer):
    q = canonicalize_obj(proposal)
    q.pop("authority_bundle")
    return {
        **q,
        "principal": signer.principal,
        "role": signer.role,
        "scope": signer.scope,
    }


def unsigned(record, field="signature"):
    data = canonicalize_obj(record)
    data.pop(field)
    return data
