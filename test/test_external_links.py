import copy
import json
import os
import socket
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import external_links as el

PUBLIC_V4 = "93.184.216.34"
PUBLIC_V6 = "2606:4700:4700::1111"
TARGET = "https://example.test"
SITE_ID = "example-site"
WQT_COMMIT = "a" * 40
FIXTURE = Path(__file__).parent / "fixtures" / "siteone-external-links.json"


def evidence_for(urls):
    external = []
    skipped = []
    for index, url in enumerate(urls):
        external.append({"count": "1", "foundOn": f"https://example.test/source-{index}", "url": url})
        skipped.append({"reason": "Not allowed host", "sourceAttr": "<a href>", "sourceUqId": f"/source-{index}", "url": url})
    return {
        "crawler": {"name": "SiteOne Crawler", "version": "2.5.1.20260627", "executedAt": "2026-10-06 00:00:00"},
        "options": {"url": TARGET},
        "tables": {
            "external-urls": {"aplCode": "external-urls", "rows": external},
            "skipped": {"aplCode": "skipped", "rows": skipped},
        },
    }


def evidence_bytes(urls):
    return json.dumps(evidence_for(urls), separators=(",", ":")).encode()


class FakeResolver:
    def __init__(self, mapping=None, failure=None):
        self.mapping = mapping or {}
        self.failure = failure
        self.calls = []

    def __call__(self, hostname, port):
        self.calls.append((hostname, port))
        if self.failure:
            raise self.failure
        return self.mapping.get(hostname, [PUBLIC_V4])


class FakeTransport:
    def __init__(self, responses=None):
        self.responses = responses or {}
        self.calls = []

    def probe(self, destination, method):
        self.calls.append((destination, method))
        value = self.responses.get((destination.url, method))
        if isinstance(value, list):
            return value.pop(0)
        if value is not None:
            return value
        return el.TransportResponse(method=method, status=204)


def fast_limiter():
    return el.HostRateLimiter(minimum_interval=0, sleeper=lambda _seconds: None)


def sidecar_for(urls, *, resolver=None, transport=None):
    return el.build_sidecar(
        site_id=SITE_ID,
        target=TARGET,
        wqt_commit=WQT_COMMIT,
        siteone_bytes=evidence_bytes(urls),
        resolver=resolver or FakeResolver(),
        transport=transport or FakeTransport(),
        limiter=fast_limiter(),
    )


