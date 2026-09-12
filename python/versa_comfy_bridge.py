#!/usr/bin/env python3
"""VERSA CLASS — ComfyUI workflows plus a titanium watchdog.

Text Lab erase and rebuild both POST real graphs to ``/prompt`` and wait on
``/history``.  Every returned raster is validated.  A dead or hung server is
diagnosed with ``/system_stats`` and resuscitated through Node.js
(``comfy-service.cjs``): kill, restart, retry.
"""

from __future__ import annotations

import json
import mimetypes
import os
import random
import shutil
import signal
import subprocess
import sys
import time
import urllib.parse
from io import BytesIO

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8188
DEFAULT_BASE_URL = "http://127.0.0.1:8188"
DEFAULT_HOOK = os.environ.get("VERSA_COMFY_HOOK", "http://127.0.0.1:17881/comfy/resuscitate")

_SEARCH_PATHS = [
    os.environ.get("VERSA_COMFY_HOME", ""),
    "/Users/abdelmouiz/ComfyUI-Installs/VERSA CLASS/ComfyUI",
    os.path.expanduser("~/ComfyUI"),
    os.path.expanduser("~/Documents/ComfyUI"),
    os.path.expanduser("~/Desktop/ComfyUI"),
    os.path.expanduser("~/Applications/ComfyUI"),
    "/Applications/ComfyUI",
    os.path.expanduser("~/comfyui"),
    os.path.expanduser("~/Library/Application Support/ComfyUI"),
]

_STARTUP_TIMEOUT_S = 60
_POLL_INTERVAL_S = 2.0
_REQUEST_TIMEOUT_S = 30
_HISTORY_POLL_S = 1.0
_RETRY_WAITS = (2.0, 5.0, 10.0)
_POSITIVE_INPAINT = (
    "seamless reconstructed background, clean paper, matching surrounding texture, "
    "no text, no letters, no words, no glyphs, no watermark"
)
_NEGATIVE_INPAINT = "text, letters, words, watermark, logo, writing, typography, caption"


def find_comfy_home():
    for candidate in _SEARCH_PATHS:
        if candidate and os.path.isfile(os.path.join(candidate, "main.py")):
            return candidate
    return None


def _build_session():
    retry = Retry(
        total=5,
        connect=5,
        read=5,
        backoff_factor=0.4,
        status_forcelist=(502, 503, 504),
        allowed_methods=frozenset({"GET", "POST"}),
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry, pool_connections=8, pool_maxsize=8)
    session = requests.Session()
    session.mount("http://127.0.0.1", adapter)
    session.mount("http://localhost", adapter)
    session.headers.update({"Connection": "keep-alive"})
    return session


_SESSION = _build_session()


def _debug_log(*_args, **_kwargs):
    return None


class ComfyBridgeError(RuntimeError):
    def __init__(self, message, code="COMFY_BRIDGE_FAILED", **details):
        super().__init__(message)
        self.code = code
        self.details = details


def validate_image_bytes(payload, *, allow_empty=False):
    """Reject 0-byte, unreadable, or mathematically solid black/white rasters."""
    if payload is None:
        return False, "missing"
    data = bytes(payload)
    if not data:
        return False, "zero-byte"
    if len(data) < 24:
        return False, "too-small"
    try:
        from PIL import Image
        import numpy as np
        image = Image.open(BytesIO(data))
        image.load()
        array = np.asarray(image)
    except Exception as error:  # noqa: BLE001
        return False, f"unreadable:{error}"
    if array.size == 0:
        return False, "empty-array"
    if allow_empty:
        return True, "ok"
    unique = int(len(set(array.reshape(-1).tolist()[: min(array.size, 4096)])))
    try:
        import numpy as np
        std = float(np.asarray(array, dtype=np.float32).std())
        mean = float(np.asarray(array, dtype=np.float32).mean())
    except Exception:
        std, mean = 1.0, 128.0
    if std < 0.35 and (mean <= 1.0 or mean >= 254.0):
        return False, f"solid mean={mean:.1f} std={std:.3f} unique~{unique}"
    return True, "ok"


