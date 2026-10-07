#!/usr/bin/env python3
"""Guarded external-link reachability sidecar for WQT."""
from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
import os
import re
import socket
import subprocess
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable, Mapping, Protocol
from urllib.parse import urlsplit, urlunsplit

SCHEMA_VERSION = "ldw.wqt-external-links.v1"
POLICY_ID = "wqt-external-links-policy.v1"
SITEONE_CANONICAL_VERSION = "2.5.1.20260627"
USER_AGENT = "LowcountryDigitalWorks-WQT-LinkCheck/1.0 (+https://lowcountrydigitalworks.com/)"
MAX_UNIQUE_URLS = 100
MAX_UNIQUE_HOSTS = 25
MAX_GLOBAL_CONCURRENCY = 4
MIN_SECONDS_BETWEEN_SAME_HOST_REQUESTS = 1.0
REQUEST_TIMEOUT_SECONDS = 10
CONNECT_TIMEOUT_SECONDS = 5
GET_BODY_LIMIT_BYTES = 65536
ALLOWED_PORTS = (80, 443)
HEAD_FALLBACK_STATUSES = (405, 501)
MAX_LOCATION_CHARS = 512
MAX_SOURCE_CONTEXT_CHARS = 512
MAX_URL_CHARS = 4096
MAX_ATTENTION_ITEMS = 20

POLICY = {
    "policyId": POLICY_ID,
    "maxUniqueUrls": MAX_UNIQUE_URLS,
    "maxUniqueHosts": MAX_UNIQUE_HOSTS,
    "maxUrlChars": MAX_URL_CHARS,
    "maxGlobalConcurrency": MAX_GLOBAL_CONCURRENCY,
    "maxPerHostConcurrency": 1,
    "minSecondsBetweenSameHostRequests": MIN_SECONDS_BETWEEN_SAME_HOST_REQUESTS,
    "requestTimeoutSeconds": REQUEST_TIMEOUT_SECONDS,
    "connectTimeoutSeconds": CONNECT_TIMEOUT_SECONDS,
    "getBodyLimitBytes": GET_BODY_LIMIT_BYTES,
    "allowedPorts": list(ALLOWED_PORTS),
    "automaticRedirectHops": 0,
    "headFallbackStatuses": list(HEAD_FALLBACK_STATUSES),
}

_ALLOWED_STATES = {
    "reachable", "http_error", "redirect_observed", "blocked_or_rate_limited",
    "unavailable_unknown", "unsafe_destination_rejected",
}
_HOST_LABEL = re.compile(r"^[A-Za-z0-9-]{1,63}$")
_SITE_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
_GIT_OBJECT_ID = re.compile(r"^[0-9a-f]{40}$")


class ExternalLinkError(RuntimeError):
    pass


@dataclass(frozen=True)
class SourceLink:
    url: str
    found_on: str
    source_count: int


@dataclass(frozen=True)
class ValidatedDestination:
    url: str
    request_url: str
    scheme: str
    hostname: str
    port: int
    pinned_address: str
    address_count: int
    is_ip_literal: bool
    source: SourceLink


@dataclass(frozen=True)
class TransportResponse:
    method: str
    status: int | None = None
    location: str | None = None
    error_reason: str | None = None
    body_cap_reached: bool = False


class Resolver(Protocol):
    def __call__(self, hostname: str, port: int) -> Iterable[str]: ...


class Transport(Protocol):
    def probe(self, destination: ValidatedDestination, method: str) -> TransportResponse: ...


