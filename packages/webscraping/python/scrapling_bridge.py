#!/usr/bin/env python3
"""
scrapling_bridge.py — JSON-RPC adapter that wraps Scrapling's session-based
fetchers so that a Node.js parent process can call them via stdin/stdout.

Protocol (one JSON object per line on stdin, one JSON object on stdout):

  REQUEST  { "action": "fetch_stealthy"|"fetch_dynamic"|"health",
             "url": "...", "method": "GET", "headers": {...},
             "body": "...", "timeoutMs": 60000, "maxBytes": 10_000_000 }

  RESPONSE { "success": true, "status": 200, "headers": {...},
             "body": "...", "finalUrl": "...", "elapsedMs": 123 }
         or { "success": false, "error": "..." }

Uses:
  - FetcherSession  for stealthy  (TLS impersonation, Cloudflare bypass)
  - DynamicSession  for dynamic   (Playwright-based headful browser)
"""

from __future__ import annotations

import json
import sys
import time
from typing import Any

# ---------------------------------------------------------------------------
# Graceful import — explain what's missing if Scrapling isn't installed.
# ---------------------------------------------------------------------------
try:
    from scrapling.fetchers import FetcherSession  # type: ignore[import-untyped]
    from scrapling.fetchers import DynamicSession  # type: ignore[import-untyped]
except ImportError as exc:
    print(
        json.dumps(
            {
                "success": False,
                "error": (
                    "Scrapling is not installed. Run:\\n"
                    "  pip install 'scrapling[fetchers]'\\n"
                    "  scrapling install\\n"
                    f"  (raw: {exc})"
                ),
            }
        ),
        flush=True,
    )
    sys.exit(1)

# ---------------------------------------------------------------------------
# Adaptor import — may be unavailable in older versions of Scrapling.
# ---------------------------------------------------------------------------
_adaptor_available = False
try:
    from scrapling import Adaptor  # type: ignore[import-untyped]
    _adaptor_available = True
except ImportError:
    pass


# ---------------------------------------------------------------------------
# Session singletons — created lazily so the bridge starts instantly.
# ---------------------------------------------------------------------------
_stealthy_session: FetcherSession | None = None
_dynamic_session: DynamicSession | None = None


def _get_stealthy() -> FetcherSession:
    global _stealthy_session
    if _stealthy_session is None:
        _stealthy_session = FetcherSession(
            impersonate="chrome",
            timeout=60,
        )
    return _stealthy_session


def _get_dynamic() -> DynamicSession:
    global _dynamic_session
    if _dynamic_session is None:
        _dynamic_session = DynamicSession(
            headless=True,
            timeout=60,
        )
    return _dynamic_session


# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------


def _handle_find_similar(req: dict[str, Any]) -> dict[str, Any]:
    """Find the best-matching element in new_html for a selector from old_html.

    Uses Scrapling's Adaptor.similarity when available; falls back to a
    structural-tag-path heuristic otherwise.
    """
    old_html: str = req.get("oldHtml", "")
    new_html: str = req.get("newHtml", "")
    selector: str = req.get("selector", "")
    selector_type: str = req.get("selectorType", "css")

    if not old_html or not new_html or not selector:
        return {
            "success": False,
            "error": "find_similar requires oldHtml, newHtml, and selector",
        }

    try:
        if _adaptor_available:
            return _find_similar_scrapling(old_html, new_html, selector, selector_type)
        else:
            return _find_similar_fallback(old_html, new_html, selector, selector_type)
    except Exception as exc:
        return {"success": False, "error": f"find_similar error: {exc}"}


