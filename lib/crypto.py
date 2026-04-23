"""
Symmetric encryption for sensitive credentials (OAuth tokens, access tokens).
Uses Fernet (AES-128-CBC + HMAC-SHA256) from the `cryptography` package.

Requires ENCRYPTION_KEY env var — a URL-safe base64-encoded 32-byte key.
Generate one with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
"""

import os
import base64
from cryptography.fernet import Fernet, InvalidToken


def _get_fernet() -> Fernet:
    key = os.getenv("ENCRYPTION_KEY")
    if not key:
        raise RuntimeError(
            "ENCRYPTION_KEY env var is not set. "
            "Generate one with: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
        )
    return Fernet(key.encode() if isinstance(key, str) else key)


def encrypt_token(plaintext: str) -> str:
    """Encrypt a plaintext string. Returns a URL-safe base64 ciphertext string."""
    if not plaintext:
        return plaintext
    return _get_fernet().encrypt(plaintext.encode()).decode()


def decrypt_token(ciphertext: str) -> str:
    """Decrypt a ciphertext string. Returns the original plaintext."""
    if not ciphertext:
        return ciphertext
    try:
        return _get_fernet().decrypt(ciphertext.encode()).decode()
    except (InvalidToken, Exception) as e:
        raise ValueError(f"Failed to decrypt token — key mismatch or corrupted data: {e}")
