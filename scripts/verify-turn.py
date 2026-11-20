#!/usr/bin/env python3
"""Minimal TURN client — verifies credentials by performing a real Allocate.

Implements just enough of RFC 5389 / 5766 to prove that a relay will grant us a
public transport address. Used to validate Metered / coturn credentials without
needing a browser.

Usage:
  python3 scripts/verify-turn.py <host> <port> <username> <password> [tls]
"""
import base64
import hashlib
import hmac
import os
import socket
import ssl
import struct
import sys

MAGIC = 0x2112A442
ALLOCATE = 0x0003
SUCCESS = 0x0103
ERROR = 0x0113

ATTR_USERNAME = 0x0006
ATTR_MESSAGE_INTEGRITY = 0x0008
ATTR_ERROR_CODE = 0x0009
ATTR_REALM = 0x0014
ATTR_NONCE = 0x0015
ATTR_REQUESTED_TRANSPORT = 0x0019
ATTR_XOR_RELAYED_ADDRESS = 0x0016
ATTR_LIFETIME = 0x000D


def attr(kind, value):
    pad = (4 - len(value) % 4) % 4
    return struct.pack('!HH', kind, len(value)) + value + b'\x00' * pad


def build(msg_type, attrs, txn, integrity_key=None):
    body = b''.join(attrs)
    if integrity_key:
        # length must include the MESSAGE-INTEGRITY attribute itself (24 bytes)
        hdr = struct.pack('!HHI', msg_type, len(body) + 24, MAGIC) + txn
        digest = hmac.new(integrity_key, hdr + body, hashlib.sha1).digest()
        body += attr(ATTR_MESSAGE_INTEGRITY, digest)
    hdr = struct.pack('!HHI', msg_type, len(body), MAGIC) + txn
    return hdr + body


def parse(data):
    msg_type, length = struct.unpack('!HH', data[:4])
    txn = data[8:20]
    out = {}
    i = 20
    while i + 4 <= 20 + length:
        kind, alen = struct.unpack('!HH', data[i:i + 4])
        val = data[i + 4:i + 4 + alen]
        out.setdefault(kind, []).append(val)
        i += 4 + alen + ((4 - alen % 4) % 4)
    return msg_type, out, txn


def error_code(val):
    code = (val[2] & 0x07) * 100 + val[3]
    return code, val[4:].decode('utf-8', 'replace')


def main():
    host, port, user, password = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4]
    tls = len(sys.argv) > 5 and sys.argv[5] == 'tls'

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(8)
    sock.connect((host, port))
    if tls:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        sock = ctx.wrap_socket(sock, server_hostname=host)

    # 1) unauthenticated allocate -> 401 carrying REALM + NONCE
    txn = os.urandom(12)
    req = build(ALLOCATE, [attr(ATTR_REQUESTED_TRANSPORT, b'\x11\x00\x00\x00')], txn)
    sock.sendall(req)
    data = sock.recv(4096)
    mtype, a, _ = parse(data)
    if mtype != ERROR:
        print(f'FAIL expected 401, got 0x{mtype:04x}')
        return 1
    realm = a[ATTR_REALM][0]
    nonce = a[ATTR_NONCE][0]
    code, reason = error_code(a[ATTR_ERROR_CODE][0])
    print(f'  challenge: {code} {reason}  realm={realm.decode()}')

    # 2) authenticated allocate
    key = hashlib.md5(f'{user}:{realm.decode()}:{password}'.encode()).digest()
    txn = os.urandom(12)
    attrs = [
        attr(ATTR_REQUESTED_TRANSPORT, b'\x11\x00\x00\x00'),
        attr(ATTR_USERNAME, user.encode()),
        attr(ATTR_REALM, realm),
        attr(ATTR_NONCE, nonce),
    ]
    sock.sendall(build(ALLOCATE, attrs, txn, integrity_key=key))
    data = sock.recv(4096)
    mtype, a, _ = parse(data)

    if mtype == SUCCESS:
        relayed = 'unknown'
        if ATTR_XOR_RELAYED_ADDRESS in a:
            v = a[ATTR_XOR_RELAYED_ADDRESS][0]
            xport = struct.unpack('!H', v[2:4])[0] ^ (MAGIC >> 16)
            ip = bytes(b ^ MAGIC.to_bytes(4, 'big')[i] for i, b in enumerate(v[4:8]))
            relayed = f'{socket.inet_ntoa(ip)}:{xport}'
        life = struct.unpack('!I', a[ATTR_LIFETIME][0])[0] if ATTR_LIFETIME in a else 0
        print(f'  ALLOCATED relay address {relayed}  lifetime={life}s')
        print('PASS  credentials accepted, relay granted a public address')
        return 0

    if mtype == ERROR:
        code, reason = error_code(a[ATTR_ERROR_CODE][0])
        print(f'FAIL  {code} {reason}')
        return 1
    print(f'FAIL  unexpected response 0x{mtype:04x}')
    return 1


if __name__ == '__main__':
    sys.exit(main())
