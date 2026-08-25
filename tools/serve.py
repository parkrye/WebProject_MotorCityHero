#!/usr/bin/env python3
"""모터시티 히어로 로컬 서버.

프로젝트 루트를 정적으로 서빙한다. 기본으로 0.0.0.0 에 바인딩해서 같은 공유기에
물린 다른 기기(폰 · 노트북)에서도 접속할 수 있게 연다. 표준 라이브러리만 쓴다.

    python tools/serve.py                   # 47823 포트로 열고 브라우저 실행
    python tools/serve.py --port 50000      # 포트 지정
    python tools/serve.py --local-only      # 이 PC 에서만 접속
    python tools/serve.py --close-firewall  # 등록해둔 방화벽 규칙 제거 후 종료
"""
from __future__ import annotations

import argparse
import base64
import http.server
import ipaddress
import json
import os
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from http import HTTPStatus

# IANA 미할당이고 Windows 임시 포트 범위(49152~) 밖이라 충돌 가능성이 낮다.
DEFAULT_PORT = 47823
PORT_SCAN_LIMIT = 20
FIREWALL_RULE_NAME = "MotorCityHero LAN"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IS_WINDOWS = os.name == "nt"

# 랭킹. 레포 안 data/scores.json 에 그냥 담아둔다.
SCORES_PATH = os.path.join(ROOT, "data", "scores.json")
SCORES_API = "/api/scores"
MAX_ENTRIES = 100
MAX_NAME_LENGTH = 16
MAX_BODY_BYTES = 4096
NAME_CHARSET = set("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ")
scores_lock = threading.Lock()


def clean_name(value):
    """게임의 비트맵 폰트에 있는 글자만 남긴다."""
    text = "".join(ch for ch in str(value or "").upper() if ch in NAME_CHARSET)
    return text.strip()[:MAX_NAME_LENGTH] or "NO NAME"


def clamp_int(value, low, high, default=0):
    try:
        return max(low, min(high, int(value)))
    except (TypeError, ValueError):
        return default