class ExternalLinkTests(unittest.TestCase):
    def test_exact_siteone_structured_relationship_extracts_deterministically(self):
        links, source = el.extract_external_links(FIXTURE.read_bytes())
        self.assertEqual([item.url for item in links], [
            "http://c.example.org/path",
            "https://a.example.org/path",
            "https://b.example.org/path",
        ])
        self.assertEqual(source["siteOneVersion"], "2.5.1.20260627")
        self.assertEqual(source["siteOneTarget"], TARGET)
        self.assertRegex(source["rawSha256"], r"^[0-9a-f]{64}$")
        self.assertRegex(source["externalInputSha256"], r"^[0-9a-f]{64}$")

    def test_non_global_literal_destinations_are_rejected(self):
        urls = [
            "http://127.0.0.1/",
            "http://[::1]/",
            "http://10.0.0.1/",
            "http://192.168.1.1/",
            "http://169.254.1.2/",
            "http://[fe80::1]/",
            "http://[fc00::1]/",
            "http://169.254.169.254/latest/meta-data/",
            "http://192.0.2.1/",
            "http://198.18.0.1/",
            "http://0.0.0.0/",
            "http://224.0.0.1/",
            "http://[::ffff:127.0.0.1]/",
            "http://[2002:7f00:1::]/",
            "http://[2001:0000:4136:e378:8000:63bf:3fff:fdd2]/",
            "http://[64:ff9b::7f00:1]/",
            "http://[64:ff9b:1::7f00:1]/",
        ]
        for url in urls:
            with self.subTest(url=url):
                with self.assertRaisesRegex(el.ExternalLinkError, "non_global_destination"):
                    el.validate_destination(el.SourceLink(url, TARGET, 1), FakeResolver())

    def test_mixed_public_and_private_dns_answers_fail_closed(self):
        resolver = FakeResolver({"mixed.example.org": [PUBLIC_V4, "10.0.0.5"]})
        with self.assertRaisesRegex(el.ExternalLinkError, "non_global_destination"):
            el.validate_destination(el.SourceLink("https://mixed.example.org/a", TARGET, 1), resolver)

    def test_system_resolver_uses_absolute_dns_name_and_requests_ipv4_and_ipv6(self):
        answer = (socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", (PUBLIC_V4, 443))
        with patch.object(el.socket, "getaddrinfo", return_value=[answer]) as getaddrinfo:
            self.assertEqual(el.system_resolver("safe.example.org", 443), [PUBLIC_V4])
        getaddrinfo.assert_called_once_with(
            "safe.example.org.", 443, socket.AF_UNSPEC, socket.SOCK_STREAM, socket.IPPROTO_TCP,
        )

    def test_scheme_port_userinfo_and_ambiguous_host_are_rejected(self):
        cases = {
            "ftp://example.org/a": "unsupported_scheme",
            "https://example.org:8443/a": "port_rejected",
            "https://user:pass@example.org/a": "userinfo_rejected",
            "https://localhost/a": "ambiguous_hostname|special_internal_hostname",
            "https://intranet/a": "ambiguous_hostname",
        }
        for url, reason in cases.items():
            with self.subTest(url=url):
                with self.assertRaisesRegex(el.ExternalLinkError, reason):
                    el.validate_destination(el.SourceLink(url, TARGET, 1), FakeResolver())

    def test_safe_public_resolution_is_deterministic_and_curl_is_hostname_pinned(self):
        resolver = FakeResolver({"safe.example.org": [PUBLIC_V6, PUBLIC_V4]})
        source = el.SourceLink("https://safe.example.org/path?q=1", TARGET, 1)
        destination = el.validate_destination(source, resolver)
        self.assertEqual(destination.pinned_address, PUBLIC_V4)
        command = el.CurlTransport("curl").build_command(destination, "HEAD", "/tmp/headers")
        self.assertEqual(command[0:2], ["curl", "--disable"])
        self.assertIn("--resolve", command)
        self.assertIn(f"safe.example.org:443:{PUBLIC_V4}", command)
        self.assertEqual(command[-1], source.url)
        self.assertIn("--head", command)
        joined = " ".join(command).lower()
        self.assertNotIn("--insecure", joined)
        self.assertNotIn(" -k", joined)
        self.assertNotIn("--location", joined)
        self.assertNotIn(" -l", joined)
        self.assertIn("--noproxy *", joined)

    def test_unsafe_destination_never_reaches_transport(self):
        transport = FakeTransport()
        result = sidecar_for(["http://127.0.0.1/"], transport=transport)
        self.assertEqual(transport.calls, [])
        self.assertEqual(result["results"][0]["state"], "unsafe_destination_rejected")
        self.assertFalse(result["results"][0]["attempted"])

    def test_2xx_is_reachable(self):
        url = "https://ok.example.org/a"
        transport = FakeTransport({(url, "HEAD"): el.TransportResponse(method="HEAD", status=204)})
        result = sidecar_for([url], transport=transport)
        self.assertEqual(result["results"][0]["state"], "reachable")
        self.assertEqual(result["results"][0]["httpStatus"], 204)

    def test_404_and_410_are_http_error(self):
        for status in (404, 410):
            url = f"https://error{status}.example.org/a"
            transport = FakeTransport({(url, "HEAD"): el.TransportResponse(method="HEAD", status=status)})
            result = sidecar_for([url], transport=transport)
            self.assertEqual(result["results"][0]["state"], "http_error")
            self.assertEqual(result["results"][0]["httpStatus"], status)

    def test_403_and_429_are_blocked_without_fallback(self):
        for status in (403, 429):
            url = f"https://blocked{status}.example.org/a"
            transport = FakeTransport({(url, "HEAD"): el.TransportResponse(method="HEAD", status=status)})
            result = sidecar_for([url], transport=transport)
            self.assertEqual(result["results"][0]["state"], "blocked_or_rate_limited")
            self.assertEqual([method for _dest, method in transport.calls], ["HEAD"])

    def test_redirect_is_observed_and_not_followed(self):
        url = "https://redirect.example.org/a"
        transport = FakeTransport({
            (url, "HEAD"): el.TransportResponse(method="HEAD", status=302, location="https://elsewhere.example/b")
        })
        result = sidecar_for([url], transport=transport)
        item = result["results"][0]
        self.assertEqual(item["state"], "redirect_observed")
        self.assertEqual(item["redirect"], {
            "locationKind": "absolute_https",
            "scheme": "https",
            "canonicalHostname": "elsewhere.example",
            "effectivePort": 443,
            "pathPresent": True,
        })
        self.assertNotIn("location", item)
        self.assertEqual([method for _dest, method in transport.calls], ["HEAD"])

    def test_sensitive_absolute_redirect_material_is_never_persisted_or_summarized(self):
        url = "https://redirect-sensitive.example.org/a"
        raw_location = "https://user:pass@example.org/path?token=SECRET#fragment"
        transport = FakeTransport({
            (url, "HEAD"): el.TransportResponse(method="HEAD", status=302, location=raw_location)
        })
        result = sidecar_for([url], transport=transport)
        item = result["results"][0]
        self.assertEqual(item["state"], "redirect_observed")
        self.assertEqual(item["redirect"], {
            "locationKind": "absolute_https",
            "scheme": "https",
            "canonicalHostname": "example.org",
            "effectivePort": 443,
            "pathPresent": True,
        })
        combined = json.dumps(result, sort_keys=True) + "\n" + el.render_summary(result)
        for forbidden in (raw_location, "user", "pass", "token", "SECRET", "#fragment", "?token="):
            self.assertNotIn(forbidden, combined)
        self.assertEqual([method for _dest, method in transport.calls], ["HEAD"])

    def test_presigned_redirect_query_material_is_never_persisted(self):
        url = "https://redirect-presigned.example.org/a"
        raw_location = "https://example.org/object?X-Amz-Credential=SECRET&X-Amz-Signature=ABC"
        transport = FakeTransport({
            (url, "HEAD"): el.TransportResponse(method="HEAD", status=307, location=raw_location)
        })
        result = sidecar_for([url], transport=transport)
        item = result["results"][0]
        self.assertEqual(item["redirect"]["locationKind"], "absolute_https")
        combined = json.dumps(result, sort_keys=True) + "\n" + el.render_summary(result)
        for forbidden in (raw_location, "X-Amz-Credential", "SECRET", "X-Amz-Signature", "ABC"):
            self.assertNotIn(forbidden, combined)
        self.assertEqual([method for _dest, method in transport.calls], ["HEAD"])

    def test_relative_redirect_is_generic_and_does_not_persist_target_material(self):
        url = "https://redirect-relative.example.org/a"
        raw_location = "/callback?code=SECRET#state"
        transport = FakeTransport({
            (url, "HEAD"): el.TransportResponse(method="HEAD", status=302, location=raw_location)
        })
        result = sidecar_for([url], transport=transport)
        item = result["results"][0]
        self.assertEqual(item["state"], "redirect_observed")
        self.assertEqual(item["redirect"], {"locationKind": "relative"})
        combined = json.dumps(result, sort_keys=True) + "\n" + el.render_summary(result)
        for forbidden in (raw_location, "callback", "code=SECRET", "SECRET"):
            self.assertNotIn(forbidden, combined)
        self.assertEqual([method for _dest, method in transport.calls], ["HEAD"])

    def test_malformed_redirect_is_nonfatal_bounded_and_factual(self):
        url = "https://redirect-invalid.example.org/a"
        raw_location = "https://[malformed.example?token=SECRET"
        transport = FakeTransport({
            (url, "HEAD"): el.TransportResponse(method="HEAD", status=302, location=raw_location)
        })
        result = sidecar_for([url], transport=transport)
        item = result["results"][0]
        self.assertEqual(item["state"], "redirect_observed")
        self.assertEqual(item["redirect"], {"locationKind": "invalid"})
        combined = json.dumps(result, sort_keys=True) + "\n" + el.render_summary(result)
        self.assertNotIn(raw_location, combined)
        self.assertNotIn("SECRET", combined)
        self.assertEqual([method for _dest, method in transport.calls], ["HEAD"])

    def test_dns_and_transport_failures_are_unavailable_unknown(self):
        dns = sidecar_for(
            ["https://dnsfail.example.org/a"],
            resolver=FakeResolver(failure=socket.gaierror("synthetic")),
            transport=FakeTransport(),
        )
        self.assertEqual(dns["results"][0]["state"], "unavailable_unknown")
        self.assertEqual(dns["results"][0]["reason"], "dns_failure")
        for reason in ("tls_failure", "timeout", "connect_failure", "transport_failure"):
            url = f"https://{reason.replace('_','-')}.example.org/a"
            transport = FakeTransport({
                (url, "HEAD"): el.TransportResponse(method="HEAD", error_reason=reason)
            })
            result = sidecar_for([url], transport=transport)
            self.assertEqual(result["results"][0]["state"], "unavailable_unknown")
            self.assertEqual(result["results"][0]["reason"], reason)

    def test_head_unsupported_gets_exactly_one_bounded_get_fallback(self):
        for status in el.HEAD_FALLBACK_STATUSES:
            url = f"https://fallback{status}.example.org/a"
            transport = FakeTransport({
                (url, "HEAD"): el.TransportResponse(method="HEAD", status=status),
                (url, "GET"): el.TransportResponse(method="GET", status=206, body_cap_reached=False),
            })
            result = sidecar_for([url], transport=transport)
            self.assertEqual(result["results"][0]["state"], "reachable")
            self.assertEqual(result["results"][0]["method"], "GET")
            self.assertEqual([method for _dest, method in transport.calls], ["HEAD", "GET"])
            destination = transport.calls[-1][0]
            command = el.CurlTransport().build_command(destination, "GET", "/tmp/headers")
            self.assertIn("0-0", command)
            self.assertIn(str(el.GET_BODY_LIMIT_BYTES), command)

    def test_url_limit_discloses_incomplete_coverage_without_transport(self):
        urls = [f"https://same.example.org/{index}" for index in range(el.MAX_UNIQUE_URLS + 1)]
        transport = FakeTransport()
        result = sidecar_for(urls, transport=transport)
        self.assertEqual(result["coverage"]["state"], "coverage_limit_exceeded")
        self.assertIn("unique_url_limit:100", result["coverage"]["limitations"])
        self.assertEqual(result["counts"]["attempted"], 0)
        self.assertEqual(result["counts"]["unattempted"], len(urls))
        self.assertEqual(transport.calls, [])

    def test_host_limit_discloses_incomplete_coverage_without_transport(self):
        urls = [f"https://host{index}.example.org/a" for index in range(el.MAX_UNIQUE_HOSTS + 1)]
        transport = FakeTransport()
        result = sidecar_for(urls, transport=transport)
        self.assertEqual(result["coverage"]["state"], "coverage_limit_exceeded")
        self.assertIn("unique_host_limit:25", result["coverage"]["limitations"])
        self.assertEqual(transport.calls, [])

    def test_results_and_source_urls_are_deterministically_ordered(self):
        urls = ["https://z.example.org/a", "https://a.example.org/a", "https://m.example.org/a"]
        result = sidecar_for(urls)
        expected = sorted(urls)
        self.assertEqual([item["url"] for item in result["results"]], expected)
        links, _source = el.extract_external_links(evidence_bytes(urls))
        self.assertEqual([item.url for item in links], expected)

    def test_curl_command_has_no_credentials_cookies_or_private_headers(self):
        destination = el.validate_destination(
            el.SourceLink("https://safe.example.org/a", TARGET, 1),
            FakeResolver({"safe.example.org": [PUBLIC_V4]}),
        )
        command = el.CurlTransport().build_command(destination, "HEAD", "/tmp/headers")
        joined = " ".join(command).lower()
        for forbidden in ("authorization", "cookie", "referer", "origin:", "--user ", "--basic", "--header"):
            self.assertNotIn(forbidden, joined)
        self.assertIn(el.USER_AGENT.lower(), joined)
        controlled_env = ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "CURL_CA_BUNDLE", "SSL_CERT_FILE", "SSL_CERT_DIR")
        old = {key: os.environ.get(key) for key in controlled_env}
        try:
            for key in old:
                os.environ[key] = "synthetic-override"
            clean = el._sanitized_curl_env()
            for key in controlled_env:
                self.assertNotIn(key, clean)
        finally:
            for key, value in old.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value

    def test_malformed_or_missing_siteone_structured_evidence_fails_closed(self):
        base = evidence_for(["https://a.example.org/a"])
        cases = []
        missing_external = copy.deepcopy(base)
        del missing_external["tables"]["external-urls"]
        cases.append(missing_external)
        missing_skipped = copy.deepcopy(base)
        del missing_skipped["tables"]["skipped"]
        cases.append(missing_skipped)
        mismatch = copy.deepcopy(base)
        mismatch["tables"]["skipped"]["rows"][0]["reason"] = "Other"
        cases.append(mismatch)
        bad_row = copy.deepcopy(base)
        del bad_row["tables"]["external-urls"]["rows"][0]["foundOn"]
        cases.append(bad_row)
        for value in cases:
            with self.subTest(value=value):
                with self.assertRaises(el.ExternalLinkError):
                    el.extract_external_links(json.dumps(value).encode())

    def test_sidecar_contract_counts_policy_and_summary_are_bounded(self):
        urls = ["https://ok.example.org/a", "https://bad.example.org/a"]
        transport = FakeTransport({
            (urls[0], "HEAD"): el.TransportResponse(method="HEAD", status=200),
            (urls[1], "HEAD"): el.TransportResponse(method="HEAD", status=404),
        })
        result = sidecar_for(urls, transport=transport)
        self.assertEqual(result["schemaVersion"], "ldw.wqt-external-links.v1")
        self.assertEqual(result["siteId"], SITE_ID)
        self.assertEqual(result["target"], TARGET)
        self.assertEqual(result["source"]["wqtCommit"], WQT_COMMIT)
        self.assertEqual(result["source"]["siteOneTarget"], TARGET)
        self.assertRegex(result["policySha256"], r"^[0-9a-f]{64}$")
        self.assertEqual(result["counts"], {"discovered": 2, "attempted": 2, "rejected": 0, "unattempted": 0})
        summary = el.render_summary(result)
        self.assertIn("Reachability is observed from the GitHub runner", summary)
        self.assertIn("403/429 is not classified as a broken link", summary)

    def test_head_to_get_fallback_is_rate_limited_as_two_host_requests(self):
        url = "https://paced.example.org/a"
        transport = FakeTransport({
            (url, "HEAD"): el.TransportResponse(method="HEAD", status=405),
            (url, "GET"): el.TransportResponse(method="GET", status=200),
        })
        clock_values = iter([0.0, 0.1, 1.1])
        sleeps = []
        limiter = el.HostRateLimiter(
            minimum_interval=1.0,
            clock=lambda: next(clock_values),
            sleeper=lambda seconds: sleeps.append(seconds),
        )
        result = el.build_sidecar(
            site_id=SITE_ID,
            target=TARGET,
            wqt_commit=WQT_COMMIT,
            siteone_bytes=evidence_bytes([url]),
            resolver=FakeResolver(),
            transport=transport,
            limiter=limiter,
        )
        self.assertEqual(result["results"][0]["state"], "reachable")
        self.assertEqual([method for _dest, method in transport.calls], ["HEAD", "GET"])
        self.assertEqual(len(sleeps), 1)
        self.assertAlmostEqual(sleeps[0], 0.9)

    def test_canonical_request_hostname_matches_resolve_key_and_strips_fragment(self):
        source = el.SourceLink("https://SAFE.Example.Org./a?q=1#frag", TARGET, 1)
        destination = el.validate_destination(source, FakeResolver({"safe.example.org": [PUBLIC_V4]}))
        self.assertEqual(destination.hostname, "safe.example.org")
        self.assertEqual(destination.request_url, "https://safe.example.org/a?q=1")
        command = el.CurlTransport().build_command(destination, "HEAD", "/tmp/headers")
        self.assertIn(f"safe.example.org:443:{PUBLIC_V4}", command)
        self.assertEqual(command[-1], destination.request_url)

    def test_body_cap_after_valid_status_is_not_unreachability(self):
        response = el.TransportResponse(method="GET", status=200, body_cap_reached=True)
        self.assertEqual(el._classify_response(response), ("reachable", None))

    def test_wrong_siteone_build_fails_closed(self):
        value = evidence_for(["https://a.example.org/a"])
        value["crawler"]["version"] = "2.5.1"
        with self.assertRaisesRegex(el.ExternalLinkError, "siteone_unexpected_version"):
            el.extract_external_links(json.dumps(value).encode())

    def test_siteone_source_target_must_match_authorized_target(self):
        value = evidence_for(["https://a.example.org/a"])
        value["options"]["url"] = "https://other.example.test"
        with self.assertRaisesRegex(el.ExternalLinkError, "siteone_target_mismatch"):
            el.build_sidecar(
                site_id=SITE_ID,
                target=TARGET,
            wqt_commit=WQT_COMMIT,
                siteone_bytes=json.dumps(value).encode(),
                resolver=FakeResolver(),
                transport=FakeTransport(),
                limiter=fast_limiter(),
            )

    def test_same_host_requests_never_overlap(self):
        class SlowTransport(FakeTransport):
            def __init__(self):
                super().__init__()
                self.guard = threading.Lock()
                self.active = {}
                self.max_active = {}

            def probe(self, destination, method):
                host = destination.hostname
                with self.guard:
                    self.active[host] = self.active.get(host, 0) + 1
                    self.max_active[host] = max(self.max_active.get(host, 0), self.active[host])
                time.sleep(0.01)
                with self.guard:
                    self.active[host] -= 1
                self.calls.append((destination, method))
                return el.TransportResponse(method=method, status=200)

        urls = [f"https://same-host.example.org/{index}" for index in range(4)]
        transport = SlowTransport()
        result = el.build_sidecar(
            site_id=SITE_ID,
            target=TARGET,
            wqt_commit=WQT_COMMIT,
            siteone_bytes=evidence_bytes(urls),
            resolver=FakeResolver(),
            transport=transport,
            limiter=el.HostRateLimiter(minimum_interval=0, sleeper=lambda _seconds: None),
        )
        self.assertEqual(result["counts"]["attempted"], 4)
        self.assertEqual(transport.max_active["same-host.example.org"], 1)


if __name__ == "__main__":
    unittest.main()