def _is_invalid_workflow(error):
    """A rejected graph is not a dead server. Restarting ComfyUI cannot invent a checkpoint."""
    code = getattr(error, "code", "") or ""
    text = str(error)
    return code in {"COMFY_PROMPT_REJECTED", "COMFY_NO_CHECKPOINT"} or any(
        token in text
        for token in (
            "prompt_outputs_failed_validation",
            "value_not_in_list",
            "not in []",
            "COMFY_NO_CHECKPOINT",
        )
    )


class ComfyWatchdog:
    """Three-strike wrapper: validate output, diagnose hangs, resuscitate ComfyUI."""

    def __init__(self, bridge):
        self.bridge = bridge

    def run(self, operation, *, timeout=600):
        last_error = None
        for attempt in range(1, 4):
            if attempt == 3:
                stats = self.bridge.system_stats()
                self.bridge.request_resuscitation(
                    f"strike 2: {last_error}",
                    stats=stats or {"reachable": False},
                )
                if not self.bridge.ensure_running(timeout=max(timeout, _STARTUP_TIMEOUT_S)):
                    raise ComfyBridgeError(
                        self.bridge.last_error or "ComfyUI did not recover after a brutal restart.",
                        code="COMFY_RESUSCITATION_FAILED",
                        attempt=attempt,
                        stats=stats,
                    )
                time.sleep(_RETRY_WAITS[2])
            try:
                result = operation()
                self._assert_valid(result)
                _debug_log(
                    "versa_comfy_bridge.py:watchdog",
                    "watchdog accepted result",
                    {"attempt": attempt, "ok": True},
                    "H2",
                )
                return result
            except Exception as error:  # noqa: BLE001
                last_error = error
                if _is_invalid_workflow(error):
                    _debug_log(
                        "versa_comfy_bridge.py:watchdog",
                        "invalid workflow — not restarting Comfy",
                        {"attempt": attempt, "error": str(error)[:240]},
                        "H1",
                    )
                    raise
                stats = self.bridge.system_stats()
                _debug_log(
                    "versa_comfy_bridge.py:watchdog",
                    "watchdog strike",
                    {
                        "attempt": attempt,
                        "alive": bool(stats),
                        "error": str(error)[:240],
                        "hasStats": bool(stats),
                    },
                    "H1",
                )
                if attempt == 1:
                    time.sleep(_RETRY_WAITS[0])
                elif attempt == 2:
                    if not stats:
                        self.bridge.request_resuscitation(str(error), stats={"reachable": False})
                        if not self.bridge.ensure_running(timeout=max(timeout, _STARTUP_TIMEOUT_S)):
                            raise ComfyBridgeError(
                                self.bridge.last_error or "ComfyUI did not recover after a brutal restart.",
                                code="COMFY_RESUSCITATION_FAILED",
                                attempt=attempt,
                                stats=stats,
                            ) from error
                    time.sleep(_RETRY_WAITS[1])
        raise ComfyBridgeError(
            f"ComfyUI failed after 3 watchdog strikes: {last_error}",
            code="COMFY_WATCHDOG_EXHAUSTED",
        )

    def _assert_valid(self, result):
        if not isinstance(result, dict):
            raise ComfyBridgeError("ComfyUI returned no structured result.", code="COMFY_OUTPUT_MISSING")
        blob = result.get("imageBytes") or result.get("layerBytes")
        if blob:
            ok, reason = validate_image_bytes(blob, allow_empty=result.get("allowEmpty") is True)
            if not ok:
                raise ComfyBridgeError(
                    f"ComfyUI output failed mathematical validation ({reason}).",
                    code="COMFY_OUTPUT_INVALID",
                    reason=reason,
                )
        for record in result.get("runLayers") or []:
            layer = record.get("imageBytes") if isinstance(record, dict) else None
            if not layer:
                raise ComfyBridgeError("A glyph layer was empty.", code="COMFY_OUTPUT_INVALID")
            ok, reason = validate_image_bytes(layer)
            if not ok:
                raise ComfyBridgeError(
                    f"A glyph layer failed validation ({reason}).",
                    code="COMFY_OUTPUT_INVALID",
                    reason=reason,
                )