def canonical_json_bytes(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _bounded_ascii(value: object, maximum: int) -> str:
    text = "" if value is None else str(value)
    clean = "".join(ch for ch in text if ch == "\t" or 0x20 <= ord(ch) <= 0x7E)
    return clean[:maximum]


def extract_external_links(siteone_bytes: bytes) -> tuple[list[SourceLink], dict[str, object]]:
    try:
        evidence = json.loads(siteone_bytes)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ExternalLinkError("siteone_invalid_json") from exc
    if not isinstance(evidence, dict):
        raise ExternalLinkError("siteone_invalid_root")
    crawler = evidence.get("crawler")
    options = evidence.get("options")
    tables = evidence.get("tables")
    if not isinstance(crawler, dict) or not isinstance(options, dict) or not isinstance(tables, dict):
        raise ExternalLinkError("siteone_missing_structured_evidence")
    source_target = options.get("url")
    if not isinstance(source_target, str) or not source_target:
        raise ExternalLinkError("siteone_missing_source_target")
    version = crawler.get("version")
    if version != SITEONE_CANONICAL_VERSION:
        raise ExternalLinkError("siteone_unexpected_version")
    external_table = tables.get("external-urls")
    skipped_table = tables.get("skipped")
    if not isinstance(external_table, dict) or external_table.get("aplCode") != "external-urls":
        raise ExternalLinkError("siteone_missing_external_urls_table")
    if not isinstance(skipped_table, dict) or skipped_table.get("aplCode") != "skipped":
        raise ExternalLinkError("siteone_missing_skipped_table")
    external_rows = external_table.get("rows")
    skipped_rows = skipped_table.get("rows")
    if not isinstance(external_rows, list) or not isinstance(skipped_rows, list):
        raise ExternalLinkError("siteone_invalid_external_link_rows")
    skipped_not_allowed: set[str] = set()
    for row in skipped_rows:
        if not isinstance(row, dict) or not isinstance(row.get("url"), str) or not isinstance(row.get("reason"), str):
            raise ExternalLinkError("siteone_invalid_skipped_row")
        if row["reason"] == "Not allowed host":
            skipped_not_allowed.add(row["url"])
    links: list[SourceLink] = []
    seen: set[str] = set()
    for row in external_rows:
        if not isinstance(row, dict):
            raise ExternalLinkError("siteone_invalid_external_row")
        url, found_on, count = row.get("url"), row.get("foundOn"), row.get("count")
        if (
            not isinstance(url, str)
            or not url
            or len(url) > MAX_URL_CHARS
            or not isinstance(found_on, str)
        ):
            raise ExternalLinkError("siteone_invalid_external_row")
        try:
            source_count = int(count)
        except (TypeError, ValueError) as exc:
            raise ExternalLinkError("siteone_invalid_external_row") from exc
        if source_count < 1 or url in seen:
            raise ExternalLinkError("siteone_invalid_external_row")
        if url not in skipped_not_allowed:
            raise ExternalLinkError("siteone_external_skip_mismatch")
        seen.add(url)
        links.append(SourceLink(url, _bounded_ascii(found_on, MAX_SOURCE_CONTEXT_CHARS), source_count))
    if seen != skipped_not_allowed:
        raise ExternalLinkError("siteone_external_skip_mismatch")
    links.sort(key=lambda item: item.url)
    source = {
        "siteOneVersion": version,
        "siteOneTarget": source_target,
        "siteOneExecutedAt": _bounded_ascii(crawler.get("executedAt"), 128) or None,
        "rawSha256": sha256_hex(siteone_bytes),
        "externalInputSha256": sha256_hex(canonical_json_bytes([
            {"url": item.url, "foundOn": item.found_on, "sourceCount": item.source_count} for item in links
        ])),
    }
    return links, source


def _canonical_dns_name(hostname: str) -> str:
    host = hostname.rstrip(".")
    if not host or "%" in host:
        raise ExternalLinkError("ambiguous_hostname")
    try:
        ascii_host = host.encode("idna").decode("ascii").lower()
    except UnicodeError as exc:
        raise ExternalLinkError("ambiguous_hostname") from exc
    if len(ascii_host) > 253 or "." not in ascii_host:
        raise ExternalLinkError("ambiguous_hostname")
    labels = ascii_host.split(".")
    if any(not _HOST_LABEL.fullmatch(label) or label.startswith("-") or label.endswith("-") for label in labels):
        raise ExternalLinkError("ambiguous_hostname")
    if ascii_host == "localhost" or ascii_host.endswith(".localhost"):
        raise ExternalLinkError("special_internal_hostname")
    return ascii_host


def _parse_destination(source: SourceLink) -> tuple[str, str, int, bool]:
    if (
        source.url != source.url.strip()
        or "\\" in source.url
        or any(ord(ch) < 0x20 or ord(ch) == 0x7F for ch in source.url)
    ):
        raise ExternalLinkError("malformed_url")
    try:
        parsed = urlsplit(source.url)
        port = parsed.port
    except ValueError as exc:
        raise ExternalLinkError("malformed_url") from exc
    scheme = parsed.scheme.lower()
    if scheme not in {"http", "https"}:
        raise ExternalLinkError("unsupported_scheme")
    if parsed.username is not None or parsed.password is not None:
        raise ExternalLinkError("userinfo_rejected")
    if not parsed.hostname:
        raise ExternalLinkError("malformed_url")
    effective_port = port if port is not None else (443 if scheme == "https" else 80)
    if effective_port not in ALLOWED_PORTS:
        raise ExternalLinkError("port_rejected")
    hostname = parsed.hostname
    if "%" in hostname:
        raise ExternalLinkError("ambiguous_hostname")
    try:
        literal = ipaddress.ip_address(hostname)
    except ValueError:
        return scheme, _canonical_dns_name(hostname), effective_port, False
    return scheme, str(literal), effective_port, True


def system_resolver(hostname: str, port: int) -> list[str]:
    query_name = hostname if hostname.endswith(".") else f"{hostname}."
    try:
        answers = socket.getaddrinfo(query_name, port, socket.AF_UNSPEC, socket.SOCK_STREAM, socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise ExternalLinkError("dns_failure") from exc
    addresses = sorted({item[4][0].split("%", 1)[0] for item in answers})
    if not addresses:
        raise ExternalLinkError("dns_failure")
    return addresses


def validate_destination(source: SourceLink, resolver: Resolver = system_resolver) -> ValidatedDestination:
    scheme, hostname, port, is_ip_literal = _parse_destination(source)
    if is_ip_literal:
        answers = [hostname]
    else:
        try:
            answers = list(resolver(hostname, port))
        except ExternalLinkError:
            raise
        except Exception as exc:
            raise ExternalLinkError("dns_failure") from exc
        if not answers:
            raise ExternalLinkError("dns_failure")
    parsed_addresses = []
    for raw in answers:
        try:
            address = ipaddress.ip_address(raw)
        except ValueError as exc:
            raise ExternalLinkError("dns_invalid_address") from exc
        if (
            not address.is_global
            or address.is_multicast
            or address.is_unspecified
            or address.is_loopback
            or address.is_link_local
            or address.is_private
            or address.is_reserved
        ):
            raise ExternalLinkError("non_global_destination")
        parsed_addresses.append(address)
    parsed_addresses.sort(key=lambda address: (address.version, int(address)))
    chosen = parsed_addresses[0]
    original = urlsplit(source.url)
    request_host = f"[{hostname}]" if ":" in hostname else hostname
    request_netloc = request_host + (f":{port}" if original.port is not None else "")
    request_url = urlunsplit((scheme, request_netloc, original.path or "/", original.query, ""))
    return ValidatedDestination(
        source.url, request_url, scheme, hostname, port, str(chosen), len(parsed_addresses), is_ip_literal, source,
    )


def _curl_resolve_value(destination: ValidatedDestination) -> str:
    address = destination.pinned_address
    if ":" in address:
        address = f"[{address}]"
    return f"{destination.hostname}:{destination.port}:{address}"


def _sanitized_curl_env() -> dict[str, str]:
    env = dict(os.environ)
    for key in list(env):
        if key.lower() in {
            "http_proxy", "https_proxy", "all_proxy", "no_proxy", "curl_home",
            "curl_ca_bundle", "ssl_cert_file", "ssl_cert_dir",
        }:
            env.pop(key, None)
    return env


def _parse_location(header_bytes: bytes) -> str | None:
    text = header_bytes.decode("iso-8859-1", errors="replace")
    locations = []
    for line in text.splitlines():
        if line.lower().startswith("location:"):
            locations.append(_bounded_ascii(line.split(":", 1)[1].strip(), MAX_LOCATION_CHARS))
    return locations[-1] if locations else None


def _safe_redirect_descriptor(location: str | None) -> dict[str, object]:
    if location is None:
        return {"locationKind": "absent"}
    if (
        not location
        or "\\" in location
        or any(ord(ch) < 0x20 or ord(ch) == 0x7F for ch in location)
    ):
        return {"locationKind": "invalid"}
    candidate = _bounded_ascii(location, MAX_LOCATION_CHARS).strip()
    if not candidate:
        return {"locationKind": "invalid"}
    try:
        parsed = urlsplit(candidate)
    except ValueError:
        return {"locationKind": "invalid"}

    if not parsed.scheme:
        return {"locationKind": "relative"}

    scheme = parsed.scheme.lower()
    if scheme not in {"http", "https"}:
        return {"locationKind": "other_scheme"}

    try:
        hostname = parsed.hostname
        port = parsed.port
    except ValueError:
        return {"locationKind": "invalid"}
    if not hostname:
        return {"locationKind": "invalid"}

    try:
        canonical_hostname = ipaddress.ip_address(hostname).compressed.lower()
    except ValueError:
        try:
            canonical_hostname = _canonical_dns_name(hostname)
        except ExternalLinkError:
            return {"locationKind": "invalid"}

    effective_port = port if port is not None else (443 if scheme == "https" else 80)
    if not (1 <= effective_port <= 65535):
        return {"locationKind": "invalid"}

    return {
        "locationKind": f"absolute_{scheme}",
        "scheme": scheme,
        "canonicalHostname": canonical_hostname,
        "effectivePort": effective_port,
        "pathPresent": parsed.path not in {"", "/"},
    }


class CurlTransport:
    """System curl transport with disabled config/proxy and exact address pinning."""

    def __init__(self, curl_bin: str = "curl") -> None:
        self.curl_bin = curl_bin

    def build_command(self, destination: ValidatedDestination, method: str, header_path: str) -> list[str]:
        if method not in {"HEAD", "GET"}:
            raise ValueError("unsupported transport method")
        command = [
            self.curl_bin,
            "--disable",
            "--silent",
            "--show-error",
            "--noproxy", "*",
            "--proto", "=http,https",
            "--max-time", str(REQUEST_TIMEOUT_SECONDS),
            "--connect-timeout", str(CONNECT_TIMEOUT_SECONDS),
            "--max-redirs", "0",
            "--user-agent", USER_AGENT,
            "--dump-header", header_path,
            "--output", os.devnull,
            "--write-out", "%{http_code}",
        ]
        if not destination.is_ip_literal:
            command += ["--resolve", _curl_resolve_value(destination)]
        if method == "HEAD":
            command.append("--head")
        else:
            command += ["--request", "GET", "--range", "0-0", "--max-filesize", str(GET_BODY_LIMIT_BYTES)]
        command.append(destination.request_url)
        return command

    def probe(self, destination: ValidatedDestination, method: str) -> TransportResponse:
        with tempfile.NamedTemporaryFile(prefix="wqt-link-headers-", delete=False) as handle:
            header_path = handle.name
        try:
            command = self.build_command(destination, method, header_path)
            try:
                completed = subprocess.run(
                    command,
                    capture_output=True,
                    text=True,
                    timeout=REQUEST_TIMEOUT_SECONDS + 2,
                    env=_sanitized_curl_env(),
                    check=False,
                )
            except subprocess.TimeoutExpired:
                return TransportResponse(method=method, error_reason="timeout")
            try:
                status = int((completed.stdout or "").strip()[-3:])
            except (TypeError, ValueError):
                status = None
            body_cap = completed.returncode == 63 and status is not None and 100 <= status <= 599
            if completed.returncode != 0 and not body_cap:
                reason = {
                    7: "connect_failure", 28: "timeout", 35: "tls_failure", 51: "tls_failure",
                    58: "tls_failure", 60: "tls_failure", 77: "tls_failure", 80: "tls_failure",
                    82: "tls_failure", 83: "tls_failure", 90: "tls_failure", 91: "tls_failure",
                }.get(completed.returncode, "transport_failure")
                return TransportResponse(method=method, status=status, error_reason=reason)
            header_bytes = Path(header_path).read_bytes() if Path(header_path).exists() else b""
            return TransportResponse(
                method=method,
                status=status,
                location=_parse_location(header_bytes),
                body_cap_reached=body_cap,
            )
        finally:
            try:
                Path(header_path).unlink()
            except FileNotFoundError:
                pass


def _classify_response(response: TransportResponse) -> tuple[str, str | None]:
    if response.error_reason:
        return "unavailable_unknown", response.error_reason
    status = response.status
    if status is None or status < 100 or status > 599:
        return "unavailable_unknown", "invalid_http_status"
    if 200 <= status <= 299:
        return "reachable", None
    if 300 <= status <= 399:
        return "redirect_observed", None
    if status in {403, 429}:
        return "blocked_or_rate_limited", None
    if 400 <= status <= 599:
        return "http_error", None
    return "unavailable_unknown", "unexpected_http_status"


class HostRateLimiter:
    def __init__(
        self,
        minimum_interval: float = MIN_SECONDS_BETWEEN_SAME_HOST_REQUESTS,
        clock: Callable[[], float] = time.monotonic,
        sleeper: Callable[[float], None] = time.sleep,
    ) -> None:
        self.minimum_interval = minimum_interval
        self.clock = clock
        self.sleeper = sleeper
        self._guard = threading.Lock()
        self._locks: dict[str, threading.Lock] = {}
        self._last_start: dict[str, float] = {}

    def run(self, hostname: str, fn: Callable[[], object]) -> object:
        with self._guard:
            lock = self._locks.setdefault(hostname, threading.Lock())
        with lock:
            with self._guard:
                last = self._last_start.get(hostname)
            now = self.clock()
            if last is not None:
                delay = self.minimum_interval - (now - last)
                if delay > 0:
                    self.sleeper(delay)
                    now = self.clock()
            with self._guard:
                self._last_start[hostname] = now
            return fn()


def _base_result(source: SourceLink, state: str, *, attempted: bool, reason: str | None = None) -> dict[str, object]:
    return {
        "url": source.url,
        "foundOn": source.found_on,
        "sourceCount": source.source_count,
        "state": state,
        "attempted": attempted,
        "method": None,
        "httpStatus": None,
        "redirect": None,
        "reason": reason,
        "pinnedAddress": None,
    }


def _probe_one(destination: ValidatedDestination, transport: Transport, limiter: HostRateLimiter) -> dict[str, object]:
    response = limiter.run(destination.hostname, lambda: transport.probe(destination, "HEAD"))
    assert isinstance(response, TransportResponse)
    if response.status in HEAD_FALLBACK_STATUSES and not response.error_reason:
        response = limiter.run(destination.hostname, lambda: transport.probe(destination, "GET"))
        assert isinstance(response, TransportResponse)
    state, reason = _classify_response(response)
    if state not in _ALLOWED_STATES:
        raise AssertionError("unexpected result state")
    return {
        "url": destination.source.url,
        "foundOn": destination.source.found_on,
        "sourceCount": destination.source.source_count,
        "state": state,
        "attempted": True,
        "method": response.method,
        "httpStatus": response.status,
        "redirect": _safe_redirect_descriptor(response.location) if state == "redirect_observed" else None,
        "reason": reason,
        "pinnedAddress": destination.pinned_address,
    }


def _host_key_for_limit(source: SourceLink) -> str:
    try:
        parsed = urlsplit(source.url)
        if not parsed.hostname:
            return f"!invalid:{source.url}"
        return parsed.hostname.rstrip(".").lower()
    except ValueError:
        return f"!invalid:{source.url}"


def build_sidecar(
    *,
    site_id: str,
    target: str,
    wqt_commit: str,
    siteone_bytes: bytes,
    resolver: Resolver = system_resolver,
    transport: Transport | None = None,
    limiter: HostRateLimiter | None = None,
) -> dict[str, object]:
    if not _SITE_ID.fullmatch(site_id):
        raise ExternalLinkError("invalid_site_id")
    if not _GIT_OBJECT_ID.fullmatch(wqt_commit):
        raise ExternalLinkError("invalid_wqt_commit")
    links, source = extract_external_links(siteone_bytes)
    if source["siteOneTarget"] != target:
        raise ExternalLinkError("siteone_target_mismatch")
    source = {**source, "wqtCommit": wqt_commit}
    transport = transport or CurlTransport()
    limiter = limiter or HostRateLimiter()
    policy_sha = sha256_hex(canonical_json_bytes(POLICY))
    unique_hosts = sorted({_host_key_for_limit(link) for link in links})
    if len(links) > MAX_UNIQUE_URLS or len(unique_hosts) > MAX_UNIQUE_HOSTS:
        limitations = []
        if len(links) > MAX_UNIQUE_URLS:
            limitations.append(f"unique_url_limit:{MAX_UNIQUE_URLS}")
        if len(unique_hosts) > MAX_UNIQUE_HOSTS:
            limitations.append(f"unique_host_limit:{MAX_UNIQUE_HOSTS}")
        return {
            "schemaVersion": SCHEMA_VERSION,
            "siteId": site_id,
            "target": target,
            "source": source,
            "policy": POLICY,
            "policySha256": policy_sha,
            "counts": {"discovered": len(links), "attempted": 0, "rejected": 0, "unattempted": len(links)},
            "coverage": {"state": "coverage_limit_exceeded", "limitations": limitations},
            "results": [],
        }

    results_by_url: dict[str, dict[str, object]] = {}
    destinations: list[ValidatedDestination] = []
    for link in links:
        try:
            destinations.append(validate_destination(link, resolver))
        except ExternalLinkError as exc:
            reason = str(exc)
            if reason == "dns_failure":
                results_by_url[link.url] = _base_result(link, "unavailable_unknown", attempted=False, reason=reason)
            else:
                results_by_url[link.url] = _base_result(link, "unsafe_destination_rejected", attempted=False, reason=reason)

    with ThreadPoolExecutor(max_workers=MAX_GLOBAL_CONCURRENCY) as executor:
        futures = {executor.submit(_probe_one, destination, transport, limiter): destination.source.url for destination in destinations}
        for future in as_completed(futures):
            results_by_url[futures[future]] = future.result()

    results = [results_by_url[link.url] for link in links]
    attempted = sum(1 for item in results if item["attempted"])
    rejected = sum(1 for item in results if item["state"] == "unsafe_destination_rejected")
    unattempted = len(links) - attempted - rejected
    return {
        "schemaVersion": SCHEMA_VERSION,
        "siteId": site_id,
        "target": target,
        "source": source,
        "policy": POLICY,
        "policySha256": policy_sha,
        "counts": {"discovered": len(links), "attempted": attempted, "rejected": rejected, "unattempted": unattempted},
        "coverage": {"state": "complete", "limitations": []},
        "results": results,
    }


def render_summary(sidecar: Mapping[str, object]) -> str:
    counts = sidecar["counts"]
    coverage = sidecar["coverage"]
    results = sidecar["results"]
    assert isinstance(counts, Mapping) and isinstance(coverage, Mapping) and isinstance(results, list)
    buckets = {state: 0 for state in sorted(_ALLOWED_STATES)}
    for item in results:
        buckets[item["state"]] = buckets.get(item["state"], 0) + 1
    lines = [
        "## External Link Reachability", "",
        f"- Discovered external URLs: {counts['discovered']}",
        f"- Attempted URLs: {counts['attempted']}",
        f"- Unsafe destinations rejected: {counts['rejected']}",
        f"- Unattempted URLs: {counts['unattempted']}",
        f"- Coverage state: `{coverage['state']}`",
        "- Result buckets: " + ", ".join(f"{key}={value}" for key, value in buckets.items()),
    ]
    limitations = coverage.get("limitations", [])
    if limitations:
        lines.append("- Coverage limitations: " + ", ".join(str(item) for item in limitations))
    attention = [item for item in results if item["state"] != "reachable"]
    lines += ["", f"### Bounded attention list (maximum {MAX_ATTENTION_ITEMS})", ""]
    if not attention:
        lines.append("- No non-reachable observations are present; this is not a guarantee that every human browser will receive the same result.")
    else:
        for item in attention[:MAX_ATTENTION_ITEMS]:
            status = item["httpStatus"] if item["httpStatus"] is not None else "n/a"
            detail = f"{item['state']} status={status}"
            if item.get("reason"):
                detail += f" reason={item['reason']}"
            redirect = item.get("redirect")
            if isinstance(redirect, Mapping):
                kind = redirect.get("locationKind", "invalid")
                detail += f" redirect={kind}"
                if kind in {"absolute_http", "absolute_https"}:
                    detail += (
                        f" scheme={redirect.get('scheme')}"
                        f" host={redirect.get('canonicalHostname')}"
                        f" port={redirect.get('effectivePort')}"
                        f" pathPresent={str(bool(redirect.get('pathPresent'))).lower()}"
                    )
            display_url = _bounded_ascii(item["url"], 512).replace("`", "%60")
            lines.append(f"- `{display_url}` — {detail}")
        omitted = len(attention) - MAX_ATTENTION_ITEMS
        if omitted > 0:
            lines.append(f"- {omitted} additional non-reachable observation(s) omitted from this bounded summary.")
    lines += ["", "> Reachability is observed from the GitHub runner. Third-party CDN, bot, geolocation, rate-limit, or policy behavior can differ from a human browser. A 403/429 is not classified as a broken link.", ""]
    return "\n".join(lines)


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(json.dumps(value, sort_keys=True, indent=2, ensure_ascii=False).encode("utf-8") + b"\n")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--site-id", required=True)
    parser.add_argument("--target", required=True)
    parser.add_argument("--wqt-commit", required=True)
    parser.add_argument("--siteone", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--summary-output", required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    sidecar = build_sidecar(
        site_id=args.site_id,
        target=args.target,
        wqt_commit=args.wqt_commit,
        siteone_bytes=Path(args.siteone).read_bytes(),
    )
    _write_json(Path(args.output), sidecar)
    summary = Path(args.summary_output)
    summary.parent.mkdir(parents=True, exist_ok=True)
    summary.write_text(render_summary(sidecar), encoding="utf-8", newline="\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())