def _find_similar_scrapling(
    old_html: str, new_html: str, selector: str, selector_type: str
) -> dict[str, Any]:
    """Use Scrapling's Adaptor for similarity-based relocation."""
    old_adaptor = Adaptor(old_html)
    new_adaptor = Adaptor(new_html)

    # Locate the target element in the old document.
    try:
        if selector_type == "xpath":
            target_el = old_adaptor.xpath(selector)
        else:
            target_el = old_adaptor.css(selector)
    except Exception:
        return {
            "success": False,
            "error": f"Selector '{selector}' did not match in old document",
        }

    if not target_el:
        return {
            "success": False,
            "error": f"Selector '{selector}' returned no elements in old document",
        }

    # Adaptor.css/xpath returns a list — take the first match.
    if isinstance(target_el, list):
        if len(target_el) == 0:
            return {
                "success": False,
                "error": "Selector matched no elements in old document",
            }
        target_el = target_el[0]

    # Find the most similar element in the new document.
    # Scrapling's find_similar takes a target node and a pool, returns
    # (node, score) pairs sorted by similarity.
    try:
        candidates = Adaptor.find_similar(
            target_el,
            new_adaptor,
            threshold=0.15,
        )
    except Exception:
        # find_similar may not exist in all versions — fall back to heuristic.
        return _find_similar_fallback(old_html, new_html, selector, selector_type)

    if not candidates or len(candidates) == 0:
        return {
            "success": False,
            "error": "No similar elements found in new document",
        }

    best_node, best_score = candidates[0]

    # Build a CSS selector for the best match.
    new_css = best_node.css_selectors
    if isinstance(new_css, list):
        new_css = new_css[0] if new_css else ""
    new_xpath = best_node.xpath_selector
    if isinstance(new_xpath, list):
        new_xpath = new_xpath[0] if new_xpath else ""

    return {
        "success": True,
        "css": str(new_css),
        "xpath": str(new_xpath),
        "confidence": round(float(best_score), 4),
    }


def _find_similar_fallback(
    old_html: str, new_html: str, selector: str, selector_type: str
) -> dict[str, Any]:
    """Tag-path structural heuristic when Scrapling Adaptor is unavailable."""
    from html.parser import HTMLParser

    class TagCollector(HTMLParser):
        def __init__(self) -> None:
            super().__init__()
            self.path: list[str] = []
            self.elements: list[dict[str, Any]] = []

        def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
            self.path.append(tag)
            attrs_dict = {k: (v or "") for k, v in attrs}
            self.elements.append({
                "tag": tag,
                "attrs": attrs_dict,
                "path": list(self.path),
                "depth": len(self.path),
                "idx": len(self.elements),
            })

        def handle_endtag(self, tag: str) -> None:
            if self.path and self.path[-1] == tag:
                self.path.pop()

    # Parse old HTML to get the target element's structural signature.
    old_collector = TagCollector()
    old_collector.feed(old_html)
    old_els = old_collector.elements

    # Parse new HTML.
    new_collector = TagCollector()
    new_collector.feed(new_html)
    new_els = new_collector.elements

    if not old_els or not new_els:
        return {"success": False, "error": "Could not parse HTML documents"}

    # For CSS selectors, try to match by tag + class/id heuristics.
    # For XPath, extract tag path.
    target_idx = -1
    if selector_type == "css":
        tag = selector.split("#")[0].split(".")[0].split("[")[0].split(":")[0] or "*"
        cls = ""
        if "." in selector:
            cls = selector.split(".")[1].split("#")[0].split("[")[0].split(":")[0]
        el_id = ""
        if "#" in selector:
            el_id = selector.split("#")[1].split(".")[0].split("[")[0].split(":")[0]

        for i, el in enumerate(old_els):
            if tag != "*" and el["tag"] != tag:
                continue
            if cls and el["attrs"].get("class", "") != cls:
                continue
            if el_id and el["attrs"].get("id", "") != el_id:
                continue
            target_idx = i
            break
    else:
        parts = [p for p in selector.strip("/").split("/") if p and not p.startswith("@")]
        if parts:
            leaf_tag = parts[-1]
            for i, el in enumerate(old_els):
                if el["tag"] == leaf_tag:
                    target_idx = i
                    break

    if target_idx < 0:
        return {"success": False, "error": "Could not locate target element in old document"}

    target = old_els[target_idx]
    tag_path = target["path"]
    target_tag = target["tag"]
    target_cls = target["attrs"].get("class", "")
    target_id = target["attrs"].get("id", "")

    best_match = None
    best_score = 0.0
    for el in new_els:
        if el["tag"] != target_tag:
            continue

        score = 0.0
        depth_diff = abs(el["depth"] - target["depth"])
        score += max(0, 1.0 - depth_diff * 0.2)
        common = 0
        for old_tag, new_tag in zip(tag_path, el["path"]):
            if old_tag == new_tag:
                common += 1
            else:
                break
        path_similarity = common / max(len(tag_path), len(el["path"]), 1)
        score += path_similarity * 0.4
        if target_cls and el["attrs"].get("class", "") == target_cls:
            score += 0.3
        if target_id and el["attrs"].get("id", "") == target_id:
            score += 0.5

        if score > best_score:
            best_score = score
            best_match = el

    if best_match is None:
        return {"success": False, "error": "No similar element found in new document"}

    el = best_match
    css = el["tag"]
    if el["attrs"].get("id"):
        css = f"{el['tag']}#{el['attrs']['id']}"
    elif el["attrs"].get("class"):
        css = f"{el['tag']}.{el['attrs']['class'].split()[0]}"
    else:
        css = f"{el['tag']}:nth-of-type({el['idx'] + 1})"

    xpath_parts = "/".join(el["path"])
    xpath = f"/{xpath_parts}"

    return {
        "success": True,
        "css": css,
        "xpath": xpath,
        "confidence": round(best_score, 4),
    }


