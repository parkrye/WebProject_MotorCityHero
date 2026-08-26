#!/usr/bin/env python3
"""도날드 퓨리 2088 로컬 서버.

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
import collections
import hmac
import http.server
import ipaddress
import json
import os
import secrets
import socket
import subprocess
import sys
import threading
import time
import urllib.parse
import webbrowser
from hashlib import sha256
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
SESSION_API = "/api/session"
MAX_ENTRIES = 100
MAX_NAME_LENGTH = 16
MAX_BODY_BYTES = 4096
NAME_CHARSET = set("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ")
scores_lock = threading.Lock()

# --- 랭킹 위조 방지 -----------------------------------------------------------
#
# 예전에는 POST /api/scores 가 완전히 열려 있어서 curl 한 줄이면 아무 점수나
# 꽂을 수 있었다. 아래로 문턱을 올린다.
#
#   1. 기록하려면 먼저 POST /api/session 으로 1회용 토큰을 받아야 한다.
#      토큰은 발급 IP 에 묶이고, 쓰면 사라지고, 시간이 지나면 만료된다.
#   2. 제출 본문은 그 세션의 열쇠로 HMAC 서명해야 한다.
#   3. 같은 출처에서 온 요청인지(Origin · Sec-Fetch-Site) 본다.
#   4. 점수 · 스테이지가 그 시점에 나올 수 있는 값인지, 토큰을 받은 뒤
#      최소한의 플레이 시간이 흘렀는지 본다.
#   5. IP 당 발급 · 제출 횟수를 제한한다.
#
# 열쇠가 브라우저 안에 있는 이상 게임 코드를 읽으면 우회할 수 있다.
# 클라이언트를 신뢰하는 구조에서 이건 원리적으로 못 막는다. 목적은 완전 차단이
# 아니라 "URL 을 알아냈다" 수준의 조작을 무의미하게 만드는 것이다.
SESSION_TTL_SECONDS = 3 * 60 * 60   # 한 판이 아무리 길어도 이 안에 끝난다
SESSION_MAX = 2000                  # 메모리 상한. 넘으면 오래된 것부터 버린다
MIN_SECONDS_PER_STAGE = 45          # 스테이지 하나를 넘기는 데 최소로 걸리는 시간
RATE_WINDOW_SECONDS = 600
RATE_MAX_SESSIONS = 40
RATE_MAX_SUBMITS = 20

# 스테이지 N 에서 기록될 수 있는 점수 상한. js/config.js 의 CONFIG.score 를
# 최대치로 굴린 값에 여유를 얹었다. 밸런스를 크게 바꾸면 같이 손봐야 한다.
STAGE_SCORE_CAP = [25_000, 175_000, 360_000, 585_000, 855_000, 999_999]
MAX_SCORE = STAGE_SCORE_CAP[-1]
MAX_STAGE = len(STAGE_SCORE_CAP)

sessions = {}  # token -> {"secret", "ip", "issued"}
rate_log = collections.defaultdict(list)  # (ip, kind) -> [timestamp]
sessions_lock = threading.Lock()


def rate_allow(ip, kind, limit):
    """IP 당 RATE_WINDOW_SECONDS 안에서 limit 번까지만 허용한다."""
    now = time.time()
    with sessions_lock:
        hits = [t for t in rate_log[(ip, kind)] if now - t < RATE_WINDOW_SECONDS]
        allowed = len(hits) < limit
        if allowed:
            hits.append(now)
        rate_log[(ip, kind)] = hits
    return allowed


def open_session(ip):
    """1회용 기록 토큰을 발급한다. 게임을 새로 시작할 때 한 번 받아간다."""
    token = secrets.token_hex(16)
    entry = {"secret": secrets.token_hex(32), "ip": ip, "issued": time.time()}

    with sessions_lock:
        now = time.time()
        for old in [t for t, e in sessions.items() if now - e["issued"] > SESSION_TTL_SECONDS]:
            sessions.pop(old, None)
        while len(sessions) >= SESSION_MAX:
            sessions.pop(next(iter(sessions)))
        sessions[token] = entry

    return {"token": token, "secret": entry["secret"]}


def find_session(token, ip):
    """토큰을 확인만 한다. 실제 소모는 검증을 다 통과한 뒤 consume_session 이 한다.
    @returns (세션, 거절 사유)"""
    if not isinstance(token, str) or not token:
        return None, "no session"

    with sessions_lock:
        entry = sessions.get(token)

    if entry is None:
        return None, "unknown session"
    if entry["ip"] != ip:
        return None, "session from another host"
    if time.time() - entry["issued"] > SESSION_TTL_SECONDS:
        return None, "session expired"
    return entry, None


def consume_session(token):
    """기록이 실제로 들어간 뒤에 태운다. 토큰 하나에 기록 하나."""
    with sessions_lock:
        sessions.pop(token, None)


def sign_payload(secret, payload):
    """클라이언트와 같은 규칙으로 정규화해서 서명한다. 순서가 곧 규칙이다."""
    message = "%s|%s|%d|%d|%d" % (
        payload.get("token", ""),
        clean_name(payload.get("name")),
        clamp_int(payload.get("score"), 0, MAX_SCORE),
        clamp_int(payload.get("stage"), 1, MAX_STAGE, 1),
        clamp_int(payload.get("at"), 0, 2 ** 53),
    )
    return hmac.new(secret.encode("utf-8"), message.encode("utf-8"), sha256).hexdigest()


def check_score(session, score, stage):
    """그 시점에 나올 수 있는 점수인지. @returns 거절 사유 또는 None"""
    if score > STAGE_SCORE_CAP[stage - 1]:
        return "score too high for stage %d" % stage

    # 스테이지를 넘기려면 최소한의 시간이 든다. 받자마자 6스테이지를 낼 수는 없다.
    played = time.time() - session["issued"]
    if played < (stage - 1) * MIN_SECONDS_PER_STAGE:
        return "stage %d too early (%.0fs)" % (stage, played)
    return None


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
        "score": clamp_int(payload.get("score"), 0, MAX_SCORE),
        "stage": clamp_int(payload.get("stage"), 1, MAX_STAGE, 1),
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

    @property
    def client_ip(self) -> str:
        return self.client_address[0]

    def same_origin(self) -> bool:
        """브라우저가 이 페이지에서 보낸 요청인지. 손으로 만든 요청을 걸러낸다."""
        site = self.headers.get("Sec-Fetch-Site")
        if site is not None:
            return site == "same-origin"

        # Sec-Fetch-* 를 안 보내는 구형 브라우저는 Origin/Referer 의 host 로 본다.
        host = (self.headers.get("Host") or "").strip()
        for header in ("Origin", "Referer"):
            value = self.headers.get(header)
            if not value:
                continue
            return urllib.parse.urlsplit(value).netloc == host
        return False

    def read_json(self):
        """본문을 끝까지 읽고 해석한다. @returns (본문 dict, 오류 메시지)"""
        declared = clamp_int(self.headers.get("Content-Length"), 0, 2 ** 31)
        if declared > MAX_BODY_BYTES:
            self.close_connection = True # 남은 본문을 읽지 않고 끊는다
            return None, "body too large"

        raw = self.rfile.read(declared)
        if "application/json" not in (self.headers.get("Content-Type") or ""):
            return None, "expected application/json"

        try:
            payload = json.loads(raw or b"{}")
        except ValueError:
            return None, "invalid json"

        if not isinstance(payload, dict):
            return None, "invalid payload"
        return payload, None

    def do_POST(self) -> None:
        path = self.path.split("?")[0]
        if path not in (SCORES_API, SESSION_API):
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        # 거절하더라도 본문은 먼저 다 읽어야 한다. 안 읽고 응답하면 keep-alive
        # 연결에서 다음 요청이 이 본문을 요청 줄로 읽어 어긋난다.
        payload, error = self.read_json()

        if not self.same_origin():
            self.reject("cross-origin request", HTTPStatus.FORBIDDEN)
            return
        if error:
            self.reject(error, HTTPStatus.BAD_REQUEST)
            return

        if path == SESSION_API:
            self.post_session()
            return
        self.post_score(payload)

    def post_session(self) -> None:
        if not rate_allow(self.client_ip, "session", RATE_MAX_SESSIONS):
            self.reject("too many sessions", HTTPStatus.TOO_MANY_REQUESTS)
            return
        self.send_json(open_session(self.client_ip))

    def post_score(self, payload) -> None:
        if not rate_allow(self.client_ip, "score", RATE_MAX_SUBMITS):
            self.reject("too many submissions", HTTPStatus.TOO_MANY_REQUESTS)
            return

        session, error = find_session(payload.get("token"), self.client_ip)
        if error:
            self.reject(error, HTTPStatus.FORBIDDEN)
            return

        expected = sign_payload(session["secret"], payload)
        if not hmac.compare_digest(expected, str(payload.get("sig") or "")):
            self.reject("bad signature", HTTPStatus.FORBIDDEN)
            return

        score = clamp_int(payload.get("score"), 0, MAX_SCORE)
        stage = clamp_int(payload.get("stage"), 1, MAX_STAGE, 1)
        error = check_score(session, score, stage)
        if error:
            self.reject(error, HTTPStatus.FORBIDDEN)
            return

        consume_session(payload["token"])
        entries = add_score(payload)
        print("  [기록] %s  %s" % (clean_name(payload.get("name")), score))
        self.send_json({"entries": entries})

    def reject(self, reason, status) -> None:
        print("  [거절] %s  %s (%s)" % (self.client_ip, reason, self.path))
        self.send_json({"error": reason}, status)

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
    print("  도날드 퓨리 2088")
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
    parser = argparse.ArgumentParser(description="도날드 퓨리 2088 로컬 서버")
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