def read_scores():
    try:
        with open(SCORES_PATH, encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return []

    entries = data.get("entries") if isinstance(data, dict) else data
    return entries if isinstance(entries, list) else []


def rank_entries(entries):
    """점수 내림차순. 같으면 먼저 올린 기록이 위로 간다."""
    ordered = sorted(entries, key=lambda e: (-e.get("score", 0), e.get("at", 0)))
    return ordered[:MAX_ENTRIES]


def add_score(payload):
    """기록 하나를 더하고 정리된 전체 목록을 돌려준다."""
    entry = {
        "name": clean_name(payload.get("name")),
        "score": clamp_int(payload.get("score"), 0, 99_999_999),
        "stage": clamp_int(payload.get("stage"), 1, 99, 1),
        "players": clamp_int(payload.get("players"), 1, 2, 1),
        "at": clamp_int(payload.get("at"), 0, 2**53, int(time.time() * 1000)),
    }

    with scores_lock:
        entries = rank_entries(read_scores() + [entry])
        os.makedirs(os.path.dirname(SCORES_PATH), exist_ok=True)

        # 쓰다가 죽어도 기존 파일이 깨지지 않도록 임시 파일에 쓰고 바꿔치운다.
        temp = SCORES_PATH + ".tmp"
        with open(temp, "w", encoding="utf-8") as handle:
            json.dump({"entries": entries}, handle, ensure_ascii=False, indent=1)
        os.replace(temp, SCORES_PATH)

    return entries


class GameHandler(http.server.SimpleHTTPRequestHandler):
    """캐시를 끄고, 실패한 요청만 로그로 남기는 정적 핸들러."""

    # 기본값인 HTTP/1.0 은 리소스마다 TCP 연결을 새로 맺는다.
    # 스프라이트시트가 30개가 넘어서 첫 로딩이 눈에 띄게 느려지므로 keep-alive 를 켠다.
    protocol_version = "HTTP/1.1"

    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".json": "application/json",
        ".png": "image/png",
        ".gif": "image/gif",
    }

    def end_headers(self) -> None:
        # 에셋을 교체하고 새로고침했을 때 옛 파일이 나오지 않도록 한다.
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def do_GET(self) -> None:
        if self.path.split("?")[0] == SCORES_API:
            self.send_json({"entries": rank_entries(read_scores())})
            return
        super().do_GET()

    def do_POST(self) -> None:
        if self.path.split("?")[0] != SCORES_API:
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        length = clamp_int(self.headers.get("Content-Length"), 0, MAX_BODY_BYTES)
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            self.send_json({"error": "invalid json"}, HTTPStatus.BAD_REQUEST)
            return

        if not isinstance(payload, dict):
            self.send_json({"error": "invalid payload"}, HTTPStatus.BAD_REQUEST)
            return

        entries = add_score(payload)
        print("  [기록] %s  %s" % (clean_name(payload.get("name")), payload.get("score", 0)))
        self.send_json({"entries": entries})

    def send_json(self, payload, status=HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_request(self, code="-", size="-") -> None:
        if isinstance(code, HTTPStatus):
            code = code.value
        if isinstance(code, int) and code >= 400:
            sys.stderr.write("  [%s] %s\n" % (code, self.requestline))

    def log_message(self, fmt, *args) -> None:
        sys.stderr.write("  " + (fmt % args) + "\n")


class GameServer(http.server.ThreadingHTTPServer):
    # Windows 의 SO_REUSEADDR 는 이미 쓰고 있는 포트에도 바인드를 허용해 버린다.
    # 그러면 포트 점유를 감지하지 못하므로 꺼둔다.
    allow_reuse_address = not IS_WINDOWS
    daemon_threads = True


def bind_server(host: str, port: int, scan: int) -> GameServer:
    """port 부터 차례로 시도해서 비어 있는 포트에 바인딩한다."""
    def handler(*a, **kw):
        return GameHandler(*a, directory=ROOT, **kw)

    last_error = None
    for candidate in range(port, port + max(scan, 1)):
        try:
            return GameServer((host, candidate), handler)
        except OSError as exc:
            last_error = exc
    raise SystemExit(
        "[!] %d~%d 포트가 모두 사용 중입니다: %s" % (port, port + scan - 1, last_error)
    )


def lan_addresses() -> list:
    """다른 기기에서 접속할 때 쓸 수 있는 이 PC 의 IPv4 주소들."""
    primary = None
    try:
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        with probe:
            # UDP 라 실제 패킷은 나가지 않는다. 기본 경로의 인터페이스를 알아내는 용도.
            probe.connect(("8.8.8.8", 80))
            primary = probe.getsockname()[0]
    except OSError:
        pass

    found = set()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            found.add(info[4][0])
    except socket.gaierror:
        pass
    if primary:
        found.add(primary)

    usable = []
    for addr in found:
        ip = ipaddress.ip_address(addr)
        if ip.is_loopback or ip.is_link_local or ip.is_unspecified:
            continue
        usable.append(addr)

    usable.sort(key=lambda a: (a != primary, a))
    return usable


def _encode_ps(text: str) -> str:
    return base64.b64encode(text.encode("utf-16-le")).decode("ascii")


def _powershell(script: str, elevate: bool = False) -> int:
    """PowerShell 을 EncodedCommand 로 실행한다. 따옴표 이스케이프를 피하기 위함."""
    if elevate:
        script = (
            "Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden "
            "-ArgumentList '-NoProfile','-ExecutionPolicy','Bypass',"
            "'-EncodedCommand','%s'" % _encode_ps(script)
        )

    completed = subprocess.run(
        ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass",
         "-EncodedCommand", _encode_ps(script)],
        capture_output=True,
    )
    return completed.returncode


def firewall_rule_exists(port: int) -> bool:
    script = (
        "$ErrorActionPreference = 'SilentlyContinue'\n"
        "$rule = Get-NetFirewallRule -DisplayName '%s'\n"
        "if (-not $rule) { exit 1 }\n"
        "$ports = $rule | Get-NetFirewallPortFilter | ForEach-Object { $_.LocalPort }\n"
        "if ($ports -contains '%d') { exit 0 } else { exit 1 }\n"
    ) % (FIREWALL_RULE_NAME, port)
    return _powershell(script) == 0