def handle_request(req: dict[str, Any]) -> dict[str, Any]:
    """Route a single JSON-RPC request to the appropriate handler."""
    start = time.monotonic()
    action: str = req.get("action", "")

    if action == "health":
        return {"success": True, "elapsedMs": 0, "status": 200}

    if action == "find_similar":
        return _handle_find_similar(req)

    if action not in ("fetch_stealthy", "fetch_dynamic"):
        return {"success": False, "error": f"unknown action: {action}"}

    url: str = req["url"]
    method: str = req.get("method", "GET")
    headers: dict[str, str] | None = req.get("headers")
    body: str | None = req.get("body")
    timeout_ms: float | None = req.get("timeoutMs")
    max_bytes: int | None = req.get("maxBytes")

    kwargs: dict[str, Any] = {"method": method}
    if headers:
        kwargs["headers"] = headers
    if body:
        kwargs["data"] = body
    if timeout_ms:
        kwargs["timeout"] = timeout_ms / 1000.0

    try:
        if action == "fetch_stealthy":
            sess = _get_stealthy()
        else:
            sess = _get_dynamic()

        resp = sess.fetch(url, **kwargs)

        # Truncate body if maxBytes was set.
        content = resp.text
        if max_bytes is not None and len(content) > max_bytes:
            content = content[:max_bytes]

        elapsed = (time.monotonic() - start) * 1000

        return {
            "success": True,
            "status": resp.status_code,
            "headers": dict(resp.headers),
            "body": content,
            "finalUrl": str(resp.url),
            "elapsedMs": round(elapsed, 1),
        }

    except Exception as exc:
        elapsed = (time.monotonic() - start) * 1000
        return {
            "success": False,
            "error": f"{type(exc).__name__}: {exc}",
            "elapsedMs": round(elapsed, 1),
        }


# ---------------------------------------------------------------------------
# Main loop — read JSON lines from stdin, write JSON lines to stdout.
# ---------------------------------------------------------------------------
def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            req = json.loads(line)
        except json.JSONDecodeError as exc:
            print(
                json.dumps({"success": False, "error": f"invalid json: {exc}"}),
                flush=True,
            )
            continue

        resp = handle_request(req)
        print(json.dumps(resp), flush=True)


if __name__ == "__main__":
    main()
