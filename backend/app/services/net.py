"""Rules for addresses a shared server may call on an account's behalf."""

import ipaddress
import socket
from urllib.parse import urlsplit

from .llm.base import LLMError


def ensure_public_url(url: str) -> None:
    """Refuse an address that leads anywhere but the public internet.

    On a server without local models, people type the address of their model
    provider and the server calls it. Without this check that is a way to reach the machine's own
    services and whatever else sits on its private network.

    The name is resolved here and again by the HTTP client, so a DNS answer that
    changes in between is not caught. Redirects are a second way round, which is
    why those providers are built with redirects off.
    """
    parts = urlsplit(url.strip())
    if parts.scheme not in {"http", "https"} or not parts.hostname:
        raise LLMError("Enter a full address that starts with http:// or https://.")
    try:
        port = parts.port or (443 if parts.scheme == "https" else 80)
        resolved = socket.getaddrinfo(parts.hostname, port, type=socket.SOCK_STREAM)
    except (socket.gaierror, ValueError) as exc:
        raise LLMError(f"The address {parts.hostname} could not be found.") from exc

    for *_, sockaddr in resolved:
        address = ipaddress.ip_address(sockaddr[0])
        # ::ffff:127.0.0.1 is loopback wearing an IPv6 address.
        if address.version == 6 and address.ipv4_mapped is not None:
            address = address.ipv4_mapped
        if not address.is_global:
            raise LLMError(
                f"{parts.hostname} is on a private network. This server only calls public addresses."
            )