def add_firewall_rule(port: int) -> bool:
    """관리자 권한으로 승격해서 인바운드 허용 규칙을 등록한다."""
    script = (
        "$ErrorActionPreference = 'Stop'\n"
        "Remove-NetFirewallRule -DisplayName '%s' -ErrorAction SilentlyContinue\n"
        "New-NetFirewallRule -DisplayName '%s' "
        "-Description 'MotorCityHero local game server' "
        "-Direction Inbound -Action Allow -Protocol TCP -LocalPort %d "
        "-Profile Private | Out-Null\n"
    ) % (FIREWALL_RULE_NAME, FIREWALL_RULE_NAME, port)
    if _powershell(script, elevate=True) != 0:
        return False
    return firewall_rule_exists(port)


def remove_firewall_rule() -> bool:
    script = (
        "$ErrorActionPreference = 'Stop'\n"
        "Remove-NetFirewallRule -DisplayName '%s' -ErrorAction SilentlyContinue\n"
    ) % FIREWALL_RULE_NAME
    return _powershell(script, elevate=True) == 0


def ensure_firewall(port: int) -> None:
    if not IS_WINDOWS:
        return
    if firewall_rule_exists(port):
        print("[방화벽] '%s' 규칙 확인 (TCP %d, 개인 네트워크)" % (FIREWALL_RULE_NAME, port))
        return

    print("[방화벽] TCP %d 인바운드 허용 규칙이 없습니다." % port)
    print("         다른 기기에서 접속하려면 필요합니다. 관리자 권한 창이 뜨면 [예] 를 눌러주세요.")
    if add_firewall_rule(port):
        print("[방화벽] 규칙 등록 완료 (개인 네트워크에서만 허용). 해제는 --close-firewall")
        return

    print("[방화벽] 등록하지 못했습니다. 이 PC 에서만 접속될 수 있습니다.")
    print("         직접 열려면 관리자 권한 PowerShell 에서:")
    print("         New-NetFirewallRule -DisplayName '%s' -Direction Inbound "
          "-Action Allow -Protocol TCP -LocalPort %d -Profile Private"
          % (FIREWALL_RULE_NAME, port))


def print_banner(host: str, port: int) -> None:
    line = "=" * 52
    print()
    print(line)
    print("  모터시티 히어로 : 미스터 D")
    print(line)
    print("  이 PC      http://localhost:%d" % port)
    if host != "127.0.0.1":
        addresses = lan_addresses()
        if not addresses:
            print("  다른 기기  (LAN IP 를 찾지 못했습니다. 네트워크 연결을 확인하세요)")
        for i, addr in enumerate(addresses):
            label = "  다른 기기 " if i == 0 else "            "
            print("%s http://%s:%d" % (label, addr, port))
    print("-" * 52)
    print("  종료: Ctrl+C")
    print(line)
    print()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="모터시티 히어로 로컬 서버")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT,
                        help="사용할 포트 (기본 %d, 점유 중이면 다음 포트로 이동)" % DEFAULT_PORT)
    parser.add_argument("--local-only", action="store_true",
                        help="127.0.0.1 에만 바인딩해서 이 PC 에서만 접속하게 한다")
    parser.add_argument("--no-browser", action="store_true",
                        help="브라우저를 자동으로 열지 않는다")
    parser.add_argument("--no-firewall", action="store_true",
                        help="방화벽 규칙을 확인/등록하지 않는다")
    parser.add_argument("--close-firewall", action="store_true",
                        help="등록해둔 방화벽 규칙을 제거하고 종료한다")
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    if args.close_firewall:
        if not IS_WINDOWS:
            print("[!] Windows 에서만 쓸 수 있는 옵션입니다.")
            return 1
        ok = remove_firewall_rule()
        print("[방화벽] 규칙을 제거했습니다." if ok else "[방화벽] 제거하지 못했습니다.")
        return 0 if ok else 1

    host = "127.0.0.1" if args.local_only else "0.0.0.0"
    server = bind_server(host, args.port, PORT_SCAN_LIMIT)
    port = server.server_address[1]
    if port != args.port:
        print("[i] %d 포트가 사용 중이라 %d 포트로 열었습니다." % (args.port, port))

    if not args.local_only and not args.no_firewall:
        ensure_firewall(port)

    print_banner(host, port)

    if not args.no_browser:
        webbrowser.open("http://localhost:%d/index.html" % port)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n서버를 종료합니다.")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