class ComfyBridge:
    def __init__(self, host=DEFAULT_HOST, port=DEFAULT_PORT, home=None):
        self.host = DEFAULT_HOST
        self.port = DEFAULT_PORT
        self.home = home or find_comfy_home()
        self.process = None
        self.pid = None
        self.last_error = None
        self.watchdog = ComfyWatchdog(self)
        self._object_info = None
        self.session = _SESSION

    @property
    def base_url(self):
        return DEFAULT_BASE_URL

    def ping(self, timeout=3):
        return bool(self.system_stats(timeout=timeout))

    def system_stats(self, timeout=3):
        try:
            response = self.session.get(f"{self.base_url}/system_stats", timeout=timeout)
            if response.status_code != 200:
                return None
            return response.json()
        except Exception as error:  # noqa: BLE001
            self.last_error = str(error)
            return None

    def _wait_until_ready(self, timeout=_STARTUP_TIMEOUT_S):
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self.ping(timeout=_POLL_INTERVAL_S):
                return True
            if self.process is not None and self.process.poll() is not None:
                return False
            time.sleep(_POLL_INTERVAL_S)
        return False

    def ensure_running(self, timeout=_STARTUP_TIMEOUT_S):
        if self.ping():
            return True
        self.request_resuscitation("python bridge: /system_stats not ready", stats={"reachable": False})
        if self._wait_until_ready(timeout=timeout):
            return True
        if not self.home:
            self.last_error = (
                "ComfyUI is not installed where this can find it. Set VERSA_COMFY_HOME "
                "to the checkout containing main.py."
            )
            return False

        python = sys.executable
        local_venv = os.path.join(self.home, ".venv", "bin", "python")
        if os.path.exists(local_venv):
            python = local_venv
        elif shutil.which("python3"):
            python = shutil.which("python3")

        log_path = os.environ.get(
            "VERSA_COMFY_LOG",
            os.path.expanduser("~/Library/Logs/VERSA CLASS/comfyui.log"),
        )
        try:
            os.makedirs(os.path.dirname(log_path), exist_ok=True)
            log_handle = open(log_path, "a", encoding="utf-8")
            self.process = subprocess.Popen(
                [
                    python,
                    "main.py",
                    "--listen",
                    DEFAULT_HOST,
                    "--port",
                    str(DEFAULT_PORT),
                    "--disable-auto-launch",
                ],
                cwd=self.home,
                stdout=log_handle,
                stderr=log_handle,
                start_new_session=True,
            )
            self.pid = self.process.pid
        except Exception as error:  # noqa: BLE001
            self.last_error = f"Could not launch ComfyUI: {error}"
            return False

        if self._wait_until_ready(timeout=timeout):
            return True
        self.last_error = f"ComfyUI did not answer {DEFAULT_BASE_URL}/system_stats within {timeout}s."
        self.shutdown()
        return False

    def shutdown(self):
        if not self.process:
            return False
        try:
            os.killpg(os.getpgid(self.process.pid), signal.SIGTERM)
            self.process.wait(timeout=15)
        except Exception:  # noqa: BLE001
            try:
                self.process.kill()
            except Exception:  # noqa: BLE001
                pass
        self.process = None
        self.pid = None
        return True

    def request_resuscitation(self, reason, stats=None):
        payload = {
            "event": "comfy-watchdog",
            "state": "restarting",
            "reason": str(reason)[:400],
            "stats": stats or {},
        }
        print(json.dumps(payload), file=sys.stderr, flush=True)
        _debug_log("versa_comfy_bridge.py:resuscitate", "requesting Node brutal restart", payload, "H1")
        hook = os.environ.get("VERSA_COMFY_HOOK", DEFAULT_HOOK)
        try:
            response = self.session.post(hook, json=payload, timeout=45)
            return response.json() if response.content else {"ok": False}
        except Exception as error:  # noqa: BLE001
            self.last_error = f"Watchdog hook failed: {error}"
            return {"ok": False, "error": self.last_error}

    def _request(self, path, *, data=None, headers=None, timeout=_REQUEST_TIMEOUT_S, method=None):
        verb = (method or ("POST" if data is not None else "GET")).upper()
        url = f"{self.base_url}{path}"
        if verb == "POST":
            response = self.session.post(url, data=data, headers=headers or {}, timeout=timeout)
        else:
            response = self.session.get(url, headers=headers or {}, timeout=timeout)
        raw = response.content
        if not raw:
            return {}
        try:
            return response.json()
        except ValueError:
            return {"raw": raw}

    def _post(self, path, payload, timeout=_REQUEST_TIMEOUT_S):
        return self._request(
            path,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            timeout=timeout,
        )

    def _get(self, path, timeout=_REQUEST_TIMEOUT_S):
        return self._request(path, timeout=timeout)

    def object_info(self, refresh=False):
        if self._object_info is not None and not refresh:
            return self._object_info
        for path in ("/object_info", "/api/object_info"):
            try:
                info = self._get(path)
                if isinstance(info, dict) and info:
                    self._object_info = info
                    return info
            except Exception as error:  # noqa: BLE001
                self.last_error = str(error)
        return {}

    def available_nodes(self):
        try:
            return set(self.object_info().keys())
        except Exception as error:  # noqa: BLE001
            self.last_error = str(error)
            return set()

    def has_font_nodes(self):
        return any(
            any(token in name.lower() for token in ("font", "glyph", "typeface", "text overlay", "draw text", "textimage"))
            for name in self.available_nodes()
        )

    def checkpoint_choices(self):
        info = self.object_info()
        spec = (((info.get("CheckpointLoaderSimple") or {}).get("input") or {}).get("required") or {}).get("ckpt_name")
        if not isinstance(spec, list) or not spec:
            return []
        choices = spec[0] if isinstance(spec[0], list) else spec
        return [name for name in choices if isinstance(name, str) and name.strip() and name != "put_checkpoints_here"]

    def has_checkpoint(self):
        return bool(self.checkpoint_choices())

    def _checkpoint_name(self):
        configured = os.environ.get("VERSA_COMFY_CHECKPOINT", "").strip()
        choices = self.checkpoint_choices()
        if configured and configured in choices:
            return configured
        if choices:
            return choices[0]
        return None

    def _vae_name(self):
        return os.environ.get("VERSA_COMFY_VAE", "").strip() or None

    def upload_image(self, image, filename, image_type="input"):
        from PIL import Image

        if hasattr(image, "save"):
            buffer = BytesIO()
            image.save(buffer, format="PNG")
            payload = buffer.getvalue()
        else:
            payload = bytes(image)
        boundary = f"----VersaComfy{int(time.time() * 1000)}"
        body = bytearray()
        fields = {"overwrite": "true", "type": image_type}
        for name, value in fields.items():
            body.extend(f"--{boundary}\r\n".encode("utf-8"))
            body.extend(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8"))
            body.extend(str(value).encode("utf-8") + b"\r\n")
        ctype = mimetypes.guess_type(filename)[0] or "image/png"
        body.extend(f"--{boundary}\r\n".encode("utf-8"))
        body.extend(
            f'Content-Disposition: form-data; name="image"; filename="{filename}"\r\n'.encode("utf-8")
        )
        body.extend(f"Content-Type: {ctype}\r\n\r\n".encode("utf-8"))
        body.extend(payload)
        body.extend(b"\r\n")
        body.extend(f"--{boundary}--\r\n".encode("utf-8"))
        result = self._request(
            "/upload/image",
            data=bytes(body),
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
            timeout=60,
        )
        name = result.get("name") if isinstance(result, dict) else None
        if not name:
            raise ComfyBridgeError("ComfyUI rejected the image upload.", code="COMFY_UPLOAD_FAILED")
        return name

    def submit(self, workflow, client_id="versa-class"):
        try:
            body = self._post("/prompt", {"prompt": workflow, "client_id": client_id}, timeout=60)
        except Exception as error:  # noqa: BLE001
            self.last_error = str(error)
            raise ComfyBridgeError(f"POST /prompt failed: {error}", code="COMFY_PROMPT_FAILED") from error
        prompt_id = body.get("prompt_id") if isinstance(body, dict) else None
        if not prompt_id:
            raise ComfyBridgeError(
                f"ComfyUI queued nothing: {json.dumps(body)[:300]}",
                code="COMFY_PROMPT_REJECTED",
            )
        return prompt_id

    def wait_for(self, prompt_id, timeout=300):
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                history = self._get(f"/history/{prompt_id}", timeout=15)
            except Exception as error:  # noqa: BLE001
                self.last_error = str(error)
                if not self.system_stats():
                    raise ComfyBridgeError(
                        f"ComfyUI died while waiting for {prompt_id}: {error}",
                        code="COMFY_DEAD",
                    ) from error
                time.sleep(_HISTORY_POLL_S)
                continue
            entry = history.get(prompt_id) if isinstance(history, dict) else None
            if entry:
                status = (entry.get("status") or {}).get("status_str")
                if status == "error":
                    self.last_error = json.dumps(entry.get("status"))[:400]
                    raise ComfyBridgeError(self.last_error, code="COMFY_PROMPT_ERROR")
                if entry.get("outputs"):
                    return entry["outputs"]
            time.sleep(_HISTORY_POLL_S)
        raise ComfyBridgeError(
            f"Prompt {prompt_id} did not finish within {timeout}s.",
            code="COMFY_HISTORY_TIMEOUT",
        )

    def view_image(self, image_info):
        if not isinstance(image_info, dict):
            raise ComfyBridgeError("ComfyUI output image record is missing.", code="COMFY_OUTPUT_MISSING")
        query = urllib.parse.urlencode({
            "filename": image_info.get("filename") or "",
            "subfolder": image_info.get("subfolder") or "",
            "type": image_info.get("type") or "output",
        })
        response = self.session.get(f"{self.base_url}/view?{query}", timeout=60)
        response.raise_for_status()
        return response.content

    def _first_image_bytes(self, outputs):
        for _node, payload in (outputs or {}).items():
            images = (payload or {}).get("images") or []
            if images:
                return self.view_image(images[0]), images
        raise ComfyBridgeError("ComfyUI finished without an image output.", code="COMFY_OUTPUT_MISSING")

    def _load_workflow(self, workflow=None, workflow_path=None):
        if isinstance(workflow, dict):
            return json.loads(json.dumps(workflow))
        if workflow_path:
            with open(workflow_path, encoding="utf-8") as handle:
                return json.load(handle)
        return None

    def _inpaint_workflow(self, image_name, mask_name, seed):
        custom = self._load_workflow(
            workflow=None,
            workflow_path=os.environ.get("VERSA_COMFY_INPAINT_WORKFLOW") or None,
        )
        if custom:
            return self._inject_load_images(custom, image_name, mask_name)
        checkpoint = self._checkpoint_name()
        if not checkpoint:
            raise ComfyBridgeError(
                "ComfyUI has no Stable Diffusion checkpoint installed. "
                "models/checkpoints is empty, so the SD inpaint graph cannot run.",
                code="COMFY_NO_CHECKPOINT",
            )
        graph = {
            "1": {"class_type": "LoadImage", "inputs": {"image": image_name}},
            "2": {"class_type": "LoadImage", "inputs": {"image": mask_name}},
            "8": {"class_type": "ImageToMask", "inputs": {"image": ["2", 0], "channel": "red"}},
            "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": checkpoint}},
            "6": {"class_type": "CLIPTextEncode", "inputs": {"text": _POSITIVE_INPAINT, "clip": ["4", 1]}},
            "7": {"class_type": "CLIPTextEncode", "inputs": {"text": _NEGATIVE_INPAINT, "clip": ["4", 1]}},
            "5": {
                "class_type": "VAEEncodeForInpaint",
                "inputs": {"grow_mask_by": 6, "pixels": ["1", 0], "vae": ["4", 2], "mask": ["8", 0]},
            },
            "3": {
                "class_type": "KSampler",
                "inputs": {
                    "seed": int(seed),
                    "steps": 22,
                    "cfg": 7.0,
                    "sampler_name": "euler",
                    "scheduler": "normal",
                    "denoise": 1.0,
                    "model": ["4", 0],
                    "positive": ["6", 0],
                    "negative": ["7", 0],
                    "latent_image": ["5", 0],
                },
            },
            "9": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["4", 2]}},
            "10": {"class_type": "SaveImage", "inputs": {"filename_prefix": "versa_inpaint", "images": ["9", 0]}},
        }
        vae = self._vae_name()
        if vae:
            graph["11"] = {"class_type": "VAELoader", "inputs": {"vae_name": vae}}
            graph["5"]["inputs"]["vae"] = ["11", 0]
            graph["9"]["inputs"]["vae"] = ["11", 0]
        return graph

    def _inject_load_images(self, workflow, image_name, mask_name=None):
        loaders = [
            (key, node) for key, node in workflow.items()
            if isinstance(node, dict) and node.get("class_type") == "LoadImage"
        ]
        if loaders:
            loaders[0][1].setdefault("inputs", {})["image"] = image_name
            if mask_name and len(loaders) > 1:
                loaders[1][1].setdefault("inputs", {})["image"] = mask_name
        return workflow

    def execute_inpainting_workflow(
        self,
        image,
        mask,
        *,
        workflow=None,
        workflow_path=None,
        timeout=600,
        seed=None,
        filename_prefix="versa_inpaint",
    ):
        """VAE Encode → KSampler → Decode. Image + MobileSAM mask, nothing else."""
        if not self.ensure_running(timeout=min(timeout, _STARTUP_TIMEOUT_S)):
            raise ComfyBridgeError(self.last_error or "ComfyUI is unavailable.", code="COMFYUI_UNAVAILABLE")

        def operation():
            image_name = self.upload_image(image, f"{filename_prefix}_src.png")
            mask_name = self.upload_image(mask, f"{filename_prefix}_mask.png")
            graph = self._load_workflow(workflow, workflow_path) or self._inpaint_workflow(
                image_name, mask_name, seed if seed is not None else random.randint(1, 2**31 - 1)
            )
            if workflow or workflow_path:
                graph = self._inject_load_images(graph, image_name, mask_name)
            _debug_log(
                "versa_comfy_bridge.py:inpaint",
                "submitting inpaint workflow",
                {"nodes": len(graph), "timeout": timeout},
                "H1",
            )
            prompt_id = self.submit(graph)
            outputs = self.wait_for(prompt_id, timeout=timeout)
            image_bytes, images = self._first_image_bytes(outputs)
            return {
                "promptId": prompt_id,
                "imageBytes": image_bytes,
                "images": images,
                "engine": "comfyui",
            }

        return self.watchdog.run(operation, timeout=timeout)

    def inpaint(self, image, mask, **kwargs):
        return self.execute_inpainting_workflow(image, mask, **kwargs)

    def status(self):
        stats = self.system_stats()
        return {
            "reachable": bool(stats),
            "home": self.home,
            "url": self.base_url,
            "managed": self.process is not None,
            "pid": self.pid,
            "fontNodes": self.has_font_nodes() if stats else False,
            "systemStats": stats,
            "error": self.last_error,
        }


if __name__ == "__main__":
    print(json.dumps(ComfyBridge().status(), indent=2))
